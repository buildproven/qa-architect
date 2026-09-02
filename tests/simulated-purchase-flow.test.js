#!/usr/bin/env node

// @ts-nocheck
/**
 * Test a simulated purchase-to-activation flow with generated keys and a
 * localhost registry. This is not payment-provider or production evidence.
 *
 * Verifies:
 * 1. Webhook handler can populate license database
 * 2. Database can be served via HTTP endpoint
 * 3. CLI can fetch and validate against the localhost fixture database
 * 4. Generated fixture licenses work end-to-end
 * 5. Offline fallback works for existing activated licenses
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const {
  createTestKeyPair,
  setTestPublicKeyEnv,
  buildSignedLicenseEntry,
  buildSignedRegistry,
} = require('./license-test-helpers')

// Use temp license directory to avoid writing to real home during tests
const TEST_LICENSE_DIR = path.join(
  os.tmpdir(),
  `cqa-license-test-${Date.now()}`
)
process.env.QAA_LICENSE_DIR = TEST_LICENSE_DIR

const { publicKey, privateKey } = createTestKeyPair()
setTestPublicKeyEnv(publicKey)

// Disable developer mode for purchase flow tests
delete process.env.QAA_DEVELOPER

const { LicenseValidator } = require('../lib/license-validator')
const { addLegitimateKey, activateLicense } = require('../lib/licensing')

function getTestPaths() {
  const licenseDir = TEST_LICENSE_DIR
  const licenseFile = path.join(licenseDir, 'license.json')
  const legitimateDB = path.join(licenseDir, 'legitimate-licenses.json')

  return { licenseDir, licenseFile, legitimateDB }
}

function cleanup() {
  const { licenseDir, licenseFile, legitimateDB } = getTestPaths()
  if (fs.existsSync(licenseFile)) fs.unlinkSync(licenseFile)
  if (fs.existsSync(legitimateDB)) fs.unlinkSync(legitimateDB)
  if (fs.existsSync(licenseDir))
    fs.rmSync(licenseDir, { recursive: true, force: true })
}

// Mock HTTP server to simulate the webhook handler API
function createMockServer(database) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/legitimate-licenses.json' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify(database))
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      }
    })

    server.listen(0, 'localhost', () => {
      const port = server.address().port
      resolve({ server, port, url: `http://localhost:${port}` })
    })
  })
}

console.log('🧪 Testing Simulated Purchase Flow (Localhost Registry)...\\n')

/**
 * Test 1: Simulate webhook output in a signed registry
 */
async function testWebhookLicensePopulation() {
  cleanup()
  console.log('Test 1: Fixture creates signed webhook output')

  try {
    // Simulate a legitimate license database as webhook would create
    const proEntry = buildSignedLicenseEntry({
      licenseKey: 'QAA-1234-5678-ABCD-EF90',
      tier: 'PRO',
      isFounder: true,
      email: 'customer@example.com',
      privateKey,
    })
    const mockDatabase = buildSignedRegistry(
      {
        [proEntry.licenseKey]: {
          tier: proEntry.tier,
          isFounder: proEntry.isFounder,
          issued: proEntry.issued,
          emailHash: proEntry.emailHash,
          signature: proEntry.signature,
          keyId: 'test-key',
        },
      },
      privateKey
    )

    console.log('  ✅ Webhook database created with 1 legitimate license')
    return { mockDatabase }
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`)
    return { mockDatabase: null }
  }
}

/**
 * Test 2: CLI fetches a simulated registry and validates activation
 */
async function testNetworkLicenseValidation() {
  console.log('Test 2: CLI validates against network database')

  try {
    const { mockDatabase } = await testWebhookLicensePopulation()
    if (!mockDatabase) throw new Error('Mock database creation failed')

    // Start mock server
    const { server, port, url } = await createMockServer(mockDatabase)
    console.log(`  🌐 Mock server running at ${url}`)

    try {
      // Override license DB URL via environment variable (cleaner than mocking fetch)
      const originalUrl = process.env.QAA_LICENSE_DB_URL
      process.env.QAA_LICENSE_DB_URL = `http://localhost:${port}/legitimate-licenses.json`
      process.env.QAA_ALLOW_INSECURE_LICENSE_DB = '1'

      // Test license activation with network fetch
      const validator = new LicenseValidator()
      const result = await validator.activateLicense(
        'QAA-1234-5678-ABCD-EF90',
        'customer@example.com'
      )

      if (result.success && result.tier === 'PRO' && result.isFounder) {
        console.log(
          '  ✅ License fetched from network and activated successfully'
        )
        console.log(`  ✅ Tier: ${result.tier}, Founder: ${result.isFounder}`)

        // Verify local storage was updated
        const localLicense = validator.getLocalLicense()
        if (localLicense && localLicense.valid) {
          console.log('  ✅ License stored locally for offline use')
        }

        // Restore original URL
        if (originalUrl) {
          process.env.QAA_LICENSE_DB_URL = originalUrl
        } else {
          delete process.env.QAA_LICENSE_DB_URL
        }
        delete process.env.QAA_ALLOW_INSECURE_LICENSE_DB
        server.close()
        return true
      } else {
        throw new Error(`Activation failed: ${JSON.stringify(result)}`)
      }
    } catch (error) {
      delete process.env.QAA_ALLOW_INSECURE_LICENSE_DB
      server.close()
      throw error
    }
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`)
    return false
  }
}

/**
 * Test 3: Offline validation works for already activated licenses
 */
async function testOfflineLicenseValidation() {
  console.log('Test 3: Offline validation works after network activation')

  try {
    // License should be stored locally from previous test
    const validator = new LicenseValidator()
    const localLicense = validator.getLocalLicense()

    if (!localLicense || !localLicense.valid) {
      throw new Error('No valid local license found from previous activation')
    }

    // Test validation without network (simulate offline)
    const validation = await validator.validateLicense(
      localLicense.licenseKey,
      localLicense.email
    )

    if (validation.valid && validation.source === 'local_file') {
      console.log('  ✅ Offline validation successful')
      console.log(`  ✅ Source: ${validation.source}`)
      return true
    } else {
      throw new Error(
        `Offline validation failed: ${JSON.stringify(validation)}`
      )
    }
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`)
    return false
  }
}

