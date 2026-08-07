#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const AjvImport = require('ajv')
const addFormatsImport = require('ajv-formats')

const Ajv = /** @type {any} */ (AjvImport.default || AjvImport)
const addFormats = /** @type {(ajv: any) => void} */ (
  addFormatsImport.default || addFormatsImport
)

const {
  createFingerprint,
  createSourceRevision,
  evaluateAssurance,
  loadRuleCatalog,
  loadAssurancePolicy,
  renderRuleCatalogMarkdown,
  toJson,
  toMarkdown,
  toSarif,
  toTerminal,
} = require('../lib/assurance')

const projectRoot = path.join(os.tmpdir(), 'qaa-assurance-project')
const now = new Date('2026-08-05T12:00:00.000Z')
const gitRevision = { kind: 'git-commit', value: 'a'.repeat(40) }
const engine = {
  name: 'fixture-engine',
  version: '1.0.0',
  rulePackVersion: '1.0.0',
}

function finding(overrides = {}) {
  return {
    source: 'semgrep',
    ruleId: 'sql-injection-template-string',
    ruleVersion: '1.0.0',
    identityVersion: '1.0.0',
    severity: 'high',
    message: 'Untrusted input reaches a SQL query',
    engine,
    location: { path: 'src/db.js', line: 12, endLine: 12 },
    evidenceIdentity: 'db.query(`SELECT * FROM users WHERE id = ${userId}`)',
    continuityIdentity: 'module:db/function:getUser',
    remediation: { guidance: 'Use a parameterized query.' },
    assuranceMappings: [],
    ...overrides,
  }
}

function member(overrides = {}) {
  return {
    key: 'js/tests',
    engine,
    command: { executable: 'npm', args: ['run', 'test'] },
    outcome: 'passed',
    summary: 'Tests passed',
    details: null,
    ...overrides,
  }
}

function check(id, overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    id,
    applicable: true,
    applicabilityReason: `${id} is configured`,
    required: true,
    requiredReason: 'Command floor',
    outcome: 'passed',
    engine,
    members: [member({ key: `js/${id}` })],
    summary: `${id} passed`,
    details: null,
    coverage: null,
    ...overrides,
  }
}

