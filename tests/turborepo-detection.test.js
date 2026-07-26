'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

/**
 * Tests for Turborepo detection and workflow integration
 * These tests ensure Turborepo monorepos are properly detected and configured
 * Note: Uses execSync with controlled, safe inputs for test automation
 */
async function testTurborepoDetection() {
  console.log('🧪 Testing Turborepo detection...\n')

  await testWorkflowDetectsTurborepo()
  await testWorkflowSetsCorrectOutputs()
  await testWorkflowWithoutTurborepo()

  console.log('\n✅ All Turborepo detection tests passed!\n')
}

/**
 * Test: Workflow detects turbo.json and sets is-turborepo flag
 * Issue: CI workflows were failing on Turborepo projects
 */
async function testWorkflowDetectsTurborepo() {
  console.log('🔍 Testing workflow detects Turborepo...')

  const testDir = createTempProject()

  try {
    // Create turbo.json to simulate Turborepo project
    const turboConfig = {
      $schema: 'https://turbo.build/schema.json',
      globalDependencies: ['**/.env.*local'],
      tasks: {
        build: {
          dependsOn: ['^build'],
          outputs: ['.next/**', 'dist/**'],
        },
        dev: {
          cache: false,
          persistent: true,
        },
        lint: {},
        test: {
          dependsOn: ['build'],
        },
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'turbo.json'),
      JSON.stringify(turboConfig, null, 2)
    )

    // Create package.json with workspaces
    const packageJson = {
      name: 'test-turborepo',
      version: '1.0.0',
      private: true,
      workspaces: ['apps/*', 'packages/*'],
      scripts: {
        dev: 'turbo run dev',
        build: 'turbo run build',
        test: 'turbo run test',
        lint: 'turbo run lint',
      },
      devDependencies: {
        turbo: '^2.0.0',
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Run setup to generate workflow
    const setupPath = path.join(__dirname, '..', 'setup.js')
    execSync(`QAA_DEVELOPER=true node ${setupPath}`, {
      cwd: testDir,
      stdio: 'pipe',
      env: sanitizedGitEnvironment(),
    })

    // Read generated workflow
    const workflowPath = path.join(
      testDir,
      '.github',
      'workflows',
      'quality.yml'
    )

    if (!fs.existsSync(workflowPath)) {
      throw new Error('Workflow file was not generated')
    }

    const workflowContent = fs.readFileSync(workflowPath, 'utf8')

    // Test 1: Workflow should check for turbo.json
    if (!workflowContent.includes('turbo.json')) {
      throw new Error('Workflow should check for turbo.json file')
    }

    // Test 2: Should set is-turborepo output
    if (!workflowContent.includes('is-turborepo')) {
      throw new Error('Workflow should set is-turborepo output variable')
    }

    // Test 3: Should set turbo-prefix output
    if (!workflowContent.includes('turbo-prefix')) {
      throw new Error('Workflow should set turbo-prefix output variable')
    }

    console.log('  ✅ Workflow correctly detects Turborepo')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test: Workflow sets correct outputs for Turborepo projects
 */
async function testWorkflowSetsCorrectOutputs() {
  console.log('🔍 Testing workflow sets correct Turborepo outputs...')

  const workflowTemplate = path.join(
    __dirname,
    '..',
    '.github',
    'workflows',
    'quality.yml'
  )

  if (!fs.existsSync(workflowTemplate)) {
    throw new Error('Workflow template not found')
  }

  const content = fs.readFileSync(workflowTemplate, 'utf8')

  // Test 1: detect-maturity job should output is-turborepo
  const detectMaturitySection = content.match(
    /detect-maturity:[\s\S]*?outputs:[\s\S]*?steps:/m
  )

  if (!detectMaturitySection) {
    throw new Error('Could not find detect-maturity job outputs')
  }

  if (!detectMaturitySection[0].includes('is-turborepo:')) {
    throw new Error('detect-maturity should output is-turborepo')
  }

  if (!detectMaturitySection[0].includes('turbo-prefix:')) {
    throw new Error('detect-maturity should output turbo-prefix')
  }

  console.log('  ✅ Workflow sets correct Turborepo outputs')
}

/**
 * Test: Workflow works for non-Turborepo projects
 * Ensures we didn't break standard projects
 */
async function testWorkflowWithoutTurborepo() {
  console.log('🔍 Testing workflow for non-Turborepo projects...')

  const testDir = createTempProject()

  try {
    // Create standard package.json (no workspaces, no turbo.json)
    const packageJson = {
      name: 'test-standard-project',
      version: '1.0.0',
      scripts: {
        dev: 'node index.js',
        test: 'echo "Testing..."',
        lint: 'eslint .',
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Create source files
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true })
    fs.writeFileSync(
      path.join(testDir, 'src', 'index.js'),
      'console.log("test")'
    )

    // Run setup to generate workflow
    const setupPath = path.join(__dirname, '..', 'setup.js')
    execSync(`QAA_DEVELOPER=true node ${setupPath}`, {
      cwd: testDir,
      stdio: 'pipe',
      env: sanitizedGitEnvironment(),
    })

    // Read generated workflow
    const workflowPath = path.join(
      testDir,
      '.github',
      'workflows',
      'quality.yml'
    )

    if (!fs.existsSync(workflowPath)) {
      throw new Error('Workflow file was not generated')
    }

    const workflowContent = fs.readFileSync(workflowPath, 'utf8')

    // Test: Workflow should still be valid
    if (!workflowContent.includes('name: Quality Checks')) {
      throw new Error('Workflow should have correct name')
    }

    console.log('  ✅ Workflow works correctly for non-Turborepo projects')
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Helper: Create a temporary project directory
 */
function createTempProject() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqa-turbo-test-'))

  // Initialize git repo
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
  testTurborepoDetection()
    .then(() => {
      process.exit(0)
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error.message)
      console.error(error.stack)
      process.exit(1)
    })
}

module.exports = { testTurborepoDetection }
