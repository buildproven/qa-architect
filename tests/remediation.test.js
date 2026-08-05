'use strict'

process.env.QAA_DEVELOPER = 'true'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const Ajv = require('ajv/dist/2020').default
const addFormats = require('ajv-formats').default
const {
  adapterFor,
  createRemediationPacket,
  evidenceFresh,
  exportRemediationPackets,
  orchestrateRemediation,
  redactContext,
  renderAgentInstructions,
} = require('../lib/commands/remediation')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${error.stack || error.message}`)
    failed++
  }
}

function run(executable, args, cwd, timeout = 120_000) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(' ')} failed: ${result.stderr || result.stdout}`
    )
  }
  return (result.stdout || '').trim()
}

function commandResult(executable, args, cwd, timeout = 120_000) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  return {
    executable,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-remediation-test-'))
  run('git', ['init', '-b', 'feature/test-remediation'], root)
  run('git', ['config', 'user.email', 'qaa@example.test'], root)
  run('git', ['config', 'user.name', 'QA Architect Test'], root)
  fs.mkdirSync(path.join(root, 'tests'))
  fs.writeFileSync(
    path.join(root, 'app.js'),
    'function load(name) { return require(name) }\nmodule.exports = { load }\n'
  )
  fs.writeFileSync(
    path.join(root, 'tests', 'smoke.test.js'),
    "require('node:test').test('loads the module', () => require('../app'))\n"
  )
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ scripts: { test: 'node --test tests/*.test.js' } }, null, 2)}\n`
  )
  const rule = path.join(root, 'remediation-rule.yml')
  fs.writeFileSync(
    rule,
    [
      'rules:',
      '  - id: dynamic-require-variable',
      '    languages: [javascript]',
      '    message: Dynamic require is unsafe',
      '    severity: ERROR',
      '    pattern: require($X)',
      '',
    ].join('\n')
  )
  run('git', ['add', '.'], root)
  run('git', ['commit', '-m', 'test: fixture'], root)
  return { root, rule }
}

function finding() {
  return {
    id: 'dynamic-require-variable',
    severity: 'high',
    file: 'app.js',
    line: 1,
    endLine: 1,
    message: 'Dynamic require is unsafe',
    fix: 'Use a static module allowlist.',
    note: null,
    cwe: 'CWE-829',
    owasp: 'A08:2021',
    source: 'semgrep',
  }
}

function schemaValidator(filename) {
  const ajv = new Ajv({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', filename), 'utf8')
    )
  )
}

console.log('\nVerified remediation')

test('packet is provider-neutral, revision-bound, and secret-minimized', () => {
  const { root } = fixture()
  fs.writeFileSync(
    path.join(root, 'app.js'),
    "const apiKey = 'top-secret'\nfunction load(name) { return require(name) }\n"
  )
  run('git', ['add', 'app.js'], root)
  run('git', ['commit', '-m', 'test: secret context'], root)
  const packet = createRemediationPacket({
    projectPath: root,
    finding: { ...finding(), line: 2, endLine: 2 },
  })
  assert.strictEqual(packet.schemaVersion, '1.0.0')
  assert.strictEqual(
    packet.revision.value,
    run('git', ['rev-parse', 'HEAD'], root)
  )
  assert.ok(packet.finding.fingerprint.length === 64)
  assert.ok(packet.context.text.includes('[REDACTED]'))
  assert.ok(!packet.context.text.includes('top-secret'))
  const instructions = renderAgentInstructions(packet)
  assert.ok(!/Claude|Codex|Cursor/.test(instructions))
  const validate = schemaValidator('remediation-packet-v1.schema.json')
  assert.strictEqual(validate(packet), true, JSON.stringify(validate.errors))
})

test('private key and secret assignments are redacted', () => {
  const redacted = redactContext(
    "token = 'secret-value'\n-----BEGIN PRIVATE KEY-----\nmaterial"
  )
  assert.ok(!redacted.includes('secret-value'))
  assert.ok(redacted.includes('[REDACTED'))
})

test('adapter contract supports Codex and Claude without changing the packet', () => {
  const prompt = 'provider-neutral packet'
  const codex = adapterFor('codex', '/tmp/worktree', prompt)
  const claude = adapterFor('claude', '/tmp/worktree', prompt)
  assert.strictEqual(codex.executable, 'codex')
  assert.strictEqual(claude.executable, 'claude')
  assert.ok(codex.args.includes(prompt))
  assert.ok(claude.args.includes(prompt))
  assert.throws(() => adapterFor('unknown', '/tmp/worktree', prompt))
})

test('export writes inspectable mode-0600 packets and sends nothing', () => {
  const { root } = fixture()
  const output = path.join(root, 'packets')
  const exports = exportRemediationPackets(root, [finding()], output)
  assert.strictEqual(exports.length, 1)
  assert.ok(fs.existsSync(exports[0].path))
  assert.strictEqual(fs.statSync(exports[0].path).mode & 0o777, 0o600)
  assert.strictEqual(
    JSON.parse(fs.readFileSync(exports[0].path, 'utf8')).packetId,
    exports[0].packet.packetId
  )
})

test('CLI --fix exports packets without invoking an agent', () => {
  const { root } = fixture()
  const output = path.join(root, 'cli-packets')
  const cli = spawnSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'setup.js'),
      '--audit',
      '--fix',
      '--remediation-out',
      output,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, QAA_DEVELOPER: 'true', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  assert.strictEqual(cli.status, 1, cli.stderr || cli.stdout)
  const packets = fs
    .readdirSync(output)
    .filter(filename => filename.endsWith('.json'))
  assert.ok(packets.length > 0)
  assert.ok(!/invoking (?:Codex|Claude)|Copy this prompt/.test(cli.stdout))
})

test('fixture repair proves fail-before, pass-after, regression test, and exact commit', () => {
  const { root, rule } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const packetPath = path.join(root, 'remediation-packet.json')
  fs.writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`)
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  const runner = (executable, args, options) => {
    if (executable === 'codex') {
      fs.writeFileSync(
        path.join(options.cwd, 'app.js'),
        "const allowed = { crypto: process.getBuiltinModule('crypto') }\nfunction load(name) { return allowed[name] }\nmodule.exports = { load }\n"
      )
      fs.writeFileSync(
        path.join(options.cwd, 'tests', 'remediation.test.js'),
        "const test = require('node:test')\nconst assert = require('node:assert')\nconst { load } = require('../app')\ntest('uses an allowlist', () => {\n  assert.strictEqual(load('crypto'), require('crypto'))\n  assert.strictEqual(load('unknown'), undefined)\n})\n"
      )
      return {
        executable,
        args,
        status: 0,
        signal: null,
        error: null,
        stdout: 'repaired',
        stderr: '',
      }
    }
    return commandResult(executable, args, options.cwd, options.timeout)
  }
  const evidence = orchestrateRemediation({
    projectPath: root,
    packet,
    adapterName: 'codex',
    ruleFiles: [rule],
    commandRunner: runner,
    worktreeRoot: container,
    allowedDirtyPaths: ['remediation-packet.json'],
  })
  assert.strictEqual(evidence.status, 'VERIFIED', evidence.reason)
  if (evidence.status !== 'VERIFIED' || !('changedPaths' in evidence)) {
    throw new Error(`expected VERIFIED evidence, got ${evidence.reason}`)
  }
  assert.ok(evidence.changedPaths.includes('app.js'))
  assert.ok(evidence.changedPaths.includes('tests/remediation.test.js'))
  assert.strictEqual(
    evidence.resultHead,
    run('git', ['rev-parse', 'HEAD'], evidence.worktree)
  )
  assert.ok(evidenceFresh(evidence.worktree, evidence))
  const validate = schemaValidator('remediation-evidence-v1.schema.json')
  assert.strictEqual(validate(evidence), true, JSON.stringify(validate.errors))
  run(
    'git',
    ['commit', '--allow-empty', '-m', 'test: stale evidence'],
    evidence.worktree
  )
  assert.ok(!evidenceFresh(evidence.worktree, evidence))
})

