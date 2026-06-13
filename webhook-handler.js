#!/usr/bin/env node

// @ts-nocheck
/**
 * Polar.sh Webhook Handler for License Management
 *
 * SERVER-SIDE code that processes Polar.sh webhooks and populates the
 * signed license registry consumed by the CLI.
 *
 * Deploy on Vercel (or any Node host). Not bundled with the CLI package.
 *
 * Required dependencies (install separately, see webhook-package.json):
 *   npm install express helmet standardwebhooks
 *
 * Setup: docs/POLAR-DEPLOYMENT.md
 */

const crypto = require('crypto')
const express = require('express')
const helmet = require('helmet')
const { Webhook } = require('standardwebhooks')
const {
  LICENSE_KEY_PATTERN,
  buildLicensePayload,
  hashEmail,
  signPayload,
  stableStringify,
  loadKeyFromEnv,
} = require('./lib/license-signing')
const {
  loadBlob,
  loadBlobWithEtag,
  saveBlob,
  BLOB_PATHS,
} = require('./lib/blob-storage')

// ─── Env vars ────────────────────────────────────────────────────────────────

const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET
const POLAR_PRO_PRODUCT_ID = process.env.POLAR_PRO_PRODUCT_ID
const LICENSE_REGISTRY_KEY_ID = process.env.LICENSE_REGISTRY_KEY_ID || 'default'
const LICENSE_REGISTRY_PRIVATE_KEY = loadKeyFromEnv(
  process.env.LICENSE_REGISTRY_PRIVATE_KEY,
  process.env.LICENSE_REGISTRY_PRIVATE_KEY_PATH
)
const PORT = process.env.PORT || 3000

if (!POLAR_WEBHOOK_SECRET) {
  console.error('❌ Required environment variable missing:')
  console.error('   POLAR_WEBHOOK_SECRET - Polar webhook signing secret')
  console.error('')
  console.error('📖 See docs/POLAR-DEPLOYMENT.md for setup guide')
  process.exit(1)
}

if (!POLAR_PRO_PRODUCT_ID) {
  console.error('❌ Required environment variable missing:')
  console.error('   POLAR_PRO_PRODUCT_ID - Polar product ID for Pro tier')
  console.error('   Find it at: https://polar.sh/dashboard/<org>/products')
  process.exit(1)
}

if (!LICENSE_REGISTRY_PRIVATE_KEY) {
  console.error('❌ Required environment variable missing:')
  console.error(
    '   LICENSE_REGISTRY_PRIVATE_KEY or LICENSE_REGISTRY_PRIVATE_KEY_PATH'
  )
  process.exit(1)
}

// Polar signs webhooks per the Standard Webhooks spec. Its official SDK
// (validateEvent) base64-encodes the ENTIRE secret string — including the
// "polar_whs_" prefix — and hands that to the standardwebhooks Webhook class,
// which decodes it back to the raw secret bytes for the HMAC key. We must
// derive the key identically or every legitimate Polar webhook fails
// verification. Do NOT strip the "polar_whs_" prefix.
// Ref: github.com/polarsource/polar-js src/webhooks.ts
const _polarSecret = Buffer.from(POLAR_WEBHOOK_SECRET, 'utf-8').toString(
  'base64'
)
const polarWebhook = new Webhook(_polarSecret)

// ─── Rate limiting (unchanged) ───────────────────────────────────────────────

class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 60) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
    this.requests = new Map()
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown'
      const now = Date.now()
      let timestamps = this.requests.get(ip) || []
      timestamps = timestamps.filter(ts => now - ts < this.windowMs)

      if (timestamps.length >= this.maxRequests) {
        const oldestTimestamp = timestamps[0]
        const retryAfter = Math.ceil(
          (oldestTimestamp + this.windowMs - now) / 1000
        )
        res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        })
        return
      }

      timestamps.push(now)
      this.requests.set(ip, timestamps)

      if (this.requests.size > 100) {
        for (const [key, value] of this.requests.entries()) {
          const filtered = value.filter(ts => now - ts < this.windowMs)
          if (filtered.length === 0) {
            this.requests.delete(key)
          }
        }
      }
      next()
    }
  }
}

