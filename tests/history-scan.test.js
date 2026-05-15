#!/usr/bin/env node

/**
 * Tests for --history-scan (full git-history secrets audit).
 * Tests focus on the pure helpers (arg construction, dedup, output formatting),
 * not the gitleaks binary itself.
 */

const assert = require('assert')

const {
  buildGitleaksArgs,
  dedupeFindings,
  normalizeFinding,
  parseDepth,
  buildHumanReport,
  buildMarkdown,
} = require('../lib/commands/history-scan')

console.log('🧪 Testing history-scan module...\n')

// Test 1: parseDepth() — invalid + valid + cap
;(() => {
  console.log('Test 1: parseDepth() — rejects garbage, clamps to safe max')
  assert.strictEqual(parseDepth(null), null)
  assert.strictEqual(parseDepth(''), null)
  assert.strictEqual(parseDepth('not-a-number'), null)
  assert.strictEqual(parseDepth('0'), null)
  assert.strictEqual(parseDepth('-5'), null)
  assert.strictEqual(parseDepth('100'), 100)
  // Clamps to SAFE_DEPTH_MAX = 10_000
  assert.strictEqual(parseDepth('99999'), 10_000)
  console.log('✅ PASS\n')
})()

// Test 2: buildGitleaksArgs — full history vs depth-bounded
;(() => {
  console.log(
    'Test 2: buildGitleaksArgs() — default scans --all, depth uses --max-count'
  )
  const reportPath = '/tmp/report.json'

  const fullArgs = buildGitleaksArgs(reportPath, null)
  assert.ok(fullArgs.includes('detect'))
  assert.ok(fullArgs.includes('--no-banner'))
  assert.ok(fullArgs.includes('--redact'))
  assert.ok(fullArgs.includes('--log-opts=--all'))
  assert.ok(fullArgs.includes('--report-path'))
  assert.ok(fullArgs.includes(reportPath))

  const depthArgs = buildGitleaksArgs(reportPath, 500)
  // Use --max-count (safe on shallow repos) instead of HEAD~N..HEAD which
  // git treats as fatal when N exceeds available commits.
  assert.ok(depthArgs.includes('--log-opts=--max-count=500'))
  assert.ok(!depthArgs.includes('--log-opts=--all'))
  console.log('✅ PASS\n')
})()

// Test 3: dedupeFindings removes exact duplicates
;(() => {
  console.log(
    'Test 3: dedupeFindings() — collapses {commit,file,secret} duplicates'
  )
  const findings = [
    { Commit: 'abc', File: 'app.js', Secret: 'AKIA...' },
    { Commit: 'abc', File: 'app.js', Secret: 'AKIA...' }, // exact dup
    { Commit: 'def', File: 'app.js', Secret: 'AKIA...' }, // different commit
  ]
  const deduped = dedupeFindings(findings)
  assert.strictEqual(deduped.length, 2)
  console.log('✅ PASS\n')
})()

// Test 4: normalizeFinding handles both Pascal and camelCase keys
;(() => {
  console.log('Test 4: normalizeFinding() — handles Pascal and camelCase keys')
  const pascal = normalizeFinding({
    Commit: 'abc',
    File: 'a.js',
    StartLine: 42,
    RuleID: 'aws-access-key',
    Date: '2024-01-01',
  })
  assert.strictEqual(pascal.commit, 'abc')
  assert.strictEqual(pascal.file, 'a.js')
  assert.strictEqual(pascal.line, 42)
  assert.strictEqual(pascal.secretType, 'aws-access-key')

  const camel = normalizeFinding({
    commit: 'def',
    file: 'b.js',
    startLine: 10,
    ruleId: 'github-token',
  })
  assert.strictEqual(camel.commit, 'def')
  assert.strictEqual(camel.secretType, 'github-token')
  console.log('✅ PASS\n')
})()

// Test 5: buildHumanReport — empty + non-empty
;(() => {
  console.log('Test 5: buildHumanReport() — empty vs findings')
  const empty = buildHumanReport({
    scope: 'full history',
    commitsScanned: 100,
    findings: [],
  })
  assert.ok(empty.includes('No secrets detected'))

  const filled = buildHumanReport({
    scope: 'full history',
    commitsScanned: 100,
    findings: [
      {
        commit: 'abcdef123456',
        file: 'config.js',
        secretType: 'aws-access-key',
        date: '2024-01-01T00:00:00Z',
      },
    ],
  })
  assert.ok(filled.includes('Findings: 1'))
  assert.ok(filled.includes('aws-access-key'))
  assert.ok(filled.includes('config.js'))
  assert.ok(filled.includes('Rotate exposed credentials'))
  console.log('✅ PASS\n')
})()

// Test 6: buildMarkdown — empty + non-empty
;(() => {
  console.log('Test 6: buildMarkdown() — empty vs findings')
  const empty = buildMarkdown({
    scope: 'full history',
    commitsScanned: 100,
    findings: [],
  })
  assert.ok(empty.includes('# Historical Secrets Scan'))
  assert.ok(empty.includes('No secrets detected'))

  const filled = buildMarkdown({
    scope: 'full history',
    commitsScanned: 100,
    findings: [
      {
        commit: 'abcdef123456',
        file: 'config.js',
        secretType: 'aws-access-key',
        date: '2024-01-01T00:00:00Z',
      },
    ],
  })
  assert.ok(filled.includes('## By secret type'))
  assert.ok(filled.includes('## Top 10 oldest exposures'))
  assert.ok(filled.includes('### Next steps'))
  assert.ok(filled.includes('git-filter-repo'))
  console.log('✅ PASS\n')
})()

console.log('🎉 history-scan tests passed.\n')