/**
 * Test 4: Unknown license rejected by network validation
 */
async function testUnknownLicenseRejection() {
  console.log('Test 4: Unknown license rejected by network database')

  try {
    const mockDatabase = buildSignedRegistry({}, privateKey)

    const { server, port } = await createMockServer(mockDatabase)

    try {
      // Override license DB URL via environment variable
      const originalUrl = process.env.QAA_LICENSE_DB_URL
      process.env.QAA_LICENSE_DB_URL = `http://localhost:${port}/legitimate-licenses.json`
      process.env.QAA_ALLOW_INSECURE_LICENSE_DB = '1'

      const validator = new LicenseValidator()
      const result = await validator.activateLicense(
        'QAA-UNKN-1234-5678-ABCD',
        'unknown@example.com'
      )

      // Should get "registry is empty" error when database has no licenses
      if (
        !result.success &&
        (result.error.includes('registry is empty') ||
          result.error.includes('not found'))
      ) {
        console.log(
          '  ✅ Unknown license properly rejected by network validation'
        )

        // Restore original URL
        if (originalUrl) {
          process.env.QAA_LICENSE_DB_URL = originalUrl
        } else {
          delete process.env.QAA_LICENSE_DB_URL
        }
        delete process.env.QAA_ALLOW_INSECURE_LICENSE_DB
        server.close()
        return true
      } else {
        throw new Error(`Expected rejection, got: ${JSON.stringify(result)}`)
      }
    } catch (error) {
      delete process.env.QAA_ALLOW_INSECURE_LICENSE_DB
      server.close()
      throw error
    }
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`)
    return false
  }
}

/**
 * Test 5: Network fallback handles server unavailable
 */
async function testNetworkFallback() {
  console.log('Test 5: Network fallback when server unavailable')

  try {
    // First add a license to local database
    process.env.LICENSE_REGISTRY_PRIVATE_KEY = privateKey
    await addLegitimateKey(
      'QAA-FALL-1234-5678-BACK',
      'cus_fallback',
      'PRO',
      false,
      'fallback@test.com'
    )

    // Patch fetch to simulate network failure
    const originalFetch = global.fetch
    global.fetch = async () => {
      throw new Error('Network unavailable')
    }

    const validator = new LicenseValidator()
    const result = await validator.activateLicense(
      'QAA-FALL-1234-5678-BACK',
      'fallback@test.com'
    )

    if (result.success) {
      console.log(
        '  ✅ Fallback to local database successful when network unavailable'
      )
      global.fetch = originalFetch
      delete process.env.LICENSE_REGISTRY_PRIVATE_KEY
      return true
    } else {
      throw new Error(`Fallback failed: ${JSON.stringify(result)}`)
    }
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`)
    return false
  }
}

/**
 * Test 6: End-to-end signed-registry activation simulation
 */
