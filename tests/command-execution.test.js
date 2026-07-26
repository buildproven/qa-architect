'use strict'

/**
 * CRITICAL TEST: Verify that generated commands ACTUALLY WORK
 *
 * This test suite creates isolated test projects, runs setup.js,
 * and then executes the generated commands to ensure they work.
 *
 * This would have caught the ESLint --ext bug immediately.
 */

const { execSync } = require('child_process')
const { sanitizedGitEnvironment } = require('./git-fixture-helpers')
const fs = require('fs')
const path = require('path')
const os = require('os')

const setupScript = path.join(__dirname, '..', 'setup.js')

function setupTestProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cmd-test-${name}-`))

  try {
    // Initialize git (required by setup.js)
    execSync('git init', {
      cwd: dir,
      stdio: 'ignore',
      env: sanitizedGitEnvironment(),
    })

    // Create minimal package.json
    const packageJson = {
      name: `test-${name}`,
      version: '1.0.0',
      scripts: {},
    }

    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Run setup
    execSync(`node "${setupScript}"`, {
      cwd: dir,
      stdio: 'inherit',
      env: sanitizedGitEnvironment(),
    })

    // Install dependencies
    console.log(`  Installing dependencies in ${name}...`)
    execSync('npm install', { cwd: dir, stdio: 'pipe' })

    return dir
  } catch (error) {
    // Cleanup on failure
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

function runCommand(dir, command, description) {
  try {
    console.log(`    Testing: ${description}`)
    const output = execSync(command, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    console.log(`    ✅ ${description} - PASSED`)
    return { success: true, output }
  } catch (error) {
    console.error(`    ❌ ${description} - FAILED`)
    console.error(`       Command: ${command}`)
    console.error(`       Exit code: ${error.status}`)
    if (error.stderr) {
      console.error(`       Error: ${error.stderr.slice(0, 200)}`)
    }
    throw error
  }
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    console.warn(`Warning: Failed to cleanup ${dir}`)
  }
}

// Test 1: JavaScript project
console.log('\n🧪 Test 1: JavaScript Project - Command Execution')
let jsDir
try {
  jsDir = setupTestProject('js')

  // Create test files
  fs.writeFileSync(
    path.join(jsDir, 'test.js'),
    'const x = 1;\nconsole.log(x);\n'
  )
  fs.writeFileSync(path.join(jsDir, 'style.css'), 'body {\n  color: red;\n}\n')

  // Format files first (generated files may not be formatted)
  runCommand(jsDir, 'npm run format', 'Format files')

  // Test commands
  runCommand(jsDir, 'npm run format:check', 'Prettier check')
  runCommand(jsDir, 'npm run lint', 'ESLint + Stylelint')
  runCommand(jsDir, 'npx eslint test.js', 'Direct ESLint on .js file')
  runCommand(jsDir, 'npx stylelint style.css', 'Direct Stylelint on .css file')

  console.log('  ✅ JavaScript project tests passed\n')
} catch (error) {
  console.error('  ❌ JavaScript project tests failed\n')
  throw error
} finally {
  if (jsDir) cleanup(jsDir)
}

// Test 2: TypeScript project
console.log('🧪 Test 2: TypeScript Project - Command Execution')
let tsDir
try {
  tsDir = setupTestProject('ts')

  // Create TypeScript file
  fs.writeFileSync(
    path.join(tsDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2020' } }, null, 2)
  )
  fs.writeFileSync(
    path.join(tsDir, 'test.ts'),
    'const x: number = 1;\nconsole.log(x);\n'
  )

  // Re-run setup to detect TypeScript
  execSync(`node "${setupScript}"`, {
    cwd: tsDir,
    stdio: 'inherit',
    env: sanitizedGitEnvironment(),
  })
  execSync('npm install', { cwd: tsDir, stdio: 'pipe' })

  // Format files first
  runCommand(tsDir, 'npm run format', 'Format files')

  // Test TypeScript linting
  runCommand(tsDir, 'npm run lint', 'ESLint on TypeScript')
  runCommand(tsDir, 'npx eslint test.ts', 'Direct ESLint on .ts file')

  console.log('  ✅ TypeScript project tests passed\n')
} catch (error) {
  console.error('  ❌ TypeScript project tests failed\n')
  throw error
} finally {
  if (tsDir) cleanup(tsDir)
}

// Test 3: Empty project (should not error)
console.log('🧪 Test 3: Empty Project - Graceful Handling')
let emptyDir
try {
  emptyDir = setupTestProject('empty')

  // Format generated files first
  runCommand(emptyDir, 'npm run format', 'Format generated files')

  // Don't create any files - test empty project behavior
  runCommand(emptyDir, 'npm run lint', 'Lint empty project (should pass)')
  runCommand(emptyDir, 'npm run format:check', 'Format check empty project')

  console.log('  ✅ Empty project tests passed\n')
} catch (error) {
  console.error('  ❌ Empty project tests failed\n')
  throw error
} finally {
  if (emptyDir) cleanup(emptyDir)
}

// Test 4: Project with linting errors
console.log('🧪 Test 4: Project With Errors - Detection Works')
let errorDir
try {
  errorDir = setupTestProject('errors')

  // Create file with intentional linting error
  fs.writeFileSync(
    path.join(errorDir, 'bad.js'),
    'var unused = 1;\n' // unused variable
  )

  // This should fail
  let didFail = false
  try {
    runCommand(errorDir, 'npm run lint', 'Lint with errors (should fail)')
  } catch {
    didFail = true
    console.log('    ✅ Correctly detected linting errors')
  }

  if (!didFail) {
    throw new Error('Linting should have failed but passed!')
  }

  console.log('  ✅ Error detection tests passed\n')
} catch (error) {
  console.error('  ❌ Error detection tests failed\n')
  throw error
} finally {
  if (errorDir) cleanup(errorDir)
}

console.log('✅ All command execution tests passed!')
console.log('\n🎉 SUCCESS: Generated commands work in real projects\n')
