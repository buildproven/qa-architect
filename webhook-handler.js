#!/usr/bin/env node

// @ts-nocheck
/**
 * Stripe Webhook Handler for License Management
 *
 * This is SERVER-SIDE code that processes Stripe webhooks
 * and populates the legitimate license database.
 *
 * Deploy this on your server (not distributed with CLI package).
 *
 * Required dependencies (install separately):
 *   npm install express helmet stripe
 *
 * Usage:
 *   1. Deploy this script to your server
 *   2. Set up Stripe webhook endpoint pointing to this handler
 *   3. Set required environment variables
 *   4. Webhook will automatically populate license database when payments succeed
 */

const crypto = require('crypto')
const express = require('express')
const helmet = require('helmet')
const {
  LICENSE_KEY_PATTERN,
  buildLicensePayload,
  hashEmail,
  signPayload,
  stableStringify,
  loadKeyFromEnv,
} = require('./lib/license-signing')
const { loadBlob, saveBlob, BLOB_PATHS } = require('./lib/blob-storage')

// Environment variables required
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const LICENSE_REGISTRY_KEY_ID = process.env.LICENSE_REGISTRY_KEY_ID || 'default'
const LICENSE_REGISTRY_PRIVATE_KEY = loadKeyFromEnv(
  process.env.LICENSE_REGISTRY_PRIVATE_KEY,
  process.env.LICENSE_REGISTRY_PRIVATE_KEY_PATH
)
const PORT = process.env.PORT || 3000

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error('❌ Required environment variables missing:')
  console.error(
    '   STRIPE_SECRET_KEY - Your Stripe secret key (sk_live_... for production)'
  )
  console.error(
    '   STRIPE_WEBHOOK_SECRET - Your Stripe webhook secret (whsec_...)'
  )
  console.error('')
  console.error('📖 See docs/STRIPE-LIVE-MODE-DEPLOYMENT.md for setup guide')
  process.exit(1)
}

// Warn if using test mode keys in production
if (STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  console.warn('⚠️  WARNING: Using Stripe TEST mode key')
  console.warn('   This will NOT process real payments')
  console.warn('   For production, use sk_live_... key')
  console.warn('   See docs/STRIPE-LIVE-MODE-DEPLOYMENT.md')
  console.warn('')
}

if (!LICENSE_REGISTRY_PRIVATE_KEY) {
  console.error('❌ Required environment variables missing:')
  console.error(
    '   LICENSE_REGISTRY_PRIVATE_KEY or LICENSE_REGISTRY_PRIVATE_KEY_PATH'
  )
  process.exit(1)
}

/**
 * DR19 fix: Simple in-memory rate limiter for public endpoints
 * Prevents abuse of health check and license database endpoints
 */
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 60) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
    this.requests = new Map() // ip -> [timestamps]
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown'
      const now = Date.now()

      // Get existing requests for this IP
      let timestamps = this.requests.get(ip) || []

      // Remove expired timestamps (outside the window)
      timestamps = timestamps.filter(ts => now - ts < this.windowMs)

      // Check if limit exceeded
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

      // Add current request
      timestamps.push(now)
      this.requests.set(ip, timestamps)

      // Cleanup old entries periodically (every 100 requests)
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

// Create rate limiters for different endpoints
const healthRateLimiter = new RateLimiter(60000, 60) // 60 requests per minute
const dbRateLimiter = new RateLimiter(60000, 30) // 30 requests per minute

const app = express()

// DR28 fix: Use helmet.js for comprehensive security headers
app.use(
  helmet({
    // Prevent clickjacking
    frameguard: { action: 'deny' },
    // Prevent MIME sniffing
    noSniff: true,
    // XSS protection (legacy browsers)
    xssFilter: true,
    // Strict Content Security Policy for API endpoints
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Referrer policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // HSTS - only in production
    hsts:
      process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    // Permissions policy via custom middleware (helmet doesn't support all features)
    permissionsPolicy: {
      features: {
        geolocation: [],
        microphone: [],
        camera: [],
      },
    },
  })
)

