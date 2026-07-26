'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

/**
 * Test suite for ProjectMaturityDetector CLI
 *
 * Tests CLI interface and command-line usage:
 * - CLI output format
 * - GitHub Actions output
 * - Verbose mode
 * - printReport() functionality
 */

console.log('🧪 Testing ProjectMaturityDetector CLI...\n')

const maturityScript = path.join(__dirname, '..', 'lib', 'project-maturity.js')

// Helper: Create temp project
const createTempProject = (sourceFiles = 0, testFiles = 0) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maturity-cli-test-'))

  // Create package.json
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
  )

  // Create source files
  if (sourceFiles > 0) {
    const srcDir = path.join(tempDir, 'src')
    fs.mkdirSync(srcDir, { recursive: true })
    for (let i = 0; i < sourceFiles; i++) {
      fs.writeFileSync(
        path.join(srcDir, `file${i}.js`),
        `module.exports = ${i};`
      )
    }
  }

  // Create test files
  if (testFiles > 0) {
    const testDir = path.join(tempDir, '__tests__')
    fs.mkdirSync(testDir, { recursive: true })
    for (let i = 0; i < testFiles; i++) {
      fs.writeFileSync(
        path.join(testDir, `test${i}.test.js`),
        `test("${i}", () => {});`
      )
    }
  }

  return tempDir
}

// Helper: Clean up temp directory
const cleanupTempProject = tempDir => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch (error) {
    console.warn(`Warning: Could not clean up ${tempDir}:`, error.message)
  }
}

