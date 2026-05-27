/**
 * Security-focused licensing tests
 * Ensures critical security vulnerabilities cannot be exploited
 *
 * Uses temporary directory for isolation (like other licensing tests)
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  createTestKeyPair,
  setTestPublicKeyEnv,
  buildSignedLicenseEntry,
} = require('./license-test-helpers')

// Set up temporary license directory for tests (before requiring licensing.js)
const TEST_LICENSE_DIR = path.join(
  os.tmpdir(),
  `cqa-security-test-${Date.now()}`
)
process.env.QAA_LICENSE_DIR = TEST_LICENSE_DIR

// Disable developer mode for licensing tests
delete process.env.QAA_DEVELOPER

const { publicKey, privateKey } = createTestKeyPair()
setTestPublicKeyEnv(publicKey)

// Now require licensing.js (will use QAA_LICENSE_DIR environment variable)
const {
  getLicenseInfo,
  activateLicense,
  removeLicense,
  verifyLicenseSignature,
} = require('../lib/licensing')

// Mock environment for security testing
const originalEnv = process.env

// Helper to get test license paths
function getTestLicensePaths() {
  const licenseDir = TEST_LICENSE_DIR
  const licenseFile = path.join(licenseDir, 'license.json')
  return { licenseDir, licenseFile }
}

/**
 * Setup and teardown for security tests
 */
function setupSecurityTest() {
  // Clean up any existing license
  removeLicense()

  // Reset environment
  process.env = { ...originalEnv }
  delete process.env.QAA_LICENSE_PUBLIC_KEY
  delete process.env.QAA_DEVELOPER // Must disable dev mode for security tests
  setTestPublicKeyEnv(publicKey)
}

function teardownSecurityTest() {
  // Clean up
  removeLicense()

  // Restore environment
  process.env = originalEnv
}

/**
 * Security Test 1: License validation bypass attempt
 * Verifies that arbitrary license keys cannot be self-activated
 */
async function testLicenseValidationBypass() {
  setupSecurityTest()
  console.log('Security Test 1: License validation bypass prevention')

  // Attempt to activate arbitrary license keys that should fail
  // These should be rejected as they are not in the legitimate license database
  const testKeys = [
    'QAA-1234-5678-9ABC-DEF0',
    'QAA-ABCD-EF12-3456-7890',
    'QAA-FFFF-AAAA-1111-2222',
  ]

  for (const testKey of testKeys) {
    try {
      const result = await activateLicense(testKey, 'test@example.com')

      if (result.success) {
        console.error(
          `  ❌ SECURITY VIOLATION: Key ${testKey} was accepted without proper validation`
        )
        console.error(
          `  This indicates the license validation bypass vulnerability still exists`
        )
        teardownSecurityTest()
        process.exit(1)
      }

      // Verify the error indicates proper rejection
      // Valid rejection messages: "not found", "validation failed", "registry is empty"
      const validRejections = [
        'not found',
        'validation failed',
        'registry is empty',
        'empty',
      ]
      const isValidRejection = validRejections.some(
        msg => result.error && result.error.toLowerCase().includes(msg)
      )

      if (!result.error || !isValidRejection) {
        console.error(
          `  ❌ SECURITY ISSUE: Key ${testKey} rejected but with unexpected error message`
        )
        console.error(`  Expected valid rejection error, got: ${result.error}`)
        teardownSecurityTest()
        process.exit(1)
      }
    } catch (error) {
      console.error(`  ❌ Unexpected error for key ${testKey}:`, error.message)
      teardownSecurityTest()
      process.exit(1)
    }
  }

  console.log('  ✅ All arbitrary license keys properly rejected')
  teardownSecurityTest()
  return true
}

/**
 * Security Test 2: Activation fails without a valid signed registry.
 * Verifies that a well-formatted-but-unissued key is rejected.
 */
