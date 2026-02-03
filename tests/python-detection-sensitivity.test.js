#!/usr/bin/env node

/**
 * Python Detection Sensitivity Tests
 *
 * Tests that Python detection requires strong evidence before deploying Python CI.
 * - Config files (pyproject.toml, requirements.txt, setup.py, Pipfile) → DETECTS
 * - Single .py file → NO DETECTION (too sensitive)
 * - Few .py files (2-4) → NO DETECTION (utility scripts, not a Python project)
 * - 5+ meaningful .py files → DETECTS (real Python project)
 */

const assert = require('node:assert')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

console.log('🧪 Testing Python Detection Sensitivity...\n')

/**
 * Create temporary test directory with git
 */
function createTestDir(name) {
  const testDir = path.join(os.tmpdir(), `cqa-py-detect-${name}-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  // Initialize git (required by setup.js)
  execSync('git init', { cwd: testDir, stdio: 'pipe' })
  execSync('git config user.email "test@example.com"', {
    cwd: testDir,
    stdio: 'pipe',
  })
  execSync('git config user.name "Test User"', {
    cwd: testDir,
    stdio: 'pipe',
  })

  return testDir
}

/**
 * Test 1: Single random .py file should NOT trigger Python setup
 */
function testSinglePyFileNoDetection() {
  console.log('Test 1: Single random .py file → NO Python detection')

  const testDir = createTestDir('single-py')

  try {
    // Create JS project with single random Python script
    const packageJsonPath = path.join(testDir, 'package.json')
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: 'js-project', version: '1.0.0' })
    )
    fs.writeFileSync(path.join(testDir, 'index.js'), 'console.log("JS")')
    fs.writeFileSync(path.join(testDir, 'random_script.py'), 'print("utility")')

    // Run setup
    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    const output = execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    // Should NOT detect Python
    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      !hasPythonSetup,
      'Should NOT create Python config for single .py file'
    )

    // Should mention it's a JS project only
    const isJSOnly =
      !output.includes('Python project') && !output.includes('🐍')
    assert(isJSOnly, 'Should detect as JS project only')

    console.log('  ✅ Single .py file correctly ignored (not a Python project)')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 2: Few .py files (< 5) should NOT trigger Python detection
 */
function testFewPyFilesNoDetection() {
  console.log('\nTest 2: Few .py files (3) → NO Python detection')

  const testDir = createTestDir('few-py')

  try {
    // Create project with only 3 Python files (below threshold)
    fs.writeFileSync(path.join(testDir, 'app.py'), 'print("app")')
    fs.writeFileSync(path.join(testDir, 'utils.py'), 'print("utils")')
    fs.writeFileSync(path.join(testDir, 'config.py'), 'print("config")')

    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    // Should NOT detect Python (below 5-file threshold)
    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      !hasPythonSetup,
      'Should NOT create Python config for only 3 .py files'
    )

    console.log('  ✅ Few .py files correctly ignored (not enough evidence)')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 2b: 5+ meaningful .py files SHOULD trigger Python detection
 */
function testManyPyFilesDetection() {
  console.log('\nTest 2b: 5+ .py files → Python detection')

  const testDir = createTestDir('many-py')

  try {
    const pyFiles = [
      'app.py',
      'utils.py',
      'config.py',
      'models.py',
      'routes.py',
    ]
    for (const f of pyFiles) {
      fs.writeFileSync(path.join(testDir, f), `print("${f}")`)
    }

    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    const output = execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(hasPythonSetup, 'Should create Python config for 5+ .py files')

    const detectedPython = output.includes('Python') || output.includes('🐍')
    assert(detectedPython, 'Should detect as Python project')

    console.log('  ✅ 5+ .py files correctly detected')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 3: Single main.py should NOT trigger Python detection (need 5+ files)
 */
function testMainPatternNoDetection() {
  console.log('\nTest 3: Single main.py → NO Python detection')

  const testDir = createTestDir('main-pattern')

  try {
    fs.writeFileSync(path.join(testDir, 'main.py'), 'print("main")')

    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      !hasPythonSetup,
      'Should NOT create Python config for single main.py'
    )

    console.log('  ✅ Single main.py correctly ignored (need 5+ files)')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 4: __init__.py and conftest.py should NOT count toward threshold
 */
function testBoilerplateFilesIgnored() {
  console.log('\nTest 4: Boilerplate .py files → NOT counted')

  const testDir = createTestDir('boilerplate')

  try {
    // Create 4 meaningful files + 3 boilerplate = 7 total but only 4 meaningful
    fs.writeFileSync(path.join(testDir, 'app.py'), 'print("app")')
    fs.writeFileSync(path.join(testDir, 'utils.py'), 'print("utils")')
    fs.writeFileSync(path.join(testDir, 'config.py'), 'print("config")')
    fs.writeFileSync(path.join(testDir, 'models.py'), 'print("models")')
    fs.writeFileSync(path.join(testDir, '__init__.py'), '')
    fs.writeFileSync(path.join(testDir, 'conftest.py'), '')
    const testsDir = path.join(testDir, 'tests')
    fs.mkdirSync(testsDir)
    fs.writeFileSync(path.join(testsDir, '__init__.py'), '')
    fs.writeFileSync(path.join(testsDir, 'conftest.py'), '')

    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    // 4 meaningful files < 5 threshold, should NOT detect
    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      !hasPythonSetup,
      'Should NOT count __init__.py/conftest.py toward threshold'
    )

    console.log('  ✅ Boilerplate files correctly excluded from count')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 5a: Config file alone (no .py files) should NOT trigger detection
 */
function testConfigFileAloneNoDetection() {
  console.log('\nTest 5a: pyproject.toml alone (0 .py files) → NO detection')

  const testDir = createTestDir('config-alone')

  try {
    fs.writeFileSync(
      path.join(testDir, 'pyproject.toml'),
      '[project]\nname = "test"'
    )

    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      !hasPythonSetup,
      'Should NOT create Python config for pyproject.toml alone without .py files'
    )

    console.log('  ✅ Config file alone correctly ignored')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 5b: Config file + .py files should trigger detection
 */
function testConfigFilePlusPyDetection() {
  console.log('\nTest 5b: pyproject.toml + .py files → Python detection')

  const testDir = createTestDir('config-plus-py')

  try {
    fs.writeFileSync(
      path.join(testDir, 'pyproject.toml'),
      '[project]\nname = "test"'
    )
    fs.writeFileSync(path.join(testDir, 'app.py'), 'print("app")')

    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      hasPythonSetup,
      'Should create Python config for pyproject.toml + .py files'
    )

    console.log('  ✅ Config file + .py files correctly detected')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test 6: JS project with scripts/ subdirectory containing single .py
 */
function testSubdirectorySinglePy() {
  console.log('\nTest 6: scripts/ with single .py → NO Python detection')

  const testDir = createTestDir('subdir-single-py')

  try {
    // Create JS project
    const packageJsonPath = path.join(testDir, 'package.json')
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: 'js-project', version: '1.0.0' })
    )
    fs.writeFileSync(path.join(testDir, 'index.js'), 'console.log("JS")')

    // Add single Python script in subdirectory
    const scriptsDir = path.join(testDir, 'scripts')
    fs.mkdirSync(scriptsDir)
    fs.writeFileSync(path.join(scriptsDir, 'deploy.py'), 'print("deploy")')

    // Run setup
    const setupPath = path.resolve(__dirname, '..', 'setup.js')
    execSync(`node "${setupPath}"`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    // Should NOT detect as Python project
    const hasPythonSetup = fs.existsSync(
      path.join(testDir, '.pre-commit-config.yaml')
    )
    assert(
      !hasPythonSetup,
      'Should NOT create Python config for single .py in subdirectory'
    )

    console.log('  ✅ Single .py in subdirectory correctly ignored')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

// Run all tests
;(async () => {
  try {
    testSinglePyFileNoDetection()
    testFewPyFilesNoDetection()
    testManyPyFilesDetection()
    testMainPatternNoDetection()
    testBoilerplateFilesIgnored()
    testConfigFileAloneNoDetection()
    testConfigFilePlusPyDetection()
    testSubdirectorySinglePy()

    console.log('\n🎉 All Python Detection Sensitivity Tests Passed!\n')
    console.log('✅ Single random .py file → NO detection')
    console.log('✅ Few .py files (< 5) → NO detection')
    console.log('✅ 5+ meaningful .py files → Detection')
    console.log('✅ Single main.py → NO detection (need 5+ files)')
    console.log('✅ Boilerplate files (__init__.py, conftest.py) → NOT counted')
    console.log('✅ Config alone (pyproject.toml, no .py) → NO detection')
    console.log('✅ Config + .py files → Detection')
    console.log('✅ Subdirectory single .py → NO detection')
    console.log(
      '\n📊 Detection requires (config + ≥1 .py) OR (≥5 meaningful .py files)'
    )
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
})()
