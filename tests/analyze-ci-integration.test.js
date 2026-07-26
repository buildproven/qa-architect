#!/usr/bin/env node

/**
 * Integration tests for --analyze-ci CLI command
 * Tests the full CLI flow with real workflow files
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

console.log('🧪 Testing --analyze-ci CLI integration...\n')

// Store original cwd
const originalCwd = process.cwd()

/**
 * Helper: Create temp git repo with workflow
 */
function createTestRepo(workflowContent) {
  const testDir = path.join(os.tmpdir(), `cqa-test-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  // Init git repo (safe: hardcoded command, no user input)
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

  // Create workflow
  const workflowDir = path.join(testDir, '.github', 'workflows')
  fs.mkdirSync(workflowDir, { recursive: true })
  fs.writeFileSync(
    path.join(workflowDir, 'ci.yml'),
    workflowContent || DEFAULT_WORKFLOW
  )

  // Create some commits for frequency analysis
  fs.writeFileSync(path.join(testDir, 'test.txt'), 'test')
  execSync('git add .', {
    cwd: testDir,
    stdio: 'ignore',
    env: sanitizedGitEnvironment(),
  })
  execSync('git commit -m "Initial commit"', {
    cwd: testDir,
    stdio: 'ignore',
    env: sanitizedGitEnvironment(),
  })

  return testDir
}

const DEFAULT_WORKFLOW = `name: CI

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
`

const WORKFLOW_WITH_MATRIX = `name: CI Matrix

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: ['14', '16', '18', '20']
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: \${{ matrix.node }}
      - run: npm install
      - run: npm test
`

const WORKFLOW_OPTIMIZED = `name: Optimized CI

on:
  push:
    paths:
      - 'src/**'
      - 'tests/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
`

// Test 1: Basic workflow analysis
;(() => {
  console.log('Test 1: Analyze basic workflow')
  const testDir = createTestRepo()

  try {
    // Safe: hardcoded command with controlled env vars
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
      }
    )

    // Should contain expected output sections
    assert.ok(output.includes('GitHub Actions Usage Analysis'))
    assert.ok(output.includes('Estimated usage:'))
    assert.ok(output.includes('Workflows detected: 1'))
    assert.ok(output.includes('Cost Analysis'))

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 2: No workflows directory
;(() => {
  console.log('Test 2: Handle missing workflows gracefully')
  const testDir = path.join(os.tmpdir(), `cqa-test-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  // Init git but no workflows
  execSync('git init', {
    cwd: testDir,
    stdio: 'ignore',
    env: sanitizedGitEnvironment(),
  })

  try {
    execSync(`node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`, {
      cwd: testDir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
    })
    assert.fail('Should have exited with error')
  } catch (error) {
    // Should fail with helpful message
    const output = error.stderr
      ? error.stderr.toString()
      : error.stdout.toString()
    assert.ok(
      output.includes('No GitHub Actions workflows found') ||
        output.includes('No .github/workflows'),
      'Should show helpful error message'
    )
    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 3: Workflow with large matrix
;(() => {
  console.log('Test 3: Detect oversized matrix')
  const testDir = createTestRepo(WORKFLOW_WITH_MATRIX)

  try {
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
      }
    )

    // Should detect matrix and suggest optimization
    assert.ok(output.includes('Optimization Recommendations'))
    assert.ok(
      output.includes('matrix') || output.includes('Matrix'),
      'Should detect matrix optimization'
    )

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 4: Already optimized workflow
;(() => {
  console.log('Test 4: Recognize optimized workflow')
  const testDir = createTestRepo(WORKFLOW_OPTIMIZED)

  try {
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
      }
    )

    // Should show fewer or no recommendations
    assert.ok(output.includes('GitHub Actions Usage Analysis'))

    // Either shows "No optimization opportunities" or minimal recommendations
    const hasOptimizations = output.includes('Optimization Recommendations')
    if (hasOptimizations) {
      // If it does show recommendations, they should be low priority
      const highPriorityCount = (output.match(/🔴 High Priority/g) || []).length
      assert.ok(
        highPriorityCount === 0,
        'Optimized workflow should not have high priority recommendations'
      )
    }

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 5: Free tier cost analysis
;(() => {
  console.log('Test 5: Free tier cost calculations')
  const testDir = createTestRepo()

  try {
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
      }
    )

    // Should mention free tier
    assert.ok(
      output.includes('Free tier') || output.includes('free tier'),
      'Should analyze free tier'
    )

    // Should show either "WITHIN LIMIT" or "EXCEEDED"
    assert.ok(
      output.includes('WITHIN LIMIT') || output.includes('EXCEEDED'),
      'Should show free tier status'
    )

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 6: Workflow breakdown
;(() => {
  console.log('Test 6: Show workflow breakdown')
  const testDir = createTestRepo()

  try {
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
      }
    )

    // Should show workflow details
    assert.ok(output.includes('Workflow breakdown'))
    assert.ok(output.includes('min/run'))
    assert.ok(output.includes('runs/month'))

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 7: Missing caching detection
;(() => {
  console.log('Test 7: Detect missing dependency caching')
  const testDir = createTestRepo(DEFAULT_WORKFLOW)

  try {
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --analyze-ci`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: sanitizedGitEnvironment({ QAA_DEVELOPER: 'true' }),
      }
    )

    // Should detect missing cache and recommend it
    if (output.includes('Optimization Recommendations')) {
      assert.ok(
        output.includes('cach') || output.includes('Cach'),
        'Should recommend caching'
      )
    }

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

console.log('✅ All --analyze-ci integration tests passed!\n')