const healthRateLimiter = new RateLimiter(60000, 60)
const dbRateLimiter = new RateLimiter(60000, 30)

const app = express()

app.use(
  helmet({
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts:
      process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    permissionsPolicy: {
      features: { geolocation: [], microphone: [], camera: [] },
    },
  })
)

// Raw body parser for webhook signature verification — must come before json parser
app.use('/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

// ─── Storage layer ───────────────────────────────────────────────────────────

function emptyLicenseDatabase() {
  return {
    _metadata: {
      version: '1.0',
      created: new Date().toISOString(),
      description: 'License database — populated by Polar webhooks',
    },
  }
}

async function loadLicenseDatabase() {
  const database = await loadBlob(BLOB_PATHS.private)
  return database || emptyLicenseDatabase()
}

/**
 * Load the private DB together with its ETag so the matching save can be
 * guarded against concurrent overwrites. Returns { database, etag } where
 * etag is undefined on first-run (blob does not exist yet).
 */
async function loadLicenseDatabaseForUpdate() {
  const result = await loadBlobWithEtag(BLOB_PATHS.private)
  if (!result) return { database: emptyLicenseDatabase(), etag: undefined }
  return { database: result.data, etag: result.etag }
}

const MAX_WRITE_RETRIES = 5

/**
 * Run a load → mutate → conditional-save cycle that is safe across
 * horizontally-scaled function instances. The previous in-process write
 * queue only serialized writes within a single Node process; on Vercel,
 * concurrent webhooks land on separate instances and would clobber each
 * other (last-writer-wins → lost licenses). This guards the write with the
 * blob's ETag (`ifMatch`) and, on a precondition failure, reloads the fresh
 * DB and replays the mutation.
 *
 * @param {(database: object) => boolean | void} mutator Mutates the DB in
 *   place. Return `false` to signal "no change" and skip the write.
 * @returns {Promise<boolean>} true if a write was committed, false if the
 *   mutator reported no change.
 */
async function mutateLicenseDatabase(mutator) {
  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
    const { database, etag } = await loadLicenseDatabaseForUpdate()
    const changed = mutator(database)
    if (changed === false) return false

    try {
      await saveLicenseDatabase(database, etag)
      return true
    } catch (error) {
      if (isPreconditionFailure(error) && attempt < MAX_WRITE_RETRIES - 1) {
        console.warn(
          `⚠️  License DB write conflict (attempt ${attempt + 1}); reloading and retrying`
        )
        continue
      }
      throw error
    }
  }
  throw new Error(
    `License database write failed after ${MAX_WRITE_RETRIES} attempts (persistent write conflict)`
  )
}

function isPreconditionFailure(error) {
  return (
    error?.name === 'BlobPreconditionFailedError' ||
    error?.constructor?.name === 'BlobPreconditionFailedError' ||
    error?.message?.includes('precondition') ||
    error?.message?.includes('does not match')
  )
}

/**
 * Persist the private DB and rebuild the public signed registry.
 * When `etag` is provided, the private write is conditional (ifMatch) so a
 * concurrent overwrite is rejected rather than silently lost.
 */
async function saveLicenseDatabase(database, etag) {
  // eslint-disable-next-line no-unused-vars -- excluding _metadata from hash
  const { _metadata, ...licenses } = database
  const sha = crypto
    .createHash('sha256')
    .update(stableStringify(licenses))
    .digest('hex')

  database._metadata = {
    ...(database._metadata || {}),
    lastSave: new Date().toISOString(),
    sha256: sha,
  }

  // Conditional write on the private DB — this is the serialization point.
  // If it succeeds, we hold a logically-exclusive view of the private DB.
  await saveBlob(BLOB_PATHS.private, database, etag ? { ifMatch: etag } : {})

  // The public registry is fully derived from the private DB. A different
  // instance that committed a *later* private snapshot must not have its
  // public write overwritten by our (now-stale) rebuild. Guard the public
  // write with its own ETag and, on conflict, rebuild from the freshest
  // private DB and retry — so the public registry always converges to the
  // newest private state rather than whichever write happened to land last.
  await savePublicRegistryConverging(database)
  return true
}

