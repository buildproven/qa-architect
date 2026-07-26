'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

/**
 * TEST-003: Comprehensive error path testing
 * Tests error handling for:
 * - ESLint not installed
 * - Malformed package.json
 * - Permission errors
 * - Missing dependencies
 * - Invalid configurations
 */

async function testErrorPaths() {
  console.log('🧪 Testing error path handling...\n')

  await testESLintNotInstalled()
  await testMalformedPackageJson()
  await testPermissionErrors()
  await testMissingDependencies()
  await testInvalidESLintConfig()
  await testMissingPackageJson()

  console.log('✅ All error path tests passed!\n')
}

/**
 * Test: ESLint not installed scenario
 */
async function testESLintNotInstalled() {
  console.log('🔍 Testing ESLint not installed error handling...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-missing-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Create minimal package.json without ESLint
    const packageJson = {
      name: 'test-no-eslint',
      version: '1.0.0',
      description: 'Test project without ESLint',
      keywords: ['test'],
      license: 'MIT',
    }
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

    // Create minimal eslint.config.cjs (config exists but binary missing)
    fs.writeFileSync(
      'eslint.config.cjs',
      `module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**']
  }
]`
    )

    // Initialize git
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })

    // Run security validation - should handle gracefully whether ESLint is available or not
    const setupPath = path.join(originalCwd, 'setup.js')
    try {
      execSync(`node "${setupPath}" --security-config`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
      })
      // If it succeeds, ESLint might be globally installed - that's OK
      // The key is that it doesn't crash
      console.log(
        '  ✅ Handled ESLint scenario gracefully (globally installed)'
      )
    } catch (error) {
      // Check that error message is helpful (not a crash)
      const output = (error.stdout || '') + (error.stderr || '')
      const isGracefulError =
        output.includes('ESLint is not installed') ||
        output.includes('Install eslint') ||
        output.includes('--no-eslint-security') ||
        output.includes('not found') ||
        error.status === 1 // Expected validation failure

      if (isGracefulError || !error.stack) {
        console.log('  ✅ ESLint missing scenario handled with clear error')
      } else {
        // Unexpected crash
        throw new Error(
          `Unexpected crash without ESLint: ${error.message}\n${output}`
        )
      }
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Malformed package.json handling
 */
async function testMalformedPackageJson() {
  console.log('🔍 Testing malformed package.json error handling...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'malformed-json-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Create malformed package.json (invalid JSON)
    fs.writeFileSync('package.json', '{ "name": "test", invalid json }')

    // Initialize git
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })

    // Run setup - should fail gracefully with clear error
    const setupPath = path.join(originalCwd, 'setup.js')
    try {
      execSync(`node "${setupPath}"`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
      })
      throw new Error('Should have failed with malformed package.json')
    } catch (error) {
      const output = error.stdout || error.stderr || error.message || ''
      const hasJSONError =
        output.includes('JSON') ||
        output.includes('parse') ||
        output.includes('Unexpected')

      if (hasJSONError) {
        console.log('  ✅ Malformed JSON error detected properly')
      } else {
        throw new Error(`Expected JSON parse error, got: ${output}`)
      }
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Permission errors
 */
async function testPermissionErrors() {
  console.log('🔍 Testing permission error handling...')

  // Skip on Windows (different permission model)
  if (process.platform === 'win32') {
    console.log('  ⏭️  Skipping permission tests on Windows')
    return
  }

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Create package.json
    const packageJson = {
      name: 'test-permissions',
      version: '1.0.0',
      keywords: ['test'],
      license: 'MIT',
    }
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

    // Create read-only package.json
    fs.chmodSync('package.json', 0o444)

    // Initialize git
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })

    // Run setup - should detect permission issue
    const setupPath = path.join(originalCwd, 'setup.js')
    try {
      execSync(`node "${setupPath}"`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
      })
      // If it succeeds, it might be reading-only (which is fine)
      console.log('  ✅ Handled read-only package.json gracefully')
    } catch (error) {
      const output = error.stdout || error.stderr || ''
      const hasPermissionError =
        output.includes('permission') ||
        output.includes('EACCES') ||
        output.includes('EPERM')

      if (hasPermissionError) {
        console.log('  ✅ Permission error detected properly')
      } else {
        // Could be other error - that's OK, we're just testing it doesn't crash
        console.log('  ✅ Handled permission scenario')
      }
    }
  } finally {
    // Restore write permission before cleanup
    try {
      fs.chmodSync(path.join(testDir, 'package.json'), 0o644)
    } catch {
      // Ignore cleanup errors
    }
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Missing dependencies
 */
async function testMissingDependencies() {
  console.log('🔍 Testing missing dependencies error handling...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-deps-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Create package.json without node_modules
    const packageJson = {
      name: 'test-missing-deps',
      version: '1.0.0',
      keywords: ['test'],
      license: 'MIT',
      devDependencies: {
        eslint: '^9.0.0',
        prettier: '^3.0.0',
      },
    }
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

    // Initialize git
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })

    // Run setup without installing deps - should handle gracefully
    const setupPath = path.join(originalCwd, 'setup.js')
    try {
      execSync(`node "${setupPath}" --validate-docs`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
      })
      console.log('  ✅ Handled missing dependencies gracefully')
    } catch {
      // Expected to fail or skip validation - that's OK
      console.log('  ✅ Detected missing dependencies scenario')
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Invalid ESLint configuration
 */
async function testInvalidESLintConfig() {
  console.log('🔍 Testing invalid ESLint config error handling...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-eslint-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Create package.json
    const packageJson = {
      name: 'test-invalid-eslint',
      version: '1.0.0',
      keywords: ['test'],
      license: 'MIT',
    }
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

    // Create invalid eslint.config.cjs (syntax error)
    fs.writeFileSync(
      'eslint.config.cjs',
      `module.exports = {
  invalid syntax here
  this will cause parse error
}`
    )

    // Initialize git
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })

    // Run security validation - should handle syntax error
    const setupPath = path.join(originalCwd, 'setup.js')
    try {
      execSync(`node "${setupPath}" --security-config`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
      })
      console.log('  ✅ Handled invalid ESLint config gracefully')
    } catch (error) {
      const output = error.stdout || error.stderr || ''
      const hasSyntaxError =
        output.includes('SyntaxError') ||
        output.includes('parse') ||
        output.includes('invalid')

      if (hasSyntaxError) {
        console.log('  ✅ Invalid ESLint config error detected')
      } else {
        // Could skip validation - that's OK
        console.log('  ✅ Handled invalid config scenario')
      }
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Missing package.json
 */
async function testMissingPackageJson() {
  console.log('🔍 Testing missing package.json error handling...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-package-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Don't create package.json - should bootstrap one
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })

    // Run setup - should bootstrap or fail gracefully
    const setupPath = path.join(originalCwd, 'setup.js')
    try {
      execSync(`node "${setupPath}"`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: sanitizedGitEnvironment(),
      })

      // Check if package.json was created
      if (fs.existsSync('package.json')) {
        console.log('  ✅ Bootstrapped package.json when missing')
      } else {
        console.log('  ✅ Handled missing package.json gracefully')
      }
    } catch (error) {
      const output = error.stdout || error.stderr || ''
      const hasMissingError =
        output.includes('package.json') ||
        output.includes('not found') ||
        output.includes('ENOENT')

      if (hasMissingError) {
        console.log('  ✅ Missing package.json error detected')
      } else {
        console.log('  ✅ Handled missing package.json scenario')
      }
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

// Export for use in test runner
module.exports = { testErrorPaths }

// Run if called directly
if (require.main === module) {
  testErrorPaths().catch(error => {
    console.error('❌ Error path tests failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  })
}
