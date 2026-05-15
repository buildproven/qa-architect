#!/usr/bin/env node

/**
 * Tests for --ship-check (release readiness report).
 * Exercises the pure helpers (no process.exit), so the suite is fast
 * and does not depend on running npm scripts in a temp project.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const {
  runShipCheck,
  buildMarkdown,
  buildHumanReport,
  computeVerdict,
  parseEnvKeys,
  STATUS,
  VERDICT,
} = require('../lib/commands/ship-check')

console.log('🧪 Testing ship-check module...\n')

function tmp(label) {
  const dir = path.join(os.tmpdir(), `qaa-shipcheck-${label}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// Test 1: parseEnvKeys handles comments and empty lines
;(() => {
  console.log('Test 1: parseEnvKeys() — handles comments, blanks, KEY=value')
  const sample = [
    '# comment',
    '',
    'FOO=bar',
    'BAZ=quux=with=equals',
    '   QUUX = value-with-spaces',
    '=missing-key',
  ].join('\n')
  const keys = parseEnvKeys(sample)
  assert.deepStrictEqual(keys, ['FOO', 'BAZ', 'QUUX'])
  console.log('✅ PASS\n')
})()

// Test 2: computeVerdict short-circuits on FAIL
;(() => {
  console.log(
    'Test 2: computeVerdict() — FAIL → BLOCK, WARN → REVIEW, all pass → SHIP'
  )
  assert.strictEqual(
    computeVerdict([{ status: STATUS.PASS }, { status: STATUS.FAIL }]),
    VERDICT.BLOCK
  )
  assert.strictEqual(
    computeVerdict([{ status: STATUS.PASS }, { status: STATUS.WARN }]),
    VERDICT.REVIEW
  )
  assert.strictEqual(
    computeVerdict([{ status: STATUS.PASS }, { status: STATUS.SKIP }]),
    VERDICT.SHIP
  )
  console.log('✅ PASS\n')
})()

// Test 3: runShipCheck() on empty project skips everything → SHIP
;(() => {
  console.log(
    'Test 3: runShipCheck() — empty project produces SHIP (all skipped/pass)'
  )
  const dir = tmp('empty')
  try {
    const report = runShipCheck(dir, { skipTests: true })
    // No package.json, no workflows, no coverage → most checks SKIP.
    assert.ok(Array.isArray(report.results))
    assert.ok(report.results.length > 0)
    // README missing is a WARN, so verdict will be REVIEW.
    assert.ok(
      [VERDICT.SHIP, VERDICT.REVIEW].includes(report.verdict),
      `Got ${report.verdict}`
    )
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 4: coverage threshold detection
;(() => {
  console.log('Test 4: runShipCheck() — coverage below threshold → BLOCK')
  const dir = tmp('coverage')
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: {
        lines: { pct: 40 },
        functions: { pct: 50 },
        branches: { pct: 30 },
      },
    })
  )
  // Add a README so we don't trip the docs warning.
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    '# Project\n\nThis is a real readme with more than two hundred characters so that the docs check passes. '.repeat(
      3
    )
  )
  try {
    const report = runShipCheck(dir, { skipTests: true })
    const coverage = report.results.find(r => r.name === 'Coverage')
    assert.strictEqual(coverage.status, STATUS.FAIL)
    assert.strictEqual(report.verdict, VERDICT.BLOCK)
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 5: coverage above threshold passes
;(() => {
  console.log('Test 5: runShipCheck() — coverage above threshold → PASS')
  const dir = tmp('coverage-pass')
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: {
        lines: { pct: 90 },
        functions: { pct: 85 },
        branches: { pct: 80 },
      },
    })
  )
  try {
    const report = runShipCheck(dir, { skipTests: true })
    const coverage = report.results.find(r => r.name === 'Coverage')
    assert.strictEqual(coverage.status, STATUS.PASS)
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 6: .qualityrc.json overrides thresholds
;(() => {
  console.log(
    'Test 6: runShipCheck() — .qualityrc.json overrides coverage thresholds'
  )
  const dir = tmp('coverage-custom')
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: {
        lines: { pct: 50 },
        functions: { pct: 50 },
        branches: { pct: 50 },
      },
    })
  )
  // Lower the threshold so 50% passes.
  fs.writeFileSync(
    path.join(dir, '.qualityrc.json'),
    JSON.stringify({ coverage: { lines: 40, functions: 40, branches: 40 } })
  )
  try {
    const report = runShipCheck(dir, { skipTests: true })
    const coverage = report.results.find(r => r.name === 'Coverage')
    assert.strictEqual(coverage.status, STATUS.PASS)
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 7: env-var audit detects missing keys
;(() => {
  console.log(
    'Test 7: runShipCheck() — env-var diff between .env.example and .env'
  )
  const dir = tmp('env')
  fs.writeFileSync(
    path.join(dir, '.env.example'),
    'FOO=\nBAR=\nBAZ=\n# comment\n'
  )
  fs.writeFileSync(path.join(dir, '.env'), 'FOO=1\nBAR=2\n')
  try {
    const report = runShipCheck(dir, { skipTests: true })
    const env = report.results.find(r => r.name === 'Env vars')
    assert.strictEqual(env.status, STATUS.WARN)
    assert.ok(env.summary.includes('BAZ'), `Summary was: ${env.summary}`)
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 8: markdown output structure
;(() => {
  console.log('Test 8: buildMarkdown() — produces table + verdict section')
  const report = {
    verdict: VERDICT.REVIEW,
    branch: 'feature/x',
    commit: 'abc1234',
    results: [
      { name: 'Lint', status: STATUS.PASS, summary: 'OK' },
      { name: 'Tests', status: STATUS.WARN, summary: 'Slow' },
    ],
  }
  const md = buildMarkdown(report)
  assert.ok(md.startsWith('# Ship Check — REVIEW'))
  assert.ok(md.includes('| Check | Status | Summary |'))
  assert.ok(md.includes('| Lint | ✅ pass | OK |'))
  assert.ok(md.includes('Ship with review'))
  console.log('✅ PASS\n')
})()

// Test 9: human report includes all checks
;(() => {
  console.log('Test 9: buildHumanReport() — lists every check + verdict line')
  const report = {
    verdict: VERDICT.SHIP,
    results: [{ name: 'Lint', status: STATUS.PASS, summary: 'OK' }],
  }
  const out = buildHumanReport(report)
  assert.ok(out.includes('Lint'))
  assert.ok(out.includes('Verdict: SHIP'))
  console.log('✅ PASS\n')
})()

console.log('🎉 ship-check tests passed.\n')