async function savePublicRegistryConverging(latestKnownDatabase) {
  let database = latestKnownDatabase
  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
    const existing = await loadBlobWithEtag(BLOB_PATHS.public)
    const publicRegistry = buildPublicRegistry(database)
    try {
      await saveBlob(
        BLOB_PATHS.public,
        publicRegistry,
        existing?.etag ? { ifMatch: existing.etag } : {}
      )
      return
    } catch (error) {
      if (isPreconditionFailure(error) && attempt < MAX_WRITE_RETRIES - 1) {
        // Someone else updated the public registry between our read and
        // write. Rebuild from the freshest private DB so we never regress
        // the registry to an older snapshot, then retry the guarded write.
        database = await loadLicenseDatabase()
        continue
      }
      throw error
    }
  }
  throw new Error(
    `Public registry write failed after ${MAX_WRITE_RETRIES} attempts (persistent write conflict)`
  )
}

function buildPublicRegistry(database) {
  const publicLicenses = {}
  const issuedAt = new Date().toISOString()

  Object.entries(database).forEach(([licenseKey, entry]) => {
    if (licenseKey === '_metadata') return
    if (!LICENSE_KEY_PATTERN.test(licenseKey)) {
      console.warn(`Skipping invalid license key format: ${licenseKey}`)
      return
    }
    // Skip revoked licenses — they're moved to the revocation list
    if (entry.status === 'revoked') return

    const issued = entry.issued || entry.addedDate || issuedAt
    const emailHash = hashEmail(entry.email)
    const payload = buildLicensePayload({
      licenseKey,
      tier: entry.tier,
      isFounder: entry.isFounder,
      emailHash,
      issued,
    })
    const signature = signPayload(payload, LICENSE_REGISTRY_PRIVATE_KEY)
    publicLicenses[licenseKey] = {
      tier: entry.tier,
      isFounder: entry.isFounder,
      issued,
      emailHash,
      signature,
      keyId: LICENSE_REGISTRY_KEY_ID,
    }
  })

  const registrySignature = signPayload(
    publicLicenses,
    LICENSE_REGISTRY_PRIVATE_KEY
  )

  return {
    _metadata: {
      version: '1.0',
      created: database._metadata?.created || issuedAt,
      lastSave: issuedAt,
      algorithm: 'ed25519',
      keyId: LICENSE_REGISTRY_KEY_ID,
      registrySignature,
      hash: crypto
        .createHash('sha256')
        .update(stableStringify(publicLicenses))
        .digest('hex'),
    },
    ...publicLicenses,
  }
}

async function loadPublicRegistry() {
  const registry = await loadBlob(BLOB_PATHS.public)
  if (registry) return registry
  const privateDb = await loadLicenseDatabase()
  const built = buildPublicRegistry(privateDb)
  try {
    await saveBlob(BLOB_PATHS.public, built)
  } catch (error) {
    console.warn('Failed to cache public registry:', error.message)
  }
  return built
}

// ─── License key generation (unchanged) ──────────────────────────────────────

function generateLicenseKey(customerId, tier, isFounder = false) {
  const hash = crypto
    .createHash('sha256')
    .update(`${customerId}:${tier}:${isFounder}:cqa-license-v1`)
    .digest('hex')
  const keyParts = hash.slice(0, 16).match(/.{4}/g)
  return `QAA-${keyParts.join('-').toUpperCase()}`
}

// ─── Polar product → tier mapping ────────────────────────────────────────────

