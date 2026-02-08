/**
 * Licensing System for create-qa-architect
 * Handles free/pro tier validation
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const {
  LICENSE_KEY_PATTERN,
  buildLicensePayload,
  hashEmail,
  signPayload,
  stableStringify,
  verifyPayload,
  loadKeyFromEnv,
} = require('./license-signing')

// License storage locations
// Support environment variable override for testing (like telemetry/error-reporter)
// Use getter functions to allow env override before module load
function getLicenseDir() {
  return (
    process.env.QAA_LICENSE_DIR ||
    path.join(os.homedir(), '.create-qa-architect')
  )
}

function getLicenseFile() {
  return path.join(getLicenseDir(), 'license.json')
}

// Keep old constants for backward compatibility (but make them dynamic)
Object.defineProperty(exports, 'LICENSE_DIR', {
  get: getLicenseDir,
})
Object.defineProperty(exports, 'LICENSE_FILE', {
  get: getLicenseFile,
})

/**
 * License tiers
 *
 * Standardized to use SCREAMING_SNAKE_CASE for both keys and values
 * for consistency with ErrorCategory and other enums in the codebase.
 *
 * Pricing:
 * - FREE: $0 (Hobby/OSS - capped)
 * - PRO: $49/mo or $490/yr (Solo Devs/Small Teams)
 */
// DR23 fix: Freeze object to prevent accidental or malicious mutation
const LICENSE_TIERS = Object.freeze({
  FREE: 'FREE',
  PRO: 'PRO',
})

function normalizeLicenseKey(key) {
  if (typeof key !== 'string') return ''
  return key.trim().toUpperCase()
}

/**
 * DR23 fix: Deep freeze helper to prevent mutation at any level
 */
function deepFreeze(obj) {
  Object.freeze(obj)
  Object.getOwnPropertyNames(obj).forEach(prop => {
    if (
      obj[prop] !== null &&
      (typeof obj[prop] === 'object' || typeof obj[prop] === 'function') &&
      !Object.isFrozen(obj[prop])
    ) {
      deepFreeze(obj[prop])
    }
  })
  return obj
}

/**
 * Feature definitions by tier
 *
 * FREE: Hobby/OSS - capped usage, basic quality automation
 * PRO: Solo devs/small teams - unlimited, full features
 *
 * DR23 fix: Deep frozen to prevent accidental or malicious mutation
 */
