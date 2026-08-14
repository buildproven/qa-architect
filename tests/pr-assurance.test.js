#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const AjvImport = require('ajv')
const addFormatsImport = require('ajv-formats')
const {
  exitCode,
  eligibleSelection,
  mapFinding,
  parseChangedLines,
  parseNameStatus,
  parseSemgrepResult,
  resolvePrRange,
  runPrAssurance,
  writeEvidenceBundle,
} = require('../lib/commands/pr-assurance')

function git(directory, args) {
  const result = spawnSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return (result.stdout || '').trim()
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-pr-assurance-'))
  git(directory, ['init', '-q', '-b', 'main'])
  git(directory, ['config', 'user.email', 'test@example.com'])
  git(directory, ['config', 'user.name', 'Test User'])
  fs.mkdirSync(path.join(directory, 'src'))
  fs.writeFileSync(path.join(directory, 'src', 'app.js'), 'const safe = true\n')
  fs.writeFileSync(
    path.join(directory, 'src', 'old.js'),
    'module.exports = true\n'
  )
  fs.writeFileSync(path.join(directory, 'src', 'deleted.js'), 'old\n')
  git(directory, ['add', '.'])
  git(directory, ['commit', '-q', '-m', 'initial'])
  const initialSha = git(directory, ['rev-parse', 'HEAD'])
  git(directory, ['switch', '-q', '-c', 'feature'])
  fs.writeFileSync(
    path.join(directory, 'src', 'app.js'),
    'const safe = true\nconst query = input\n'
  )
  git(directory, ['mv', 'src/old.js', 'src/renamed.js'])
  fs.unlinkSync(path.join(directory, 'src', 'deleted.js'))
  git(directory, ['add', '-A'])
  git(directory, ['commit', '-q', '-m', 'feature changes'])
  const headSha = git(directory, ['rev-parse', 'HEAD'])
  git(directory, ['switch', '-q', 'main'])
  fs.writeFileSync(path.join(directory, 'README.md'), 'base advanced\n')
  git(directory, ['add', 'README.md'])
  git(directory, ['commit', '-q', '-m', 'advance base'])
  const baseSha = git(directory, ['rev-parse', 'HEAD'])
  git(directory, ['switch', '-q', 'feature'])
  return { directory, initialSha, baseSha, headSha }
}

function finding(line = 2) {
  return {
    check_id: 'qaa.changed-danger',
    path: 'src/app.js',
    start: { line },
    end: { line },
    extra: {
      severity: 'ERROR',
      message: 'Changed code reaches a dangerous sink',
      lines: 'const query = input',
      metadata: { fix: 'Validate input before use.' },
    },
  }
}