function mapProductToTier(productId) {
  // Configured via env var. Single product covers both $29/mo and $290/yr prices.
  const mapping = new Map([
    [POLAR_PRO_PRODUCT_ID, { tier: 'PRO', isFounder: false }],
  ])
  if (typeof productId === 'string' && mapping.has(productId)) {
    return mapping.get(productId)
  }
  return null
}

// ─── DB writes ───────────────────────────────────────────────────────────────

async function addLicenseToDatabase(licenseKey, customerInfo) {
  if (typeof licenseKey !== 'string' || !LICENSE_KEY_PATTERN.test(licenseKey)) {
    throw new Error(`Invalid license key format: ${licenseKey}`)
  }

  try {
    await mutateLicenseDatabase(database => {
      // Idempotent — if license already exists, just update timestamps
      const existing = database[licenseKey]
      database[licenseKey] = {
        customerId: customerInfo.customerId,
        tier: customerInfo.tier,
        isFounder: customerInfo.isFounder,
        email: customerInfo.email,
        subscriptionId: customerInfo.subscriptionId,
        productId: customerInfo.productId,
        addedDate: existing?.addedDate || new Date().toISOString(),
        issued: existing?.issued || new Date().toISOString(),
        addedBy: 'polar_webhook',
        status: 'active',
      }

      database._metadata.lastUpdate = new Date().toISOString()
      database._metadata.totalLicenses = Object.keys(database).length - 1
    })
  } catch (error) {
    console.error('❌ CRITICAL: Payment processed but license save failed')
    console.error(`   License Key: ${licenseKey}`)
    console.error(`   Customer: ${customerInfo.email}`)
    throw error
  }
  return true
}

function markLicensePendingCancel(subscriptionId, cancelAt) {
  return mutateLicenseDatabase(database => {
    let found = false
    Object.keys(database).forEach(key => {
      if (key === '_metadata') return
      if (database[key].subscriptionId === subscriptionId) {
        database[key].status = 'pending_cancel'
        database[key].cancelAt = cancelAt
        database[key].canceledAt = new Date().toISOString()
        found = true
      }
    })
    if (!found) {
      console.warn(
        `⚠️  No license for subscription ${subscriptionId} on cancel`
      )
      return false
    }
  })
}

function revokeLicense(subscriptionId) {
  let revokedKey = null
  return mutateLicenseDatabase(database => {
    revokedKey = null
    Object.keys(database).forEach(key => {
      if (key === '_metadata') return
      if (database[key].subscriptionId === subscriptionId) {
        database[key].status = 'revoked'
        database[key].revokedAt = new Date().toISOString()
        revokedKey = key
      }
    })
    if (!revokedKey) {
      console.warn(
        `⚠️  No license for subscription ${subscriptionId} on revoke`
      )
      return false
    }
  }).then(committed => {
    if (committed) console.log(`🚫 License revoked: ${revokedKey}`)
    return committed
  })
}

function updateLicenseTier(subscriptionId, customerInfo) {
  return mutateLicenseDatabase(database => {
    let updated = false
    Object.keys(database).forEach(key => {
      if (key === '_metadata') return
      if (database[key].subscriptionId === subscriptionId) {
        // Plan change — update tier + product, keep issued date stable
        database[key].tier = customerInfo.tier
        database[key].productId = customerInfo.productId
        database[key].status = 'active'
        updated = true
      }
    })
    if (!updated) return false
  })
}

// ─── Event handlers ──────────────────────────────────────────────────────────

