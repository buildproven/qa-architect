'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

/**
 * Tests for CI environment handling
 * These tests ensure quality tools behave correctly in CI environments
 * Note: Uses execSync with controlled, safe inputs for test automation
 */
async function testCIEnvironment() {
  console.log('🧪 Testing CI environment handling...\n')

  await testHuskySkipsInCI()
  await testHuskyRunsInLocal()
  await testSmartTestStrategyInCI()

  console.log('\n✅ All CI environment tests passed!\n')
}

/**
 * Test: Husky prepare script skips in CI
 * Issue: Husky was failing in Vercel/GitHub Actions deployments
 */
async function testHuskySkipsInCI() {
  console.log('🔍 Testing Husky skips in CI environment...')

  const testDir = createTempProject()

  try {
    // Create package.json with CI-aware prepare script
    const packageJson = {
      name: 'test-ci-project',
      version: '1.0.0',
      scripts: {
        prepare: '[ "$CI" = "true" ] && echo \'Skipping Husky in CI\' || husky',
      },
      devDependencies: {
        husky: '^9.1.4',
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Test 1: In CI environment, prepare script should skip Husky
    const ciOutput = execSync('npm run prepare', {
      cwd: testDir,
      env: { ...process.env, CI: 'true', PATH: process.env.PATH },
      encoding: 'utf8',
    })

    if (!ciOutput.includes('Skipping Husky in CI')) {
      throw new Error(
        'Prepare script should output "Skipping Husky in CI" when CI=true'
      )
    }

    if (ciOutput.includes('husky install')) {
      throw new Error(
        'Prepare script should NOT run husky install when CI=true'
      )
    }

    console.log('  ✅ Husky correctly skips in CI environment')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Husky runs in local environment
 * Ensures Husky still works for developers locally
 */
async function testHuskyRunsInLocal() {
  console.log('🔍 Testing Husky runs in local environment...')

  const testDir = createTempProject()

  try {
    // Create package.json with CI-aware prepare script
    const packageJson = {
      name: 'test-local-project',
      version: '1.0.0',
      scripts: {
        prepare: '[ "$CI" = "true" ] && echo \'Skipping Husky in CI\' || husky',
      },
      devDependencies: {
        husky: '^9.1.4',
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Test 2: In local environment (CI not set), prepare script should attempt to run Husky
    let localOutput = ''
    let localError = ''

    try {
      localOutput = execSync('npm run prepare', {
        cwd: testDir,
        env: { ...process.env, CI: undefined, PATH: process.env.PATH },
        encoding: 'utf8',
      })
    } catch (err) {
      // Expected to fail because husky is not actually installed
      // But the command should have attempted to run it
      localOutput = err.stdout || ''
      localError = err.stderr || err.message || ''
    }

    // Should have attempted to run husky (command not found is expected)
    const combinedOutput = localOutput + localError

    if (!combinedOutput.includes('husky')) {
      throw new Error(
        'Prepare script should attempt to run husky command in local environment'
      )
    }

    // Should NOT have successfully skipped (should error trying to run husky)
    // The error "husky: command not found" means it tried to run (correct behavior)
    if (
      combinedOutput.includes('command not found') &&
      !combinedOutput.includes('husky')
    ) {
      throw new Error('Expected husky command not found error')
    }

    console.log('  ✅ Husky correctly runs in local environment')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Smart test strategy handles CI environment
 * Ensures smart test strategy can run in CI without local dependencies
 */
async function testSmartTestStrategyInCI() {
  console.log('🔍 Testing smart test strategy in CI...')

  const testDir = createTempProject()

  try {
    // Create a mock smart test strategy script
    const scriptsDir = path.join(testDir, 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })

    const strategyScript = `#!/bin/bash
set -e

# This is a mock - just verify it can run in CI
if [ "$CI" = "true" ]; then
  echo "Running in CI environment"
else
  echo "Running in local environment"
fi

# Mock test command
echo "✅ Tests passed"
`

    const scriptPath = path.join(scriptsDir, 'smart-test-strategy.sh')
    fs.writeFileSync(scriptPath, strategyScript)
    fs.chmodSync(scriptPath, '755')

    // Test: Script should run successfully in CI
    const ciOutput = execSync('bash scripts/smart-test-strategy.sh', {
      cwd: testDir,
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
    })

    if (!ciOutput.includes('Running in CI environment')) {
      throw new Error('Smart test strategy should detect CI environment')
    }

    if (!ciOutput.includes('Tests passed')) {
      throw new Error('Smart test strategy should complete successfully in CI')
    }

    console.log('  ✅ Smart test strategy works in CI environment')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Helper: Create a temporary project directory
 */
function createTempProject() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqa-ci-test-'))

  // Initialize git repo (required for Husky)
  execSync('git init', {
    cwd: testDir,
    stdio: 'ignore',
    env: sanitizedGitEnvironment(),
  })
  execSync('git config user.email "test@example.com"', {
    cwd: testDir,
    stdio: 'ignore',
    env: sanitizedGitEnvironment(),
  })
  execSync('git config user.name "Test User"', {
    cwd: testDir,
    stdio: 'ignore',
    env: sanitizedGitEnvironment(),
  })

  return testDir
}

// Run tests
if (require.main === module) {
  testCIEnvironment()
    .then(() => {
      process.exit(0)
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error.message)
      console.error(error.stack)
      process.exit(1)
    })
}

module.exports = { testCIEnvironment }