async function main() {
  const assuranceSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'commands', 'pr-assurance.js'),
    'utf8'
  )
  assert(
    !/spawnSync\s*\(\s*executable/.test(assuranceSource),
    'PR assurance must dispatch only literal, allowlisted executables'
  )

  const Ajv = /** @type {any} */ (AjvImport.default || AjvImport)
  const addFormats = /** @type {(ajv: any) => void} */ (
    addFormatsImport.default || addFormatsImport
  )
  const ajv = new Ajv({ allErrors: true, strict: true })
  addFormats(ajv)
  const validateAssurance = ajv.compile(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'config', 'assurance-result-v1.schema.json'),
        'utf8'
      )
    )
  )
  assert.deepStrictEqual(
    parseNameStatus('R100\told.js\tnew.js\nD\tgone.js\n'),
    [
      { status: 'R100', oldPath: 'old.js', path: 'new.js' },
      { status: 'D', oldPath: null, path: 'gone.js' },
    ]
  )
  assert.deepStrictEqual(
    parseChangedLines('+++ b/src/app.js\n@@ -1,0 +2,3 @@\n').get('src/app.js'),
    [{ start: 2, end: 4 }]
  )
  const semgrepJson = paths => ({
    status: 0,
    stdout: JSON.stringify({
      results: [],
      errors: [],
      paths: { scanned: paths },
    }),
  })
  assert.strictEqual(
    parseSemgrepResult(semgrepJson(['src/app.js']), '1.100.0', ['src/app.js'])
      .outcome,
    'passed'
  )
  const sqlSurface = {
    files: [{ status: 'A', oldPath: null, path: 'migrations/001.sql' }],
  }
  assert.deepStrictEqual(eligibleSelection(sqlSurface, {}, { checks: [] }), {
    eligible: [],
    excluded: 0,
    candidates: [],
  })
  assert.deepStrictEqual(
    eligibleSelection(
      sqlSurface,
      {},
      {
        checks: [{ semgrepRuleId: 'destructive-database-migration' }],
      }
    ).eligible,
    ['migrations/001.sql']
  )
  const partialScan = parseSemgrepResult(
    semgrepJson(['src/app.js']),
    '1.100.0',
    ['src/app.js', 'src/missed.js']
  )
  assert.strictEqual(partialScan.outcome, 'partial')
  assert.match(partialScan.error, /src\/missed\.js/)

  const { directory, initialSha, baseSha, headSha } = fixture()
  try {
    const packFinding = mapFinding(
      {
        check_id: 'semgrep.qaa-web-saas.stripe-request-controlled-amount',
        path: 'src/app.js',
        start: { line: 2 },
        end: { line: 2 },
        extra: {
          severity: 'ERROR',
          message: 'Request-controlled Stripe amount',
          lines: 'amount: req.body.amount',
          metadata: {},
        },
      },
      directory,
      '1.170.0'
    )
    assert.strictEqual(packFinding.ruleVersion, '1.0.0')
    assert.strictEqual(packFinding.engine.rulePackVersion, '2.0.0')
    assert.match(packFinding.remediation.guidance, /allowlisted server-side/)
    assert.strictEqual(packFinding.assuranceMappings[0].standard, 'OWASP ASVS')
    const collidingFinding = mapFinding(
      {
        check_id: 'custom.stripe-request-controlled-amount',
        path: 'src/app.js',
        start: { line: 2 },
        end: { line: 2 },
        extra: {
          severity: 'ERROR',
          message: 'Unrelated custom rule',
          lines: 'custom finding',
          metadata: { fix: 'Custom remediation' },
        },
      },
      directory,
      '1.170.0'
    )
    assert.strictEqual(
      collidingFinding.remediation.guidance,
      'Custom remediation'
    )
    assert.deepStrictEqual(collidingFinding.assuranceMappings, [])

    const range = resolvePrRange(directory, {
      baseSha,
      head: headSha,
      fetch: false,
    })
    assert.strictEqual(range.headSha, headSha)
    assert.strictEqual(range.baseSha, baseSha)
    assert.strictEqual(range.mergeBase, initialSha)

    const scalarPolicyPath = path.join(directory, 'scalar-pr-policy.json')
    fs.writeFileSync(scalarPolicyPath, '5\n')
    const scalarPolicy = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      prPolicyPath: scalarPolicyPath,
    })
    assert.strictEqual(scalarPolicy.result.verdict, 'INCOMPLETE')
    assert.match(scalarPolicy.result.checks[0].summary, /JSON object/)
    fs.unlinkSync(scalarPolicyPath)

    const missingPrPolicy = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      prPolicyPath: path.join(directory, 'missing-pr-policy.json'),
    })
    assert.strictEqual(missingPrPolicy.result.verdict, 'INCOMPLETE')
    assert.match(missingPrPolicy.result.checks[0].summary, /does not exist/)

    const missingAssurancePolicy = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      assurancePolicyPath: path.join(
        directory,
        'missing-assurance-policy.json'
      ),
      scanner: async () => ({
        outcome: 'passed',
        version: '1.100.0',
        findings: [],
      }),
    })
    assert.strictEqual(missingAssurancePolicy.result.verdict, 'INCOMPLETE')
    assert.match(
      missingAssurancePolicy.result.checks[0].summary,
      /does not exist/
    )

    const blocked = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      scanner: async (_root, paths, _policy, assurancePack) => {
        assert.deepStrictEqual(paths.sort(), ['src/app.js', 'src/renamed.js'])
        assert.deepStrictEqual(assurancePack.detectedStacks, [])
        return { outcome: 'passed', version: '1.100.0', findings: [finding()] }
      },
      now: new Date('2026-08-05T12:00:00.000Z'),
    })
    assert.strictEqual(blocked.result.verdict, 'BLOCK')
    assert.strictEqual(blocked.result.revision.value, headSha)
    assert.strictEqual(blocked.result.findings.length, 1)
    assert.match(
      blocked.result.checks[0].details,
      /Web SaaS pack not applicable/
    )
    assert.strictEqual(
      validateAssurance(blocked.result),
      true,
      JSON.stringify(validateAssurance.errors)
    )
    assert.strictEqual(exitCode(blocked.result.verdict), 1)
    assert(
      blocked.surface.files.some(
        item => item.status.startsWith('R') && item.oldPath === 'src/old.js'
      )
    )
    assert(
      blocked.surface.files.some(
        item => item.status === 'D' && item.path === 'src/deleted.js'
      )
    )

    const headPrPolicyPath = path.join(
      directory,
      '.qa-architect-pr-assurance.json'
    )
    fs.writeFileSync(
      headPrPolicyPath,
      JSON.stringify({ required: true, pathExcludes: ['src/'] })
    )
    const headPolicyBypass = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      scanner: async (_root, paths) => {
        assert.deepStrictEqual(paths.sort(), ['src/app.js', 'src/renamed.js'])
        return { outcome: 'passed', version: '1.100.0', findings: [finding()] }
      },
    })
    assert.strictEqual(headPolicyBypass.result.verdict, 'BLOCK')
    fs.unlinkSync(headPrPolicyPath)

    fs.writeFileSync(path.join(directory, 'uncommitted.txt'), 'dirty\n')
    const dirty = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
    })
    assert.strictEqual(dirty.result.verdict, 'INCOMPLETE')
    assert.match(dirty.result.checks[0].summary, /not clean/)
    fs.unlinkSync(path.join(directory, 'uncommitted.txt'))

    const fingerprint = blocked.result.findings[0].fingerprint
    const headAssurancePolicyPath = path.join(
      directory,
      '.qa-architect-assurance.json'
    )
    fs.writeFileSync(
      headAssurancePolicyPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        fingerprintVersion: 1,
        baseline: {
          [fingerprint]: {
            fingerprintVersion: 1,
            identityVersion: '1.0.0',
            count: 1,
            severity: 'high',
            ruleVersion: '1.0.0',
          },
        },
        waivers: {},
        blockingSeverities: ['critical', 'high'],
        requiredChecks: { sast: true },
      })
    )
    const headBaselineBypass = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      scanner: async () => ({
        outcome: 'passed',
        version: '1.100.0',
        findings: [finding()],
      }),
    })
    assert.strictEqual(headBaselineBypass.result.verdict, 'BLOCK')
    fs.unlinkSync(headAssurancePolicyPath)

    const assurancePolicyPath = path.join(directory, 'assurance-policy.json')
    fs.writeFileSync(
      assurancePolicyPath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        fingerprintVersion: 1,
        baseline: {
          [fingerprint]: {
            fingerprintVersion: 1,
            identityVersion: '1.0.0',
            count: 1,
            severity: 'high',
            ruleVersion: '1.0.0',
          },
        },
        waivers: {},
        blockingSeverities: ['critical', 'high'],
        requiredChecks: { sast: true },
      })
    )
    const baselined = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      assurancePolicyPath,
      scanner: async () => ({
        outcome: 'passed',
        version: '1.100.0',
        findings: [finding()],
      }),
    })
    assert.strictEqual(baselined.result.verdict, 'PASS')
    assert.strictEqual(baselined.result.findings[0].disposition, 'baseline')

    const unchanged = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      scanner: async () => ({
        outcome: 'passed',
        version: '1.100.0',
        findings: [finding(1)],
      }),
    })
    assert.strictEqual(unchanged.result.verdict, 'PASS')
    assert.strictEqual(unchanged.result.findings.length, 0)
    assert.strictEqual(exitCode(unchanged.result.verdict), 0)

    const unavailable = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      scanner: async () => ({
        outcome: 'unavailable',
        error: 'scanner offline',
        findings: [],
      }),
    })
    assert.strictEqual(unavailable.result.verdict, 'INCOMPLETE')
    assert.strictEqual(exitCode(unavailable.result.verdict), 2)

    const timedOut = await runPrAssurance(directory, {
      baseSha,
      head: headSha,
      fetch: false,
      allowDirty: true,
      scanner: async () => ({
        outcome: 'partial',
        error: 'scanner timeout',
        findings: [],
      }),
    })
    assert.strictEqual(timedOut.result.verdict, 'INCOMPLETE')
    assert.strictEqual(timedOut.result.checks[0].outcome, 'partial')

    const stale = await runPrAssurance(directory, {
      baseSha,
      head: baseSha,
      fetch: false,
    })
    assert.strictEqual(stale.result.verdict, 'INCOMPLETE')
    assert(
      stale.result.reasons.some(reason => reason.code === 'check.unavailable')
    )

    const output = path.join(directory, 'evidence')
    assert.strictEqual(writeEvidenceBundle(output, blocked).length, 5)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(output, 'manifest.json'), 'utf8')
    )
    const json = JSON.parse(
      fs.readFileSync(path.join(output, 'assurance.json'), 'utf8')
    )
    const sarif = JSON.parse(
      fs.readFileSync(path.join(output, 'assurance.sarif'), 'utf8')
    )
    assert.strictEqual(manifest.headSha, headSha)
    assert.strictEqual(manifest.verdict, json.assurance.verdict)
    assert.strictEqual(
      sarif.runs[0].properties.assuranceVerdict,
      manifest.verdict
    )

    const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-pr-clone-'))
    const remote = path.join(cloneRoot, 'remote.git')
    const shallow = path.join(cloneRoot, 'shallow')
    try {
      git(cloneRoot, ['clone', '--bare', directory, remote])
      git(cloneRoot, [
        'clone',
        '--depth=1',
        '--branch',
        'feature',
        `file://${remote}`,
        shallow,
      ])
      git(shallow, ['remote', 'rename', 'origin', 'fork'])
      git(shallow, ['remote', 'add', 'upstream', `file://${remote}`])
      const shallowRange = resolvePrRange(shallow, {
        base: 'main',
        head: headSha,
        fetchDepth: 20,
        remote: 'upstream',
      })
      assert.strictEqual(shallowRange.headSha, headSha)
      assert.strictEqual(shallowRange.baseSha, baseSha)
      assert.strictEqual(shallowRange.mergeBase, initialSha)
    } finally {
      fs.rmSync(cloneRoot, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
  console.log('✅ PR assurance contract tests passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
