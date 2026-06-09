'use strict'

/**
 * Unit tests for webhook-handler.js internal helpers.
 *
 * These guard the regression-prone, near-pure logic in the Polar webhook
 * handler that the slower E2E script (scripts/run-local-webhook-test.sh) is
 * the only other thing exercising:
 *
 *   - The Polar `polar_whs_` secret derivation. A prior WIP changed
 *     `new Webhook(base64(secret))` to `new Webhook(secret)`, which makes
 *     standardwebhooks base64.decode a non-base64 string and THROW at module
 *     load — taking down the whole handler. This test proves the derivation
 *     produces a usable Webhook that verifies a correctly-signed payload.
 *   - mapProductToTier — env-driven product → tier mapping.
 *   - generateLicenseKey — deterministic QAA-XXXX-... format.
 *   - extractSubscription — Polar event-shape normalization + required fields.
 *   - buildPublicRegistry — skips revoked + invalid keys, signs the rest.
 *
 * The module gates on required env vars at load time (process.exit on missing),
 * so all env must be set BEFORE requiring it.
 */

const assert = require('node:assert')
const crypto = require('node:crypto')
const { Webhook } = require('standardwebhooks')

// --- Required env, set before requiring the handler ---
const TEST_PRODUCT_ID = 'prod_test_pro_123'
// A realistic Polar webhook secret shape. The leading "polar_whs_" prefix is
// the exact thing the derivation must NOT mishandle.
const TEST_POLAR_SECRET = 'polar_whs_aGVsbG93b3JsZHRlc3RzZWNyZXQxMjM0NTY3OA'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

process.env.POLAR_WEBHOOK_SECRET = TEST_POLAR_SECRET
process.env.POLAR_PRO_PRODUCT_ID = TEST_PRODUCT_ID
process.env.LICENSE_REGISTRY_PRIVATE_KEY = privateKey
process.env.LICENSE_REGISTRY_KEY_ID = 'test-key'
// Avoid the handler trying to bind a port when required.
process.env.NODE_ENV = 'test'

const app = require('../webhook-handler')
const {
  polarWebhook,
  mapProductToTier,
  generateLicenseKey,
  extractSubscription,
  buildPublicRegistry,
  LICENSE_KEY_PATTERN,
} = app.__testExports

let passed = 0
function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log(`  ✅ ${msg}`)
  passed++
}

console.log('webhook-handler internal helper tests\n')

// ─── Polar secret derivation (the regression guard) ──────────────────────────
console.log('Polar webhook secret derivation:')
{
  // Re-derive the key the same way the handler does, and prove the resulting
  // Webhook instance verifies a payload signed with that derived key. If the
  // derivation were wrong (raw secret instead of base64-wrapped), construction
  // would throw or verification would fail.
  ok(polarWebhook instanceof Webhook, 'derives a usable Webhook instance')

  const derivedSecret = Buffer.from(TEST_POLAR_SECRET, 'utf-8').toString(
    'base64'
  )
  const signer = new Webhook(derivedSecret)
  const msgId = 'msg_test_1'
  // standardwebhooks.verify rejects stale timestamps, so sign with "now".
  const signedAt = new Date()
  const timestamp = String(Math.floor(signedAt.getTime() / 1000))
  const payload = JSON.stringify({ type: 'subscription.active', data: {} })
  const signature = signer.sign(msgId, signedAt, payload)

  const headers = {
    'webhook-id': msgId,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  }
  const verified = polarWebhook.verify(payload, headers)
  ok(
    verified && verified.type === 'subscription.active',
    'verifies a payload signed with the base64-derived key'
  )

  // The raw secret (the broken variant) must NOT silently produce a working
  // verifier — constructing with the raw polar_whs_ string throws because it
  // is not valid base64. This locks in why the base64 wrap is required.
  assert.throws(
    () => new Webhook(TEST_POLAR_SECRET),
    /base64|incorrect characters|decod/i,
    'raw polar_whs_ secret is not base64 and must throw on construction'
  )
  console.log(
    '  ✅ raw polar_whs_ secret throws (confirms why base64 is needed)'
  )
  passed++
}

// ─── mapProductToTier ────────────────────────────────────────────────────────
console.log('\nmapProductToTier:')
{
  const mapped = mapProductToTier(TEST_PRODUCT_ID)
  ok(
    mapped && mapped.tier === 'PRO' && mapped.isFounder === false,
    'known product id maps to { tier: PRO, isFounder: false }'
  )
  ok(
    mapProductToTier('prod_unknown') === null,
    'unknown product id maps to null'
  )
  ok(mapProductToTier(undefined) === null, 'undefined product id maps to null')
  ok(mapProductToTier(12345) === null, 'non-string product id maps to null')
}