function extractSubscription(event) {
  // Polar wraps the subscription object in event.data
  const sub = event.data
  if (!sub || typeof sub !== 'object') {
    throw new Error('Invalid Polar webhook: missing data')
  }
  // Customer can be either nested object or just an id depending on event version
  const customer = sub.customer || {}
  const customerId = customer.id || sub.customer_id
  const email = customer.email || sub.customer_email
  // Product id can live at sub.product.id or sub.product_id
  const productId = sub.product?.id || sub.product_id

  if (!sub.id) throw new Error('Invalid Polar webhook: missing subscription.id')
  if (!customerId) throw new Error('Invalid Polar webhook: missing customer.id')
  if (!email) throw new Error('Invalid Polar webhook: missing customer.email')
  if (!productId) throw new Error('Invalid Polar webhook: missing product id')

  return {
    subscriptionId: sub.id,
    customerId,
    email,
    productId,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end || sub.ends_at,
  }
}

async function handleSubscriptionActivated(event) {
  const s = extractSubscription(event)
  const tierInfo = mapProductToTier(s.productId)
  if (!tierInfo) {
    console.warn(`⚠️  Unknown Polar product ID: ${s.productId} — skipping`)
    return
  }
  const licenseKey = generateLicenseKey(
    s.customerId,
    tierInfo.tier,
    tierInfo.isFounder
  )
  await addLicenseToDatabase(licenseKey, {
    customerId: s.customerId,
    tier: tierInfo.tier,
    isFounder: tierInfo.isFounder,
    email: s.email,
    subscriptionId: s.subscriptionId,
    productId: s.productId,
  })
  console.log(`✅ License issued/refreshed: ${licenseKey}`)
  console.log(`   Customer: ${s.email}`)
  console.log(`   Tier: ${tierInfo.tier}`)
}

async function handleSubscriptionUpdated(event) {
  // Treat updates as plan-change checks. If product changed → update tier.
  // If still active → no-op (issued license is fine).
  const s = extractSubscription(event)
  if (s.status !== 'active') return
  const tierInfo = mapProductToTier(s.productId)
  if (!tierInfo) return
  await updateLicenseTier(s.subscriptionId, {
    tier: tierInfo.tier,
    productId: s.productId,
  })
}

async function handleSubscriptionCanceled(event) {
  // Customer hit "cancel" — they keep Pro until current_period_end.
  // We mark as pending_cancel; subscription.revoked fires when access actually ends.
  const s = extractSubscription(event)
  await markLicensePendingCancel(s.subscriptionId, s.currentPeriodEnd)
  console.log(
    `⏳ Subscription canceled (active until period end): ${s.subscriptionId}`
  )
}

async function handleSubscriptionRevoked(event) {
  // Subscription has actually ended (period end after cancel, or hard-fail dunning).
  // Remove from public registry so CLI rejects on next pull.
  const s = extractSubscription(event)
  await revokeLicense(s.subscriptionId)
}

// ─── Webhook endpoint ────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  let event

  try {
    // standard-webhooks signature verification
    const headers = {
      'webhook-id': req.headers['webhook-id'],
      'webhook-timestamp': req.headers['webhook-timestamp'],
      'webhook-signature': req.headers['webhook-signature'],
    }
    const payload = req.body.toString('utf8')
    event = polarWebhook.verify(payload, headers)
    // verify returns the parsed payload if valid, throws otherwise
    if (typeof event === 'string') event = JSON.parse(event)
  } catch (err) {
    console.error(
      '⚠️ Polar webhook signature verification failed:',
      err.message
    )
    const clientMessage =
      process.env.NODE_ENV === 'production'
        ? 'Webhook signature verification failed'
        : `Webhook Error: ${err.message}`
    return res.status(400).send(clientMessage)
  }

  try {
    if (!event || typeof event !== 'object') {
      throw new Error('Invalid webhook event: event must be an object')
    }
    if (!event.type || typeof event.type !== 'string') {
      throw new Error('Invalid webhook event: missing or invalid event.type')
    }
    if (!event.data || typeof event.data !== 'object') {
      throw new Error('Invalid webhook event: missing or invalid event.data')
    }

    switch (event.type) {
      case 'subscription.created':
      case 'subscription.active':
        await handleSubscriptionActivated(event)
        break

      case 'subscription.updated':
        await handleSubscriptionUpdated(event)
        break

      case 'subscription.canceled':
        await handleSubscriptionCanceled(event)
        break

      case 'subscription.revoked':
        await handleSubscriptionRevoked(event)
        break

      default:
        console.log(`🔄 Unhandled event type: ${event.type}`)
    }

    res.json({ received: true })
  } catch (error) {
    console.error('❌ Webhook processing error:', error.message)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// ─── Health + license-serving endpoints (unchanged) ──────────────────────────

app.get('/health', healthRateLimiter.middleware(), async (req, res) => {
  const { head: blobHead } = require('@vercel/blob')
  try {
    await blobHead(BLOB_PATHS.private)
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'exists',
    })
  } catch (error) {
    const isNotFound =
      error.code === 'blob_not_found' || error.name === 'BlobNotFoundError'
    if (isNotFound) {
      return res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'missing',
      })
    }
    console.error('Health check: database unreachable:', error.message)
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      database: 'unreachable',
    })
  }
})

