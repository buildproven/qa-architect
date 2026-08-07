#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const Ajv = require('ajv/dist/2020').default
const addFormats = require('ajv-formats').default
const {
  STATUS,
  VERDICT,
  buildHumanReport,
  buildMarkdown,
  computeVerdict,
  parseEnvKeys,
  runShipCheck,
  verifyShipManifest,
} = require('../lib/commands/ship-check')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed += 1
  } catch (error) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${error.stack || error.message}`)
    failed += 1
  }
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function policy(
  requiredChecks = ['lint-and-format', 'test-unit', 'security-scan']
) {
  return {
    riskTierRules: {
      critical: ['package.json'],
      high: ['lib/**'],
      medium: ['tests/**'],
      low: ['docs/**', 'README.md', '*.md'],
    },
    mergePolicy: {
      critical: { requiredChecks },
      high: { requiredChecks },
      medium: { requiredChecks },
      low: { requiredChecks: ['lint-and-format', 'security-scan'] },
    },
  }
}

/**
 * @param {{requiredChecks?: string[], changedPath?: string, dependencies?: Record<string,string>, build?: boolean}} [options]
 */
function fixture({
  requiredChecks,
  changedPath = 'lib/app.js',
  dependencies = {},
  build = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-ship-check-'))
  git(root, ['init', '-b', 'main'])
  git(root, ['config', 'user.email', 'qaa@example.test'])
  git(root, ['config', 'user.name', 'QA Architect Test'])
  fs.writeFileSync(path.join(root, '.gitignore'), '.qa-architect/\ncoverage/\n')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        scripts: {
          'format:check': 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
          'security:secrets': 'node -e "process.exit(0)"',
          ...(build ? { build: 'node -e "process.exit(0)"' } : {}),
        },
        dependencies,
      },
      null,
      2
    )}\n`
  )
  fs.writeFileSync(
    path.join(root, 'README.md'),
    `# Fixture\n\n${'Exact revision assurance. '.repeat(12)}\n`
  )
  fs.writeFileSync(
    path.join(root, 'harness-config.json'),
    `${JSON.stringify(policy(requiredChecks), null, 2)}\n`
  )
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'test: base'])
  const base = git(root, ['rev-parse', 'HEAD'])
  git(root, ['switch', '-c', 'feature/ship-check'])
  const target = path.join(root, changedPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, 'module.exports = true\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'feat: change fixture'])
  return { root, base, head: git(root, ['rev-parse', 'HEAD']) }
}

function successfulRunner(calls, overrides = {}) {
  return (executable, args) => {
    calls.push({ executable, args: [...args] })
    const key = args.join(' ')
    if (overrides[key]) return overrides[key]
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: '',
      stderr: '',
    }
  }
}

function runFixture(target, options = {}) {
  const calls = []
  const report = runShipCheck(target.root, {
    baseSha: target.base,
    commandRunner: successfulRunner(calls, options.overrides),
    workflowTier: options.workflowTier || 'minimal',
    referencePaths: options.referencePaths || [],
    skipTests: options.skipTests || false,
    riskPolicyPath: options.riskPolicyPath,
  })
  return { report, calls }
}

function verifyViaCli(target, report, filename) {
  const output = path.join(target.root, '.qa-architect', filename)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  return spawnSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'setup.js'),
      '--ship-check',
      '--verify-ship-manifest',
      output,
      '--json',
    ],
    {
      cwd: target.root,
      encoding: 'utf8',
      env: { ...process.env, QAA_DEVELOPER: 'true', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
}

function manifestValidator() {
  const ajv = new Ajv({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(
    JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'config',
          'ship-assurance-manifest-v1.schema.json'
        ),
        'utf8'
      )
    )
  )
}

console.log('\nRevision-bound Ship Check')

test('parses environment keys without values or comments', () => {
  assert.deepStrictEqual(
    parseEnvKeys('# comment\nFOO=bar\nBAZ=quux=with=equals\n QUUX = value\n'),
    ['FOO', 'BAZ', 'QUUX']
  )
})

test('required failures block and missing evidence is incomplete', () => {
  assert.strictEqual(
    computeVerdict([{ required: true, status: STATUS.FAIL }]),
    VERDICT.BLOCK
  )
  assert.strictEqual(
    computeVerdict([{ required: true, status: STATUS.SKIP }]),
    VERDICT.INCOMPLETE
  )
  assert.strictEqual(
    computeVerdict([{ required: false, status: STATUS.WARN }]),
    VERDICT.PASS
  )
})

test('secrets and dependency audit both execute and bind to one revision', () => {
  const target = fixture()
  const { report, calls } = runFixture(target)
  assert.strictEqual(report.verdict, VERDICT.PASS)
  assert.strictEqual(report.revision.base, target.base)
  assert.strictEqual(report.revision.head, target.head)
  assert.match(report.revision.diffSha256, /^[a-f0-9]{64}$/)
  assert.ok(calls.some(call => call.args.includes('security:secrets')))
  assert.ok(calls.some(call => call.args[0] === 'audit'))
  const validate = manifestValidator()
  assert.strictEqual(validate(report), true, JSON.stringify(validate.errors))
})