// Test 1: CLI basic usage (human-readable output)
;(() => {
  const tempDir = createTempProject(5, 2)

  try {
    const output = execSync(`node ${maturityScript}`, {
      cwd: tempDir,
      encoding: 'utf8',
      env: sanitizedGitEnvironment(),
    })

    assert.ok(
      output.includes('Project Maturity Report'),
      'Should include report header'
    )
    assert.ok(
      output.includes('Maturity Level:'),
      'Should include maturity level'
    )
    assert.ok(
      output.includes('Project Statistics:'),
      'Should include statistics'
    )
    assert.ok(
      output.includes('Quality Checks:'),
      'Should include quality checks'
    )
    assert.ok(output.includes('Source files:'), 'Should include source count')
    assert.ok(output.includes('Test files:'), 'Should include test count')

    console.log('✅ Test 1 passed: CLI basic usage (human-readable)')
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message)
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 2: CLI verbose mode
;(() => {
  const tempDir = createTempProject(3, 1)

  try {
    const output = execSync(`node ${maturityScript} --verbose`, {
      cwd: tempDir,
      encoding: 'utf8',
      env: sanitizedGitEnvironment(),
    })

    assert.ok(
      output.includes('Project Analysis:'),
      'Verbose mode should include analysis'
    )
    assert.ok(
      output.includes('Source files:'),
      'Verbose mode should show file counts'
    )
    assert.ok(
      output.includes('Test files:'),
      'Verbose mode should show test counts'
    )

    console.log('✅ Test 2 passed: CLI verbose mode')
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message)
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 3: CLI GitHub Actions output
;(() => {
  const tempDir = createTempProject(10, 5)

  try {
    const output = execSync(`node ${maturityScript} --github-actions`, {
      cwd: tempDir,
      encoding: 'utf8',
      env: sanitizedGitEnvironment(),
    })

    // Check for GitHub Actions output format (key=value pairs)
    assert.ok(output.includes('maturity='), 'Should output maturity')
    assert.ok(output.includes('source-count='), 'Should output source-count')
    assert.ok(output.includes('test-count='), 'Should output test-count')
    assert.ok(output.includes('has-deps='), 'Should output has-deps')
    assert.ok(output.includes('has-docs='), 'Should output has-docs')
    assert.ok(output.includes('has-css='), 'Should output has-css')
    assert.ok(
      output.includes('required-checks='),
      'Should output required-checks'
    )
    assert.ok(
      output.includes('optional-checks='),
      'Should output optional-checks'
    )
    assert.ok(
      output.includes('disabled-checks='),
      'Should output disabled-checks'
    )

    // Verify values
    assert.ok(
      output.includes('source-count=10'),
      'Should report correct source count'
    )
    assert.ok(
      output.includes('test-count=5'),
      'Should report correct test count'
    )

    console.log('✅ Test 3 passed: CLI GitHub Actions output')
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message)
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 4: CLI exit code (should be 0 for successful detection)
;(() => {
  const tempDir = createTempProject(2, 0)

  try {
    execSync(`node ${maturityScript}`, {
      cwd: tempDir,
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    console.log('✅ Test 4 passed: CLI exit code (0 for success)')
  } catch (error) {
    console.error(
      '❌ Test 4 failed: CLI exited with non-zero code:',
      error.message
    )
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 5: CLI with -v flag (short form of --verbose)
;(() => {
  const tempDir = createTempProject(1, 0)

  try {
    const output = execSync(`node ${maturityScript} -v`, {
      cwd: tempDir,
      encoding: 'utf8',
      env: sanitizedGitEnvironment(),
    })

    assert.ok(
      output.includes('Project Analysis:'),
      'Short -v flag should enable verbose mode'
    )

    console.log('✅ Test 5 passed: CLI -v flag (short form)')
  } catch (error) {
    console.error('❌ Test 5 failed:', error.message)
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 6: Verify maturity level in output matches project state
;(() => {
  const tempDir = createTempProject(0, 0) // Minimal project

  try {
    const output = execSync(`node ${maturityScript}`, {
      cwd: tempDir,
      encoding: 'utf8',
      env: sanitizedGitEnvironment(),
    })

    assert.ok(output.includes('Minimal'), 'Should detect minimal maturity')
    assert.ok(output.includes('Source files: 0'), 'Should show 0 source files')

    console.log('✅ Test 6 passed: Maturity level matches project state')
  } catch (error) {
    console.error('❌ Test 6 failed:', error.message)
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 7: Production-ready project detection via CLI
;(() => {
  const tempDir = createTempProject(15, 5)

  try {
    // Add documentation
    const docsDir = path.join(tempDir, 'docs')
    fs.mkdirSync(docsDir, { recursive: true })
    fs.writeFileSync(path.join(docsDir, 'guide.md'), '# Documentation\n')

    // Add dependencies
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'package.json'), 'utf8')
    )
    packageJson.dependencies = { express: '^4.18.0' }
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    const output = execSync(`node ${maturityScript}`, {
      cwd: tempDir,
      encoding: 'utf8',
      env: sanitizedGitEnvironment(),
    })

    assert.ok(
      output.includes('Production Ready'),
      'Should detect production-ready maturity'
    )
    assert.ok(
      output.includes('Documentation: Yes'),
      'Should detect documentation'
    )
    assert.ok(
      output.includes('Dependencies: Yes'),
      'Should detect dependencies'
    )

    console.log('✅ Test 7 passed: Production-ready detection via CLI')
  } catch (error) {
    console.error('❌ Test 7 failed:', error.message)
    process.exitCode = 1
  } finally {
    cleanupTempProject(tempDir)
  }
})()

// Test 8: Test the printReport() method directly
;(() => {
  try {
    const { ProjectMaturityDetector } = require('../lib/project-maturity')
    const tempDir = createTempProject(7, 3)

    const detector = new ProjectMaturityDetector({ projectPath: tempDir })

    // Capture console output
    const originalLog = console.log
    const logs = []
    console.log = (...args) => logs.push(args.join(' '))

    detector.printReport()

    console.log = originalLog

    const output = logs.join('\n')

    assert.ok(output.includes('Project Maturity Report'), 'Should print header')
    assert.ok(output.includes('Maturity Level:'), 'Should print maturity level')
    assert.ok(output.includes('Project Statistics:'), 'Should print statistics')
    assert.ok(output.includes('Quality Checks:'), 'Should print checks')

    cleanupTempProject(tempDir)
    console.log('✅ Test 8 passed: printReport() method')
  } catch (error) {
    console.error('❌ Test 8 failed:', error.message)
    process.exitCode = 1
  }
})()

// Summary
console.log('\n🎉 All CLI tests completed!')

if (process.exitCode === 1) {
  console.error('\n❌ Some tests failed')
} else {
  console.log('\n✅ All tests passed')
}
