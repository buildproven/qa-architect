/**
 * Tests for lib/commands/audit.js
 *
 * Tests pure functions: mapSemgrepFinding, groupBySeverity, buildMarkdownReport,
 * buildHumanReport. Does not test semgrep invocation (system dependency).
 */

'use strict'

process.env.QAA_DEVELOPER = 'true'

const assert = require('assert')
const {
  mapSemgrepFinding,
  groupBySeverity,
  buildMarkdownReport,
  buildHumanReport,
  buildSkippedReport,
} = require('../lib/commands/audit')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${err.message}`)
    failed++
  }
}

// ---------------------------------------------------------------------------
// mapSemgrepFinding
// ---------------------------------------------------------------------------

console.log('\nmapSemgrepFinding')

test('maps ERROR severity to high', () => {
  const raw = {
    check_id: 'test-rule',
    path: 'src/index.js',
    start: { line: 10 },
    end: { line: 10 },
    extra: {
      severity: 'ERROR',
      message: 'test message',
      metadata: { cwe: 'CWE-400' },
    },
  }
  const f = mapSemgrepFinding(raw)
  assert.strictEqual(f.severity, 'high')
  assert.strictEqual(f.file, 'src/index.js')
  assert.strictEqual(f.line, 10)
})

test('escalates CWE-89 (SQL injection) to critical', () => {
  const raw = {
    check_id: 'sql-injection',
    path: 'lib/db.js',
    start: { line: 42 },
    end: { line: 42 },
    extra: {
      severity: 'ERROR',
      message: 'SQL injection via template string',
      metadata: { cwe: 'CWE-89', owasp: 'A03:2021' },
    },
  }
  const f = mapSemgrepFinding(raw)
  assert.strictEqual(f.severity, 'critical')
  assert.strictEqual(f.cwe, 'CWE-89')
})

test('escalates CWE-78 (command injection) to critical', () => {
  const raw = {
    check_id: 'cmd-injection',
    path: 'scripts/run.js',
    start: { line: 5 },
    end: { line: 5 },
    extra: {
      severity: 'ERROR',
      message: 'Command injection',
      metadata: { cwe: 'CWE-78' },
    },
  }
  const f = mapSemgrepFinding(raw)
  assert.strictEqual(f.severity, 'critical')
})

test('escalates CWE-798 (hardcoded credentials) to critical', () => {
  const raw = {
    check_id: 'hardcoded-cred',
    path: 'config.js',
    start: { line: 3 },
    end: { line: 3 },
    extra: {
      severity: 'ERROR',
      message: 'Hardcoded API key',
      metadata: { cwe: 'CWE-798' },
    },
  }
  const f = mapSemgrepFinding(raw)
  assert.strictEqual(f.severity, 'critical')
})

test('maps WARNING to medium', () => {
  const raw = {
    check_id: 'cors-all',
    path: 'server.js',
    start: { line: 20 },
    end: { line: 20 },
    extra: {
      severity: 'WARNING',
      message: 'CORS allow all',
      metadata: { cwe: 'CWE-942' },
    },
  }
  const f = mapSemgrepFinding(raw)
  assert.strictEqual(f.severity, 'medium')
})

test('captures fix and note metadata', () => {
  const raw = {
    check_id: 'jwt-no-expiry',
    path: 'auth.js',
    start: { line: 8 },
    end: { line: 8 },
    extra: {
      severity: 'ERROR',
      message: 'JWT without expiry',
      metadata: {
        cwe: 'CWE-613',
        fix: "jwt.sign(payload, secret, { expiresIn: '24h' })",
        note: 'Set expiry on all tokens',
      },
    },
  }
  const f = mapSemgrepFinding(raw)
  assert.ok(f.fix.includes('expiresIn'))
  assert.ok(f.note.includes('expiry'))
})

test('handles missing metadata gracefully', () => {
  const raw = {
    check_id: 'bare-rule',
    path: 'x.js',
    start: { line: 1 },
    end: { line: 1 },
    extra: { severity: 'WARNING', message: 'bare' },
  }
  const f = mapSemgrepFinding(raw)
  assert.ok(f)
  assert.strictEqual(f.cwe, '')
  assert.strictEqual(f.fix, null)
})

// ---------------------------------------------------------------------------
// groupBySeverity
// ---------------------------------------------------------------------------

console.log('\ngroupBySeverity')

test('groups findings by severity level', () => {
  const findings = [
    { severity: 'critical', id: 'a' },
    { severity: 'high', id: 'b' },
    { severity: 'critical', id: 'c' },
    { severity: 'low', id: 'd' },
    { severity: 'medium', id: 'e' },
  ]
  const grouped = groupBySeverity(findings)
  assert.strictEqual(grouped.critical.length, 2)
  assert.strictEqual(grouped.high.length, 1)
  assert.strictEqual(grouped.medium.length, 1)
  assert.strictEqual(grouped.low.length, 1)
  assert.strictEqual(grouped.info.length, 0)
})

test('handles empty findings list', () => {
  const grouped = groupBySeverity([])
  assert.strictEqual(grouped.critical.length, 0)
  assert.strictEqual(grouped.high.length, 0)
})

test('treats unknown severity as low', () => {
  const findings = [{ severity: 'bogus', id: 'x' }]
  const grouped = groupBySeverity(findings)
  assert.strictEqual(grouped.low.length, 1)
})

// ---------------------------------------------------------------------------
// buildMarkdownReport
// ---------------------------------------------------------------------------

console.log('\nbuildMarkdownReport')

test('produces markdown with verdict', () => {
  const findings = [
    {
      severity: 'critical',
      file: 'app.js',
      line: 5,
      message: 'SQL injection',
      fix: 'Use parameterized query',
      cwe: 'CWE-89',
      owasp: 'A03:2021',
      source: 'semgrep',
    },
  ]
  const md = buildMarkdownReport(findings)
  assert.ok(md.includes('NOT SAFE TO SHIP'))
  assert.ok(md.includes('app.js'))
  assert.ok(md.includes('SQL injection'))
  assert.ok(md.includes('CWE-89'))
})

test('shows safe verdict when no findings', () => {
  const md = buildMarkdownReport([])
  assert.ok(md.includes('SAFE TO SHIP'))
})

test('includes fix prompts when fix option set', () => {
  const findings = [
    {
      severity: 'critical',
      file: 'auth.js',
      line: 12,
      message: 'Hardcoded secret',
      fix: 'Use env var',
      cwe: 'CWE-798',
      owasp: '',
      source: 'semgrep',
    },
  ]
  const md = buildMarkdownReport(findings, { fix: true })
  assert.ok(md.includes('Claude Code'))
  assert.ok(md.includes('auth.js'))
})

test('does not include fix section when fix option not set', () => {
  const findings = [
    {
      severity: 'high',
      file: 'x.js',
      line: 1,
      message: 'Issue',
      fix: 'Fix it',
      cwe: '',
      owasp: '',
      source: 'semgrep',
    },
  ]
  const md = buildMarkdownReport(findings, { fix: false })
  assert.ok(!md.includes('Claude Code Fix Prompts'))
})

// ---------------------------------------------------------------------------
// buildHumanReport
// ---------------------------------------------------------------------------

console.log('\nbuildHumanReport')

test('shows no issues message for empty findings', () => {
  const report = buildHumanReport([])
  assert.ok(report.includes('No security issues found'))
})

test('shows NOT SAFE TO SHIP for critical findings', () => {
  const findings = [
    {
      severity: 'critical',
      file: 'db.js',
      line: 44,
      message: 'SQL injection',
      fix: null,
      note: null,
      source: 'semgrep',
    },
  ]
  const report = buildHumanReport(findings)
  assert.ok(report.includes('NOT SAFE TO SHIP'))
  assert.ok(report.includes('db.js:44'))
})

test('shows REVIEW BEFORE SHIPPING for high findings only', () => {
  const findings = [
    {
      severity: 'high',
      file: 'api.js',
      line: 10,
      message: 'Auth bypass',
      fix: null,
      note: null,
      source: 'semgrep',
    },
  ]
  const report = buildHumanReport(findings)
  assert.ok(report.includes('REVIEW BEFORE SHIPPING'))
})

test('shows count summary', () => {
  const findings = [
    {
      severity: 'critical',
      file: 'a.js',
      line: 1,
      message: 'A',
      fix: null,
      note: null,
      source: 'semgrep',
    },
    {
      severity: 'medium',
      file: 'b.js',
      line: 2,
      message: 'B',
      fix: null,
      note: null,
      source: 'semgrep',
    },
    {
      severity: 'medium',
      file: 'c.js',
      line: 3,
      message: 'C',
      fix: null,
      note: null,
      source: 'semgrep',
    },
  ]
  const report = buildHumanReport(findings)
  assert.ok(report.includes('Total findings: 3'))
  assert.ok(report.includes('Critical: 1'))
  assert.ok(report.includes('Medium:   2'))
})

// ---------------------------------------------------------------------------
// buildSkippedReport (--no-fail infrastructure-error path)
// ---------------------------------------------------------------------------

console.log('\nbuildSkippedReport')

test('explains semgrep-not-installed and marks scan skipped', () => {
  const report = buildSkippedReport({
    error: 'semgrep_not_installed',
    hint: 'install semgrep',
  })
  assert.ok(report.includes('SCAN SKIPPED'))
  assert.ok(report.includes('semgrep is not installed'))
  assert.ok(report.includes('--no-fail'))
  assert.ok(report.includes('install semgrep'))
})

test('explains missing rule files', () => {
  const report = buildSkippedReport({ error: 'no_rules' })
  assert.ok(report.includes('SCAN SKIPPED'))
  assert.ok(report.includes('rule files were not found'))
})

test('falls back to raw error text for unknown errors', () => {
  const report = buildSkippedReport({ error: 'timeout' })
  assert.ok(report.includes('SCAN SKIPPED'))
  assert.ok(report.includes('timeout'))
})

test('omits hint code block when no hint provided', () => {
  const report = buildSkippedReport({ error: 'no_rules' })
  assert.ok(!report.includes('```'))
})

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log('')
console.log(`audit.test.js: ${passed} passed, ${failed} failed`)

if (failed > 0) process.exit(1)
