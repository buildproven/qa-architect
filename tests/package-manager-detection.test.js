'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  detectPackageManager,
  getInstallCommand,
  getAuditCommand,
} = require('../lib/package-utils')

console.log('🧪 Testing Package Manager Detection...\n')

// Create temporary test directory
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'))
}

function cleanup(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Test 1: Detect pnpm from lockfile
 */
function testPnpmDetection() {
  const tempDir = createTempDir()
  try {
    // Create pnpm-lock.yaml
    fs.writeFileSync(
      path.join(tempDir, 'pnpm-lock.yaml'),
      'lockfileVersion: 5.4'
    )
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(pm, 'pnpm', 'Should detect pnpm from lockfile')
    console.log('✅ Test 1 passed: Detects pnpm from pnpm-lock.yaml')
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 2: Detect yarn from lockfile
 */
function testYarnDetection() {
  const tempDir = createTempDir()
  try {
    // Create yarn.lock
    fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '# yarn lockfile v1')
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(pm, 'yarn', 'Should detect yarn from lockfile')
    console.log('✅ Test 2 passed: Detects yarn from yarn.lock')
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 3: Detect bun from lockfile
 */
function testBunDetection() {
  const tempDir = createTempDir()
  try {
    // Bun 1.2+ uses the text-based bun.lock format.
    fs.writeFileSync(path.join(tempDir, 'bun.lock'), '')
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(pm, 'bun', 'Should detect bun from lockfile')
    console.log('✅ Test 3 passed: Detects bun from bun.lock')
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 4: Detect npm from lockfile
 */
function testNpmDetection() {
  const tempDir = createTempDir()
  try {
    // Create package-lock.json
    fs.writeFileSync(
      path.join(tempDir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3 })
    )
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(pm, 'npm', 'Should detect npm from lockfile')
    console.log('✅ Test 4 passed: Detects npm from package-lock.json')
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 5: Default to npm when no lockfile
 */
function testDefaultToNpm() {
  const tempDir = createTempDir()
  try {
    // Only package.json, no lockfile
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(pm, 'npm', 'Should default to npm when no lockfile')
    console.log('✅ Test 5 passed: Defaults to npm when no lockfile')
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 6: Detect from package.json packageManager field
 */
function testCorepackDetection() {
  const tempDir = createTempDir()
  try {
    // Corepack format: packageManager field
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@8.6.0' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(
      pm,
      'pnpm',
      'Should detect pnpm from packageManager field'
    )
    console.log(
      '✅ Test 6 passed: Detects from packageManager field (Corepack)'
    )
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 7: Priority order - lockfile over packageManager field
 */
function testPriorityOrder() {
  const tempDir = createTempDir()
  try {
    // Both lockfile and packageManager field - lockfile should win
    fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '# yarn lockfile')
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', packageManager: 'pnpm@8.0.0' })
    )

    const pm = detectPackageManager(tempDir)
    assert.strictEqual(
      pm,
      'yarn',
      'Lockfile should take priority over packageManager field'
    )
    console.log('✅ Test 7 passed: Lockfile takes priority')
  } finally {
    cleanup(tempDir)
  }
}

/**
 * Test 8: Get install command for each package manager
 */
function testGetInstallCommand() {
  const tests = [
    { pm: 'pnpm', frozen: true, expected: 'pnpm install --frozen-lockfile' },
    { pm: 'pnpm', frozen: false, expected: 'pnpm install' },
    { pm: 'yarn', frozen: true, expected: 'yarn install --frozen-lockfile' },
    { pm: 'yarn', frozen: false, expected: 'yarn install' },
    { pm: 'bun', frozen: true, expected: 'bun install --frozen-lockfile' },
    { pm: 'bun', frozen: false, expected: 'bun install' },
    { pm: 'npm', frozen: true, expected: 'npm ci' },
    { pm: 'npm', frozen: false, expected: 'npm install' },
  ]

  tests.forEach(({ pm, frozen, expected }) => {
    const cmd = getInstallCommand(pm, frozen)
    assert.strictEqual(
      cmd,
      expected,
      `getInstallCommand('${pm}', ${frozen}) should return '${expected}'`
    )
  })

  console.log('✅ Test 8 passed: getInstallCommand returns correct commands')
}

/**
 * Test 9: Get audit command for each package manager
 */
function testGetAuditCommand() {
  const tests = [
    { pm: 'pnpm', expected: 'pnpm audit' },
    { pm: 'yarn', expected: 'yarn audit' },
    { pm: 'bun', expected: 'bun audit' },
    { pm: 'npm', expected: 'npm audit' },
  ]

  tests.forEach(({ pm, expected }) => {
    const cmd = getAuditCommand(pm)
    assert.strictEqual(
      cmd,
      expected,
      `getAuditCommand('${pm}') should return '${expected}'`
    )
  })

  console.log('✅ Test 9 passed: getAuditCommand returns correct commands')
}

/**
 * Test 10: Unknown package manager defaults to npm
 */
function testUnknownPackageManager() {
  const installCmd = getInstallCommand('unknown-pm', true)
  const auditCmd = getAuditCommand('unknown-pm')

  assert.strictEqual(
    installCmd,
    'npm install',
    'Unknown PM should default to npm install'
  )
  assert.strictEqual(
    auditCmd,
    'npm audit',
    'Unknown PM should default to npm audit'
  )

  console.log('✅ Test 10 passed: Unknown package manager defaults to npm')
}

// Run all tests
try {
  testPnpmDetection()
  testYarnDetection()
  testBunDetection()
  testNpmDetection()
  testDefaultToNpm()
  testCorepackDetection()
  testPriorityOrder()
  testGetInstallCommand()
  testGetAuditCommand()
  testUnknownPackageManager()

  console.log('\n🎉 All package manager detection tests passed!')
  process.exit(0)
} catch (error) {
  console.error('\n❌ Test failed:', error.message)
  console.error(error.stack)
  process.exit(1)
}