function evaluate(overrides = {}) {
  return evaluateAssurance({
    projectRoot,
    revision: gitRevision,
    supportedChecks: [],
    requiredChecks: [],
    findings: [],
    checks: [],
    policy: null,
    now,
    ...overrides,
  })
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qaa-assurance-${label}-`))
}

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
  } catch (error) {
    console.error(`  ❌ ${name}`)
    throw error
  }
}

console.log('\nAssurance contract')

test('fingerprints ignore line movement and normalize Unicode/path separators', () => {
  const composed = finding({
    evidenceIdentity: 'café',
    location: { path: 'src/db.js', line: 2, endLine: 2 },
  })
  const decomposed = finding({
    evidenceIdentity: 'cafe\u0301',
    location: { path: 'src\\db.js', line: 200, endLine: 203 },
  })
  assert.strictEqual(
    createFingerprint(projectRoot, composed).fingerprint,
    createFingerprint(projectRoot, decomposed).fingerprint
  )
})

test('fingerprints change when structural continuity changes', () => {
  const first = createFingerprint(projectRoot, finding()).fingerprint
  const moved = createFingerprint(
    projectRoot,
    finding({ continuityIdentity: 'module:admin/function:getUser' })
  ).fingerprint
  assert.notStrictEqual(first, moved)
})

test('fingerprints reject paths outside the explicit project root', () => {
  assert.throws(
    () =>
      createFingerprint(
        projectRoot,
        finding({ location: { path: '../secret.js', line: 1, endLine: 1 } })
      ),
    /outside|relative|traversal/i
  )
})

test('missing command-required evidence is INCOMPLETE', () => {
  const result = evaluate({
    supportedChecks: ['sast'],
    requiredChecks: ['sast'],
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.strictEqual(result.checks[0].id, 'sast')
  assert.strictEqual(result.checks[0].outcome, 'missing')
  assert.ok(result.reasons.some(reason => reason.code === 'check.missing'))
})

test('medium findings are advisory while active high findings block', () => {
  const advisory = evaluate({ findings: [finding({ severity: 'medium' })] })
  assert.strictEqual(advisory.verdict, 'PASS')
  assert.strictEqual(advisory.findings[0].blocksMerge, false)

  const blocking = evaluate({ findings: [finding()] })
  assert.strictEqual(blocking.verdict, 'BLOCK')
  assert.strictEqual(blocking.findings[0].blocksMerge, true)
  assert.ok(blocking.reasons.some(reason => reason.code === 'finding.active'))
})

test('INCOMPLETE takes precedence but retains confirmed block reasons', () => {
  const result = evaluate({
    supportedChecks: ['sast'],
    requiredChecks: ['sast'],
    findings: [finding()],
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.ok(result.reasons.some(reason => reason.kind === 'incomplete'))
  assert.ok(result.reasons.some(reason => reason.kind === 'block'))
})

test('a unique matching baseline suppresses while duplicate continuity fails closed', () => {
  const normalized = createFingerprint(projectRoot, finding())
  const policy = {
    schemaVersion: '1.0.0',
    fingerprintVersion: 1,
    baseline: {
      [normalized.fingerprint]: {
        fingerprintVersion: 1,
        identityVersion: '1.0.0',
        count: 1,
        severity: 'high',
        ruleVersion: '1.0.0',
      },
    },
    waivers: {},
    blockingSeverities: ['critical', 'high'],
    requiredChecks: {},
  }

  const suppressed = evaluate({ findings: [finding()], policy })
  assert.strictEqual(suppressed.verdict, 'PASS')
  assert.strictEqual(suppressed.findings[0].disposition, 'baseline')

  const ambiguous = evaluate({ findings: [finding(), finding()], policy })
  assert.strictEqual(ambiguous.verdict, 'INCOMPLETE')
  assert.ok(ambiguous.findings.every(item => item.disposition === 'active'))
  assert.ok(
    ambiguous.reasons.some(reason => reason.code === 'policy.ambiguous-finding')
  )
})

test('expired waivers reactivate findings and make policy evidence incomplete', () => {
  const normalized = createFingerprint(projectRoot, finding())
  const policy = {
    schemaVersion: '1.0.0',
    fingerprintVersion: 1,
    baseline: {},
    waivers: {
      [normalized.fingerprint]: {
        fingerprintVersion: 1,
        identityVersion: '1.0.0',
        count: 1,
        severity: 'high',
        ruleVersion: '1.0.0',
        reason: 'Accepted until migration',
        owner: 'security@example.com',
        createdAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    },
    blockingSeverities: ['critical', 'high'],
    requiredChecks: {},
  }
  const result = evaluate({ findings: [finding()], policy })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.strictEqual(result.findings[0].disposition, 'active')
  assert.strictEqual(result.findings[0].policyEvaluation.state, 'expired')
  assert.ok(
    result.reasons.some(reason => reason.code === 'policy.waiver-expired')
  )
})

test('raw malformed policies fail closed instead of disabling finding blocks', () => {
  const result = evaluate({
    findings: [finding({ severity: 'critical' })],
    policy: {
      schemaVersion: '1.0.0',
      fingerprintVersion: 1,
      baseline: {},
      waivers: {},
      requiredChecks: {},
    },
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.strictEqual(result.findings[0].blocksMerge, true)
  assert.ok(result.reasons.some(reason => reason.code === 'policy.malformed'))
  assert.ok(result.reasons.some(reason => reason.code === 'finding.active'))
})

test('invalid policy wrappers with no errors still fail closed', () => {
  const result = evaluate({
    policy: { valid: false, policy: null, errors: [] },
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.ok(result.reasons.some(reason => reason.code === 'policy.malformed'))
})

test('unsupported policy fingerprint versions are incomplete and never suppress', () => {
  const normalized = createFingerprint(projectRoot, finding())
  const result = evaluate({
    findings: [finding()],
    policy: {
      schemaVersion: '1.0.0',
      fingerprintVersion: 2,
      baseline: {
        [normalized.fingerprint]: {
          fingerprintVersion: 2,
          identityVersion: '1.0.0',
          count: 1,
          severity: 'high',
          ruleVersion: '1.0.0',
        },
      },
      waivers: {},
      blockingSeverities: ['critical', 'high'],
      requiredChecks: {},
    },
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.strictEqual(result.findings[0].disposition, 'active')
  assert.ok(
    result.reasons.some(
      reason => reason.code === 'policy.fingerprint-version-mismatch'
    )
  )
})

test('unknown policy-required checks are rejected explicitly', () => {
  const result = evaluate({
    policy: {
      schemaVersion: '1.0.0',
      fingerprintVersion: 1,
      baseline: {},
      waivers: {},
      blockingSeverities: ['critical', 'high'],
      requiredChecks: { 'eslint-legacy': true },
    },
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.ok(
    result.reasons.some(
      reason => reason.code === 'execution-config.unknown-required-check'
    )
  )
})

test('contradictory applicability cannot become a passing required check', () => {
  const result = evaluate({
    supportedChecks: ['tests'],
    requiredChecks: ['tests'],
    checks: [check('tests', { applicable: false, outcome: 'passed' })],
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.strictEqual(result.checks[0].outcome, 'partial')
  assert.ok(result.reasons.some(reason => reason.code === 'check.partial'))
})

test('invalid coverage and contradictory aggregate members are incomplete', () => {
  const result = evaluate({
    supportedChecks: ['package-registry', 'tests'],
    requiredChecks: ['package-registry', 'tests'],
    checks: [
      check('package-registry', {
        outcome: 'passed',
        coverage: {
          eligible: 2,
          attempted: 1,
          completed: 1,
          excluded: 0,
          completion: 'complete',
          limitations: [],
        },
      }),
      check('tests', {
        outcome: 'passed',
        members: [member({ outcome: 'failed', summary: 'pytest failed' })],
      }),
    ],
  })
  assert.strictEqual(result.verdict, 'INCOMPLETE')
  assert.ok(
    result.reasons.some(reason => reason.code === 'evidence.invalid-coverage')
  )
})

test('policy loader rejects duplicate raw keys before JSON parsing loses them', () => {
  const dir = tempDir('duplicate-policy')
  const policyPath = path.join(dir, '.qa-architect-assurance.json')
  try {
    fs.writeFileSync(
      policyPath,
      '{"schemaVersion":"1.0.0","fingerprintVersion":1,"baseline":{},"baseline":{},"waivers":{},"blockingSeverities":["high"],"requiredChecks":{}}'
    )
    const loaded = loadAssurancePolicy(policyPath, now)
    assert.strictEqual(loaded.valid, false)
    assert.ok(loaded.errors.some(error => /duplicate/i.test(error)))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('content revisions include ignored or untracked eligible bytes', () => {
  const dir = tempDir('revision')
  try {
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const value = 1\n')
    fs.writeFileSync(path.join(dir, '.ignored-secret.js'), 'const secret = 1\n')
    const first = createSourceRevision(dir, [
      'tracked.js',
      '.ignored-secret.js',
    ])
    fs.writeFileSync(path.join(dir, '.ignored-secret.js'), 'const secret = 2\n')
    const second = createSourceRevision(dir, [
      'tracked.js',
      '.ignored-secret.js',
    ])
    assert.strictEqual(first.kind, 'content-digest')
    assert.strictEqual(first.manifestVersion, 1)
    assert.notStrictEqual(first.value, second.value)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('evaluations conform to the shipped strict result schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: true })
  addFormats(ajv)
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'config', 'assurance-result-v1.schema.json'),
      'utf8'
    )
  )
  const validate = ajv.compile(schema)
  const result = evaluate({
    supportedChecks: ['tests'],
    requiredChecks: ['tests'],
    checks: [check('tests')],
  })
  assert.strictEqual(validate(result), true, ajv.errorsText(validate.errors))
})

test('terminal, JSON, Markdown, and SARIF preserve one verdict and disposition', () => {
  const result = evaluate({ findings: [finding()] })
  const terminal = toTerminal(result)
  const json = toJson(result)
  const markdown = toMarkdown(result)
  const sarif = toSarif(result)
  assert.strictEqual(result.verdict, 'BLOCK')
  assert.ok(terminal.includes('Assurance: BLOCK'))
  assert.ok(markdown.includes('**BLOCK**'))
  assert.strictEqual(json.summary.verdict, 'BLOCK')
  assert.strictEqual(json.assurance.verdict, 'BLOCK')
  assert.strictEqual(sarif.runs[0].properties.assuranceVerdict, 'BLOCK')
  assert.strictEqual(
    sarif.runs[0].results[0].partialFingerprints['qaArchitect/v1'],
    result.findings[0].fingerprint
  )
  assert.strictEqual(sarif.runs[0].results[0].properties.disposition, 'active')
})

test('PASS renderers state the supported evidence boundary', () => {
  const result = evaluate({
    supportedChecks: ['tests'],
    requiredChecks: ['tests'],
    checks: [check('tests')],
  })
  assert.ok(toTerminal(result).includes('within the supported scope'))
  assert.ok(toMarkdown(result).includes('within the supported scope'))
  assert.ok(!toMarkdown(result).includes('SAFE TO SHIP'))
})

test('waivers remain visible and become SARIF suppressions', () => {
  const raw = finding()
  const fingerprint = createFingerprint(projectRoot, raw).fingerprint
  const result = evaluate({
    findings: [raw],
    policy: {
      schemaVersion: '1.0.0',
      fingerprintVersion: 1,
      blockingSeverities: ['critical', 'high'],
      requiredChecks: {},
      baseline: {},
      waivers: {
        [fingerprint]: {
          fingerprintVersion: 1,
          identityVersion: '1.0.0',
          ruleVersion: '1.0.0',
          severity: 'high',
          count: 1,
          owner: 'security@example.com',
          reason: 'Accepted for the isolated fixture',
          createdAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2026-09-01T00:00:00.000Z',
        },
      },
    },
  })
  const sarifFinding = toSarif(result).runs[0].results[0]
  assert.strictEqual(result.verdict, 'PASS')
  assert.strictEqual(result.findings[0].disposition, 'waived')
  assert.strictEqual(sarifFinding.suppressions[0].status, 'accepted')
})

test('generated catalog agrees with shipped Semgrep IDs and severities', () => {
  const repositoryRoot = path.join(__dirname, '..')
  const catalog = loadRuleCatalog(repositoryRoot)
  assert.ok(catalog.rules.length > 20)
  assert.strictEqual(
    new Set(catalog.rules.map(rule => rule.id)).size,
    catalog.rules.length
  )
  assert.ok(catalog.rules.every(rule => rule.severity))
  assert.ok(
    catalog.rules.every(rule => rule.languages.length > 0),
    'every shipped Semgrep rule must publish its language scope'
  )
  assert.strictEqual(
    catalog.rules.find(rule => rule.id === 'sql-injection-template-string')
      .severity,
    'critical'
  )
  const markdown = renderRuleCatalogMarkdown(catalog)
  assert.ok(markdown.includes('A clean scan does not prove'))
  assert.ok(markdown.includes('`sql-injection-template-string`'))
})

test('catalog generation fails visibly when a rule omits language coverage', () => {
  const dir = tempDir('catalog-missing-languages')
  try {
    fs.mkdirSync(path.join(dir, '.semgrep'))
    fs.writeFileSync(
      path.join(dir, '.semgrep', 'defensive-patterns.yaml'),
      'rules:\n  - id: missing-language\n    severity: ERROR\n    pattern: danger(...)\n'
    )
    fs.writeFileSync(
      path.join(dir, '.semgrep', 'vibe-audit-rules.yaml'),
      'rules:\n'
    )
    fs.writeFileSync(
      path.join(dir, '.semgrep', 'vibe-moat-rules.yaml'),
      'rules:\n'
    )
    assert.throws(
      () => loadRuleCatalog(dir),
      /Missing languages for rule: missing-language/
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('catalog generation rejects missing or unrecognized engine severity', () => {
  const dir = tempDir('catalog-invalid-severity')
  try {
    fs.mkdirSync(path.join(dir, '.semgrep'))
    fs.writeFileSync(
      path.join(dir, '.semgrep', 'defensive-patterns.yaml'),
      'rules:\n  - id: quoted-severity\n    severity: "ERROR"\n    languages: [javascript]\n    pattern: danger(...)\n'
    )
    fs.writeFileSync(
      path.join(dir, '.semgrep', 'vibe-audit-rules.yaml'),
      'rules:\n'
    )
    fs.writeFileSync(
      path.join(dir, '.semgrep', 'vibe-moat-rules.yaml'),
      'rules:\n'
    )
    assert.throws(
      () => loadRuleCatalog(dir),
      /Missing or unrecognized severity for rule: quoted-severity/
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

console.log('\n✅ Assurance contract tests passed')