async function testActivationFailsWithoutValidRegistry() {
  setupSecurityTest()
  console.log('Security Test 2: Activation fails without valid signed registry')

  // Attempt to activate with a valid-format key that was never issued
  const testKey = 'QAA-1234-ABCD-5678-EF12'

  try {
    const result = await activateLicense(testKey, 'test@example.com')

    if (result.success) {
      console.error(
        '  ❌ SECURITY VIOLATION: License activation succeeded for unissued key'
      )
      teardownSecurityTest()
      process.exit(1)
    }

    // Verify the error indicates proper rejection (should be "not found" since arbitrary key is not in legitimate database)
    // Valid rejection messages: "not found", "validation failed", "registry is empty"
    const validRejections = [
      'not found',
      'validation failed',
      'registry is empty',
      'empty',
    ]
    const isValidRejection = validRejections.some(
      msg => result.error && result.error.toLowerCase().includes(msg)
    )

    if (!result.error || !isValidRejection) {
      console.error('  ❌ SECURITY ISSUE: Wrong error message for unissued key')
      console.error(`  Expected valid rejection error, got: ${result.error}`)
      teardownSecurityTest()
      process.exit(1)
    }

    console.log(
      '  ✅ Activation properly blocked for keys not in the signed registry'
    )
  } catch (error) {
    console.error('  ❌ Unexpected error:', error.message)
    teardownSecurityTest()
    process.exit(1)
  }

  teardownSecurityTest()
  return true
}

/**
 * Security Test 3: License signature validation
 * Verifies that license signature validation works correctly
 */
function testLicenseSignatureValidation() {
  setupSecurityTest()
  console.log('Security Test 3: License signature validation')

  // Build a signed entry (includes payload + signature)
  const issued = new Date().toISOString()
  const signedEntry = buildSignedLicenseEntry({
    licenseKey: 'QAA-AAAA-BBBB-CCCC-DDDD',
    tier: 'PRO',
    isFounder: false,
    email: 'test@example.com',
    issued,
    privateKey,
  })

  // Test valid signature with correct payload
  if (!verifyLicenseSignature(signedEntry.payload, signedEntry.signature)) {
    console.error('  ❌ Valid signature not verified correctly')
    teardownSecurityTest()
    process.exit(1)
  }

  // Test invalid signature
  const invalidSignature = 'invalid_signature_should_fail'
  if (verifyLicenseSignature(signedEntry.payload, invalidSignature)) {
    console.error('  ❌ SECURITY VIOLATION: Invalid signature was accepted')
    teardownSecurityTest()
    process.exit(1)
  }

  // Test tampered payload (change tier)
  const tamperedPayload = { ...signedEntry.payload, tier: 'FREE' }
  if (verifyLicenseSignature(tamperedPayload, signedEntry.signature)) {
    console.error(
      '  ❌ SECURITY VIOLATION: Tampered payload with valid signature was accepted'
    )
    teardownSecurityTest()
    process.exit(1)
  }

  console.log('  ✅ License signature validation working correctly')
  teardownSecurityTest()
  return true
}

/**
 * Security Test 4: Local license file tampering detection
 * Verifies that tampered local license files are detected
 */
function testLocalLicenseFileTamperingDetection() {
  setupSecurityTest()
  console.log('Security Test 4: Local license file tampering detection')

  const { licenseDir, licenseFile } = getTestLicensePaths()

  // Create license directory
  if (!fs.existsSync(licenseDir)) {
    fs.mkdirSync(licenseDir, { recursive: true })
  }

  const licenseKey = 'QAA-1234-ABCD-5678-EF12'
  const issued = new Date().toISOString()
  const entry = buildSignedLicenseEntry({
    licenseKey,
    tier: 'PRO',
    isFounder: false,
    email: 'test@example.com',
    issued,
    privateKey,
  })

  // Test 1: Valid license file
  const validLicenseData = {
    tier: 'PRO',
    licenseKey,
    email: 'test@example.com',
    activated: new Date().toISOString(),
    payload: entry.payload,
    signature: entry.signature,
  }

  fs.writeFileSync(licenseFile, JSON.stringify(validLicenseData, null, 2))

  let license = getLicenseInfo()
  if (license.tier !== 'PRO' || license.error) {
    console.error('  ❌ Valid license file not processed correctly')
    console.error('  Got tier:', license.tier, 'error:', license.error)
    console.error('  Expected tier: PRO with no error')
    teardownSecurityTest()
    process.exit(1)
  }

  // Test 2: Tampered payload in license file (signature should detect this)
  const tamperedPayload = {
    ...entry.payload,
    tier: 'FREE',
  }

  const tamperedLicenseData = {
    ...validLicenseData,
    tier: 'FREE', // Changed top-level tier
    payload: tamperedPayload, // Changed payload tier - signature should be invalid
  }

  fs.writeFileSync(licenseFile, JSON.stringify(tamperedLicenseData, null, 2))

  license = getLicenseInfo()
  if (
    license.tier !== 'FREE' ||
    !license.error ||
    !license.error.includes('signature verification failed')
  ) {
    console.error('  ❌ SECURITY VIOLATION: Tampered license file not detected')
    console.error('  Expected tier: FREE with signature error')
    console.error('  Got tier:', license.tier, 'error:', license.error)
    teardownSecurityTest()
    process.exit(1)
  }

  // Test 3: Invalid signature
  const invalidSignatureLicenseData = {
    ...validLicenseData,
    signature: 'invalid_signature',
  }

  fs.writeFileSync(
    licenseFile,
    JSON.stringify(invalidSignatureLicenseData, null, 2)
  )

  license = getLicenseInfo()
  if (
    license.tier !== 'FREE' ||
    !license.error ||
    !license.error.includes('signature verification failed')
  ) {
    console.error('  ❌ SECURITY VIOLATION: Invalid signature not detected')
    teardownSecurityTest()
    process.exit(1)
  }

  console.log('  ✅ Local license file tampering properly detected')
  teardownSecurityTest()
  return true
}