test('partial repair without a regression test is never labeled fixed', () => {
  const { root, rule } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  const runner = (executable, args, options) => {
    if (executable === 'claude') {
      fs.writeFileSync(
        path.join(options.cwd, 'app.js'),
        'module.exports = { load: () => null }\n'
      )
      return {
        executable,
        args,
        status: 0,
        signal: null,
        error: null,
        stdout: 'partial',
        stderr: '',
      }
    }
    return commandResult(executable, args, options.cwd, options.timeout)
  }
  const evidence = orchestrateRemediation({
    projectPath: root,
    packet,
    adapterName: 'claude',
    ruleFiles: [rule],
    commandRunner: runner,
    worktreeRoot: container,
  })
  assert.strictEqual(evidence.status, 'INCOMPLETE')
  assert.strictEqual(evidence.reason, 'regression-test-missing')
  assert.strictEqual(evidence.resultHead, null)
})

test('a packet for a changed commit becomes incomplete before transmission', () => {
  const { root, rule } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  run('git', ['commit', '--allow-empty', '-m', 'test: advance head'], root)
  let invoked = false
  const evidence = orchestrateRemediation({
    projectPath: root,
    packet,
    adapterName: 'codex',
    ruleFiles: [rule],
    commandRunner: () => {
      invoked = true
      throw new Error('must not run')
    },
  })
  assert.strictEqual(evidence.status, 'INCOMPLETE')
  assert.strictEqual(evidence.reason, 'packet-revision-stale')
  assert.strictEqual(invoked, false)
})

test('unrelated user changes stop orchestration before an adapter runs', () => {
  const { root, rule } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  fs.writeFileSync(path.join(root, 'unrelated-user-file.txt'), 'keep me\n')
  let invoked = false
  const evidence = orchestrateRemediation({
    projectPath: root,
    packet,
    adapterName: 'codex',
    ruleFiles: [rule],
    commandRunner: () => {
      invoked = true
      throw new Error('must not run')
    },
  })
  assert.strictEqual(evidence.status, 'INCOMPLETE')
  assert.strictEqual(evidence.reason, 'source-worktree-dirty')
  assert.strictEqual(invoked, false)
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'unrelated-user-file.txt'), 'utf8'),
    'keep me\n'
  )
})

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed (remediation.test.js)`)
  process.exit(1)
}
console.log(`\n${passed} passed, 0 failed (remediation.test.js)`)
