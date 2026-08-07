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
  blockingIdentity,
  createRemediationPacket,
  evidenceFresh,
  exportRemediationPackets,
  normalizedBlockingSeverity,
  orchestrateRemediation,
  parsePorcelainV1Z,
  redactContext,
  rawFindingMatches,
  rawOccurrenceSha256,
  renderAgentInstructions,
  validateRemediationOutputDirectory,
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

function adapterContractResult(executable, args) {
  const stdout =
    executable === 'codex'
      ? '--cd --sandbox --ephemeral'
      : '--safe-mode --permission-mode --tools --no-session-persistence'
  return {
    executable,
    args,
    status: 0,
    signal: null,
    error: null,
    stdout,
    stderr: '',
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-remediation-test-'))
  run('git', ['init', '-b', 'feature/test-remediation'], root)
  run('git', ['config', 'user.email', 'qaa@example.test'], root)
  run('git', ['config', 'user.name', 'QA Architect Test'], root)
  fs.writeFileSync(path.join(root, '.gitignore'), '.qa-architect/\n')
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

function remediationRefs(root) {
  return {
    worktrees: run('git', ['worktree', 'list', '--porcelain'], root),
    branches: run('git', ['branch', '--list', 'qaa/remediate-*'], root),
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
  const redacted = redactContext("token = 'user:password'")
  assert.ok(!redacted.includes('user'))
  assert.ok(!redacted.includes('password'))
  assert.ok(redacted.includes('[REDACTED'))
  assert.strictEqual(
    redactContext('-----BEGIN PRIVATE KEY-----\nmaterial'),
    '[REDACTED PRIVATE KEY MATERIAL]'
  )
})

test('packet IDs disambiguate identical findings on different lines', () => {
  const { root } = fixture()
  const first = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const second = createRemediationPacket({
    projectPath: root,
    finding: { ...finding(), line: 2, endLine: 2 },
  })
  assert.notStrictEqual(first.packetId, second.packetId)
})

test('exact occurrence proof is content-bound, not count-bound', () => {
  const { root } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const raw = {
    check_id: finding().id,
    path: 'app.js',
    start: { line: 1 },
    end: { line: 1 },
    extra: {
      lines: 'requires login',
      message: finding().message,
      severity: 'ERROR',
      metadata: { cwe: finding().cwe },
    },
  }
  assert.strictEqual(
    packet.finding.occurrenceSha256,
    rawOccurrenceSha256(root, raw)
  )
  assert.strictEqual(rawFindingMatches(raw, packet, root), true)
  fs.appendFileSync(path.join(root, 'app.js'), 'require(other)\n')
  assert.strictEqual(
    rawFindingMatches(
      { ...raw, start: { line: 3 }, end: { line: 3 } },
      packet,
      root
    ),
    false
  )
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-outside-'))
  fs.writeFileSync(path.join(outside, 'external.js'), 'require(name)\n')
  fs.symlinkSync(
    path.join(outside, 'external.js'),
    path.join(root, 'linked.js')
  )
  assert.strictEqual(
    rawOccurrenceSha256(root, { ...raw, path: 'linked.js' }),
    null
  )
})

test('adjacent identity survives line shifts and supports duplicate counts', () => {
  const beforeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-identity-before-')
  )
  const afterRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-identity-after-')
  )
  fs.writeFileSync(path.join(beforeRoot, 'app.js'), 'dangerous(input)\n')
  fs.writeFileSync(path.join(afterRoot, 'app.js'), '\n\n\ndangerous(input)\n')
  const raw = {
    check_id: 'rule',
    path: 'app.js',
    start: { line: 1 },
    end: { line: 1 },
    extra: {
      lines: 'dangerous(input)',
      message: 'Dangerous call',
      severity: 'ERROR',
      metadata: { cwe: 'CWE-78' },
    },
  }
  assert.strictEqual(
    blockingIdentity(raw, beforeRoot),
    blockingIdentity(
      { ...raw, start: { line: 4 }, end: { line: 4 } },
      afterRoot
    )
  )
})

test('focused verification honors the detected manager and real test script', () => {
  const { root } = fixture()
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  assert.deepStrictEqual(packet.verification.focusedCommands[0], {
    executable: 'pnpm',
    args: ['test'],
    timeoutMs: 600_000,
  })
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n')
  const withoutTest = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  assert.deepStrictEqual(withoutTest.verification.focusedCommands, [])
})