// Raw body parser for Stripe webhooks
app.use('/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

/**
 * Load legitimate license database from Vercel Blob
 */
async function loadLicenseDatabase() {
  const database = await loadBlob(BLOB_PATHS.private)
  if (database) return database

  return {
    _metadata: {
      version: '1.0',
      created: new Date().toISOString(),
      description: 'Legitimate license database - populated by Stripe webhooks',
    },
  }
}

let writeQueue = Promise.resolve()

function queueDatabaseWrite(task) {
  const next = writeQueue.then(task, task)
  // Chain error handling but re-throw so callers can handle
  writeQueue = next.catch(error => {
    // Silent failure fix: Log write queue errors
    console.error(`⚠️  Database write queue error: ${error.message}`)
    throw error // Re-throw to propagate to caller
  })
  return writeQueue
}

/**
 * Save legitimate license database to Vercel Blob
 */
async function saveLicenseDatabase(database) {
  try {
    // Compute integrity hash over licenses (excluding metadata)
    // eslint-disable-next-line no-unused-vars -- destructuring to exclude _metadata from licenses
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

    const privateResult = await saveBlob(BLOB_PATHS.private, database)
    if (!privateResult) return false

    const publicRegistry = buildPublicRegistry(database)
    const publicResult = await saveBlob(BLOB_PATHS.public, publicRegistry)
    return !!publicResult
  } catch (error) {
    console.error('Error saving license database:', error.message)
    return false
  }
}

function buildPublicRegistry(database) {
  const publicLicenses = {}
  const issuedAt = new Date().toISOString()

  Object.entries(database).forEach(([licenseKey, entry]) => {
    if (licenseKey === '_metadata') return
    // TD11 fix: Validate license key format to prevent object injection
    // and silence ESLint security/detect-object-injection warning
    if (!LICENSE_KEY_PATTERN.test(licenseKey)) {
      console.warn(`Skipping invalid license key format: ${licenseKey}`)
      return
    }
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
    // TD11: Safe - licenseKey is validated against LICENSE_KEY_PATTERN above
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
  await saveBlob(BLOB_PATHS.public, built)
  return built
}

/**
 * Generate deterministic license key from customer ID
 */
function generateLicenseKey(customerId, tier, isFounder = false) {
  const hash = crypto
    .createHash('sha256')
    .update(`${customerId}:${tier}:${isFounder}:cqa-license-v1`)
    .digest('hex')

  // Format as license key: QAA-XXXX-XXXX-XXXX-XXXX
  const keyParts = hash.slice(0, 16).match(/.{4}/g)
  return `QAA-${keyParts.join('-').toUpperCase()}`
}

/**
 * Map Stripe price ID to tier and founder status
 */
function mapPriceToTier(priceId) {
  // Configure these based on your Stripe price IDs (founder pricing retired)
  // Using Map to avoid object-injection warnings from eslint-plugin-security
  const priceMapping = new Map([
    ['price_1St9K2Gv7Su9XNJbdYoH3K32', { tier: 'PRO', isFounder: false }], // $49/mo
    ['price_1St9KGGv7Su9XNJbrwKMsh1R', { tier: 'PRO', isFounder: false }], // $490/yr
  ])

  if (typeof priceId === 'string' && priceMapping.has(priceId)) {
    return priceMapping.get(priceId)
  }
  return null
}

/**
 * Add license to database
 */
function addLicenseToDatabase(licenseKey, customerInfo) {
  return queueDatabaseWrite(async () => {
    try {
      // Validate license key format to prevent object injection
      if (
        typeof licenseKey !== 'string' ||
        !LICENSE_KEY_PATTERN.test(licenseKey)
      ) {
        console.error('Invalid license key format:', licenseKey)
        throw new Error(`Invalid license key format: ${licenseKey}`)
      }

      const database = await loadLicenseDatabase()

      database[licenseKey] = {
        customerId: customerInfo.customerId,
        tier: customerInfo.tier,
        isFounder: customerInfo.isFounder,
        email: customerInfo.email,
        subscriptionId: customerInfo.subscriptionId,
        addedDate: new Date().toISOString(),
        issued: new Date().toISOString(),
        addedBy: 'stripe_webhook',
      }

      // Update metadata
      database._metadata.lastUpdate = new Date().toISOString()
      database._metadata.totalLicenses = Object.keys(database).length - 1 // Exclude metadata

      const saveResult = await saveLicenseDatabase(database)
      if (!saveResult) {
        console.error(`❌ CRITICAL: Payment processed but license save failed`)
        console.error(`   License Key: ${licenseKey}`)
        console.error(
          `   Customer: ${customerInfo.email || customerInfo.customerId}`
        )
        console.error(`   Action: Manual license activation required`)
        throw new Error(
          'License database save failed - payment succeeded but license not activated'
        )
      }
      return saveResult
    } catch (error) {
      console.error(`❌ Error adding license to database: ${error.message}`)
      console.error(`   License Key: ${licenseKey}`)
      console.error(
        `   Customer: ${customerInfo.email || customerInfo.customerId}`
      )
      throw error
    }
  })
}

/**
 * Handle Stripe webhook events
 */
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    // Initialize Stripe
    const stripe = require('stripe')(STRIPE_SECRET_KEY)

    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message)
    // DR18 fix: Don't expose error details in production
    const clientMessage =
      process.env.NODE_ENV === 'production'
        ? 'Webhook signature verification failed'
        : `Webhook Error: ${err.message}`
    return res.status(400).send(clientMessage)
  }

  try {
    // DR31 fix: Validate event structure before processing
    if (!event || typeof event !== 'object') {
      throw new Error('Invalid webhook event: event must be an object')
    }
    if (!event.type || typeof event.type !== 'string') {
      throw new Error('Invalid webhook event: missing or invalid event.type')
    }
    if (!event.data || typeof event.data !== 'object') {
      throw new Error('Invalid webhook event: missing or invalid event.data')
    }
    if (!event.data.object || typeof event.data.object !== 'object') {
      throw new Error(
        'Invalid webhook event: missing or invalid event.data.object'
      )
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object)
        break

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object)
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

/**
 * Handle successful checkout completion
 */
async function handleCheckoutCompleted(session) {
  try {
    console.log('💰 Processing checkout completion:', session.id)

    // DR7 fix: Validate session structure
    if (!session.customer || !session.subscription) {
      throw new Error(
        'Invalid checkout session: missing customer or subscription'
      )
    }

    const stripe = require('stripe')(STRIPE_SECRET_KEY)

    // Get customer details
    const customer = await stripe.customers.retrieve(session.customer)

    // Get subscription details
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription
    )

    // DR7 fix: Validate subscription structure
    if (
      !subscription.items ||
      !subscription.items.data ||
      subscription.items.data.length === 0
    ) {
      throw new Error('Invalid subscription: missing items data')
    }

    const priceId = subscription.items.data[0].price?.id
    if (!priceId) {
      throw new Error('Invalid subscription: missing price ID')
    }

    // Map price to tier
    const priceInfo = mapPriceToTier(priceId)
    if (!priceInfo) {
      throw new Error(`Unknown Stripe price ID: ${priceId}`)
    }
    const { tier, isFounder } = priceInfo

    // Generate license key
    const licenseKey = generateLicenseKey(customer.id, tier, isFounder)

    // Add to database
    const customerInfo = {
      customerId: customer.id,
      tier,
      isFounder,
      email: customer.email,
      subscriptionId: subscription.id,
    }

    const success = await addLicenseToDatabase(licenseKey, customerInfo)

    if (success) {
      console.log(`✅ License created: ${licenseKey}`)
      console.log(`   Customer: ${customer.email}`)
      console.log(`   Tier: ${tier} ${isFounder ? '(Founder)' : ''}`)

      // Here you could also send the license key to the customer via email
      // await sendLicenseEmail(customer.email, licenseKey, tier)
    } else {
      throw new Error('Failed to save license to database')
    }
  } catch (error) {
    console.error('❌ Checkout processing error:', error.message)
    throw error
  }
}

