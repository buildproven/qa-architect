'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  ProjectMaturityDetector,
  MATURITY_LEVELS,
} = require('../lib/project-maturity')

const { MATURITY_THRESHOLDS } = require('../config/constants')

/**
 * Boundary and edge case tests for ProjectMaturityDetector
 *
 * Tests the exact threshold boundaries and unusual project structures
 * that could cause incorrect maturity classification.
 */

// Helper: Create temp project with precise control
const createTempProject = (options = {}) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maturity-boundary-'))

  const {
    sourceFiles = 0,
    testFiles = 0,
    hasPackageJson = true,
    hasDependencies = false,
    readmeLines = 0,
    hasDocs = false,
    shellScripts = 0,
  } = options

  if (hasPackageJson) {
    const pkg = { name: 'test-project', version: '1.0.0' }
    if (hasDependencies) {
      pkg.dependencies = { express: '^4.18.0' }
    }
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(pkg, null, 2)
    )
  }

  if (sourceFiles > 0) {
    const srcDir = path.join(tempDir, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    for (let i = 0; i < sourceFiles; i++) {
      fs.writeFileSync(
        path.join(srcDir, `module${i}.js`),
        `module.exports = { id: ${i} };\n`
      )
    }
  }

  if (testFiles > 0) {
    const testDir = path.join(tempDir, '__tests__')
    fs.mkdirSync(testDir, { recursive: true })
    for (let i = 0; i < testFiles; i++) {
      fs.writeFileSync(
        path.join(testDir, `test${i}.test.js`),
        `test('example ${i}', () => {});\n`
      )
    }
  }

  if (readmeLines > 0) {
    fs.writeFileSync(
      path.join(tempDir, 'README.md'),
      'Line\n'.repeat(readmeLines)
    )
  }

  if (hasDocs) {
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Guide\n')
  }

  if (shellScripts > 0) {
    const scriptsDir = path.join(tempDir, 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })
    for (let i = 0; i < shellScripts; i++) {
      fs.writeFileSync(
        path.join(scriptsDir, `script${i}.sh`),
        `#!/bin/bash\necho "script ${i}"\n`
      )
    }
  }

  return tempDir
}

const cleanup = dir => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

console.log('🧪 Testing Project Maturity Boundary Conditions...\n')

// ============================================================
// Threshold constants for reference
// ============================================================
const MIN_BOOTSTRAP = MATURITY_THRESHOLDS.MIN_BOOTSTRAP_FILES // 3
const MIN_PRODUCTION = MATURITY_THRESHOLDS.MIN_PRODUCTION_FILES // 10
const MIN_PROD_TESTS = MATURITY_THRESHOLDS.MIN_PRODUCTION_TESTS // 3
const MIN_README_LINES = MATURITY_THRESHOLDS.README_MIN_LINES_FOR_DOCS // 100

console.log(`Thresholds: bootstrap=${MIN_BOOTSTRAP}, production=${MIN_PRODUCTION}, prodTests=${MIN_PROD_TESTS}, readmeLines=${MIN_README_LINES}\n`)

// ============================================================
// Test 1: Exact zero files → minimal
// ============================================================
{
  console.log('Test 1: Zero source files → minimal')
  const tempDir = createTempProject({ sourceFiles: 0 })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'minimal')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 2: 1 file, no tests → bootstrap
// ============================================================
{
  console.log('Test 2: 1 source file, no tests → bootstrap')
  const tempDir = createTempProject({ sourceFiles: 1 })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'bootstrap')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 3: 2 files (MAX before bootstrap threshold), no tests → bootstrap
// ============================================================
{
  console.log('Test 3: 2 source files, no tests → bootstrap')
  const tempDir = createTempProject({ sourceFiles: 2 })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'bootstrap')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 4: EXACT bootstrap threshold (3 files), no tests → development
// ============================================================
{
  console.log(`Test 4: Exact ${MIN_BOOTSTRAP} files, no tests → development`)
  const tempDir = createTempProject({ sourceFiles: MIN_BOOTSTRAP })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'development')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 5: CRITICAL EDGE CASE - Sub-threshold files WITH tests
