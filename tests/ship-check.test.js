#!/usr/bin/env node

'use strict'

const assert = require('assert')
const crypto = require('crypto')
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
  writeReceiptBundle,
} = require('../lib/commands/ship-check')
const {
  RELEASE_RECEIPT_USAGE,
  ReleaseReceiptUsageError,
  normalizeReleaseReceiptArgs,
} = require('../lib/commands/release-receipt')

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
    previewUrl: options.previewUrl,
    previewConfigPath: options.previewConfigPath,
    previewEvidence: options.previewEvidence,
  })
  return { report, calls }
}

function verifyViaCli(target, report, filename, { legacy = false } = {}) {
  const output = path.join(target.root, '.qa-architect', filename)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  const commandArgs = legacy
    ? ['--ship-check', '--verify-ship-manifest', output, '--json']
    : ['receipt', 'check-freshness', output, '--json']
  return spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'setup.js'), ...commandArgs],
    {
      cwd: target.root,
      encoding: 'utf8',
      env: {
        ...process.env,
        QAA_DEVELOPER: '',
        QAA_LICENSE_DIR: fs.mkdtempSync(
          path.join(os.tmpdir(), 'qaa-free-receipt-license-')
        ),
        NODE_ENV: 'test',
      },
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

test('Release Receipt aliases normalize without changing unrelated arguments', () => {
  assert.deepStrictEqual(normalizeReleaseReceiptArgs(['receipt', 'create']), [
    '--ship-check',
  ])
  assert.deepStrictEqual(
    normalizeReleaseReceiptArgs([
      'receipt',
      'check-freshness',
      './receipt.json',
      '--json',
    ]),
    ['--ship-check', '--verify-ship-manifest', './receipt.json', '--json']
  )
  assert.deepStrictEqual(normalizeReleaseReceiptArgs(['--audit', '--json']), [
    '--audit',
    '--json',
  ])
})

test('invalid Release Receipt syntax has an actionable usage contract', () => {
  assert.throws(
    () => normalizeReleaseReceiptArgs(['receipt', 'verify']),
    error =>
      error instanceof ReleaseReceiptUsageError &&
      error.message.includes(RELEASE_RECEIPT_USAGE)
  )
  assert.throws(
    () => normalizeReleaseReceiptArgs(['receipt', 'create', 'unexpected']),
    error => error instanceof ReleaseReceiptUsageError
  )
  assert.throws(
    () =>
      normalizeReleaseReceiptArgs([
        'receipt',
        'create',
        '--verify-ship-manifest',
        'receipt.json',
      ]),
    error => error instanceof ReleaseReceiptUsageError
  )
  assert.throws(
    () =>
      normalizeReleaseReceiptArgs([
        'receipt',
        'check-freshness',
        'first.json',
        '--verify-ship-manifest',
        'second.json',
      ]),
    error => error instanceof ReleaseReceiptUsageError
  )
  assert.throws(
    () =>
      normalizeReleaseReceiptArgs([
        'receipt',
        'check-freshness',
        'first.json',
        'second.json',
      ]),
    error => error instanceof ReleaseReceiptUsageError
  )
  const cli = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'setup.js'), 'receipt', 'verify'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  assert.strictEqual(cli.status, 2)
  assert.match(cli.stderr, /receipt check-freshness <manifest-path>/)
})

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

