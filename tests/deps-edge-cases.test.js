#!/usr/bin/env node

/**
 * Edge case tests for deps.js command
 * Focus on uncovered code paths
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

console.log('🧪 Testing deps.js edge cases...\n')

const originalCwd = process.cwd()

// Use temp license directory to avoid global developer marker file
const TEST_LICENSE_DIR = path.join(os.tmpdir(), `cqa-deps-test-${Date.now()}`)
fs.mkdirSync(TEST_LICENSE_DIR, { recursive: true })

function createTestDir(name) {
  const testDir = path.join(os.tmpdir(), `cqa-test-${name}-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  // Init git repo (safe: hardcoded command, no user input)
  execSync('git init', { cwd: testDir, stdio: 'ignore' })
  execSync('git config user.email "test@example.com"', {
    cwd: testDir,
    stdio: 'ignore',
  })
  execSync('git config user.name "Test User"', {
    cwd: testDir,
    stdio: 'ignore',
  })

  return testDir
}

// Test 1: Premium tier (Pro) with npm project
;(() => {
  console.log('Test 1: Premium tier with npm project')
  const testDir = createTestDir('premium-npm')

  try {
    // Create package.json with React packages
    const packageJson = {
      name: 'test-premium',
      version: '1.0.0',
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        '@tanstack/react-query': '^5.0.0',
      },
    }
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Create a fake license file to simulate Pro tier
    const licenseDir = path.join(testDir, '.cqa-license')
    fs.mkdirSync(licenseDir, { recursive: true })
    fs.writeFileSync(
      path.join(licenseDir, 'license.json'),
      JSON.stringify(
        {
          tier: 'PRO',
          key: 'test-key',
          email: 'test@example.com',
          expiresAt: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
        null,
        2
      )
    )

    // Run --deps command (safe: hardcoded command with controlled env vars)
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --deps`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: { ...process.env, QAA_LICENSE_DIR: licenseDir },
      }
    )

    // Should use premium tier
    assert.ok(
      output.includes('Premium') || output.includes('premium'),
      'Should indicate premium tier'
    )

    // Should create dependabot.yml
    const dependabotPath = path.join(testDir, '.github', 'dependabot.yml')
    assert.ok(fs.existsSync(dependabotPath), 'Should create dependabot.yml')

    const dependabotContent = fs.readFileSync(dependabotPath, 'utf8')
    assert.ok(
      dependabotContent.includes('groups') ||
        dependabotContent.includes('group'),
      'Premium tier should include groups'
    )

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 2: Multi-ecosystem detection (npm + Python + Rust + Ruby)
;(() => {
  console.log('Test 2: Multi-ecosystem detection')
  const testDir = createTestDir('multi-eco')

  try {
    // Create all ecosystem files
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    )
    fs.writeFileSync(path.join(testDir, 'requirements.txt'), 'django==4.2.0')
    fs.writeFileSync(
      path.join(testDir, 'Cargo.toml'),
      '[package]\nname = "test"\nversion = "0.1.0"'
    )
    fs.writeFileSync(
      path.join(testDir, 'Gemfile'),
      'source "https://rubygems.org"'
    )

    // Run --deps command (should work with npm in free tier)
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --deps`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: { ...process.env, QAA_DEVELOPER: 'true' },
      }
    )

    // Should detect all ecosystems
    assert.ok(output.includes('npm'), 'Should detect npm')
    assert.ok(output.includes('Python'), 'Should detect Python')
    assert.ok(output.includes('Rust'), 'Should detect Rust')
    assert.ok(output.includes('Ruby'), 'Should detect Ruby')

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 3: Ruby-only project detection
;(() => {
  console.log('Test 3: Ruby-only project detection')
  const testDir = createTestDir('ruby-only')

  try {
    fs.writeFileSync(
      path.join(testDir, 'Gemfile'),
      `
source "https://rubygems.org"
gem "rails", "~> 7.0.0"
gem "pg", "~> 1.5"
`
    )

    // Should fail for free tier (Ruby requires Pro)
    try {
      execSync(`node "${path.join(originalCwd, 'setup.js')}" --deps`, {
        cwd: testDir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          QAA_DEVELOPER: 'false',
          QAA_LICENSE_DIR: TEST_LICENSE_DIR,
        },
      })
      assert.fail('Should have failed for Ruby-only in free tier')
    } catch (error) {
      const output = error.stderr
        ? error.stderr.toString()
        : error.stdout
          ? error.stdout.toString()
          : error.message || ''
      assert.ok(output.includes('Pro license'), 'Should require Pro tier')
    }

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 4: No supported files
;(() => {
  console.log('Test 4: No supported dependency files')
  const testDir = createTestDir('no-deps')

  try {
    // Just a git repo, no dependency files
    try {
      execSync(`node "${path.join(originalCwd, 'setup.js')}" --deps`, {
        cwd: testDir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, QAA_DEVELOPER: 'true' },
      })
      assert.fail('Should have failed with no dependency files')
    } catch (error) {
      const output = error.stderr
        ? error.stderr.toString()
        : error.stdout.toString()
      assert.ok(
        output.includes('No supported dependency file found'),
        'Should show error for missing files'
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

// Test 5: GitHub API error handling paths
;(() => {
  console.log('Test 5: GitHub API error handling')
  const testDir = createTestDir('github-api-error')

  try {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    )

    // Run without GitHub token (will trigger error handling)
    const output = execSync(
      `node "${path.join(originalCwd, 'setup.js')}" --deps`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          QAA_DEVELOPER: 'true',
          GITHUB_TOKEN: '', // No token
        },
      }
    )

    // Should handle GitHub API error gracefully
    assert.ok(
      output.includes('Could not auto-enable Dependabot') ||
        output.includes('Manual steps needed'),
      'Should show manual setup instructions'
    )

    console.log('✅ PASS\n')
  } catch (error) {
    console.error('❌ FAIL:', error.message)
    throw error
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 6: Test helper functions directly
;(() => {
  console.log('Test 6: detectPythonProject helper')
  const {
    detectPythonProject,
    detectRustProject,
    detectRubyProject,
  } = require('../lib/commands/deps')

  const testDir = createTestDir('helpers')

  try {
    // Test Python detection
    fs.writeFileSync(path.join(testDir, 'pyproject.toml'), '[project]')
    assert.ok(detectPythonProject(testDir), 'Should detect pyproject.toml')

    fs.rmSync(path.join(testDir, 'pyproject.toml'))
    fs.writeFileSync(path.join(testDir, 'requirements.txt'), 'django==4.2.0')
    assert.ok(detectPythonProject(testDir), 'Should detect requirements.txt')

    fs.rmSync(path.join(testDir, 'requirements.txt'))
    fs.writeFileSync(
      path.join(testDir, 'setup.py'),
      'from setuptools import setup'
    )
    assert.ok(detectPythonProject(testDir), 'Should detect setup.py')

    fs.rmSync(path.join(testDir, 'setup.py'))
    fs.writeFileSync(path.join(testDir, 'Pipfile'), '[[source]]')
    assert.ok(detectPythonProject(testDir), 'Should detect Pipfile')

    // Test Rust detection
    fs.writeFileSync(path.join(testDir, 'Cargo.toml'), '[package]')
    assert.ok(detectRustProject(testDir), 'Should detect Cargo.toml')

    // Test Ruby detection
    fs.writeFileSync(path.join(testDir, 'Gemfile'), 'source')
    assert.ok(detectRubyProject(testDir), 'Should detect Gemfile')

    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

console.log('✅ All deps.js edge case tests passed!\n')