// A project with 1-2 source files but has tests should NOT be 'minimal'.
// This tests the gap in the detection logic where:
// - Not 0 files (skip first condition)
// - < 3 files but has tests (testFiles !== 0, skip second condition)
// - Has tests but < 3 source files (skip third condition which needs >= 3)
// - Falls through to 'minimal' (BUG)
// ============================================================
{
  console.log('Test 5: EDGE CASE - 2 source files WITH 1 test file')
  const tempDir = createTempProject({ sourceFiles: 2, testFiles: 1 })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const maturity = detector.detect()

  // A project with source files AND tests should NOT be minimal
  assert.notStrictEqual(
    maturity,
    'minimal',
    `BUG: 2 source files + tests should NOT be minimal, got: ${maturity}`
  )
  console.log(`  ✅ PASS - Classified as '${maturity}' (not minimal)`)
  cleanup(tempDir)
}

// ============================================================
// Test 6: 1 source file WITH tests
// ============================================================
{
  console.log('Test 6: EDGE CASE - 1 source file WITH 1 test file')
  const tempDir = createTempProject({ sourceFiles: 1, testFiles: 1 })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const maturity = detector.detect()

  assert.notStrictEqual(
    maturity,
    'minimal',
    `BUG: 1 source file + tests should NOT be minimal, got: ${maturity}`
  )
  console.log(`  ✅ PASS - Classified as '${maturity}' (not minimal)`)
  cleanup(tempDir)
}

