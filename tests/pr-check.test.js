#!/usr/bin/env node

/**
 * Tests for --pr-check (diff-aware risk classifier).
 * Uses a real git repo in a temp dir so we exercise the actual diff path.
 *
 * All git calls use spawnSync with argv arrays (no shell).
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const {
  runPrCheck,
  classifyFile,
  findMissingTests,
  computeVerdict,
  buildMarkdown,
  RISK,
  VERDICT,
} = require('../lib/commands/pr-check')

console.log('🧪 Testing pr-check module...\n')

function git(dir, args) {
  const r = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`)
  }
  return r
}

function createTempGitRepo(label) {
  const dir = path.join(os.tmpdir(), `qaa-prcheck-${label}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test User'])
  return dir
}

function commitAll(dir, message) {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// Test 1: classifyFile() — high-risk patterns
;(() => {
  console.log('Test 1: classifyFile() — auth/payment/.env hit HIGH')
  assert.strictEqual(classifyFile('src/auth/login.js').risk, RISK.HIGH)
  assert.strictEqual(classifyFile('lib/stripe-webhook.ts').risk, RISK.HIGH)
  assert.strictEqual(classifyFile('.env.production').risk, RISK.HIGH)
  assert.strictEqual(classifyFile('migrations/0001_init.sql').risk, RISK.HIGH)
  assert.strictEqual(
    classifyFile('.github/workflows/quality.yml').risk,
    RISK.HIGH
  )
  console.log('✅ PASS\n')
})()

// Test 2: classifyFile() — low-risk patterns
;(() => {
  console.log('Test 2: classifyFile() — docs/tests/images hit LOW')
  assert.strictEqual(classifyFile('README.md').risk, RISK.LOW)
  assert.strictEqual(classifyFile('docs/api.md').risk, RISK.LOW)
  assert.strictEqual(classifyFile('src/foo.test.js').risk, RISK.LOW)
  assert.strictEqual(classifyFile('assets/logo.png').risk, RISK.LOW)
  console.log('✅ PASS\n')
})()

// Test 2b: classifyFile() — vendor paths are not high-risk
;(() => {
  console.log(
    'Test 2b: classifyFile() — node_modules/.../migrations/x.js is LOW'
  )
  // Regression: bare regex /(^|\/)migrations?\// would flag this as HIGH
  // even though it's vendored code we shouldn't care about.
  assert.strictEqual(
    classifyFile('node_modules/foo/migrations/bar.js').risk,
    RISK.LOW
  )
  assert.strictEqual(classifyFile('dist/auth.js').risk, RISK.LOW)
  assert.strictEqual(classifyFile('.venv/lib/auth.py').risk, RISK.LOW)
  console.log('✅ PASS\n')
})()

// Test 3: classifyFile() — medium-risk patterns
;(() => {
  console.log('Test 3: classifyFile() — package.json + tsconfig hit MEDIUM')
  assert.strictEqual(classifyFile('package.json').risk, RISK.MEDIUM)
  assert.strictEqual(classifyFile('tsconfig.json').risk, RISK.MEDIUM)
  assert.strictEqual(classifyFile('Dockerfile').risk, RISK.MEDIUM)
  // Generic source still gets MEDIUM (default).
  assert.strictEqual(classifyFile('src/utils/foo.js').risk, RISK.MEDIUM)
  console.log('✅ PASS\n')
})()

// Test 4: findMissingTests() — flags source change without matching test
;(() => {
  console.log(
    'Test 4: findMissingTests() — source without matching test is flagged'
  )
  const changed = [
    { code: 'M', path: 'src/api/users.js' },
    { code: 'M', path: 'src/api/posts.js' },
    { code: 'M', path: 'tests/users.test.js' }, // matches users
  ]
  const missing = findMissingTests(changed)
  assert.deepStrictEqual(missing, ['src/api/posts.js'])
  console.log('✅ PASS\n')
})()

// Test 5: findMissingTests() — deleted files are ignored
;(() => {
  console.log('Test 5: findMissingTests() — deleted files are excluded')
  const changed = [
    { code: 'D', path: 'src/old.js' },
    { code: 'M', path: 'src/new.js' },
  ]
  const missing = findMissingTests(changed)
  assert.deepStrictEqual(missing, ['src/new.js'])
  console.log('✅ PASS\n')
})()

// Test 6: computeVerdict() logic
;(() => {
  console.log(
    'Test 6: computeVerdict() — HIGH untested → BLOCK; LOW only → SHIP'
  )
  const blockCase = computeVerdict(
    [{ risk: RISK.HIGH, path: '.env' }],
    ['.env']
  )
  assert.strictEqual(blockCase, VERDICT.BLOCK)

  const reviewCase = computeVerdict(
    [
      { risk: RISK.HIGH, path: 'auth.js' },
      { risk: RISK.LOW, path: 'auth.test.js' },
    ],
    []
  )
  assert.strictEqual(reviewCase, VERDICT.REVIEW)

  const shipCase = computeVerdict([{ risk: RISK.LOW, path: 'README.md' }], [])
  assert.strictEqual(shipCase, VERDICT.SHIP)
  console.log('✅ PASS\n')
})()

// Test 6b: BLOCK still fires when an unrelated LOW file is added to the diff
;(() => {
  console.log(
    'Test 6b: computeVerdict() — HIGH untested + LOW README still → BLOCK'
  )
  // Regression: previously the BLOCK rule required missingTests to cover
  // EVERY file, so adding a README change downgraded BLOCK to REVIEW.
  const verdict = computeVerdict(
    [
      { risk: RISK.HIGH, path: 'src/auth.js' },
      { risk: RISK.LOW, path: 'README.md' },
    ],
    ['src/auth.js']
  )
  assert.strictEqual(verdict, VERDICT.BLOCK)
  console.log('✅ PASS\n')
})()

// Test 7: runPrCheck() — real git diff in temp repo
;(() => {
  console.log('Test 7: runPrCheck() — diffs HEAD vs main in temp repo')
  const dir = createTempGitRepo('diff')
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n')
    commitAll(dir, 'initial')

    // Branch off and add a high-risk file plus a README edit.
    git(dir, ['checkout', '-q', '-b', 'feature/x'])
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'src', 'auth.js'),
      '// auth code\nmodule.exports = {}\n'
    )
    fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n\nUpdated.\n')
    commitAll(dir, 'add auth + edit readme')

    const report = runPrCheck(dir, { base: 'main' })
    assert.strictEqual(report.error, undefined)
    assert.strictEqual(report.baseRef, 'main')
    assert.strictEqual(report.headRef, 'feature/x')
    assert.strictEqual(report.files.length, 2)

    const authFile = report.files.find(f => f.path === 'src/auth.js')
    assert.strictEqual(authFile.risk, RISK.HIGH)

    const readme = report.files.find(f => f.path === 'README.md')
    assert.strictEqual(readme.risk, RISK.LOW)

    // High-risk source without a matching test → REVIEW or BLOCK.
    assert.ok([VERDICT.REVIEW, VERDICT.BLOCK].includes(report.verdict))
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 8: runPrCheck() — empty diff → SHIP
;(() => {
  console.log('Test 8: runPrCheck() — no changes vs base → SHIP, empty=true')
  const dir = createTempGitRepo('empty')
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n')
    commitAll(dir, 'initial')

    const report = runPrCheck(dir, { base: 'main' })
    assert.strictEqual(report.empty, true)
    assert.strictEqual(report.verdict, VERDICT.SHIP)
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 8b: runPrCheck() — rejects --base values that look like git option flags
;(() => {
  console.log(
    'Test 8b: runPrCheck() — --base starting with `-` is rejected as unsafe ref'
  )
  const dir = createTempGitRepo('unsafe-ref')
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n')
    commitAll(dir, 'initial')

    const report = runPrCheck(dir, { base: '--upload-pack=evil' })
    assert.ok(report.error, `Expected error, got: ${JSON.stringify(report)}`)
    assert.ok(/base branch/i.test(report.error))
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 9: runPrCheck() — non-git directory returns error
;(() => {
  console.log('Test 9: runPrCheck() — non-git dir returns { error }')
  const dir = path.join(os.tmpdir(), `qaa-prcheck-nogit-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    const report = runPrCheck(dir, {})
    assert.ok(report.error)
  } finally {
    cleanup(dir)
  }
  console.log('✅ PASS\n')
})()

// Test 10: buildMarkdown() — high-risk section + verdict
;(() => {
  console.log('Test 10: buildMarkdown() — high-risk section + BLOCK message')
  const report = {
    verdict: VERDICT.BLOCK,
    baseRef: 'main',
    headRef: 'feature/x',
    files: [
      { path: '.env', risk: RISK.HIGH, reason: 'env file' },
      { path: 'README.md', risk: RISK.LOW, reason: 'docs' },
    ],
    missingTests: ['.env'],
    riskCounts: { HIGH: 1, MEDIUM: 0, LOW: 1 },
  }
  const md = buildMarkdown(report)
  assert.ok(md.includes('# PR Risk Check — BLOCK'))
  assert.ok(md.includes('High-risk changes'))
  assert.ok(md.includes('.env'))
  assert.ok(md.includes('Block'))
  console.log('✅ PASS\n')
})()

console.log('🎉 pr-check tests passed.\n')