async function serveLicenseDatabase(req, res) {
  try {
    const database = await loadPublicRegistry()
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET')
    res.header('Cache-Control', 'public, max-age=300')
    res.json(database)
  } catch (error) {
    console.error('Failed to serve license database:', error.message)
    res.status(503).json({
      error: 'License database temporarily unavailable',
      message: 'Please retry shortly or use cached license data',
      retryAfter: 60,
    })
  }
}

app.get(
  '/legitimate-licenses.json',
  dbRateLimiter.middleware(),
  serveLicenseDatabase
)
app.get(
  '/api/licenses/qa-architect.json',
  dbRateLimiter.middleware(),
  serveLicenseDatabase
)

app.get('/status', async (req, res) => {
  const authHeader = req.headers.authorization
  const expectedToken = process.env.STATUS_API_TOKEN || 'disabled'

  if (expectedToken === 'disabled') {
    return res.status(503).json({
      error:
        'Status endpoint is disabled. Set STATUS_API_TOKEN env var to enable.',
    })
  }

  // Fail-closed auth guard: denies with HTTP 401 when the Bearer token is
  // missing/malformed. This is the correct guard shape, not a permissive
  // bypass.
  // nosemgrep: semgrep.auth-bypass-or-condition
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ error: 'Unauthorized: Bearer token required' })
  }

  const token = authHeader.substring(7)
  const tokenBuffer = Buffer.from(token)
  const expectedBuffer = Buffer.from(expectedToken)

  if (tokenBuffer.length !== expectedBuffer.length) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' })
  }
  if (!crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' })
  }

  try {
    const database = await loadLicenseDatabase()
    const licenses = Object.keys(database).filter(key => key !== '_metadata')
    const maskedRecent = licenses.slice(-5).map(key => {
      const parts = key.split('-')
      return parts.length === 5
        ? `${parts[0]}-****-****-****-${parts[4]}`
        : '****'
    })
    res.json({
      status: 'ok',
      metadata: database._metadata,
      licenseCount: licenses.length,
      recentLicenses: maskedRecent,
    })
  } catch (error) {
    console.error('Status endpoint error:', error.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Start server ────────────────────────────────────────────────────────────

// Don't bind a port under Vercel (serverless) or when imported by tests —
// requiring this module for unit testing must not start a live server.
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log('🚀 Polar.sh webhook handler running')
    console.log(`📡 Port: ${PORT}`)
    console.log(`💡 Webhook endpoint: /webhook`)
    console.log('')
  })
}

module.exports = app

// Internal functions exposed for unit testing only. The Express `app` above
// remains the deployment contract; these are pure/near-pure helpers whose
// regressions (e.g. the Polar secret derivation, product→tier mapping) would
// otherwise only be caught by the slower E2E webhook script.
module.exports.__testExports = {
  polarWebhook,
  mapProductToTier,
  generateLicenseKey,
  extractSubscription,
  buildPublicRegistry,
  LICENSE_KEY_PATTERN,
}
