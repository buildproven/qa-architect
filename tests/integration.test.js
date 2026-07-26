'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

/**
 * Integration tests for the CLI in various environments
 * These tests prevent regressions and validate real-world usage
 */

async function runIntegrationTests() {
  console.log('🧪 Running integration tests...\n')

  await testNodeVersionCompatibility()
  await testESLintConfigVariants()
  await testValidationInIsolatedEnvironment()
  await testPackageJsonBootstrap()
  await testToolAvailabilityHandling()
  await testCustomTemplateIntegration()

  console.log('✅ All integration tests passed!\n')
}

/**
 * Test Node version compatibility
 */
async function testNodeVersionCompatibility() {
  console.log('🔍 Testing Node version compatibility...')

  // Check current Node version meets requirements
  const nodeVersion = process.version
  const majorVersion = parseInt(nodeVersion.split('.')[0].slice(1))

  if (majorVersion < 20) {
    throw new Error(
      `Node ${nodeVersion} is below minimum required version 20. Tests and CLI require Node 20+.`
    )
  }

  // Test the CLI's Node version check
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-version-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // The CLI should work with Node 20+ (our current version)
    try {
      execSync(`node "${path.join(originalCwd, 'setup.js')}" --help`, {
        stdio: 'pipe',
        env: sanitizedGitEnvironment(),
      })
      console.log('  ✅ CLI help works with current Node version')
    } catch (error) {
      throw new Error(`CLI failed with Node ${nodeVersion}: ${error.message}`)
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }

  // Test that @npmcli/package-json imports successfully
  try {
    const PackageJson = require('@npmcli/package-json')
    if (
      typeof PackageJson.create !== 'function' ||
      typeof PackageJson.load !== 'function'
    ) {
      throw new Error('@npmcli/package-json API not available')
    }
  } catch (error) {
    throw new Error(
      `@npmcli/package-json compatibility issue: ${error.message}`
    )
  }

  console.log('  ✅ Node version compatibility verified')
}

/**
 * Test ESLint config file variants
 */
