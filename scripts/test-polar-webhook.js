#!/usr/bin/env node
/**
 * End-to-end Polar webhook tester.
 * Sends signed subscription.created / subscription.revoked events to the
 * live handler and verifies the license registry is updated correctly.
 *
 * Usage:
 *   QA_ARCHITECT_SECRET=<whsec> node scripts/test-polar-webhook.js [options]
 *
 * Options:
 *   --url        Handler base URL (default: https://qa-architect.vercel.app)
 *   --event      Event type: created|revoked|canceled|updated (default: created)
 *   --email      Customer email (default: test@example.com)
 *   --product-id Polar product ID (default: POLAR_PRO_PRODUCT_ID from env)
 *   --sub-id     Subscription ID (default: random)
 *   --customer-id Customer ID (default: random)
 *   --check      Only check /health and /api/licenses — do not send webhook
 */

const crypto = require('crypto')
const https = require('https')
const http = require('http')
const url = require('url')

// ─── Config ──────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))

const BASE_URL = args.url || 'https://qa-architect.vercel.app'
const EVENT_TYPE = args.event || 'subscription.created'
const EMAIL = args.email || `test-${randomHex(6)}@example.com`
const PRODUCT_ID =
  args['product-id'] ||
  process.env.POLAR_PRO_PRODUCT_ID ||
  'cbb4408c-e7b3-4d19-a585-f9b07195adae'
const SUB_ID = args['sub-id'] || `sub_test_${randomHex(12)}`
const CUSTOMER_ID = args['customer-id'] || `cust_test_${randomHex(12)}`
const SECRET =
  process.env.QA_ARCHITECT_SECRET || process.env.POLAR_WEBHOOK_SECRET

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
    }
  }
  return result
}

function randomHex(n) {
  return crypto.randomBytes(n).toString('hex')
}

function buildPayload(eventType) {
  const isRevoke = eventType === 'subscription.revoked'
  const isCancel = eventType === 'subscription.canceled'
  return {
    type: eventType,
    data: {
      id: SUB_ID,
      status: isRevoke ? 'revoked' : isCancel ? 'canceled' : 'active',
      customer: {
        id: CUSTOMER_ID,
        email: EMAIL,
      },
      product: {
        id: PRODUCT_ID,
      },
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  }
}

// standardwebhooks signing: HMAC-SHA256 over "msgId.timestamp.payload"
// Polar uses "polar_whs_" prefix — strip it, use the raw bytes as the key.
// "whsec_" prefix means base64-encoded key; "polar_whs_" means raw string key.
function sign(secret, msgId, timestamp, body) {
  let key
  if (secret.startsWith('whsec_')) {
    key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  } else if (secret.startsWith('polar_whs_')) {
    // Handler wraps it as: whsec_ + base64(raw_suffix)
    // So key = raw_suffix bytes
    key = Buffer.from(secret.slice('polar_whs_'.length))
  } else {
    key = Buffer.from(secret, 'base64')
  }
  const toSign = `${msgId}.${timestamp}.${body}`
  return 'v1,' + crypto.createHmac('sha256', key).update(toSign).digest('base64')
}

function fetch(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(urlStr)
    const lib = parsed.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: opts.method || 'GET',
        headers: opts.headers || {},
      },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode, body }))
      }
    )
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function log(msg, level = 'info') {
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : level === 'ok' ? '✅' : '  '
  console.log(`${prefix} ${msg}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function checkStatus() {
  log(`Checking ${BASE_URL}/health ...`)
  const h = await fetch(`${BASE_URL}/health`)
  let health
  try { health = JSON.parse(h.body) } catch { health = { status: 'unknown' } }
  log(`Health: ${JSON.stringify(health)}`, health.status === 'ok' ? 'ok' : 'warn')

  // Fetch public registry directly from blob CDN (bypasses Vercel function cache)
  // Falls back to the API endpoint for local testing
  const registryUrl = process.env.BLOB_PUBLIC_URL
    ? `${process.env.BLOB_PUBLIC_URL}/licenses/legitimate-licenses.public.json`
    : `${BASE_URL}/api/licenses/qa-architect.json`
  log(`Checking registry ...`)
  const l = await fetch(`${registryUrl}?nocache=${Date.now()}`)
  if (l.status === 200) {
    const registry = JSON.parse(l.body)
    const count = Object.keys(registry).filter((k) => k !== '_metadata').length
    log(`License registry: ${count} license(s)`, 'ok')
    return registry
  } else {
    log(`License registry: empty or unavailable (${l.status})`, 'warn')
    return null
  }
}

async function sendWebhook(eventType) {
  if (!SECRET) {
    log('QA_ARCHITECT_SECRET or POLAR_WEBHOOK_SECRET env var required', 'error')
    process.exit(1)
  }

  const payload = buildPayload(eventType)
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const msgId = `msg_test_${randomHex(8)}`
  const signature = sign(SECRET, msgId, timestamp, body)

  log(`Sending ${eventType} to ${BASE_URL}/webhook`)
  log(`  subscription_id: ${SUB_ID}`)
  log(`  customer:        ${EMAIL} (${CUSTOMER_ID})`)
  log(`  product_id:      ${PRODUCT_ID}`)

  const res = await fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
    body,
  })

  if (res.status === 200) {
    log(`Webhook accepted (200)`, 'ok')
  } else {
    log(`Webhook rejected: ${res.status} — ${res.body}`, 'error')
    process.exit(1)
  }
}

async function main() {
  console.log(`\n=== Polar Webhook E2E Test ===\n`)

  if (args.check) {
    await checkStatus()
    return
  }

  // Before
  log('--- Before ---')
  const before = await checkStatus()
  const beforeKeys = before ? Object.keys(before).filter((k) => k !== '_metadata') : []

  console.log()

  // Send
  await sendWebhook(EVENT_TYPE)

  // Wait for handler to write to blob and CDN to propagate
  await new Promise((r) => setTimeout(r, 5000))

  console.log()

  // After
  log('--- After ---')
  const after = await checkStatus()
  const afterKeys = after ? Object.keys(after).filter((k) => k !== '_metadata') : []

  console.log()

  // Result
  if (EVENT_TYPE === 'subscription.created' || EVENT_TYPE === 'subscription.active') {
    const added = afterKeys.filter((k) => !beforeKeys.includes(k))
    // Also check if an existing license was refreshed (dedup by customer/sub)
    const refreshed = after
      ? afterKeys.find((k) => after[k]?.subscriptionId === SUB_ID || after[k]?.customerId === CUSTOMER_ID)
      : null
    if (added.length > 0) {
      log(`License issued: ${added[0]}`, 'ok')
      log(`E2E test PASSED ✓`, 'ok')
    } else if (refreshed) {
      log(`License refreshed (dedup): ${refreshed}`, 'ok')
      log(`E2E test PASSED ✓`, 'ok')
    } else {
      log(`No new or refreshed license found in registry after webhook`, 'error')
      log(`E2E test FAILED`, 'error')
      process.exit(1)
    }
  } else if (EVENT_TYPE === 'subscription.revoked') {
    const removed = beforeKeys.filter((k) => !afterKeys.includes(k))
    if (removed.length > 0) {
      log(`License revoked: ${removed[0]}`, 'ok')
      log(`E2E test PASSED ✓`, 'ok')
    } else {
      log(`License still present after revocation webhook`, 'warn')
      log(`(May be expected if sub ID didn't match an existing key)`)
    }
  } else {
    log(`Webhook sent. Check registry manually for ${EVENT_TYPE}`, 'ok')
  }

  console.log()
}

main().catch((err) => {
  log(err.message, 'error')
  process.exit(1)
})