const FEATURES = deepFreeze({
  [LICENSE_TIERS.FREE]: {
    // Caps (enforced in setup.js and CLI)
    maxPrivateRepos: 1,
    maxDependencyPRsPerMonth: 10,
    maxPrePushRunsPerMonth: 50,
    // Features
    dependencyMonitoring: 'basic',
    languages: ['npm'], // JS/TS only
    frameworkGrouping: false,
    smartTestStrategy: false, // ❌ PRO feature
    typescriptProtection: false, // ❌ PRO feature (moved from FREE)
    securityScanning: false, // ❌ PRO feature - Gitleaks, ESLint security
    projectTypeDetection: false,
    customSchedules: false,
    advancedWorkflows: false,
    notifications: false,
    multiRepo: false,
    // Quality tools
    lighthouseCI: true, // ✅ Basic Lighthouse (no thresholds)
    lighthouseThresholds: false, // ❌ PRO feature - custom thresholds
    bundleSizeLimits: false, // ❌ PRO feature
    axeAccessibility: true, // ✅ Basic a11y testing
    conventionalCommits: true, // ✅ Commit message enforcement
    coverageThresholds: false, // ❌ PRO feature
    // Pre-launch validation
    prelaunchValidation: true, // ✅ Basic prelaunch checks
    seoValidation: true, // ✅ Sitemap, robots, meta tags
    linkValidation: true, // ✅ Broken link detection
    docsValidation: true, // ✅ Documentation completeness
    envValidation: false, // ❌ PRO feature - env vars audit
    // CI/CD optimization
    ciCostAnalysis: false, // ❌ PRO feature - GitHub Actions cost analysis
    roadmap: [
      '✅ ESLint, Prettier, Stylelint configuration',
      '✅ Basic Husky pre-commit hooks',
      '✅ Basic npm dependency monitoring (10 PRs/month)',
      '✅ Lighthouse CI (basic, no thresholds)',
      '✅ axe-core accessibility testing',
      '✅ Conventional commits (commitlint)',
      '⚠️ Limited: 1 private repo, JS/TS only',
      '❌ No security scanning (Gitleaks, ESLint security)',
      '❌ No Smart Test Strategy',
    ],
  },
  [LICENSE_TIERS.PRO]: {
    // No caps - unlimited
    maxPrivateRepos: Infinity,
    maxDependencyPRsPerMonth: Infinity,
    maxPrePushRunsPerMonth: Infinity,
    // Features
    dependencyMonitoring: 'premium',
    languages: ['npm', 'python', 'rust', 'ruby'], // Multi-language
    frameworkGrouping: true, // React, Vue, Angular, Svelte grouping
    smartTestStrategy: true, // ✅ KEY DIFFERENTIATOR: 70% faster pre-push
    typescriptProtection: true, // ✅ tests/tsconfig.json generation
    securityScanning: true, // ✅ Gitleaks + ESLint security rules
    projectTypeDetection: true, // CLI, Web, SaaS, API, Library, Docs
    advancedSecurity: true, // Rate limits, stricter audits
    customSchedules: false,
    advancedWorkflows: false,
    notifications: false,
    multiRepo: false,
    // Quality tools - all enabled
    lighthouseCI: true, // ✅ Full Lighthouse CI
    lighthouseThresholds: true, // ✅ Custom performance/a11y thresholds
    bundleSizeLimits: true, // ✅ Bundle size enforcement
    axeAccessibility: true, // ✅ Advanced a11y testing
    conventionalCommits: true, // ✅ Commit message enforcement
    coverageThresholds: true, // ✅ Coverage threshold enforcement
    // Pre-launch validation - all enabled
    prelaunchValidation: true, // ✅ Full prelaunch suite
    seoValidation: true, // ✅ Sitemap, robots, meta tags
    linkValidation: true, // ✅ Broken link detection
    docsValidation: true, // ✅ Documentation completeness
    envValidation: true, // ✅ Env vars audit
    // CI/CD optimization
    ciCostAnalysis: true, // ✅ GitHub Actions cost analysis
    roadmap: [
      '✅ Unlimited repos and runs',
      '✅ Smart Test Strategy (70% faster pre-push validation)',
      '✅ Security scanning (Gitleaks + ESLint security rules)',
      '✅ TypeScript production protection',
      '✅ Multi-language (Python, Rust, Ruby)',
      '✅ Framework-aware dependency grouping',
      '✅ Lighthouse CI with custom thresholds',
      '✅ Bundle size limits (size-limit)',
      '✅ Coverage threshold enforcement',
      '✅ Pre-launch validation with env vars audit',
      '✅ Email support (24-48h response)',
    ],
  },
})

/**
 * Check if developer/owner mode is enabled
 * Allows the tool creator to use all features without a license
 * Security: Production mode always enforces license checks
 */
function isDeveloperMode() {
  // Security: Production mode never allows developer bypass
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  // Check environment variable
  if (process.env.QAA_DEVELOPER === 'true') {
    return true
  }

  // Check for marker file in license directory
  try {
    const developerMarkerFile = path.join(getLicenseDir(), '.cqa-developer')
    if (fs.existsSync(developerMarkerFile)) {
      return true
    }
  } catch (error) {
    // DR10 fix: Halt on ELOOP in production (security issue)
    if (error?.code === 'ELOOP') {
      const message =
        'Symlink loop detected in license directory - possible security issue'
      if (process.env.NODE_ENV === 'production') {
        throw new Error(message)
      } else {
        console.warn(`⚠️  ${message}`)
      }
    } else if (process.env.DEBUG && error?.code !== 'ENOENT') {
      console.warn(`⚠️  Developer mode check failed: ${error.message}`)
    }
  }

  return false
}

/**
 * Check if user has a valid license file (USER-FACING - NO STRIPE DEPENDENCIES)
 */