test('preview evidence is required, revision-bound, and verdict-bearing', () => {
  const target = fixture()
  const configRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-preview-config-')
  )
  const configPath = path.join(configRoot, 'preview.json')
  const configSource = '{"schemaVersion":"1.0.0"}\n'
  fs.writeFileSync(configPath, configSource)
  const configSha256 = crypto
    .createHash('sha256')
    .update(configSource)
    .digest('hex')
  const evidence = status => ({
    schemaVersion: '1.0.0',
    checkVersion: '1.0.0',
    status,
    target: 'https://example-preview.vercel.app',
    environment: {
      classification: 'preview',
      revisionBinding: 'verified',
      deploymentIdSha256: null,
    },
    configSha256,
    checks: [
      {
        id: 'deployment-revision-binding',
        version: '1.0.0',
        status,
        summary: status,
        observations: [],
      },
    ],
    evaluatedAt: new Date().toISOString(),
  })
  const passedReport = runFixture(target, {
    previewUrl: 'https://example-preview.vercel.app',
    previewConfigPath: configPath,
    previewEvidence: evidence('pass'),
  }).report
  assert.strictEqual(passedReport.verdict, VERDICT.PASS)
  assert.ok(passedReport.requiredChecks.includes('preview-runtime'))
  const validate = manifestValidator()
  assert.strictEqual(
    validate(passedReport),
    true,
    JSON.stringify(validate.errors)
  )
  assert.strictEqual(
    verifyShipManifest(target.root, passedReport, {
      previewConfigPath: configPath,
    }).fresh,
    true
  )
  fs.writeFileSync(configPath, '{"changed":true}\n')
  assert.ok(
    verifyShipManifest(target.root, passedReport, {
      previewConfigPath: configPath,
    }).reasons.includes('preview-config-changed')
  )
  const blocked = runFixture(target, {
    previewUrl: 'https://example-preview.vercel.app',
    previewEvidence: evidence('fail'),
  }).report
  assert.strictEqual(blocked.verdict, VERDICT.BLOCK)
  const incomplete = runFixture(target, {
    previewUrl: 'https://example-preview.vercel.app',
  }).report
  assert.strictEqual(incomplete.verdict, VERDICT.INCOMPLETE)
  fs.rmSync(configRoot, { recursive: true, force: true })
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

test('the free CLI checks a saved manifest for local checkout freshness', () => {
  const target = fixture()
  const report = runFixture(target).report
  const cli = verifyViaCli(target, report, 'pass-manifest.json')
  assert.strictEqual(cli.status, 0, cli.stderr || cli.stdout)
  assert.strictEqual(JSON.parse(cli.stdout).fresh, true)
})

test('the legacy manifest verifier remains compatible', () => {
  const target = fixture()
  const report = runFixture(target).report
  const cli = verifyViaCli(target, report, 'legacy-manifest.json', {
    legacy: true,
  })
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

test('manifest freshness checking rejects malformed input safely', () => {
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
  const findingFingerprint = 'a'.repeat(64)
  fs.writeFileSync(
    reference,
    `${JSON.stringify({ assurance: { verdict: 'PASS', revision: { value: target.head }, findings: [{ fingerprint: findingFingerprint }], checks: [{ engine: { rulePackVersion: '2.0.0' } }] } })}\n`
  )
  const freshReport = runFixture(target, { referencePaths: [reference] }).report
  assert.strictEqual(freshReport.verdict, VERDICT.PASS)
  assert.deepStrictEqual(freshReport.references[0].findingFingerprints, [
    findingFingerprint,
  ])
  assert.strictEqual(freshReport.references[0].rulePackVersion, '2.0.0')
  fs.writeFileSync(
    reference,
    `${JSON.stringify({ assurance: { verdict: 'PASS', revision: { value: target.head }, checks: [{ engine: { rulePackVersion: '1.0.0' } }, { engine: { rulePackVersion: '2.0.0' } }] } })}\n`
  )
  const mixedReport = runFixture(target, { referencePaths: [reference] }).report
  assert.strictEqual(mixedReport.verdict, VERDICT.INCOMPLETE)
  assert.strictEqual(mixedReport.references[0].verdict, 'MALFORMED')
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
  assert.ok(markdown.startsWith('# Release Receipt — PASS'))
  assert.ok(markdown.includes(report.evidenceIdentity))
})

test('artifact directory writes two projections and preserves unrelated files', () => {
  const target = fixture()
  const report = runFixture(target).report
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-receipt-'))
  const unrelatedPath = path.join(artifactDir, 'customer-note.txt')
  fs.writeFileSync(unrelatedPath, 'keep me\n')

  const files = writeReceiptBundle(artifactDir, report, artifactDir)

  assert.deepStrictEqual(
    files.map(filename => path.basename(filename)).sort(),
    ['release-receipt.json', 'release-receipt.md']
  )
  assert.deepStrictEqual(
    JSON.parse(
      fs.readFileSync(path.join(artifactDir, 'release-receipt.json'), 'utf8')
    ),
    report
  )
  assert.ok(
    fs
      .readFileSync(path.join(artifactDir, 'release-receipt.md'), 'utf8')
      .startsWith('# Release Receipt — PASS')
  )
  assert.strictEqual(fs.readFileSync(unrelatedPath, 'utf8'), 'keep me\n')
})

test('artifact directory refuses dangling output symlinks before any write', () => {
  const target = fixture()
  const report = runFixture(target).report
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-receipt-'))
  const escapedPath = path.join(target.root, 'escaped-receipt.json')
  const outputPath = path.join(artifactDir, 'release-receipt.json')
  fs.symlinkSync(escapedPath, outputPath)

  assert.throws(
    () => writeReceiptBundle(artifactDir, report, artifactDir),
    /Refusing to write Release Receipt through a symlink/
  )
  assert.ok(!fs.existsSync(escapedPath))
  assert.ok(!fs.existsSync(path.join(artifactDir, 'release-receipt.md')))
})

test('artifact directory refuses a symlinked destination directory', () => {
  const target = fixture()
  const report = runFixture(target).report
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-receipt-'))
  const redirectedDir = path.join(parent, 'redirected')
  const artifactDir = path.join(parent, 'artifacts')
  fs.mkdirSync(redirectedDir)
  fs.symlinkSync(redirectedDir, artifactDir)

  assert.throws(
    () => writeReceiptBundle(artifactDir, report, parent),
    /symlink/
  )
  assert.deepStrictEqual(fs.readdirSync(redirectedDir), [])
})

test('artifact directory refuses symlinked components below its trusted root', () => {
  const target = fixture()
  const report = runFixture(target).report
  const redirectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-redirect-'))
  const controlledPath = path.join(target.root, '.qa-architect')
  const artifactDir = path.join(controlledPath, 'release-receipt')
  fs.symlinkSync(redirectedDir, controlledPath)

  assert.throws(
    () => writeReceiptBundle(artifactDir, report, target.root),
    /Release Receipt path contains a symlink/
  )
  assert.deepStrictEqual(fs.readdirSync(redirectedDir), [])
})

test('artifact bundle preflight preserves an existing pair on invalid target type', () => {
  const target = fixture()
  const report = runFixture(target).report
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-receipt-'))
  const jsonPath = path.join(artifactDir, 'release-receipt.json')
  const markdownPath = path.join(artifactDir, 'release-receipt.md')
  fs.writeFileSync(jsonPath, 'old-json\n')
  fs.mkdirSync(markdownPath)

  assert.throws(
    () => writeReceiptBundle(artifactDir, report, artifactDir),
    /Release Receipt output must be a regular file/
  )
  assert.strictEqual(fs.readFileSync(jsonPath, 'utf8'), 'old-json\n')
  assert.ok(fs.statSync(markdownPath).isDirectory())
})

test('artifact bundle rolls back both projections when publication is partial', () => {
  const target = fixture()
  const report = runFixture(target).report
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-receipt-'))
  const jsonPath = path.join(artifactDir, 'release-receipt.json')
  const markdownPath = path.join(artifactDir, 'release-receipt.md')
  fs.writeFileSync(jsonPath, 'old-json\n')
  fs.writeFileSync(markdownPath, 'old-markdown\n')
  const renameSync = fs.renameSync
  fs.renameSync = (source, destination) => {
    const sourcePath = source.toString()
    if (
      path.basename(sourcePath).startsWith('.release-receipt.md.') &&
      sourcePath.endsWith('.tmp')
    ) {
      const error = Object.assign(
        new Error('injected second-publication failure'),
        { code: 'EIO' }
      )
      throw error
    }
    return renameSync(source, destination)
  }
  try {
    assert.throws(
      () => writeReceiptBundle(artifactDir, report, artifactDir),
      /injected second-publication failure/
    )
  } finally {
    fs.renameSync = renameSync
  }

  assert.strictEqual(fs.readFileSync(jsonPath, 'utf8'), 'old-json\n')
  assert.strictEqual(fs.readFileSync(markdownPath, 'utf8'), 'old-markdown\n')
  assert.deepStrictEqual(fs.readdirSync(artifactDir).sort(), [
    'release-receipt.json',
    'release-receipt.md',
  ])
})

test('receipt create routes through the packaged CLI and writes the bundle', () => {
  const target = fixture()
  const artifactDir = path.join(target.root, '.qa-architect', 'release-receipt')
  const cli = spawnSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'setup.js'),
      'receipt',
      'create',
      '--base-sha',
      target.base,
      '--head',
      target.head,
      '--skip-tests',
      '--artifact-dir',
      artifactDir,
      '--json',
    ],
    {
      cwd: target.root,
      encoding: 'utf8',
      env: { ...process.env, QAA_DEVELOPER: 'true', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  assert.ok([0, 1, 2].includes(cli.status), cli.stderr || cli.stdout)
  const receipt = JSON.parse(
    fs.readFileSync(path.join(artifactDir, 'release-receipt.json'), 'utf8')
  )
  assert.strictEqual(receipt.revision.base, target.base)
  assert.strictEqual(receipt.revision.head, target.head)
  assert.ok(
    fs
      .readFileSync(path.join(artifactDir, 'release-receipt.md'), 'utf8')
      .startsWith(`# Release Receipt — ${receipt.verdict}`)
  )
})

console.log(`\n${passed} passed, ${failed} failed (ship-check.test.js)`)
if (failed > 0) process.exit(1)