test('adapter contract supports Codex and Claude without changing the packet', () => {
  const prompt = 'provider-neutral packet'
  const codex = adapterFor('codex', '/tmp/worktree', prompt)
  const claude = adapterFor('claude', '/tmp/worktree', prompt)
  assert.strictEqual(codex.executable, 'codex')
  assert.strictEqual(claude.executable, 'claude')
  assert.ok(!codex.args.includes(prompt))
  assert.ok(!claude.args.includes(prompt))
  assert.strictEqual(codex.input, prompt)
  assert.strictEqual(claude.input, prompt)
  assert.strictEqual(codex.args.at(-1), '-')
  assert.ok(claude.args.includes('--safe-mode'))
  assert.ok(claude.args.includes('--tools'))
  assert.ok(!claude.args.includes('--allowedTools'))
  assert.throws(() => adapterFor('unknown', '/tmp/worktree', prompt))
})

test('in-repository remediation output must be gitignored and untracked', () => {
  const { root } = fixture()
  assert.strictEqual(
    validateRemediationOutputDirectory(
      root,
      path.join(root, '.qa-architect', 'remediation')
    ),
    path.join(root, '.qa-architect', 'remediation')
  )
  assert.throws(
    () => validateRemediationOutputDirectory(root, path.join(root, 'src')),
    /must be untracked and gitignored/
  )
  assert.throws(
    () => validateRemediationOutputDirectory(root, root),
    /cannot be the project root/
  )
  const external = path.join(os.tmpdir(), 'qaa-external-remediation')
  assert.strictEqual(
    validateRemediationOutputDirectory(root, external),
    external
  )
})

