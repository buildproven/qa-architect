'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

/**
 * Integration tests for Python project setup
 */
async function testPythonIntegration() {
  console.log('🧪 Testing Python project integration...\n')

  const setupPath = path.join(__dirname, '..', 'setup.js')

  // Test 1: Pure Python project detection
  console.log('🔍 Testing pure Python project detection...')
  const pythonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-test-'))

  try {
    // Create 5+ meaningful Python files to trigger detection
    const pyFiles = ['main.py', 'app.py', 'utils.py', 'models.py', 'routes.py']
    for (const f of pyFiles) {
      fs.writeFileSync(path.join(pythonDir, f), `print("${f}")`)
    }

    fs.writeFileSync(
      path.join(pythonDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    )

    // Initialize git
    execSync('git init', { cwd: pythonDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: pythonDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: pythonDir,
      stdio: 'ignore',
    })

    // Run setup
    execSync(`node "${setupPath}"`, { cwd: pythonDir, stdio: 'pipe' })

    // Verify Python files were created
    const expectedPythonFiles = [
      'pyproject.toml',
      '.pre-commit-config.yaml',
      'requirements-dev.txt',
    ]

    for (const file of expectedPythonFiles) {
      const filePath = path.join(pythonDir, file)

      if (!fs.existsSync(filePath)) {
        throw new Error(`Expected Python file not created: ${file}`)
      }
    }

    console.log('  ✅ Pure Python project detection works')
  } finally {
    fs.rmSync(pythonDir, { recursive: true, force: true })
  }

  // Test 2: Mixed JS+Python project
  console.log('🔍 Testing mixed JS+Python project...')
  const mixedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mixed-test-'))

  try {
    // Create both JS and Python files

    fs.writeFileSync(path.join(mixedDir, 'index.js'), 'console.log("JS")')

    fs.writeFileSync(path.join(mixedDir, 'script.py'), 'print("Python")')

    fs.writeFileSync(
      path.join(mixedDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    )
    // Add Python config file to ensure detection (after sensitivity fix)

    fs.writeFileSync(
      path.join(mixedDir, 'requirements.txt'),
      'requests==2.31.0'
    )

    execSync('git init', { cwd: mixedDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: mixedDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: mixedDir,
      stdio: 'ignore',
    })

    execSync(`node "${setupPath}"`, { cwd: mixedDir, stdio: 'pipe' })

    // Verify both JS and Python files created
    const expectedFiles = [
      '.prettierrc',
      'eslint.config.cjs',
      'pyproject.toml',
      '.pre-commit-config.yaml',
    ]

    for (const file of expectedFiles) {
      const filePath = path.join(mixedDir, file)

      if (!fs.existsSync(filePath)) {
        throw new Error(`Expected mixed project file not created: ${file}`)
      }
    }

    console.log('  ✅ Mixed JS+Python project detection works')
  } finally {
    fs.rmSync(mixedDir, { recursive: true, force: true })
  }

  // Test 3: Verify Python tool configuration
  console.log('🔍 Testing Python configuration content...')
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'py-config-test-'))

  try {
    // Create 5+ meaningful Python files to trigger detection
    const cfgPyFiles = [
      'app.py',
      'utils.py',
      'models.py',
      'views.py',
      'routes.py',
    ]
    for (const f of cfgPyFiles) {
      fs.writeFileSync(path.join(configDir, f), 'def main(): pass')
    }

    fs.writeFileSync(
      path.join(configDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2)
    )

    execSync('git init', { cwd: configDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: configDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: configDir,
      stdio: 'ignore',
    })

    execSync(`node "${setupPath}"`, { cwd: configDir, stdio: 'pipe' })

    // Check pyproject.toml contains expected tools

    const pyprojectContent = fs.readFileSync(
      path.join(configDir, 'pyproject.toml'),
      'utf8'
    )
    const expectedTools = ['black', 'ruff', 'mypy', 'isort']

    for (const tool of expectedTools) {
      if (!pyprojectContent.includes(tool)) {
        throw new Error(`pyproject.toml missing ${tool} configuration`)
      }
    }

    // Check .pre-commit-config.yaml contains hooks

    const preCommitContent = fs.readFileSync(
      path.join(configDir, '.pre-commit-config.yaml'),
      'utf8'
    )
    const expectedHooks = ['black', 'ruff', 'mypy']

    for (const hook of expectedHooks) {
      if (!preCommitContent.includes(hook)) {
        throw new Error(`.pre-commit-config.yaml missing ${hook} hook`)
      }
    }

    console.log('  ✅ Python configuration content is correct')
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true })
  }

  console.log('\n✅ All Python integration tests passed!\n')
}

// Run tests if this file is executed directly
if (require.main === module) {
  testPythonIntegration().catch(error => {
    console.error('❌ Python integration tests failed:', error.message)
    process.exit(1)
  })
}

module.exports = { testPythonIntegration }