test('a skipped required test produces INCOMPLETE', () => {
  const target = fixture()
  const { report } = runFixture(target, { skipTests: true })
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(
    report.results.find(result => result.id === 'tests').status,
    STATUS.SKIP
  )
})

test('a timed-out required test produces INCOMPLETE', () => {
  const target = fixture()
  const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
  const { report } = runFixture(target, {
    overrides: {
      'run --silent test': {
        status: null,
        signal: 'SIGTERM',
        error: timeout,
        stdout: '',
        stderr: '',
      },
    },
  })
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(
    report.results.find(result => result.id === 'tests').status,
    STATUS.INCOMPLETE
  )
})

test('a malformed risk policy produces INCOMPLETE', () => {
  const target = fixture()
  const malformed = path.join(target.root, 'malformed-risk-policy.json')
  fs.writeFileSync(malformed, '{"riskTierRules": {}}\n')
  const { report } = runFixture(target, { riskPolicyPath: malformed })
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(report.risk.tier, 'critical')
  assert.ok(report.results.some(result => result.id === 'risk-policy'))
})

test('an unreadable waiver policy produces INCOMPLETE evidence', () => {
  const target = fixture()
  fs.mkdirSync(path.join(target.root, '.qa-architect-assurance.json'))
  const { report } = runFixture(target)
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(report.waivers.error, 'waiver-policy-unreadable')
  assert.ok(
    report.results.some(
      result =>
        result.id === 'waiver-policy' && result.status === STATUS.INCOMPLETE
    )
  )
})

test('a non-Git project cannot produce complete revision evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-ship-non-git-'))
  fs.writeFileSync(
    path.join(root, 'README.md'),
    `# Fixture\n\n${'No immutable Git revision. '.repeat(12)}\n`
  )
  const report = runShipCheck(root, {
    commandRunner: successfulRunner([]),
    workflowTier: 'minimal',
  })
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(report.risk.tier, 'critical')
  assert.ok(
    report.results.some(
      result =>
        result.id === 'revision-binding' &&
        result.summary === 'not-a-git-checkout'
    )
  )
})

test('a dependency vulnerability blocks independently of secret scanning', () => {
  const target = fixture()
  const { report, calls } = runFixture(target, {
    overrides: {
      'audit --json --audit-level=high --omit=dev': {
        status: 1,
        signal: null,
        error: null,
        stdout: JSON.stringify({
          metadata: {
            vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 },
          },
        }),
        stderr: '',
      },
    },
  })
  assert.strictEqual(report.verdict, VERDICT.BLOCK)
  assert.ok(calls.some(call => call.args.includes('security:secrets')))
})

test('an unavailable dependency audit produces INCOMPLETE', () => {
  const target = fixture()
  const { report } = runFixture(target, {
    overrides: {
      'audit --json --audit-level=high --omit=dev': {
        status: 1,
        signal: null,
        error: null,
        stdout: '',
        stderr: 'registry unavailable',
      },
    },
  })
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(
    report.results.find(result => result.id === 'dependency-audit').status,
    STATUS.INCOMPLETE
  )
})

test('a check that mutates the candidate makes execution INCOMPLETE', () => {
  const target = fixture()
  const calls = []
  const runner = (executable, args) => {
    calls.push({ executable, args })
    if (args.join(' ') === 'run --silent test') {
      fs.appendFileSync(path.join(target.root, 'lib', 'app.js'), '// mutated\n')
    }
    return { status: 0, signal: null, error: null, stdout: '', stderr: '' }
  }
  const report = runShipCheck(target.root, {
    baseSha: target.base,
    commandRunner: runner,
    workflowTier: 'minimal',
  })
  assert.strictEqual(report.verdict, VERDICT.INCOMPLETE)
  assert.ok(report.results.some(result => result.id === 'execution-freshness'))
})

test('identical inputs have the same identity despite timestamp metadata', () => {
  const target = fixture()
  const first = runFixture(target).report
  const second = runFixture(target).report
  assert.strictEqual(first.evidenceIdentity, second.evidenceIdentity)
  assert.strictEqual(first.revision.diffSha256, second.revision.diffSha256)
})

test('the CLI independently verifies a saved manifest from the checkout', () => {
  const target = fixture()
  const report = runFixture(target).report
  const cli = verifyViaCli(target, report, 'pass-manifest.json')
  assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout)
  assert.strictEqual(JSON.parse(cli.stdout).fresh, true)
})

test('fresh BLOCK and INCOMPLETE manifests retain nonzero CLI verdicts', () => {
  const blockedTarget = fixture()
  const blocked = runFixture(blockedTarget, {
    overrides: {
      'audit --json --audit-level=high --omit=dev': {
        status: 1,
        signal: null,
        error: null,
        stdout: JSON.stringify({
          metadata: {
            vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 },
          },
        }),
        stderr: '',
      },
    },
  }).report
  const blockedCli = verifyViaCli(blockedTarget, blocked, 'block-manifest.json')
  assert.strictEqual(blockedCli.status, 1, blockedCli.stderr)
  assert.strictEqual(JSON.parse(blockedCli.stdout).fresh, true)

  const incompleteTarget = fixture()
  const incomplete = runFixture(incompleteTarget, { skipTests: true }).report
  const incompleteCli = verifyViaCli(
    incompleteTarget,
    incomplete,
    'incomplete-manifest.json'
  )
  assert.strictEqual(incompleteCli.status, 2, incompleteCli.stderr)
  assert.strictEqual(JSON.parse(incompleteCli.stdout).fresh, true)
})

