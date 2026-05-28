'use strict'

/**
 * Tests for periodic license re-validation (revocation re-check) and the
 * latest-version warning. These cover the gap where an already-activated
 * client trusted its local file forever and never noticed a revoked
 * subscription. See lib/license-validator.js revalidateLocalLicense /
 * needsRevalidation / warnIfOutdated.
 */

const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const {
  createTestKeyPair,
  setTestPublicKeyEnv,
  buildSignedLicenseEntry,
  buildSignedRegistry,
} = require('./license-test-helpers')

const TEST_LICENSE_DIR = path.join(os.tmpdir(), `cqa-reval-test-${Date.now()}`)
process.env.QAA_LICENSE_DIR = TEST_LICENSE_DIR
delete process.env.QAA_DEVELOPER

const { publicKey, privateKey } = createTestKeyPair()
setTestPublicKeyEnv(publicKey)

const { LicenseValidator } = require('../lib/license-validator')

const KEY = 'QAA-PRO-TESTREVALIDATE000001'
const EMAIL = 'reval@example.com'

function freshValidator() {
  fs.rmSync(TEST_LICENSE_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_LICENSE_DIR, { recursive: true })
  return new LicenseValidator()
}

function writeLocalLicense(validator, { verifiedAt }) {
  const entry = buildSignedLicenseEntry({
    licenseKey: KEY,
    tier: 'PRO',
    email: EMAIL,
    privateKey,
  })
  const record = {
    licenseKey: KEY,
    tier: 'PRO',
    isFounder: false,
    email: EMAIL,
    activated: verifiedAt,
    verifiedAt,
    payload: entry.payload,
    signature: entry.signature,
    source: 'legitimate_database',
  }
  validator.ensureLicenseDir()
  fs.writeFileSync(validator.licenseFile, JSON.stringify(record, null, 2))
  return entry
}

// Capture console.warn output for assertions on user-facing messages.
function captureWarn(fn) {
  const original = console.warn
  const lines = []
  console.warn = (...args) => lines.push(args.join(' '))
  return Promise.resolve(fn())
    .then(result => ({ result, output: lines.join('\n') }))
    .finally(() => {
      console.warn = original
    })
}

let passed = 0
function check(name, condition) {
  assert.ok(condition, name)
  console.log(`  ✅ ${name}`)
  passed++
}

async function run() {
  console.log('\nLicense re-validation tests\n')

  // --- needsRevalidation ---
  {
    const v = freshValidator()
    const recent = new Date().toISOString()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    check(
      'needsRevalidation false for recently verified license',
      v.needsRevalidation({ verifiedAt: recent }) === false
    )
    check(
      'needsRevalidation true when verifiedAt is older than interval',
      v.needsRevalidation({ verifiedAt: old }) === true
    )
    check(
      'needsRevalidation true when timestamp missing/unparseable',
      v.needsRevalidation({}) === true
    )
  }

  // --- revoked key → downgrade ---
  {
    const v = freshValidator()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const local = writeLocalLicense(v, { verifiedAt: old })
    void local
    // Registry no longer contains the key (revoked → removed).
    v.fetchRegistryStrict = async () => ({
      fresh: true,
      registry: buildSignedRegistry({}, privateKey),
    })
    const localLicense = v.getLocalLicense()
    const res = await v.revalidateLocalLicense(localLicense)
    check('revoked/removed key → active:false', res.active === false)
    check(
      'revoked reason is revoked-or-removed',
      res.reason === 'revoked-or-removed'
    )
    check(
      'revocation removes local license file (downgrade persists)',
      fs.existsSync(v.licenseFile) === false
    )
  }

  // --- explicit status:revoked → downgrade ---
  {
    const v = freshValidator()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    writeLocalLicense(v, { verifiedAt: old })
    const entry = buildSignedLicenseEntry({
      licenseKey: KEY,
      tier: 'PRO',
      email: EMAIL,
      privateKey,
    })
    entry.status = 'revoked'
    v.fetchRegistryStrict = async () => ({
      fresh: true,
      registry: buildSignedRegistry({ [KEY]: entry }, privateKey),
    })
    const res = await v.revalidateLocalLicense(v.getLocalLicense())
    check('status:revoked entry → active:false', res.active === false)
  }

  // --- offline (not fresh) → fail open, keep access ---
  {
    const v = freshValidator()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    writeLocalLicense(v, { verifiedAt: old })
    v.fetchRegistryStrict = async () => ({ fresh: false, registry: null })
    const res = await v.revalidateLocalLicense(v.getLocalLicense())
    check('offline re-check keeps access (fail open)', res.active === true)
    check('offline reason is offline-kept', res.reason === 'offline-kept')
  }

  // --- still valid → confirmed + verifiedAt refreshed ---
  {
    const v = freshValidator()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const entry = writeLocalLicense(v, { verifiedAt: old })
    v.fetchRegistryStrict = async () => ({
      fresh: true,
      registry: buildSignedRegistry({ [KEY]: entry }, privateKey),
    })
    const res = await v.revalidateLocalLicense(v.getLocalLicense())
    check('valid key in registry → active:true', res.active === true)
    const after = JSON.parse(fs.readFileSync(v.licenseFile, 'utf8'))
    check(
      'verifiedAt refreshed after successful re-check',
      Date.parse(after.verifiedAt) > Date.parse(old)
    )
  }

  // --- version warning emitted when installed < minRecommendedVersion ---
  {
    const v = freshValidator()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const entry = writeLocalLicense(v, { verifiedAt: old })
    const registry = buildSignedRegistry({ [KEY]: entry }, privateKey)
    registry._metadata.minRecommendedVersion = '999.0.0'
    v.fetchRegistryStrict = async () => ({ fresh: true, registry })
    const { output } = await captureWarn(() =>
      v.revalidateLocalLicense(v.getLocalLicense())
    )
    check(
      'outdated CLI prints non-fatal update warning',
      /newer QA Architect is available/.test(output)
    )
  }

  // --- no warning when version is current/ahead ---
  {
    const v = freshValidator()
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const entry = writeLocalLicense(v, { verifiedAt: old })
    const registry = buildSignedRegistry({ [KEY]: entry }, privateKey)
    registry._metadata.minRecommendedVersion = '0.0.1'
    v.fetchRegistryStrict = async () => ({ fresh: true, registry })
    const { output } = await captureWarn(() =>
      v.revalidateLocalLicense(v.getLocalLicense())
    )
    check(
      'up-to-date CLI prints no update warning',
      !/newer QA Architect is available/.test(output)
    )
  }

  fs.rmSync(TEST_LICENSE_DIR, { recursive: true, force: true })
  console.log(
    `\n✅ All license re-validation tests passed (${passed} checks)\n`
  )
}

run().catch(err => {
  console.error('\n❌ License re-validation test failed:', err.message)
  console.error(err.stack)
  process.exit(1)
})