/**
 * Handle successful payment (recurring)
 */
async function handlePaymentSucceeded(invoice) {
  // DR31 fix: Validate invoice structure
  if (!invoice || typeof invoice !== 'object') {
    throw new Error('Invalid invoice: must be an object')
  }
  if (!invoice.id) {
    throw new Error('Invalid invoice: missing id')
  }

  console.log(`💳 Payment succeeded: ${invoice.id}`)
  // License should already exist from checkout.session.completed
  // Could implement license renewal/extension logic here if needed
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCanceled(subscription) {
  // DR31 fix: Validate subscription structure
  if (!subscription || typeof subscription !== 'object') {
    throw new Error('Invalid subscription: must be an object')
  }
  if (!subscription.id) {
    throw new Error('Invalid subscription: missing id')
  }
  if (!subscription.customer) {
    throw new Error('Invalid subscription: missing customer')
  }

  console.log(`❌ Subscription canceled: ${subscription.id}`)
  console.log(`   Customer: ${subscription.customer}`)

  try {
    // DR4 fix: Implement license deactivation with proper error handling
    const database = await loadLicenseDatabase()
    let licenseFound = false

    Object.keys(database).forEach(key => {
      if (key === '_metadata') return
      if (database[key].subscriptionId === subscription.id) {
        database[key].status = 'canceled'
        database[key].canceledAt = new Date().toISOString()
        licenseFound = true
        console.log(`   Marking license ${key} as canceled`)
      }
    })

    if (!licenseFound) {
      console.warn(`⚠️  No license found for subscription ${subscription.id}`)
      return // Not an error - license may have been manually removed
    }

    const saveResult = await saveLicenseDatabase(database)
    if (!saveResult) {
      throw new Error(
        `Failed to save license cancellation for subscription ${subscription.id}`
      )
    }

    console.log(`✅ License deactivated for subscription ${subscription.id}`)
  } catch (error) {
    // DR4 fix: Re-throw to trigger webhook retry instead of silently failing
    console.error(`❌ CRITICAL: Subscription cancellation processing failed`)
    console.error(`   Subscription: ${subscription.id}`)
    console.error(`   Error: ${error.message}`)
    console.error(`   ACTION REQUIRED: Manually deactivate license`)
    throw error
  }
}

/**
 * Health check endpoint
 * DR19 fix: Add rate limiting to prevent DoS
 */
app.get('/health', healthRateLimiter.middleware(), async (req, res) => {
  try {
    const db = await loadBlob(BLOB_PATHS.private)
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: db ? 'exists' : 'missing',
    })
  } catch {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'unknown',
    })
  }
})