function getLicenseInfo() {
  try {
    // Developer/owner bypass - full PRO access without license
    if (isDeveloperMode()) {
      return {
        tier: LICENSE_TIERS.PRO,
        valid: true,
        email: 'developer@localhost',
        isDeveloper: true,
      }
    }

    // Use pure license validator
    const { LicenseValidator } = require('./license-validator')
    const validator = new LicenseValidator()

    const localLicense = validator.getLocalLicense()

    if (!localLicense) {
      return { tier: LICENSE_TIERS.FREE, valid: true }
    }

    const licenseKey = normalizeLicenseKey(
      localLicense.licenseKey || localLicense.key
    )
    if (!licenseKey || !localLicense.email) {
      return {
        tier: LICENSE_TIERS.FREE,
        valid: true,
        error: 'Invalid license format',
      }
    }

    // Check if license is valid
    if (!localLicense.valid) {
      return {
        tier: LICENSE_TIERS.FREE,
        valid: true,
        error:
          'License signature verification failed - license may have been tampered with',
      }
    }

    // Check expiration
    if (localLicense.expires && new Date(localLicense.expires) < new Date()) {
      return {
        tier: LICENSE_TIERS.FREE,
        valid: true,
        error: 'License expired',
      }
    }

    // Validate license key format
    if (!validateLicenseKey(licenseKey, localLicense.tier)) {
      return {
        tier: LICENSE_TIERS.FREE,
        valid: true,
        error: 'Invalid license key',
      }
    }

    // Return license info
    return {
      tier: localLicense.tier || LICENSE_TIERS.FREE,
      valid: true,
      email: localLicense.email,
      expires: localLicense.expires,
      isFounder: localLicense.isFounder || false,
      customerId: localLicense.customerId,
    }
  } catch (error) {
    return {
      tier: LICENSE_TIERS.FREE,
      valid: true,
      error: `License read error: ${error.message}`,
    }
  }
}

/**
 * License key validation with Stripe integration
 * Supports both legacy format and new Stripe-generated keys
 */
function validateLicenseKey(key, tier) {
  const normalizedKey = normalizeLicenseKey(key)
  // TD15 fix: Use shared constant for license key pattern
  if (LICENSE_KEY_PATTERN.test(normalizedKey)) {
    // Stripe-generated key - always valid if properly formatted
    return true
  }

  // Legacy format validation for backward compatibility
  const expectedPrefix = `QAA-${tier.toUpperCase()}-`
  return normalizedKey.startsWith(expectedPrefix) && normalizedKey.length > 20
}

/**
 * Verify license signature using the same algorithm as StripeIntegration
 */
function verifyLicenseSignature(payload, signature) {
  try {
    const publicKey = loadKeyFromEnv(
      process.env.QAA_LICENSE_PUBLIC_KEY,
      process.env.QAA_LICENSE_PUBLIC_KEY_PATH
    )
    if (!publicKey) {
      // TD12 fix: Log warning when public key is missing in non-dev mode
      // Security: Production mode never allows developer bypass
      const isDevMode =
        process.env.NODE_ENV !== 'production' &&
        process.env.QAA_DEVELOPER === 'true'
      if (!isDevMode) {
        console.warn(
          '⚠️  License public key not configured - signature verification skipped'
        )
      }
      return isDevMode
    }
    return verifyPayload(payload, signature, publicKey)
  } catch (error) {
    // TD12 fix: Log verification failures instead of silently returning false
    console.warn(`⚠️  Signature verification failed: ${error.message}`)
    return false
  }
}

/**
 * Check if a specific feature is available for current license
 */
function hasFeature(featureName) {
  const license = getLicenseInfo()
  const tierFeatures = FEATURES[license.tier] || FEATURES[LICENSE_TIERS.FREE]
  return tierFeatures[featureName] || false
}

/**
 * Get the dependency monitoring level for current license
 */
function getDependencyMonitoringLevel() {
  const license = getLicenseInfo()
  const tierFeatures = FEATURES[license.tier] || FEATURES[LICENSE_TIERS.FREE]
  return tierFeatures.dependencyMonitoring
}

/**
 * Get supported languages for current license
 */
function getSupportedLanguages() {
  const license = getLicenseInfo()
  const tierFeatures = FEATURES[license.tier] || FEATURES[LICENSE_TIERS.FREE]
  return tierFeatures.languages
}

/**
 * Display upgrade message for premium features
 */
function showUpgradeMessage(feature) {
  const license = getLicenseInfo()

  console.log(`\n🔒 ${feature} is a premium feature`)
  console.log(`📊 Current license: ${license.tier.toUpperCase()}`)

  if (license.tier === LICENSE_TIERS.FREE) {
    console.log('\n🚀 Upgrade to PRO')
    console.log('')
    console.log('   💰 $49/month  or  $490/year (save $98)')
    console.log('')
    console.log('   ✅ Unlimited repos, LOC, and runs')
    console.log('   ✅ Smart Test Strategy (70% faster pre-push)')
    console.log('   ✅ Security scanning (Gitleaks + ESLint security)')
    console.log('   ✅ TypeScript production protection')
    console.log('   ✅ Multi-language (Python, Rust, Ruby)')
    console.log('   ✅ Framework-aware dependency grouping')
    console.log('   ✅ Email support (24-48h response)')
    console.log('')
    console.log('   🎁 Start 14-day free trial - no credit card required')
    console.log('')
    console.log('🚀 Upgrade: https://buildproven.ai/qa-architect')
    console.log(
      '🔑 Activate: npx create-qa-architect@latest --activate-license'
    )
  }
}