test('independent verification rejects a malformed manifest safely', () => {
  const target = fixture()
  const verification = verifyShipManifest(target.root, {
    schemaVersion: '1.0.0',
    references: [{ path: '../../outside.json' }],
  })
  assert.deepStrictEqual(verification, {
    fresh: false,
    reasons: ['invalid-manifest'],
  })
})

test('a new commit makes prior evidence stale', () => {
  const target = fixture()
  const report = runFixture(target).report
  fs.appendFileSync(
    path.join(target.root, 'lib', 'app.js'),
    'module.exports = false\n'
  )
  git(target.root, ['add', '.'])
  git(target.root, ['commit', '-m', 'fix: advance revision'])
  const verification = verifyShipManifest(target.root, report)
  assert.strictEqual(verification.fresh, false)
  assert.ok(verification.reasons.includes('requested-head-mismatch'))
})

test('policy or relevant config changes make evidence stale', () => {
  const target = fixture()
  const report = runFixture(target).report
  fs.appendFileSync(path.join(target.root, 'harness-config.json'), '\n')
  fs.writeFileSync(path.join(target.root, '.qualityrc.json'), '{}\n')
  const verification = verifyShipManifest(target.root, report)
  assert.strictEqual(verification.fresh, false)
  assert.ok(verification.reasons.includes('worktree-dirty'))
  assert.ok(verification.reasons.includes('policy-changed'))
  assert.ok(verification.reasons.includes('inputs-changed'))
})

test('a rule-pack change makes prior evidence stale', () => {
  const target = fixture()
  const report = runFixture(target).report
  const verification = verifyShipManifest(target.root, report, {
    rulePackVersion: 'future-rule-pack',
  })
  assert.strictEqual(verification.fresh, false)
  assert.ok(verification.reasons.includes('rule-pack-changed'))
})

test('PR assurance references must match the exact head', () => {
  const target = fixture({
    requiredChecks: [
      'lint-and-format',
      'test-unit',
      'security-scan',
      'code-review-agent',
    ],
  })
  const evidenceDir = path.join(target.root, '.qa-architect')
  fs.mkdirSync(evidenceDir, { recursive: true })
  const reference = path.join(evidenceDir, 'assurance.json')
  fs.writeFileSync(
    reference,
    `${JSON.stringify({ assurance: { verdict: 'PASS', revision: { value: target.head } } })}\n`
  )
  const freshReport = runFixture(target, { referencePaths: [reference] }).report
  assert.strictEqual(freshReport.verdict, VERDICT.PASS)
  fs.unlinkSync(reference)
  assert.ok(
    verifyShipManifest(target.root, freshReport).reasons.includes(
      'references-changed'
    )
  )
  fs.writeFileSync(
    reference,
    `${JSON.stringify({ assurance: { verdict: 'PASS', revision: { value: target.base } } })}\n`
  )
  assert.strictEqual(
    runFixture(target, { referencePaths: [reference] }).report.verdict,
    VERDICT.INCOMPLETE
  )
})

test('workflow tiers derive progressively stronger required evidence', () => {
  const target = fixture({ changedPath: 'docs/change.md' })
  const minimal = runFixture(target, { workflowTier: 'minimal' }).report
  const standard = runFixture(target, { workflowTier: 'standard' }).report
  const comprehensive = runFixture(target, {
    workflowTier: 'comprehensive',
  }).report
  assert.ok(!minimal.requiredChecks.includes('tests'))
  assert.ok(standard.requiredChecks.includes('tests'))
  assert.ok(comprehensive.requiredChecks.includes('coverage'))
  assert.strictEqual(comprehensive.verdict, VERDICT.INCOMPLETE)
})

test('detected application stack derives its build requirement', () => {
  const target = fixture({ dependencies: { next: '^16.0.0' }, build: true })
  const { report, calls } = runFixture(target)
  assert.ok(report.stack.includes('nextjs'))
  assert.ok(report.requiredChecks.includes('build'))
  assert.ok(calls.some(call => call.args.includes('build')))
})

test('human and Markdown views retain verdict and evidence identity', () => {
  const target = fixture()
  const report = runFixture(target).report
  assert.ok(buildHumanReport(report).includes('Verdict: PASS'))
  const markdown = buildMarkdown(report)
  assert.ok(markdown.startsWith('# Ship Check — PASS'))
  assert.ok(markdown.includes(report.evidenceIdentity))
})

console.log(`\n${passed} passed, ${failed} failed (ship-check.test.js)`)
if (failed > 0) process.exit(1)
