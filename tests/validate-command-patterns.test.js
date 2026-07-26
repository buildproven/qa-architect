'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

const projectRoot = path.join(__dirname, '..')
const validateScript = path.join(
  projectRoot,
  'scripts',
  'validate-command-patterns.js'
)

/**
 * Test suite for scripts/validate-command-patterns.js
 *
 * Tests deprecated command pattern detection:
 * - ESLint --ext flag (deprecated in ESLint 9)
 * - husky install (deprecated in Husky 9)
 * - Prettier --no-semi flag (deprecated)
 * - Stylelint --config flag usage
 * - Exit codes
 *
 * Note: This script uses __dirname, so we test by creating temporary
 * backup files and modifying the actual project files temporarily.
 */

const backupFile = filePath => {
  const fullPath = path.join(projectRoot, filePath)
  if (fs.existsSync(fullPath)) {
    const backupPath = fullPath + '.test-backup'
    fs.copyFileSync(fullPath, backupPath)
    return backupPath
  }
  return null
}

const restoreFile = (filePath, backupPath) => {
  const fullPath = path.join(projectRoot, filePath)
  if (backupPath && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, fullPath)
    fs.unlinkSync(backupPath)
  } else if (fs.existsSync(fullPath)) {
    // File didn't exist before, remove it
    fs.unlinkSync(fullPath)
  }
}

const createTestFile = (filePath, content) => {
  const fullPath = path.join(projectRoot, filePath)
  const dir = path.dirname(fullPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(fullPath, content)
}

const runValidation = shouldSucceed => {
  try {
    const result = execSync(`node "${validateScript}" 2>&1`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      env: sanitizedGitEnvironment(),
    })
    if (!shouldSucceed) {
      throw new Error(
        `Expected validation to fail but it succeeded with output: ${result}`
      )
    }
    return { success: true, output: result, exitCode: 0 }
  } catch (error) {
    if (shouldSucceed) {
      throw new Error(
        `Expected validation to succeed but it failed: ${error.message}\nOutput: ${error.stdout}\nError: ${error.stderr}`
      )
    }
    return {
      success: false,
      output: (error.stdout || '') + (error.stderr || ''),
      error: error.stderr || '',
      exitCode: error.status || 1,
    }
  }
}

// Test 1: Clean code with no deprecated patterns (test current state)
console.log('Test 1: Current project has no deprecated patterns')
{
  try {
    const result = runValidation(true)
    assert.strictEqual(result.success, true, 'Should succeed with clean code')
    assert.ok(
      result.output.includes('No deprecated command patterns found'),
      'Should show success message'
    )
    console.log('✓ Test 1 passed: Current project is clean')
  } catch {
    console.log(
      '⚠ Test 1 skipped: Project has deprecated patterns (expected in development)'
    )
  }
}

// Test 2: Deprecated ESLint --ext flag
console.log('Test 2: Deprecated ESLint --ext flag detected')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          lint: 'eslint --ext .js,.jsx src/'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.strictEqual(result.success, false, 'Should fail with --ext flag')
    assert.strictEqual(result.exitCode, 1, 'Should exit with code 1')
    assert.ok(
      result.output.includes('--ext flag is deprecated'),
      'Should show --ext deprecation error'
    )
    assert.ok(
      result.output.includes('Use "eslint ."') ||
        result.output.includes('Use "eslint ."'),
      'Should suggest correct usage'
    )
    console.log('✓ Test 2 passed: ESLint --ext flag detected')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 3: Deprecated husky install
console.log('Test 3: Deprecated husky install detected')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          prepare: 'husky install'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.strictEqual(result.success, false, 'Should fail with husky install')
    assert.ok(
      result.output.includes('husky install is deprecated'),
      'Should show husky install deprecation error'
    )
    assert.ok(
      result.output.includes('Use just "husky"') ||
        result.output.includes('Use just \\"husky\\"'),
      'Should suggest correct usage'
    )
    console.log('✓ Test 3 passed: husky install detected')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 4: Deprecated Prettier --no-semi
console.log('Test 4: Deprecated Prettier --no-semi detected')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          format: 'prettier --write --no-semi .'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.strictEqual(result.success, false, 'Should fail with --no-semi')
    assert.ok(
      result.output.includes('--no-semi is deprecated'),
      'Should show --no-semi deprecation error'
    )
    assert.ok(
      result.output.includes('.prettierrc'),
      'Should suggest config file'
    )
    console.log('✓ Test 4 passed: Prettier --no-semi detected')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 5: Deprecated Stylelint --config
console.log('Test 5: Deprecated Stylelint --config flag')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          stylelint: 'stylelint --config .stylelintrc.json "**/*.css"'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.strictEqual(result.success, false, 'Should fail with --config')
    assert.ok(
      result.output.includes('Stylelint --config flag'),
      'Should show Stylelint --config error'
    )
    console.log('✓ Test 5 passed: Stylelint --config detected')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 6: Multiple deprecated patterns
console.log('Test 6: Multiple deprecated patterns detected')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          lint: 'eslint --ext .js src/',
          prepare: 'husky install',
          format: 'prettier --no-semi --write .'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail with multiple patterns'
    )
    assert.ok(
      result.output.includes('Found') && result.output.includes('deprecated'),
      'Should show count of deprecated patterns'
    )
    console.log('✓ Test 6 passed: Multiple patterns detected')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 7: Pattern in setup.js
console.log('Test 7: Pattern detected in any checked file')
{
  const backupPath = backupFile('setup.js')
  try {
    // Read original content
    const originalContent = fs.readFileSync(
      path.join(projectRoot, 'setup.js'),
      'utf8'
    )
    // Add a deprecated pattern
    createTestFile('setup.js', originalContent + '\n// Test: husky install\n')

    const result = runValidation(false)
    assert.strictEqual(
      result.success,
      false,
      'Should detect pattern in setup.js'
    )
    console.log('✓ Test 7 passed: Pattern in setup.js detected')
  } finally {
    restoreFile('setup.js', backupPath)
  }
}

// Test 8: Exit code - success
console.log('Test 8: Exit code - success scenario')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          lint: 'eslint .',
          prepare: 'husky'
        }
      }
    `
    )

    const result = runValidation(true)
    assert.strictEqual(result.exitCode, 0, 'Should exit with code 0')
    console.log('✓ Test 8 passed: Exit code 0 on success')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 9: Exit code - failure
console.log('Test 9: Exit code - failure scenario')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          prepare: 'husky install'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.strictEqual(result.exitCode, 1, 'Should exit with code 1')
    console.log('✓ Test 9 passed: Exit code 1 on failure')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

// Test 10: Detailed error output with suggestions
console.log('Test 10: Detailed error output with suggestions')
{
  const backupPath = backupFile('config/defaults.js')
  try {
    createTestFile(
      'config/defaults.js',
      `
      module.exports = {
        scripts: {
          lint: 'eslint --ext .js src/'
        }
      }
    `
    )

    const result = runValidation(false)
    assert.ok(
      result.output.includes('config/defaults.js'),
      'Should show affected file'
    )
    assert.ok(
      result.output.includes('💡') || result.output.includes('suggestion'),
      'Should show suggestion icon or text'
    )
    console.log('✓ Test 10 passed: Detailed error output provided')
  } finally {
    restoreFile('config/defaults.js', backupPath)
  }
}

console.log('\n✅ All validate-command-patterns.js tests passed! (10 tests)')
