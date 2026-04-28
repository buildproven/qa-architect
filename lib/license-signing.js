'use strict'

/**
 * License signing primitives — thin adapter over @buildproven/license-core.
 *
 * The package is the single source of truth for the signing/verification
 * algorithm. This file exists for backward compatibility with existing
 * `require('./license-signing')` callers in licensing.js, license-validator.js,
 * admin-license.js, and tests. The bit-for-bit format is locked by the
 * package's golden-vector tests against this exact file's prior behavior.
 *
 * QAA-specific bits (loadKeyFromEnv, LICENSE_KEY_PATTERN) stay here because
 * they're not generic to all BuildProven products.
 */

const core = require('@buildproven/license-core')

// QAA license key format — kept here, not in the shared package, because
// each product has its own prefix.
const LICENSE_KEY_PATTERN =
  /^QAA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

// QAA-specific helper: load a PEM key from either an env var (raw value)
// or a path env var (file contents). Not in the shared package because
// other consumers (Vercel functions) read keys differently.
function loadKeyFromEnv(envValue, envPathValue) {
  if (envValue) return envValue
  if (envPathValue) {
    const fs = require('fs')
    if (fs.existsSync(envPathValue)) {
      return fs.readFileSync(envPathValue, 'utf8')
    }
  }
  return null
}

module.exports = {
  LICENSE_KEY_PATTERN,
  loadKeyFromEnv,
  // Re-exports — single source of truth in @buildproven/license-core
  stableStringify: core.stableStringify,
  normalizeEmail: core.normalizeEmail,
  hashEmail: core.hashEmail,
  buildLicensePayload: core.buildLicensePayload,
  signPayload: core.signPayload,
  verifyPayload: core.verifyPayload,
}