/**
 * Save license information (for testing or license activation)
 */
function saveLicense(tier, key, email, expires = null) {
  try {
    // DR24 fix: Validate tier is a valid LICENSE_TIERS value
    const validTiers = Object.values(LICENSE_TIERS)
    if (!validTiers.includes(tier)) {
      return {
        success: false,
        error: `Invalid tier "${tier}". Must be one of: ${validTiers.join(', ')}`,
      }
    }

    // DR21 fix: Validate email format before hashing
    if (email) {
      const normalizedEmail = require('./license-signing').normalizeEmail(email)
      if (!normalizedEmail) {
        return {
          success: false,
          error: `Invalid email format: "${email}". Must be valid email address (e.g., user@example.com)`,
        }
      }
    }

    const licenseDir = getLicenseDir()
    const licenseFile = getLicenseFile()
    const normalizedKey = normalizeLicenseKey(key)
    const privateKey = loadKeyFromEnv(
      process.env.LICENSE_REGISTRY_PRIVATE_KEY,
      process.env.LICENSE_REGISTRY_PRIVATE_KEY_PATH
    )

    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true, mode: 0o700 })
    }

    if (!privateKey) {
      return {
        success: false,
        error:
          'LICENSE_REGISTRY_PRIVATE_KEY or LICENSE_REGISTRY_PRIVATE_KEY_PATH is required to save a signed license',
      }
    }

    const payload = buildLicensePayload({
      licenseKey: normalizedKey,
      tier,
      isFounder: false,
      emailHash: hashEmail(email),
      issued: new Date().toISOString(),
    })
    const signature = signPayload(payload, privateKey)

    const licenseData = {
      tier,
      licenseKey: normalizedKey,
      email,
      expires,
      activated: new Date().toISOString(),
      payload,
      signature,
    }

    fs.writeFileSync(licenseFile, JSON.stringify(licenseData, null, 2), {
      mode: 0o600,
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Save license information with signature validation data
 */
function saveLicenseWithSignature(tier, key, email, validation) {
  try {
    // DR24 fix: Validate tier is a valid LICENSE_TIERS value
    const validTiers = Object.values(LICENSE_TIERS)
    if (!validTiers.includes(tier)) {
      return {
        success: false,
        error: `Invalid tier "${tier}". Must be one of: ${validTiers.join(', ')}`,
      }
    }

    const licenseDir = getLicenseDir()
    const licenseFile = getLicenseFile()
    const normalizedKey = normalizeLicenseKey(key)

    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true, mode: 0o700 })
    }

    const licenseData = {
      tier,
      licenseKey: normalizedKey, // ✅ Changed from 'key' to 'licenseKey' to match StripeIntegration
      email,
      expires: validation.expires,
      activated: new Date().toISOString(),
      customerId: validation.customerId,
      isFounder: validation.isFounder,
      // Include validation payload and signature for security
      payload: validation.payload, // ✅ Changed from 'validationPayload' to 'payload'
      signature: validation.signature, // ✅ Changed from 'validationSignature' to 'signature'
      issued: validation.issued,
    }

    fs.writeFileSync(licenseFile, JSON.stringify(licenseData, null, 2), {
      mode: 0o600,
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Remove license (for testing)
 */
function removeLicense() {
  try {
    const licenseFile = getLicenseFile()

    if (fs.existsSync(licenseFile)) {
      fs.unlinkSync(licenseFile)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Activate license (USER-FACING - NO STRIPE DEPENDENCIES)
 */
async function activateLicense(licenseKey, email) {
  try {
    // Use pure license validator (no Stripe dependencies)
    const { LicenseValidator } = require('./license-validator')
    const validator = new LicenseValidator()

    // Initialize license directory/database
    validator.initialize()

    // Activate license using local database validation only
    return await validator.activateLicense(licenseKey, email)
  } catch (error) {
    return {
      success: false,
      error: `License activation failed: ${error.message}. Please contact support if the issue persists.`,
    }
  }
}

/**
 * Add a legitimate license key (admin function - uses local database)
 */
async function addLegitimateKey(
  licenseKey,
  customerId,
  tier,
  isFounder = false,
  purchaseEmail = null
) {
  try {
    // DR21 fix: Validate email format before hashing
    if (purchaseEmail) {
      const normalizedEmail =
        require('./license-signing').normalizeEmail(purchaseEmail)
      if (!normalizedEmail) {
        return {
          success: false,
          error: `Invalid email format: "${purchaseEmail}". Must be valid email address (e.g., user@example.com)`,
        }
      }
    }

    const normalizedKey = normalizeLicenseKey(licenseKey)
    // Use the same license directory as the CLI
    const licenseDir =
      process.env.QAA_LICENSE_DIR ||
      path.join(os.homedir(), '.create-qa-architect')
    const legitimateDBFile = path.join(licenseDir, 'legitimate-licenses.json')
    const privateKey = loadKeyFromEnv(
      process.env.LICENSE_REGISTRY_PRIVATE_KEY,
      process.env.LICENSE_REGISTRY_PRIVATE_KEY_PATH
    )

    // Ensure directory exists
    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true })
    }

    // Load existing database
    let database = {}
    if (fs.existsSync(legitimateDBFile)) {
      try {
        database = JSON.parse(fs.readFileSync(legitimateDBFile, 'utf8'))
      } catch (parseError) {
        // DR8 fix: Return error instead of continuing with corrupted database
        const backupPath = `${legitimateDBFile}.corrupted.${Date.now()}`
        let backupSucceeded = false

        try {
          fs.copyFileSync(legitimateDBFile, backupPath)
          backupSucceeded = true
          console.error(
            `⚠️  Database corruption detected. Backed up to ${backupPath}`
          )
        } catch (backupError) {
          console.error(
            `❌ CRITICAL: Could not backup corrupted database: ${backupError.message}`
          )
        }

        // Always return error on corruption - forces investigation
        return {
          success: false,
          error: backupSucceeded
            ? `License database corrupted (backup saved to ${backupPath}). Manual review required before adding keys.`
            : `License database corrupted AND backup failed. Cannot proceed without data loss risk. Parse error: ${parseError.message}`,
        }
      }
    }

    if (!privateKey) {
      return {
        success: false,
        error:
          'LICENSE_REGISTRY_PRIVATE_KEY or LICENSE_REGISTRY_PRIVATE_KEY_PATH is required to add legitimate keys',
      }
    }

    const issued = new Date().toISOString()
    const emailHash = hashEmail(purchaseEmail)
    const payload = buildLicensePayload({
      licenseKey: normalizedKey,
      tier,
      isFounder,
      emailHash,
      issued,
    })
    const signature = signPayload(payload, privateKey)

    const { _metadata: existingMetadata, ...existingLicenses } = database
    const licenses = {
      ...existingLicenses,
      [normalizedKey]: {
        tier,
        isFounder,
        issued,
        emailHash,
        signature,
        keyId: process.env.LICENSE_REGISTRY_KEY_ID || 'default',
      },
    }

    const registrySignature = signPayload(licenses, privateKey)
    const hash = crypto
      .createHash('sha256')
      .update(stableStringify(licenses))
      .digest('hex')
    const metadata = {
      version: '1.0',
      created: existingMetadata?.created || new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      description: 'Legitimate license database - populated by admin/webhook',
      algorithm: 'ed25519',
      keyId: process.env.LICENSE_REGISTRY_KEY_ID || 'default',
      registrySignature,
      hash,
      totalLicenses: Object.keys(licenses).length,
    }
    database = { _metadata: metadata, ...licenses }

    // Save database
    fs.writeFileSync(legitimateDBFile, JSON.stringify(database, null, 2))

    console.log(`✅ Added legitimate license: ${licenseKey}`)
    console.log(`   Customer: ${customerId}`)
    console.log(`   Tier: ${tier}`)
    console.log(`   Founder: ${isFounder ? 'Yes' : 'No'}`)
    if (purchaseEmail) {
      console.log(`   Purchase Email: ${purchaseEmail}`)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Interactive license activation prompt
 * DR27 fix: Converted from callback-based readline to async/await pattern
 */
async function promptLicenseActivation() {
  const readline = require('readline/promises')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    console.log('\n🔑 License Activation')
    console.log(
      'Enter your license key from the purchase confirmation email.\n'
    )

    const licenseKey = await rl.question(
      'License key (QAA-XXXX-XXXX-XXXX-XXXX): '
    )

    if (!licenseKey.trim()) {
      console.log('❌ License key required')
      rl.close()
      return { success: false }
    }

    const email = await rl.question('Email address: ')

    if (!email.trim()) {
      console.log('❌ Email address required')
      rl.close()
      return { success: false }
    }

    rl.close()

    const result = await activateLicense(licenseKey.trim(), email.trim())

    if (!result.success && result.error && result.error.includes('not found')) {
      console.log('\n📞 License activation assistance:')
      console.log(
        '   If you purchased this license, please contact support at:'
      )
      console.log('   Email: support@buildproven.ai')
      console.log(
        '   Include your license key and purchase email for verification.'
      )
    }

    return result
  } catch (error) {
    rl.close()
    return { success: false, error: error.message }
  }
}

/**
 * Enable developer mode by creating the marker file
 */
function enableDeveloperMode() {
  try {
    const licenseDir = getLicenseDir()
    const developerMarkerFile = path.join(licenseDir, '.cqa-developer')

    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true })
    }

    fs.writeFileSync(
      developerMarkerFile,
      `# QAA Developer Mode\n# Created: ${new Date().toISOString()}\n# This file grants full PRO access for development purposes.\n`
    )

    console.log('✅ Developer mode enabled')
    console.log(`   Marker file: ${developerMarkerFile}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Disable developer mode by removing the marker file
 */
function disableDeveloperMode() {
  try {
    const developerMarkerFile = path.join(getLicenseDir(), '.cqa-developer')

    if (fs.existsSync(developerMarkerFile)) {
      fs.unlinkSync(developerMarkerFile)
    }

    console.log('✅ Developer mode disabled')
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// ============================================================================
// FREE TIER CAP ENFORCEMENT
// ============================================================================

/**
 * Get the path to the usage tracking file
 */
function getUsageFile() {
  return path.join(getLicenseDir(), 'usage.json')
}

/**
 * Load current usage data
 */
function loadUsage() {
  try {
    const usageFile = getUsageFile()
    if (fs.existsSync(usageFile)) {
      const data = JSON.parse(fs.readFileSync(usageFile, 'utf8'))

      // Check if we need to reset monthly counters
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      if (data.month !== currentMonth) {
        // New month - reset monthly counters
        return {
          month: currentMonth,
          prePushRuns: 0,
          dependencyPRs: 0,
          repos: data.repos || [],
        }
      }

      return data
    }
  } catch (error) {
    // DR8 fix: Prevent quota bypass through file corruption
    if (error instanceof SyntaxError) {
      const usageFile = getUsageFile()
      console.error(`\n❌ CRITICAL: Usage tracking file is corrupted`)
      console.error(`   File: ${usageFile}`)
      console.error(`   Parse error: ${error.message}\n`)

      // Backup corrupted file for forensics
      const backupPath = `${usageFile}.corrupted.${Date.now()}`
      try {
        fs.copyFileSync(usageFile, backupPath)
        console.log(`   ✅ Backup saved: ${backupPath}`)
      } catch {
        console.error(`   ❌ Could not create backup`)
      }

      const license = getLicenseInfo()

      if (license.tier === LICENSE_TIERS.FREE) {
        console.error(`\n⚠️  FREE TIER CORRUPTION POLICY:`)
        console.error(
          `   To prevent quota bypass, your usage has been reset to maximum.`
        )
        console.error(`   This is a security measure, not a penalty.\n`)
        console.error(`   To restore your usage:`)
        console.error(`   1. Review the backup file: ${backupPath}`)
        console.error(`   2. If data looks correct, manually fix JSON syntax`)
        console.error(`   3. Copy corrected JSON back to: ${usageFile}`)
        console.error(
          `   4. Or delete ${usageFile} to start fresh this month\n`
        )
        console.error(`   If this keeps happening, please report the issue.`)

        // Provide clear recovery path
        console.error(`\n🔧 Quick fix: rm ${usageFile}`)
        console.error(
          `   This will reset your usage to 0 for the current month.\n`
        )

        const caps = FEATURES[LICENSE_TIERS.FREE]
        return {
          month: getCurrentMonth(),
          prePushRuns: caps.maxPrePushRunsPerMonth,
          dependencyPRs: caps.maxDependencyPRsPerMonth,
          repos: Array.from(
            { length: caps.maxPrivateRepos },
            (_item, index) => `corrupted-${index + 1}`
          ),
        }
      }
    } else if (process.env.DEBUG && error?.code !== 'ENOENT') {
      console.warn(`⚠️  Could not read usage file: ${error.message}`)
    }
  }

  // Default usage data
  return getDefaultUsage()
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function getDefaultUsage() {
  return {
    month: getCurrentMonth(),
    prePushRuns: 0,
    dependencyPRs: 0,
    repos: [],
  }
}

/**
 * Save usage data
 */
function saveUsage(usage) {
  try {
    const licenseDir = getLicenseDir()
    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true, mode: 0o700 })
    }
    fs.writeFileSync(getUsageFile(), JSON.stringify(usage, null, 2), {
      mode: 0o600,
    })
    return true
  } catch (error) {
    const license = getLicenseInfo()
    const usageFile = getUsageFile()

    // For FREE tier, this is critical - can't track quota
    if (license.tier === LICENSE_TIERS.FREE) {
      console.error(`\n❌ CRITICAL: Cannot save usage tracking data`)
      console.error(`   File: ${usageFile}`)
      console.error(`   Error: ${error.message} (${error.code})`)
      console.error(`\n   FREE tier quota enforcement requires usage tracking.`)
      console.error(`   Please fix this filesystem issue:\n`)

      if (error.code === 'ENOSPC') {
        console.error(`   • Disk full - free up space`)
      } else if (error.code === 'EACCES') {
        console.error(`   • Permission denied - check directory permissions`)
        console.error(`   • Try: chmod 700 ${getLicenseDir()}`)
      } else if (error.code === 'EROFS') {
        console.error(`   • Filesystem is readonly - remount as read-write`)
      } else {
        console.error(`   • Unexpected error - please report this issue`)
      }

      throw error // Don't allow FREE tier to continue without tracking
    } else {
      // Pro/Team/Enterprise - warn but don't fail
      console.warn(`⚠️  Failed to save usage data: ${error.message}`)
      console.warn(`   This won't affect Pro/Team/Enterprise functionality`)
      return false
    }
  }
}

/**
 * Check if usage is within FREE tier caps
 * Returns { allowed: boolean, reason?: string, usage: object, caps: object }
 */
function checkUsageCaps(operation = 'general') {
  const license = getLicenseInfo()

  // Non-FREE tiers have no caps
  if (license.tier !== LICENSE_TIERS.FREE) {
    return { allowed: true, usage: {}, caps: {} }
  }

  const caps = FEATURES[LICENSE_TIERS.FREE]
  const usage = loadUsage()

  const result = {
    allowed: true,
    usage: {
      prePushRuns: usage.prePushRuns,
      dependencyPRs: usage.dependencyPRs,
      repos: usage.repos || [],
      repoCount: (usage.repos || []).length,
    },
    caps: {
      maxPrePushRunsPerMonth: caps.maxPrePushRunsPerMonth,
      maxDependencyPRsPerMonth: caps.maxDependencyPRsPerMonth,
      maxPrivateRepos: caps.maxPrivateRepos,
    },
  }

  // Check specific cap based on operation
  if (operation === 'pre-push') {
    if (usage.prePushRuns >= caps.maxPrePushRunsPerMonth) {
      result.allowed = false
      result.reason = `FREE tier limit reached: ${usage.prePushRuns}/${caps.maxPrePushRunsPerMonth} pre-push runs this month`
    }
  } else if (operation === 'dependency-pr') {
    if (usage.dependencyPRs >= caps.maxDependencyPRsPerMonth) {
      result.allowed = false
      result.reason = `FREE tier limit reached: ${usage.dependencyPRs}/${caps.maxDependencyPRsPerMonth} dependency PRs this month`
    }
  } else if (operation === 'repo') {
    if (usage.repos.length >= caps.maxPrivateRepos) {
      result.allowed = false
      result.reason = `FREE tier limit reached: ${usage.repos.length}/${caps.maxPrivateRepos} private repos`
    }
  }

  return result
}

/**
 * Increment usage counter for an operation
 */
function incrementUsage(operation, amount = 1, repoId = null) {
  const license = getLicenseInfo()

  // Non-FREE tiers don't track usage
  if (license.tier !== LICENSE_TIERS.FREE) {
    return { success: true }
  }

  const usage = loadUsage()

  if (operation === 'pre-push') {
    usage.prePushRuns += amount
  } else if (operation === 'dependency-pr') {
    usage.dependencyPRs += amount
  } else if (operation === 'repo' && repoId) {
    if (!usage.repos.includes(repoId)) {
      usage.repos.push(repoId)
    }
  }

  saveUsage(usage)
  return { success: true, usage }
}

/**
 * Get usage summary for display
 */
function getUsageSummary() {
  const license = getLicenseInfo()
  const usage = loadUsage()
  const caps = FEATURES[LICENSE_TIERS.FREE]

  if (license.tier !== LICENSE_TIERS.FREE) {
    return {
      tier: license.tier,
      unlimited: true,
    }
  }

  return {
    tier: license.tier,
    unlimited: false,
    month: usage.month,
    prePushRuns: {
      used: usage.prePushRuns,
      limit: caps.maxPrePushRunsPerMonth,
      remaining: Math.max(0, caps.maxPrePushRunsPerMonth - usage.prePushRuns),
    },
    dependencyPRs: {
      used: usage.dependencyPRs,
      limit: caps.maxDependencyPRsPerMonth,
      remaining: Math.max(
        0,
        caps.maxDependencyPRsPerMonth - usage.dependencyPRs
      ),
    },
    repos: {
      used: usage.repos.length,
      limit: caps.maxPrivateRepos,
      remaining: Math.max(0, caps.maxPrivateRepos - usage.repos.length),
    },
  }
}

/**
 * Display current license status
 */
function showLicenseStatus() {
  const license = getLicenseInfo()

  console.log('\n📋 License Status:')
  if (license.isDeveloper) {
    console.log('   Mode: 🛠️  DEVELOPER (full PRO access)')
  }
  console.log(`   Tier: ${license.tier.toUpperCase()}`)

  if (license.email) {
    console.log(`   Email: ${license.email}`)
  }

  if (license.expires) {
    console.log(`   Expires: ${license.expires}`)
  }

  if (license.error) {
    console.log(`   ⚠️  Issue: ${license.error}`)
  }

  console.log('\n🎯 Available Features:')
  const features = FEATURES[license.tier] || FEATURES[LICENSE_TIERS.FREE]

  // Show caps and current usage for FREE tier
  if (license.tier === LICENSE_TIERS.FREE) {
    const usage = getUsageSummary()
    console.log('\n📊 Usage This Month:')
    console.log(
      `   Pre-push Runs: ${usage.prePushRuns.used}/${usage.prePushRuns.limit} (${usage.prePushRuns.remaining} remaining)`
    )
    console.log(
      `   Dependency PRs: ${usage.dependencyPRs.used}/${usage.dependencyPRs.limit} (${usage.dependencyPRs.remaining} remaining)`
    )
    console.log(`   Private Repos: ${usage.repos.used}/${usage.repos.limit}`)
  } else {
    console.log(`   Repos/Runs: Unlimited`)
  }

  console.log(`   Dependency Monitoring: ${features.dependencyMonitoring}`)
  console.log(`   Languages: ${features.languages.join(', ')}`)
  console.log(
    `   Security Scanning: ${features.securityScanning ? '✅' : '❌'}`
  )
  console.log(
    `   Smart Test Strategy: ${features.smartTestStrategy ? '✅' : '❌'}`
  )
  console.log(
    `   Framework Grouping: ${features.frameworkGrouping ? '✅' : '❌'}`
  )
  console.log(
    `   Advanced Workflows: ${features.advancedWorkflows ? '✅' : '❌'}`
  )

  if (features.roadmap && features.roadmap.length) {
    console.log('\n📦 Your Plan Features:')
    features.roadmap.forEach(item => console.log(`   ${item}`))
  }

  // Show upgrade path
  if (license.tier === LICENSE_TIERS.FREE) {
    console.log('\n💡 Upgrade to PRO for unlimited access + security scanning')
    console.log('   → https://buildproven.ai/qa-architect')
  }
}

module.exports = {
  LICENSE_TIERS,
  FEATURES,
  getLicenseInfo,
  hasFeature,
  getDependencyMonitoringLevel,
  getSupportedLanguages,
  showUpgradeMessage,
  saveLicense,
  saveLicenseWithSignature,
  removeLicense,
  showLicenseStatus,
  activateLicense,
  promptLicenseActivation,
  verifyLicenseSignature,
  LicenseValidator: require('./license-validator').LicenseValidator,
  addLegitimateKey,
  // Developer mode functions
  isDeveloperMode,
  enableDeveloperMode,
  disableDeveloperMode,
  // Usage tracking and cap enforcement (FREE tier)
  checkUsageCaps,
  incrementUsage,
  getUsageSummary,
}