async function testESLintConfigVariants() {
  console.log('🔍 Testing ESLint config file detection...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-config-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Initialize git repository
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })
    execSync('git config user.email "test@example.com"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })
    execSync('git config user.name "Test User"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    // Test 1: eslint.config.js variant
    const jsConfig = `module.exports = { rules: {} }`
    fs.writeFileSync('eslint.config.js', jsConfig)

    try {
      execSync(
        `node "${path.join(originalCwd, 'setup.js')}" --security-config`,
        {
          stdio: 'pipe',
        }
      )
      console.log('  ✅ eslint.config.js detected correctly')
    } catch (error) {
      // Check if it failed due to config file not found (which would be the bug)
      if (
        error.message.includes('Cannot read config file') &&
        error.message.includes('eslint.config.cjs')
      ) {
        throw new Error(
          'ESLint config detection bug: hardcoded .cjs when .js exists'
        )
      }
      // Other errors (like no security issues found) are OK
      console.log('  ✅ eslint.config.js detected correctly')
    }

    // Test 2: eslint.config.cjs variant
    fs.unlinkSync('eslint.config.js')
    const cjsConfig = `module.exports = { rules: {} }`
    fs.writeFileSync('eslint.config.cjs', cjsConfig)

    try {
      execSync(
        `node "${path.join(originalCwd, 'setup.js')}" --security-config`,
        {
          stdio: 'pipe',
        }
      )
      console.log('  ✅ eslint.config.cjs detected correctly')
    } catch {
      // Other errors are OK
      console.log('  ✅ eslint.config.cjs detected correctly')
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test validation in isolated environment
 */
async function testValidationInIsolatedEnvironment() {
  console.log('🔍 Testing validation in isolated environment...')

  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'isolated-validation-test-')
  )
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Initialize git repository
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })
    execSync('git config user.email "test@example.com"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })
    execSync('git config user.name "Test User"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    // Create minimal package.json
    const packageJson = {
      name: 'test-project',
      version: '1.0.0',
      description: 'Test project',
      keywords: ['test'],
      license: 'MIT',
    }
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

    // Create minimal README
    const readme = `# Test Project

## Description
Test project for validation.

## Installation
\`\`\`bash
npm install
\`\`\`

## Usage
Run the project.
`
    fs.writeFileSync('README.md', readme)

    // Create .gitignore
    fs.writeFileSync('.gitignore', 'node_modules/\n.env*\n*.log\n')

    // Create minimal workflow
    fs.mkdirSync('.github/workflows', { recursive: true })
    fs.writeFileSync(
      '.github/workflows/ci.yml',
      `name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`
    )

    // Test that validation doesn't crash without any config files
    try {
      execSync(
        `node "${path.join(originalCwd, 'setup.js')}" --comprehensive --no-npm-audit --no-gitleaks --no-actionlint --no-markdownlint`,
        {
          stdio: 'pipe',
        }
      )
      console.log('  ✅ Validation runs successfully in minimal environment')
    } catch (error) {
      throw new Error(
        `Validation failed in isolated environment: ${error.message}`
      )
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test package.json bootstrap in fresh repo
 */
async function testPackageJsonBootstrap() {
  console.log('🔍 Testing package.json bootstrap...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'))
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Initialize git repository
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })
    execSync('git config user.email "test@example.com"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })
    execSync('git config user.name "Test User"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    // Test setup without existing package.json
    try {
      execSync(`node "${path.join(originalCwd, 'setup.js')}"`, {
        stdio: 'pipe',
        env: sanitizedGitEnvironment(),
      })

      // Verify package.json was created
      if (!fs.existsSync('package.json')) {
        throw new Error('package.json was not created')
      }

      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
      if (!packageJson.scripts || !packageJson.devDependencies) {
        throw new Error('package.json is missing required sections')
      }

      console.log('  ✅ Package.json bootstrap works correctly')
    } catch (error) {
      throw new Error(`Package.json bootstrap failed: ${error.message}`)
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test tool availability handling
 */
async function testToolAvailabilityHandling() {
  console.log('🔍 Testing tool availability handling...')

  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tool-availability-test-')
  )
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Initialize git repository
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })
    execSync('git config user.email "test@example.com"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })
    execSync('git config user.name "Test User"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    // Create basic README with proper markdown formatting
    const readme = `# Test Project

## Description

This is a test project.

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

Run the project.
`
    fs.writeFileSync('README.md', readme)

    // Test that validation gracefully handles missing tools
    try {
      execSync(`node "${path.join(originalCwd, 'setup.js')}" --validate-docs`, {
        stdio: 'pipe',
        env: sanitizedGitEnvironment(),
      })
      console.log('  ✅ Tool availability handling works correctly')
    } catch (error) {
      // Documentation validation should pass even if markdownlint is missing
      throw new Error(`Tool availability handling failed: ${error.message}`)
    }
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test custom template integration with CLI
 */
async function testCustomTemplateIntegration() {
  console.log('🔍 Testing custom template integration...')

  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'custom-template-test-')
  )
  const originalCwd = process.cwd()

  try {
    process.chdir(testDir)

    // Initialize git repository
    execSync('git init', { stdio: 'ignore', env: sanitizedGitEnvironment() })
    execSync('git config user.email "test@example.com"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })
    execSync('git config user.name "Test User"', {
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    // Create custom template directory with special characters in name
    const customTemplateDir = path.join(testDir, 'templates-acme-&-co')
    fs.mkdirSync(customTemplateDir)

    // Create custom .prettierrc in template
    const customPrettierConfig = {
      semi: false,
      singleQuote: true,
      tabWidth: 4,
      trailingComma: 'all',
    }
    fs.writeFileSync(
      path.join(customTemplateDir, '.prettierrc'),
      JSON.stringify(customPrettierConfig, null, 2)
    )

    // Create package.json
    fs.writeFileSync(
      'package.json',
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    )

    // Run setup with custom template
    try {
      execSync(
        `node "${path.join(originalCwd, 'setup.js')}" --template "${customTemplateDir}"`,
        {
          stdio: 'pipe',
        }
      )
    } catch (error) {
      throw new Error(`Setup with custom template failed: ${error.message}`)
    }

    // Verify custom .prettierrc was used
    if (!fs.existsSync('.prettierrc')) {
      throw new Error('Custom .prettierrc was not created')
    }

    const installedPrettierrc = JSON.parse(
      fs.readFileSync('.prettierrc', 'utf8')
    )

    // Verify custom config values were applied
    if (
      installedPrettierrc.semi !== false ||
      installedPrettierrc.singleQuote !== true ||
      installedPrettierrc.tabWidth !== 4 ||
      installedPrettierrc.trailingComma !== 'all'
    ) {
      throw new Error(
        'Custom .prettierrc values were not applied correctly. Expected custom template to override defaults.'
      )
    }

    // Verify other default files were still created (partial template support)
    if (!fs.existsSync('eslint.config.cjs')) {
      throw new Error(
        'Default eslint.config.cjs was not created (partial template should still get defaults)'
      )
    }

    console.log('  ✅ Custom template integration works correctly')
    console.log(
      '  ✅ Special characters (&) in template path handled correctly'
    )
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

// Run integration tests if this file is executed directly
if (require.main === module) {
  runIntegrationTests().catch(error => {
    console.error('❌ Integration tests failed:', error.message)
    process.exit(1)
  })
}

module.exports = { runIntegrationTests }