/**
 * License database endpoint for CLI access
 *
 * This is the critical endpoint that allows the CLI to fetch
 * the latest legitimate licenses for validation
 * DR19 fix: Add rate limiting to prevent abuse
 */
app.get('/legitimate-licenses.json', dbRateLimiter.middleware(), async (req, res) => {
  try {
    const database = await loadPublicRegistry()

    // Add CORS headers for CLI access
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET')
    res.header('Cache-Control', 'public, max-age=300') // Cache for 5 minutes

    res.json(database)
  } catch (error) {
    // DR9 fix: Return proper error status so clients know to retry with cache
    console.error('Failed to serve license database:', error.message)
    res.status(503).json({
      error: 'License database temporarily unavailable',
      message: 'Please retry shortly or use cached license data',
      retryAfter: 60,
    })
  }
})

/**
 * License database status endpoint
 * DR15 fix: Requires authentication
 */
app.get('/status', async (req, res) => {
  // DR15 fix: Require Bearer token authentication
  const authHeader = req.headers.authorization
  const expectedToken = process.env.STATUS_API_TOKEN || 'disabled'

  if (expectedToken === 'disabled') {
    return res.status(503).json({
      error:
        'Status endpoint is disabled. Set STATUS_API_TOKEN env var to enable.',
    })
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ error: 'Unauthorized: Bearer token required' })
  }

  const token = authHeader.substring(7)
  // Use constant-time comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(token)
  const expectedBuffer = Buffer.from(expectedToken)

  // Ensure buffers are same length to prevent length-based timing attacks
  if (tokenBuffer.length !== expectedBuffer.length) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' })
  }

  if (!crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' })
  }

  try {
    const database = await loadLicenseDatabase()
    const licenses = Object.keys(database).filter(key => key !== '_metadata')

    // TD9 fix: Don't expose actual license keys - show masked versions for debugging
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
    res.status(500).json({ error: error.message })
  }
})

// Route alias: CLI fetches /api/licenses/qa-architect.json by default
app.get(
  '/api/licenses/qa-architect.json',
  dbRateLimiter.middleware(),
  async (req, res) => {
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
)

// Start server (Vercel handles listening via module.exports)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('🚀 License webhook handler running')
    console.log(`📡 Port: ${PORT}`)
    console.log(`💡 Webhook endpoint: /webhook`)
    console.log('')
  })
}

module.exports = app