/**
 * Security Test 5: Environment variable security
 * Verifies that the system handles missing or invalid environment variables securely
 */
function testEnvironmentVariableSecurity() {
  setupSecurityTest()
  console.log('Security Test 5: Environment variable security')

  // Test with missing public key
  delete process.env.QAA_LICENSE_PUBLIC_KEY

  const testPayload = { test: 'payload' }
  const testSignature = 'test_signature'

  // Should still verify correctly with default secret
  try {
    const result = verifyLicenseSignature(testPayload, testSignature)
    // This should not crash but return false for invalid signature
    if (result === true) {
      console.error(
        '  ❌ SECURITY ISSUE: Signature verification passed with invalid signature'
      )
      teardownSecurityTest()
      process.exit(1)
    }
  } catch (error) {
    console.error(
      '  ❌ Signature verification crashed with missing env var:',
      error.message
    )
    teardownSecurityTest()
    process.exit(1)
  }

  console.log('  ✅ Environment variable security handled correctly')
  teardownSecurityTest()
  return true
}

/**
 * Run all security tests
 */
async function runSecurityTests() {
  console.log('============================================================')
  console.log('Running Security-Focused Licensing Tests')
  console.log('============================================================\n')

  try {
    await testLicenseValidationBypass()
    await testActivationFailsWithoutValidRegistry()
    testLicenseSignatureValidation()
    testLocalLicenseFileTamperingDetection()
    testEnvironmentVariableSecurity()

    console.log('============================================================')
    console.log('✅ All Security Tests Passed!')
    console.log(
      '============================================================\n'
    )
    console.log('Security coverage:')
    console.log('  • License validation bypass prevention - ✅')
    console.log('  • Activation requires signed registry entry - ✅')
    console.log('  • Signature validation security - ✅')
    console.log('  • Local file tampering detection - ✅')
    console.log('  • Environment variable security - ✅')
    console.log('')

    // Cleanup temporary test directory
    if (fs.existsSync(TEST_LICENSE_DIR)) {
      fs.rmSync(TEST_LICENSE_DIR, { recursive: true, force: true })
      console.log(`🧹 Cleaned up temporary directory: ${TEST_LICENSE_DIR}\n`)
    }
  } catch (error) {
    // Cleanup temporary test directory on error
    if (fs.existsSync(TEST_LICENSE_DIR)) {
      fs.rmSync(TEST_LICENSE_DIR, { recursive: true, force: true })
    }
    console.error('❌ Security test failed:', error.message)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  runSecurityTests()
}

module.exports = {
  runSecurityTests,
  testLicenseValidationBypass,
  testActivationFailsWithoutValidRegistry,
  testLicenseSignatureValidation,
  testLocalLicenseFileTamperingDetection,
  testEnvironmentVariableSecurity,
}
