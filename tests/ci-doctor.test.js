#!/usr/bin/env node

/**
 * Tests for CI Doctor (analyze-ci --doctor expansion).
 * Exercises pure detection functions with synthetic workflow objects —
 * no actual `gh` or `git` invocations required.
 */

const assert = require('assert')

const {
  detectDuplicatedJobs,
  detectMissingPathFilters,
  detectExpensiveMatrix,
  detectUnnecessarySchedules,
  matrixCellCount,
  parseCronFrequency,
  fingerprintSteps,
  buildDoctorReport,
  runDoctorChecks,
} = require('../lib/commands/ci-doctor')

console.log('🧪 Testing ci-doctor module...\n')

// Test 1: fingerprintSteps() is deterministic and discriminating
;(() => {
  console.log(
    'Test 1: fingerprintSteps() — same input → same fp, different → different'
  )
  const a = [{ uses: 'actions/checkout@v4' }, { run: 'npm ci' }]
  const b = [{ uses: 'actions/checkout@v4' }, { run: 'npm ci' }]
  const c = [{ uses: 'actions/checkout@v4' }, { run: 'pnpm i' }]
  assert.strictEqual(fingerprintSteps(a), fingerprintSteps(b))
  assert.notStrictEqual(fingerprintSteps(a), fingerprintSteps(c))
  console.log('✅ PASS\n')
})()

// Test 2: detectDuplicatedJobs flags identical jobs across workflows
;(() => {
  console.log('Test 2: detectDuplicatedJobs() — flags identical job signatures')
  const steps = [{ uses: 'actions/checkout@v4' }, { run: 'npm ci && npm test' }]
  const workflows = [
    {
      name: 'a.yml',
      parsed: { jobs: { test: { 'runs-on': 'ubuntu-latest', steps } } },
    },
    {
      name: 'b.yml',
      parsed: { jobs: { test: { 'runs-on': 'ubuntu-latest', steps } } },
    },
  ]
  const findings = detectDuplicatedJobs(workflows)
  assert.strictEqual(findings.length, 1)
  assert.strictEqual(findings[0].id, 'duplicated-job')
  console.log('✅ PASS\n')
})()

// Test 3: detectMissingPathFilters flags push without paths
;(() => {
  console.log(
    'Test 3: detectMissingPathFilters() — flags push trigger w/o paths filter'
  )
  const workflows = [
    { name: 'no-filter.yml', parsed: { on: 'push' } },
    { name: 'object-no-filter.yml', parsed: { on: { push: {} } } },
    {
      name: 'with-filter.yml',
      parsed: { on: { push: { paths: ['src/**'] } } },
    },
    { name: 'pr-only.yml', parsed: { on: { pull_request: {} } } },
  ]
  const findings = detectMissingPathFilters(workflows)
  const flagged = findings.map(f => f.location).sort()
  assert.deepStrictEqual(flagged, ['no-filter.yml', 'object-no-filter.yml'])
  console.log('✅ PASS\n')
})()

// Test 4: matrixCellCount handles include/exclude
;(() => {
  console.log(
    'Test 4: matrixCellCount() — product, plus include, minus exclude'
  )
  assert.strictEqual(matrixCellCount({ os: ['a', 'b'], node: [18, 20] }), 4)
  assert.strictEqual(
    matrixCellCount({
      os: ['a', 'b'],
      node: [18, 20],
      include: [{ os: 'c', node: 22 }],
    }),
    5
  )
  assert.strictEqual(
    matrixCellCount({
      os: ['a', 'b'],
      node: [18, 20],
      exclude: [{ os: 'a', node: 18 }],
    }),
    3
  )
  console.log('✅ PASS\n')
})()

// Test 5: detectExpensiveMatrix flags >10 cells
;(() => {
  console.log('Test 5: detectExpensiveMatrix() — flags >10 cells')
  const workflows = [
    {
      name: 'big.yml',
      parsed: {
        jobs: {
          big: {
            strategy: {
              matrix: {
                os: ['ubuntu', 'macos', 'windows'],
                node: [16, 18, 20, 22],
              },
            }, // 12 cells
          },
          small: {
            strategy: { matrix: { node: [18, 20] } }, // 2 cells
          },
        },
      },
    },
  ]
  const findings = detectExpensiveMatrix(workflows)
  assert.strictEqual(findings.length, 1)
  assert.strictEqual(findings[0].location, 'big.yml#big')
  console.log('✅ PASS\n')
})()

// Test 6: parseCronFrequency distinguishes daily/weekly/hourly
;(() => {
  console.log('Test 6: parseCronFrequency() — hourly > daily > weekly')
  assert.ok(parseCronFrequency('0 * * * *') > 7) // hourly
  assert.strictEqual(parseCronFrequency('0 9 * * *'), 7) // daily
  assert.strictEqual(parseCronFrequency('0 9 * * 1'), 1) // weekly Mondays
  console.log('✅ PASS\n')
})()

// Test 7: detectUnnecessarySchedules flags daily-or-more
;(() => {
  console.log(
    'Test 7: detectUnnecessarySchedules() — flags daily, ignores weekly'
  )
  const workflows = [
    {
      name: 'daily.yml',
      parsed: { on: { schedule: [{ cron: '0 9 * * *' }] } },
    },
    {
      name: 'weekly.yml',
      parsed: { on: { schedule: [{ cron: '0 9 * * 1' }] } },
    },
  ]
  const findings = detectUnnecessarySchedules(workflows)
  assert.strictEqual(findings.length, 1)
  assert.strictEqual(findings[0].location.startsWith('daily.yml'), true)
  console.log('✅ PASS\n')
})()

// Test 8: runDoctorChecks aggregates + sorts by severity
;(() => {
  console.log(
    'Test 8: runDoctorChecks() — aggregates and sorts high → medium → low'
  )
  const workflows = [
    {
      name: 'big.yml',
      parsed: {
        on: 'push',
        jobs: {
          big: {
            strategy: {
              matrix: { os: ['a', 'b', 'c'], node: [16, 18, 20, 22] },
            },
          },
        },
      },
    },
    { name: 'cron.yml', parsed: { on: { schedule: [{ cron: '0 * * * *' }] } } },
  ]
  // Pass null projectPath so the flaky-check skips gracefully (no `gh`).
  const findings = runDoctorChecks(workflows, null)
  const severities = findings.map(f => f.severity)
  // Must be sorted: 'high' indexes come before 'medium' / 'low'.
  const order = { high: 0, medium: 1, low: 2 }
  for (let i = 1; i < severities.length; i++) {
    assert.ok(
      order[severities[i - 1]] <= order[severities[i]],
      `Sort order violated: ${severities.join(',')}`
    )
  }
  console.log('✅ PASS\n')
})()

// Test 9: buildDoctorReport — empty + non-empty
;(() => {
  console.log('Test 9: buildDoctorReport() — empty + non-empty formatting')
  const emptyReport = buildDoctorReport([])
  assert.ok(emptyReport.includes('No CI health issues detected'))

  const filled = buildDoctorReport([
    {
      id: 'x',
      severity: 'high',
      title: 'Test',
      location: 'foo.yml',
      description: 'desc',
      fix: 'fix it',
    },
  ])
  assert.ok(filled.includes('Test'))
  assert.ok(filled.includes('Fix: fix it'))
  console.log('✅ PASS\n')
})()

console.log('🎉 ci-doctor tests passed.\n')
