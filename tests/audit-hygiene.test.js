/**
 * Tests for two audit-hygiene improvements:
 *
 * 1. check-stray-files.js — the isStray() classifier (pure, no git needed).
 * 2. semgrep inline suppression — proves the audit honors `// nosemgrep`
 *    so a confirmed false positive can be suppressed surgically rather than
 *    by disabling the rule wholesale. (Requires semgrep; self-skips if absent.)
 */

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

let passed = 0
let failed = 0
let skipped = 0

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
// check-stray-files: isStray classifier
// ---------------------------------------------------------------------------

const { isStray } = require('../scripts/check-stray-files')

console.log('\ncheck-stray-files — isStray()')

test('flags a source file under lib/', () => {
  assert.ok(isStray('lib/scratch-helper.js'))
})

test('flags a python script under scripts/', () => {
  assert.ok(isStray('scripts/oneoff.py'))
})

test('flags an underscore-prefixed scratch file anywhere', () => {
  assert.ok(isStray('_debug.js'))
  assert.ok(isStray('utils/_temp.ts'))
})

test('flags tmp-/debug- prefixed files', () => {
  assert.ok(isStray('tmp-runner.js'))
  assert.ok(isStray('lib/debug-trace.js'))
})

test('flags .bak / .scratch / .orig variants', () => {
  assert.ok(isStray('config.bak.js'))
  assert.ok(isStray('lib/thing.scratch.js'))
})

test('does NOT flag a normal data file under a source dir', () => {
  assert.ok(!isStray('config/defaults.json'))
  assert.ok(!isStray('tests/fixtures/sample.md'))
})

test('does NOT flag a root-level config/doc', () => {
  assert.ok(!isStray('README.md'))
  assert.ok(!isStray('package.json'))
  assert.ok(!isStray('vitest.config.js'))
})

test('does NOT flag a non-source extension under a source dir', () => {
  assert.ok(!isStray('lib/data.csv'))
  assert.ok(!isStray('scripts/notes.txt'))
})

// ---------------------------------------------------------------------------
// semgrep inline suppression (// nosemgrep)
// ---------------------------------------------------------------------------

function semgrepAvailable() {
  const r = spawnSync('semgrep', ['--version'], { encoding: 'utf8' })
  return !r.error && r.status === 0
}

const DEFENSIVE = path.resolve(__dirname, '../.semgrep/defensive-patterns.yaml')

function findingLines(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-nosem-'))
  const file = path.join(root, 'code.js')
  try {
    fs.writeFileSync(file, source, 'utf8')
    const r = spawnSync(
      'semgrep',
      ['--json', '--quiet', '--no-git-ignore', '--config', DEFENSIVE, file],
      { encoding: 'utf8', timeout: 60_000 }
    )
    const parsed = JSON.parse(r.stdout || '{"results":[]}')
    return (parsed.results || []).map(x => x.start.line).sort()
  } finally {
    fs.rmSync(file, { force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
}

console.log('\nsemgrep inline suppression — // nosemgrep')

if (!semgrepAvailable()) {
  console.log('  ⏭️  semgrep not installed — skipping suppression tests')
  skipped = 1
} else {
  test('a // nosemgrep comment suppresses that line', () => {
    // Two identical auth-bypass patterns; only the second is suppressed.
    const lines = findingLines(
      'function a(authToken){ if (authToken || true) return 1 }\n' +
        'function b(authToken){ if (authToken || true) return 1 } // nosemgrep\n'
    )
    assert.ok(lines.includes(1), 'line 1 should still be flagged')
    assert.ok(!lines.includes(2), 'line 2 (nosemgrep) should be suppressed')
  })
}

// ---------------------------------------------------------------------------

console.log('')
console.log(
  `audit-hygiene.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped`
)

if (failed > 0) process.exit(1)