// ─── generateLicenseKey ──────────────────────────────────────────────────────
console.log('\ngenerateLicenseKey:')
{
  const key = generateLicenseKey('cust_abc', 'PRO', false)
  ok(
    LICENSE_KEY_PATTERN.test(key),
    `produces a valid license key format (${key})`
  )
  ok(
    generateLicenseKey('cust_abc', 'PRO', false) === key,
    'is deterministic for the same inputs'
  )
  ok(
    generateLicenseKey('cust_abc', 'PRO', true) !== key,
    'isFounder flag changes the derived key'
  )
  ok(
    generateLicenseKey('cust_xyz', 'PRO', false) !== key,
    'different customer id changes the derived key'
  )
}

// ─── extractSubscription ─────────────────────────────────────────────────────
console.log('\nextractSubscription:')
{
  const nested = extractSubscription({
    data: {
      id: 'sub_1',
      status: 'active',
      customer: { id: 'cust_1', email: 'a@b.com' },
      product: { id: TEST_PRODUCT_ID },
      current_period_end: '2026-12-31',
    },
  })
  ok(
    nested.subscriptionId === 'sub_1' &&
      nested.customerId === 'cust_1' &&
      nested.email === 'a@b.com' &&
      nested.productId === TEST_PRODUCT_ID,
    'normalizes the nested customer/product event shape'
  )

  const flat = extractSubscription({
    data: {
      id: 'sub_2',
      status: 'active',
      customer_id: 'cust_2',
      customer_email: 'c@d.com',
      product_id: TEST_PRODUCT_ID,
      ends_at: '2026-11-30',
    },
  })
  ok(
    flat.customerId === 'cust_2' &&
      flat.email === 'c@d.com' &&
      flat.productId === TEST_PRODUCT_ID &&
      flat.currentPeriodEnd === '2026-11-30',
    'normalizes the flat customer_id/product_id event shape'
  )

  assert.throws(
    () => extractSubscription({}),
    /missing data/i,
    'throws when event.data is missing'
  )
  console.log('  ✅ throws when event.data is missing')
  passed++

  assert.throws(
    () => extractSubscription({ data: { id: 'sub_3', customer: {} } }),
    /customer\.id/i,
    'throws when customer id is missing'
  )
  console.log('  ✅ throws when customer id is missing')
  passed++

  assert.throws(
    () =>
      extractSubscription({
        data: { customer: { id: 'c', email: 'e@x.com' }, product_id: 'p' },
      }),
    /subscription\.id/i,
    'throws when subscription id is missing'
  )
  console.log('  ✅ throws when subscription id is missing')
  passed++
}

// ─── buildPublicRegistry ─────────────────────────────────────────────────────
console.log('\nbuildPublicRegistry:')
{
  const validKey = generateLicenseKey('cust_pub', 'PRO', false)
  const revokedKey = generateLicenseKey('cust_rev', 'PRO', false)
  const database = {
    _metadata: { created: '2026-01-01T00:00:00.000Z' },
    [validKey]: {
      tier: 'PRO',
      isFounder: false,
      email: 'pub@x.com',
      status: 'active',
      issued: '2026-02-01T00:00:00.000Z',
    },
    [revokedKey]: {
      tier: 'PRO',
      isFounder: false,
      email: 'rev@x.com',
      status: 'revoked',
      issued: '2026-02-01T00:00:00.000Z',
    },
    'not-a-valid-key': { tier: 'PRO', status: 'active', email: 'bad@x.com' },
  }

  const registry = buildPublicRegistry(database)
  ok(registry[validKey] !== undefined, 'includes the active, valid license')
  ok(registry[revokedKey] === undefined, 'excludes the revoked license')
  ok(
    registry['not-a-valid-key'] === undefined,
    'excludes entries with an invalid key format'
  )
  ok(
    registry._metadata &&
      typeof registry._metadata.registrySignature === 'string',
    'signs the registry (_metadata.registrySignature present)'
  )
  ok(
    registry[validKey].keyId === 'test-key' &&
      typeof registry[validKey].signature === 'string',
    'each public entry carries a keyId and signature'
  )
  // The public registry must never leak the raw email — only a hash.
  ok(
    registry[validKey].email === undefined &&
      typeof registry[validKey].emailHash === 'string',
    'public entry exposes emailHash, never the raw email'
  )
  // Verify the per-license signature actually validates against the public key,
  // rebuilding the canonical payload exactly as the handler does.
  const {
    buildLicensePayload,
    verifyPayload,
  } = require('../lib/license-signing')
  const entry = registry[validKey]
  const canonicalPayload = buildLicensePayload({
    licenseKey: validKey,
    tier: entry.tier,
    isFounder: entry.isFounder,
    emailHash: entry.emailHash,
    issued: entry.issued,
  })
  ok(
    verifyPayload(canonicalPayload, entry.signature, publicKey) === true,
    'per-license signature verifies against the public key'
  )
}

console.log(`\n✅ All webhook-handler helper tests passed (${passed} checks)`)