// ============================================================
// Test 7: Exact production threshold boundary
// ============================================================
{
  console.log(`Test 7: Exact production threshold (${MIN_PRODUCTION} files, ${MIN_PROD_TESTS} tests, with deps)`)
  const tempDir = createTempProject({
    sourceFiles: MIN_PRODUCTION,
    testFiles: MIN_PROD_TESTS,
    hasDependencies: true,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'production-ready')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 8: Just below production (9 files, 3 tests) → development
// ============================================================
{
  console.log(`Test 8: Just below production (${MIN_PRODUCTION - 1} files, ${MIN_PROD_TESTS} tests)`)
  const tempDir = createTempProject({
    sourceFiles: MIN_PRODUCTION - 1,
    testFiles: MIN_PROD_TESTS,
    hasDependencies: true,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'development')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 9: Production files but insufficient tests → development
// ============================================================
{
  console.log(`Test 9: ${MIN_PRODUCTION} files, ${MIN_PROD_TESTS - 1} tests → development`)
  const tempDir = createTempProject({
    sourceFiles: MIN_PRODUCTION,
    testFiles: MIN_PROD_TESTS - 1,
    hasDependencies: true,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'development')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 10: Production files + tests but NO docs and NO deps → development
// ============================================================
{
  console.log('Test 10: Production-level files+tests but no docs/deps → development')
  const tempDir = createTempProject({
    sourceFiles: MIN_PRODUCTION,
    testFiles: MIN_PROD_TESTS,
    hasDependencies: false,
    hasPackageJson: true,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  assert.strictEqual(detector.detect(), 'development')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 11: Production-ready via docs (not deps)
// ============================================================
{
  console.log('Test 11: Production-ready via docs directory (no deps)')
  const tempDir = createTempProject({
    sourceFiles: MIN_PRODUCTION,
    testFiles: MIN_PROD_TESTS,
    hasDocs: true,
    hasPackageJson: false,
  })
  // Note: hasDocumentation checks for docs/ dir, which we created
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const maturity = detector.detect()
  // Without package.json, hasDependencies is false, but hasDocs should be true
  // So it should qualify for production-ready
  assert.strictEqual(maturity, 'production-ready')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 12: README line threshold for documentation detection
// ============================================================
{
  // Note: 'Line\n'.repeat(N).split('\n').length = N+1 due to trailing newline
  // The check is `lines > MIN_README_LINES` so we need N+1 <= MIN_README_LINES
  // i.e. N <= MIN_README_LINES - 1 = 99 repetitions → 100 lines → NOT > 100
  const belowThreshold = MIN_README_LINES - 1
  console.log(`Test 12: README with ${belowThreshold} text lines (${belowThreshold + 1} after split) → not documented`)
  const tempDir = createTempProject({
    sourceFiles: MIN_PRODUCTION,
    testFiles: MIN_PROD_TESTS,
    readmeLines: belowThreshold,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const stats = detector.analyzeProject()
  assert.strictEqual(stats.hasDocumentation, false, `${belowThreshold} text lines should NOT qualify`)
  console.log('  ✅ PASS')

  // Now test at threshold (100 repetitions → 101 lines → > 100)
  const tempDir2 = createTempProject({
    sourceFiles: MIN_PRODUCTION,
    testFiles: MIN_PROD_TESTS,
    readmeLines: MIN_README_LINES,
  })
  const detector2 = new ProjectMaturityDetector({ projectPath: tempDir2 })
  const stats2 = detector2.analyzeProject()
  assert.strictEqual(stats2.hasDocumentation, true, `${MIN_README_LINES} text lines should qualify`)
  console.log(`  ✅ PASS - ${MIN_README_LINES} text lines qualifies as documented`)

  cleanup(tempDir)
  cleanup(tempDir2)
}

// ============================================================
// Test 13: Malformed package.json graceful handling
// ============================================================
{
  console.log('Test 13: Malformed package.json')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maturity-boundary-'))
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{{invalid json}}')

  const srcDir = path.join(tempDir, 'src')
  fs.mkdirSync(srcDir)
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(srcDir, `mod${i}.js`), `module.exports = ${i};\n`)
  }

  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  // Should not throw, should still detect files
  const maturity = detector.detect()
  assert(maturity, 'Should return a maturity level despite bad JSON')
  assert.strictEqual(maturity, 'development', 'Should detect based on files despite bad JSON')
  console.log(`  ✅ PASS - Detected as '${maturity}' despite malformed package.json`)
  cleanup(tempDir)
}

// ============================================================
// Test 14: No package.json at all
// ============================================================
{
  console.log('Test 14: No package.json')
  const tempDir = createTempProject({
    hasPackageJson: false,
    sourceFiles: 5,
    testFiles: 2,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const maturity = detector.detect()
  assert.strictEqual(maturity, 'development', 'Should still detect via source files')

  const stats = detector.analyzeProject()
  assert.strictEqual(stats.hasDependencies, false, 'No deps without package.json')
  assert.strictEqual(stats.packageJsonExists, false, 'Should report no package.json')
  console.log(`  ✅ PASS - '${maturity}' without package.json`)
  cleanup(tempDir)
}

// ============================================================
// Test 15: Shell script project detection
// ============================================================
{
  console.log('Test 15: Shell script project (no package.json)')
  const tempDir = createTempProject({
    hasPackageJson: false,
    shellScripts: 3,
  })
  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const stats = detector.analyzeProject()

  assert.strictEqual(stats.hasShellScripts, true, 'Should detect shell scripts')
  assert.strictEqual(stats.isShellProject, true, 'Should be classified as shell project')
  assert.strictEqual(stats.shellScriptCount, 3, 'Should count shell scripts correctly')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 16: MATURITY_LEVELS has correct structure
// ============================================================
{
  console.log('Test 16: MATURITY_LEVELS structure validation')
  const levels = ['minimal', 'bootstrap', 'development', 'production-ready']

  for (const level of levels) {
    assert(MATURITY_LEVELS[level], `Should have level: ${level}`)
    assert(MATURITY_LEVELS[level].name, `${level} should have name`)
    assert(MATURITY_LEVELS[level].description, `${level} should have description`)
    assert(MATURITY_LEVELS[level].checks, `${level} should have checks`)
    assert(Array.isArray(MATURITY_LEVELS[level].checks.required), `${level} should have required checks array`)
    assert(MATURITY_LEVELS[level].message, `${level} should have message`)
  }
  console.log('  ✅ PASS - All maturity levels have correct structure')
}

// ============================================================
// Test 17: GitHub Actions output format
// ============================================================
{
  console.log('Test 17: GitHub Actions output format')
  const tempDir = createTempProject({
    sourceFiles: 5,
    testFiles: 2,
    hasDependencies: true,
  })

  const detector = new ProjectMaturityDetector({ projectPath: tempDir })
  const output = detector.generateGitHubActionsOutput()

  assert(output.maturity, 'Should have maturity')
  assert(typeof output.sourceCount === 'number', 'sourceCount should be number')
  assert(typeof output.testCount === 'number', 'testCount should be number')
  assert(typeof output.hasDeps === 'boolean', 'hasDeps should be boolean')
  assert(typeof output.hasDocs === 'boolean', 'hasDocs should be boolean')
  assert(typeof output.hasCss === 'boolean', 'hasCss should be boolean')
  assert(typeof output.requiredChecks === 'string', 'requiredChecks should be string')
  assert(typeof output.optionalChecks === 'string', 'optionalChecks should be string')
  assert(typeof output.disabledChecks === 'string', 'disabledChecks should be string')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

console.log('\n✅ All Project Maturity Boundary tests passed!\n')