test('NUL porcelain parsing preserves both paths for renames', () => {
  assert.deepStrictEqual(
    parsePorcelainV1Z(
      'R  tests/new-name.test.js\0tests/old-name.test.js\0 M app.js\0'
    ),
    ['tests/new-name.test.js', 'tests/old-name.test.js', 'app.js']
  )
  assert.throws(() => parsePorcelainV1Z('R  tests/new-name.test.js\0'))
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

test('unsupported npm-audit findings are not exported as repairable packets', () => {
  const { root } = fixture()
  const output = path.join(root, 'packets')
  const exports = exportRemediationPackets(
    root,
    [{ ...finding(), source: 'npm-audit' }],
    output
  )
  assert.deepStrictEqual(exports, [])
})

test('adjacent blocking checks use normalized audit severity', () => {
  assert.strictEqual(
    normalizedBlockingSeverity({
      extra: { severity: 'WARNING', metadata: { cwe: 'CWE-78' } },
    }),
    true
  )
  assert.strictEqual(
    normalizedBlockingSeverity({
      extra: { severity: 'WARNING', metadata: { cwe: 'CWE-829' } },
    }),
    false
  )
})

test('CLI --fix exports packets without invoking an agent', () => {
  const { root } = fixture()
  const output = path.join(root, '.qa-architect', 'cli-packets')
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

test('CLI remediation progress does not corrupt JSON stdout', () => {
  const { root } = fixture()
  const output = path.join(root, '.qa-architect', 'json-packets')
  const cli = spawnSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'setup.js'),
      '--audit',
      '--json',
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
  assert.doesNotThrow(() => JSON.parse(cli.stdout))
  assert.ok(!cli.stdout.includes('Remediation packet:'))
})

test('fixture repair proves fail-before, pass-after, regression test, and exact commit', () => {
  const { root, rule } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  const runner = (executable, args, options) => {
    if (args.includes('--help')) return adapterContractResult(executable, args)
    if (executable === 'codex') {
      assert.strictEqual(options.input, renderAgentInstructions(packet))
      assert.ok(!args.includes(options.input))
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
  fs.writeFileSync(path.join(evidence.worktree, 'uncommitted.txt'), 'dirty\n')
  assert.ok(!evidenceFresh(evidence.worktree, evidence))
  fs.unlinkSync(path.join(evidence.worktree, 'uncommitted.txt'))
  const forgedEvidence = { ...evidence, diffSha256: '0'.repeat(64) }
  assert.ok(!evidenceFresh(evidence.worktree, forgedEvidence))
  run(
    'git',
    ['commit', '--allow-empty', '-m', 'test: stale evidence'],
    evidence.worktree
  )
  assert.ok(!evidenceFresh(evidence.worktree, evidence))
})

test('agent-created symlink paths fail closed before regression execution', () => {
  const { root, rule } = fixture()
  const refsBefore = remediationRefs(root)
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  let focusedCommandRan = false
  const runner = (executable, args, options) => {
    if (args.includes('--help')) return adapterContractResult(executable, args)
    if (executable === 'codex') {
      fs.writeFileSync(
        path.join(options.cwd, 'app.js'),
        'module.exports = {}\n'
      )
      fs.symlinkSync(
        path.join(root, 'tests', 'smoke.test.js'),
        path.join(options.cwd, 'tests', 'linked.test.js')
      )
      return {
        executable,
        args,
        status: 0,
        signal: null,
        error: null,
        stdout: '',
        stderr: '',
      }
    }
    focusedCommandRan = true
    return commandResult(executable, args, options.cwd, options.timeout)
  }
  const evidence = orchestrateRemediation({
    projectPath: root,
    packet,
    adapterName: 'codex',
    ruleFiles: [rule],
    commandRunner: runner,
    worktreeRoot: container,
  })
  assert.strictEqual(evidence.status, 'INCOMPLETE')
  assert.strictEqual(evidence.reason, 'unsafe-agent-paths')
  assert.strictEqual(focusedCommandRan, false)
  assert.deepStrictEqual(remediationRefs(root), refsBefore)
  assert.ok(!('worktree' in evidence))
  assert.ok(!('branch' in evidence))
})

test('partial repair without a regression test is never labeled fixed', () => {
  const { root, rule } = fixture()
  const refsBefore = remediationRefs(root)
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  const runner = (executable, args, options) => {
    if (args.includes('--help')) return adapterContractResult(executable, args)
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
  assert.deepStrictEqual(remediationRefs(root), refsBefore)
  const validate = schemaValidator('remediation-evidence-v1.schema.json')
  assert.strictEqual(validate(evidence), true, JSON.stringify(validate.errors))
})

test('an unverified adapter contract fails closed before transmitting a packet', () => {
  const { root, rule } = fixture()
  const refsBefore = remediationRefs(root)
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  let packetTransmitted = false
  const evidence = orchestrateRemediation({
    projectPath: root,
    packet,
    adapterName: 'claude',
    ruleFiles: [rule],
    commandRunner: (executable, args, options) => {
      if (args.includes('--help')) {
        return { ...adapterContractResult(executable, args), stdout: '--print' }
      }
      if (options.input) packetTransmitted = true
      throw new Error('packet must not be transmitted')
    },
  })
  assert.strictEqual(evidence.status, 'INCOMPLETE')
  assert.strictEqual(evidence.reason, 'adapter-contract-unverified')
  assert.strictEqual(packetTransmitted, false)
  assert.deepStrictEqual(remediationRefs(root), refsBefore)
})

test('unexpected adapter errors clean the isolated repository state', () => {
  const { root, rule } = fixture()
  const refsBefore = remediationRefs(root)
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  assert.throws(
    () =>
      orchestrateRemediation({
        projectPath: root,
        packet,
        adapterName: 'codex',
        ruleFiles: [rule],
        commandRunner: (executable, args) => {
          if (args.includes('--help'))
            return adapterContractResult(executable, args)
          throw new Error('simulated adapter exception')
        },
        worktreeRoot: container,
      }),
    /simulated adapter exception/
  )
  assert.deepStrictEqual(remediationRefs(root), refsBefore)
})

test('a failing clean baseline cannot masquerade as fail-before proof', () => {
  const { root, rule } = fixture()
  const packet = createRemediationPacket({
    projectPath: root,
    finding: finding(),
  })
  packet.verification.focusedCommands = [
    {
      executable: process.execPath,
      args: ['-e', 'process.exit(1)'],
      timeoutMs: 10_000,
    },
  ]
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-remediation-worktrees-')
  )
  const runner = (executable, args, options) => {
    if (args.includes('--help')) return adapterContractResult(executable, args)
    if (executable === 'codex') {
      fs.writeFileSync(
        path.join(options.cwd, 'app.js'),
        'module.exports = {}\n'
      )
      fs.writeFileSync(
        path.join(options.cwd, 'tests', 'remediation.test.js'),
        "require('node:test').test('fixed', () => require('../app'))\n"
      )
      return {
        executable,
        args,
        status: 0,
        signal: null,
        error: null,
        stdout: '',
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
  })
  assert.strictEqual(evidence.status, 'INCOMPLETE')
  assert.strictEqual(evidence.reason, 'regression-baseline-not-green')
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