async function testEndToEndSimulatedPurchase() {
  console.log('Test 6: End-to-end signed-registry activation simulation')

  try {
    cleanup() // Start fresh

    // Step 1: Fixture models the registry output of a successful webhook
    const purchaseEntry = buildSignedLicenseEntry({
      licenseKey: 'QAA-E2E5-1234-5678-AB12',
      tier: 'PRO',
      isFounder: false,
      email: 'simulated-purchase@example.com',
      privateKey,
    })
    const purchaseDatabase = buildSignedRegistry(
      {
        [purchaseEntry.licenseKey]: {
          tier: purchaseEntry.tier,
          isFounder: purchaseEntry.isFounder,
          issued: purchaseEntry.issued,
          emailHash: purchaseEntry.emailHash,
          signature: purchaseEntry.signature,
          keyId: 'test-key',
        },
      },
      privateKey
    )

    // Step 2: Start server serving the database
    const { server, port } = await createMockServer(purchaseDatabase)

    try {
      // Step 3: The generated fixture key is activated
      // Override license DB URL via environment variable
      const originalUrl = process.env.QAA_LICENSE_DB_URL
      process.env.QAA_LICENSE_DB_URL = `http://localhost:${port}/legitimate-licenses.json`
      process.env.QAA_ALLOW_INSECURE_LICENSE_DB = '1'

      // Step 4: CLI activation (simulating user running npx create-qa-architect@latest --activate-license)
      const activationResult = await activateLicense(
        'QAA-E2E5-1234-5678-AB12',
        'simulated-purchase@example.com'
      )

      if (activationResult.success && activationResult.tier === 'PRO') {
        console.log('  ✅ Simulated signed-registry activation successful')
        console.log(
          `  ✅ Generated fixture key activates: ${activationResult.tier}`
        )

        // Step 5: Verify license persists for future CLI runs
        const { getLicenseInfo } = require('../lib/licensing')
        const licenseInfo = getLicenseInfo()

        if (
          licenseInfo.tier === 'PRO' &&
          licenseInfo.email === 'simulated-purchase@example.com'
        ) {
          console.log('  ✅ License persists for future CLI operations')

          // Restore original URL
          if (originalUrl) {
            process.env.QAA_LICENSE_DB_URL = originalUrl
          } else {
            delete process.env.QAA_LICENSE_DB_URL
          }
          delete process.env.QAA_ALLOW_INSECURE_LICENSE_DB
          server.close()
          return true
        } else {
          throw new Error('License not persisting correctly')
        }
      } else {
        throw new Error(
          `End-to-end activation failed: ${JSON.stringify(activationResult)}`
        )
      }
    } catch (error) {
      delete process.env.QAA_ALLOW_INSECURE_LICENSE_DB
      server.close()
      throw error
    }
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`)
    return false
  }
}

/**
 * Run all tests
 */
async function runSimulatedPurchaseTests() {
  console.log('============================================================')
  console.log('Testing Simulated Purchase Flow with Localhost Registry')
  console.log('============================================================\\n')

  let allPassed = true

  allPassed = (await testNetworkLicenseValidation()) && allPassed
  allPassed = (await testOfflineLicenseValidation()) && allPassed
  allPassed = (await testUnknownLicenseRejection()) && allPassed
  allPassed = (await testNetworkFallback()) && allPassed
  allPassed = (await testEndToEndSimulatedPurchase()) && allPassed

  cleanup()

  if (allPassed) {
    console.log(
      '\\n============================================================'
    )
    console.log('✅ ALL SIMULATED PURCHASE FLOW TESTS PASSED!')
    console.log(
      '============================================================\\n'
    )
    console.log(
      '🧪 SIMULATION: Generated keys activate against a localhost registry'
    )
    console.log(
      '🌐 NETWORK VALIDATION: CLI fetches the localhost fixture registry'
    )
    console.log(
      '📱 OFFLINE SUPPORT: Previously activated licenses work without network'
    )
    console.log('🛡️ SECURITY: Unknown/invalid licenses properly rejected')
    console.log('🔄 FALLBACK: Local database used when network unavailable')
    console.log('')
    console.log('Simulated activation flow verified:')
    console.log('  • ✅ A fixture models webhook output in a signed registry')
    console.log('  • ✅ CLI fetches fixture data during activation')
    console.log('  • ✅ License validated against localhost fixture data')
    console.log('  • ✅ Activated license stored locally for offline use')
    console.log('  • ✅ Future CLI operations work without network calls')
    console.log('')
    console.log(
      'No payment provider, webhook delivery, or live sale was tested.'
    )
    console.log('')
  } else {
    console.log('\\n❌ Some simulated purchase flow tests failed!')
    process.exit(1)
  }
}

// Run tests
if (require.main === module) {
  runSimulatedPurchaseTests().catch(error => {
    console.error(
      '❌ Simulated purchase flow test runner error:',
      error.message
    )
    process.exit(1)
  })
}

module.exports = {
  testNetworkLicenseValidation,
  testOfflineLicenseValidation,
  testUnknownLicenseRejection,
  testNetworkFallback,
  testEndToEndSimulatedPurchase,
}
