/**
 * License Validator (user-side)
 *
 * - No Stripe dependencies (secrets stay server-side)
 * - Fetches a signed license registry from a configurable HTTPS endpoint
 * - Caches locally for offline use with graceful fallback
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const {
  LICENSE_KEY_PATTERN,
  buildLicensePayload,
  hashEmail,
  verifyPayload,
  stableStringify,
  loadKeyFromEnv,
} = require('./license-signing')

/**
 * TD10 fix: Timing-safe string comparison to prevent timing attacks
 * on hash/signature verification.
 *
 * Security enhancement: Uses constant-time operations for length check
 * to avoid leaking length information through timing side-channels.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  // Use constant-time length comparison to avoid timing leaks
  const maxLen = Math.max(a.length, b.length, 1)
  const bufA = Buffer.alloc(maxLen, 0)
  const bufB = Buffer.alloc(maxLen, 0)

  // Write actual values - this is constant time regardless of length
  Buffer.from(a, 'utf8').copy(bufA)
  Buffer.from(b, 'utf8').copy(bufB)

  // Both comparisons happen regardless of results (no early return)
  const lengthsMatch = a.length === b.length
  const contentsMatch = crypto.timingSafeEqual(bufA, bufB)

  return lengthsMatch && contentsMatch
}

/**
 * Validate that a license directory path is safe (no path traversal)
 * Security: Prevents attackers from using QAA_LICENSE_DIR to access arbitrary paths
 */
function validateLicenseDir(dirPath) {
  const resolved = path.resolve(dirPath)
  const home = os.homedir()
  const tmp = os.tmpdir()

  // Must be within home directory or temp directory (for tests)
  const isInHome = resolved.startsWith(home + path.sep) || resolved === home
  const isInTmp = resolved.startsWith(tmp + path.sep) || resolved === tmp

  if (!isInHome && !isInTmp) {
    console.warn(
      `⚠️  QAA_LICENSE_DIR must be within home or temp directory, ignoring: ${dirPath}`
    )
    return path.join(home, '.create-qa-architect')
  }

  return resolved
}

class LicenseValidator {
  constructor() {
    // Support environment variable override for testing (like telemetry/error-reporter)
    // Security: Validate path to prevent traversal attacks
    const requestedDir =
      process.env.QAA_LICENSE_DIR ||
      path.join(os.homedir(), '.create-qa-architect')
    this.licenseDir = validateLicenseDir(requestedDir)
    this.licenseFile = path.join(this.licenseDir, 'license.json')
    this.legitimateDBFile = path.join(
      this.licenseDir,
      'legitimate-licenses.json'
    )

    // Allow enterprises to host their own registry
    this.licenseDbUrl =
      process.env.QAA_LICENSE_DB_URL ||
      'https://buildproven.ai/api/licenses/qa-architect.json'

    this.licensePublicKey = loadKeyFromEnv(
      process.env.QAA_LICENSE_PUBLIC_KEY,
      process.env.QAA_LICENSE_PUBLIC_KEY_PATH
    )

    // DR14 fix: Add in-memory cache with 5-minute TTL
    this.dbCache = null
    this.dbCacheTime = 0
    this.cacheTTL = 5 * 60 * 1000 // 5 minutes
  }

  normalizeLicenseKey(key) {
    if (typeof key !== 'string') return ''
    return key.trim().toUpperCase()
  }

  ensureLicenseDir() {
    if (!fs.existsSync(this.licenseDir)) {
      fs.mkdirSync(this.licenseDir, { recursive: true })
    }
  }

  /**
   * Initialize license directory and database if needed
   */
  initialize() {
    try {
      this.ensureLicenseDir()

      // Initialize legitimate license database if it doesn't exist
      if (!fs.existsSync(this.legitimateDBFile)) {
        const initialDB = {
          _metadata: {
            version: '1.0',
            created: new Date().toISOString(),
            description:
              'Legitimate license database - populated by webhook/admin',
          },
        }
        fs.writeFileSync(
          this.legitimateDBFile,
          JSON.stringify(initialDB, null, 2)
        )
      }

      return true
    } catch (error) {
      console.error('Failed to initialize license directory:', error.message)
      return false
    }
  }

  /**
   * Load legitimate licenses from the cached database
   */
  loadLegitimateDatabase() {
    // File doesn't exist - expected for first run
    if (!fs.existsSync(this.legitimateDBFile)) {
      return {}
    }

    try {
      const data = fs.readFileSync(this.legitimateDBFile, 'utf8')
      const parsed = JSON.parse(data)

      try {
        this.verifyRegistrySignature(parsed)
      } catch (error) {
        console.warn(`⚠️  Cached license database invalid: ${error.message}`)
        return {}
      }

      // Remove metadata for license lookup (destructure to exclude it)
      const { _metadata: _unused, ...licenses } = parsed
      void _unused
      return licenses
    } catch (error) {
      // Silent failure fix: Differentiate error types for actionable messages
      if (error.code === 'EACCES') {
        console.error(
          `❌ Permission denied reading license database: ${this.legitimateDBFile}`
        )
      } else if (error instanceof SyntaxError) {
        console.error(
          `❌ License database is corrupted (invalid JSON): ${error.message}`
        )
      } else {
        console.error(
          'Error loading legitimate license database:',
          error.message
        )
      }
      return {}
    }
  }

  /**
   * Compute SHA256 hash for integrity checks
   */
  computeSha256(json) {
    return crypto.createHash('sha256').update(json).digest('hex')
  }

  /**
   * Fetch latest legitimate licenses from server (if available)
   */
  async fetchLegitimateDatabase() {
    // DR14 fix: Check in-memory cache first (5-min TTL)
    const now = Date.now()
    if (this.dbCache && now - this.dbCacheTime < this.cacheTTL) {
      console.log('✅ Using cached license database (fresh)')
      return this.dbCache
    }

    try {
      this.ensureLicenseDir()
      console.log(
        `🔄 Fetching latest license database from ${this.licenseDbUrl} ...`
      )

      const parsedUrl = new URL(this.licenseDbUrl)
      const isTest = process.argv.join(' ').includes('test')
      if (
        parsedUrl.protocol !== 'https:' &&
        !process.env.QAA_ALLOW_INSECURE_LICENSE_DB &&
        !isTest
      ) {
        throw new Error(
          'license database URL must use HTTPS (set QAA_ALLOW_INSECURE_LICENSE_DB=1 to override)'
        )
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(this.licenseDbUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'create-qa-architect-cli' },
      })
      clearTimeout(timeout)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const database = await response.json()

      if (!database || typeof database !== 'object' || !database._metadata) {
        throw new Error('invalid database format')
      }

      this.verifyRegistrySignature(database)

      // Cache locally for offline use
      fs.writeFileSync(this.legitimateDBFile, JSON.stringify(database, null, 2))
      console.log('✅ License database updated and cached')

      // Remove metadata for license lookup (destructure to exclude it)
      const { _metadata: _unused2, ...licenses } = database
      void _unused2

      // DR14 fix: Update in-memory cache
      this.dbCache = licenses
      this.dbCacheTime = Date.now()

      return licenses
    } catch (error) {
      const isTest = process.argv.join(' ').includes('test')
      const prefix = isTest ? '📋 TEST SCENARIO:' : '⚠️'
      console.log(`${prefix} Database fetch failed: ${error.message}`)

      // DR2 fix: Check if cached database has data before falling back
      const cachedDb = this.loadLegitimateDatabase()
      const hasCachedData = Object.keys(cachedDb || {}).length > 0

      if (!hasCachedData) {
        console.error('❌ No cached license database available')
        console.error(
          '   You need an internet connection to activate new licenses'
        )
        console.error('   If you recently purchased, please retry when online')
        throw new Error(
          'Cannot validate license: network unavailable and no cached database. Please connect to the internet and retry.'
        )
      }

      // Only fall back to cache if it has data
      console.log(
        `✅ Using cached database (${Object.keys(cachedDb).length} licenses)`
      )
      console.log(
        '   Note: Cache may be outdated. Connect to internet for latest licenses.'
      )
      return cachedDb
    }
  }

  /**
   * Validate license key (fetches latest database, then validates locally)
   */
  async validateLicense(licenseKey, userEmail) {
    try {
      const normalizedKey = this.normalizeLicenseKey(licenseKey)
      // Check if already activated locally
      const localLicense = this.getLocalLicense()
      if (
        localLicense &&
        localLicense.licenseKey === normalizedKey &&
        localLicense.valid
      ) {
        return {
          valid: true,
          tier: localLicense.tier,
          isFounder: localLicense.isFounder || false,
          email: localLicense.email,
          source: 'local_file',
        }
      }

      // Fetch latest legitimate database from server
      const legitimateDB = await this.fetchLegitimateDatabase()

      // If database is empty (no licenses), fail with actionable message
      const licenseInfo = legitimateDB[normalizedKey]
      const hasLicenses = Object.keys(legitimateDB || {}).length > 0

      if (!hasLicenses) {
        return {
          valid: false,
          error:
            'License registry is empty. Please connect to the internet and retry, or ask support to populate your license.',
        }
      }

      if (!licenseInfo) {
        return {
          valid: false,
          error:
            'License key not found. Verify the key and email, or contact support if this was a purchase.',
        }
      }

      // DR21 fix: Validate email format before hashing to prevent timing attacks on invalid emails
      if (userEmail && !userEmail.includes('@')) {
        return {
          valid: false,
          error: 'Invalid email format. Please provide a valid email address.',
        }
      }

      // Verify email matches (if specified in database)
      // TD10 fix: Use timing-safe comparison to prevent timing attacks
      const emailHash = hashEmail(userEmail)
      if (
        emailHash &&
        licenseInfo.emailHash &&
        !timingSafeEqual(licenseInfo.emailHash, emailHash)
      ) {
        return {
          valid: false,
          error:
            'Email address does not match the license registration. Please use the email associated with your purchase.',
        }
      }

      const payload = buildLicensePayload({
        licenseKey: normalizedKey,
        tier: licenseInfo.tier,
        isFounder: licenseInfo.isFounder,
        emailHash: licenseInfo.emailHash,
        issued: licenseInfo.issued,
      })

      if (!licenseInfo.signature) {
        return {
          valid: false,
          error: 'License entry missing signature. Please contact support.',
        }
      }

      if (!this.verifySignature(payload, licenseInfo.signature)) {
        return {
          valid: false,
          error:
            'License entry signature verification failed. Please contact support.',
        }
      }

      // License is valid
      console.log(
        `✅ License validated: ${licenseInfo.tier} ${licenseInfo.isFounder ? '(Founder)' : ''}`
      )

      return {
        valid: true,
        tier: licenseInfo.tier,
        isFounder: licenseInfo.isFounder || false,
        customerId: licenseInfo.customerId,
        email: userEmail,
        signature: licenseInfo.signature,
        payload,
        source: 'legitimate_database',
      }
    } catch (error) {
      console.error('License validation error:', error.message)
      return {
        valid: false,
        error:
          'License validation failed due to an internal error. Please try again or contact support.',
      }
    }
  }

  /**
   * Get local license file if it exists
   */
  getLocalLicense() {
    if (!fs.existsSync(this.licenseFile)) {
      return null
    }

    try {
      const content = fs.readFileSync(this.licenseFile, 'utf8')
      const license = JSON.parse(content)
      const normalizedKey = this.normalizeLicenseKey(
        license.licenseKey || license.key
      )

      if (license.payload && license.signature) {
        const isValid = this.verifySignature(license.payload, license.signature)
        return {
          ...license,
          licenseKey: normalizedKey,
          valid: isValid,
        }
      }

      // Legacy format (unsigned) is no longer trusted
      return {
        ...license,
        licenseKey: normalizedKey,
        valid: false,
        tier: license.tier,
        email: license.email,
      }
    } catch (error) {
      // DR3 fix: Handle corrupted license files gracefully
      if (error instanceof SyntaxError) {
        console.error('❌ License file is corrupted (invalid JSON)')
        console.error(`   File: ${this.licenseFile}`)
        console.error('   Please re-activate your license:')
        console.error('   npx create-qa-architect@latest --activate-license')

        // Backup corrupted file
        const backupPath = `${this.licenseFile}.corrupted.${Date.now()}`
        try {
          fs.copyFileSync(this.licenseFile, backupPath)
          console.error(`   Corrupted file backed up to: ${backupPath}`)
        } catch {
          // Ignore backup failures
        }

        return null
      }

      console.error(`❌ Error reading license file: ${error.message}`)
      return null
    }
  }

  /**
   * Save license locally after successful validation
   */
  saveLicense(licenseData) {
    try {
      this.initialize()

      const licenseRecord = {
        licenseKey: licenseData.licenseKey,
        tier: licenseData.tier,
        isFounder: licenseData.isFounder,
        email: licenseData.email,
        activated: new Date().toISOString(),
        payload: licenseData.payload,
        signature: licenseData.signature,
        source: licenseData.source || 'legitimate_database',
        verifiedAt: new Date().toISOString(),
      }

      if (!licenseRecord.payload || !licenseRecord.signature) {
        return {
          success: false,
          error:
            'Missing license signature payload. Please re-activate online.',
        }
      }

      fs.writeFileSync(this.licenseFile, JSON.stringify(licenseRecord, null, 2))

      console.log('✅ License activated successfully!')
      console.log(`📋 Tier: ${licenseData.tier}`)
      console.log(`🎁 Founder: ${licenseData.isFounder ? 'Yes' : 'No'}`)
      console.log(`📧 Email: ${licenseData.email}`)

      return { success: true }
    } catch (error) {
      console.error('Failed to save license:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * Check if developer mode bypass is allowed.
   * Security: In production mode, never allow developer bypass to prevent
   * accidental security misconfiguration.
   */
  isDevBypassAllowed() {
    // Production mode always enforces signature verification
    if (process.env.NODE_ENV === 'production') {
      return false
    }
    return process.env.QAA_DEVELOPER === 'true'
  }

  verifySignature(payload, signature) {
    if (!this.licensePublicKey) {
      // TD12 fix: Log warning when public key is missing in non-dev mode
      if (!this.isDevBypassAllowed()) {
        console.warn(
          '⚠️  License public key not configured - signature verification skipped'
        )
      }
      return this.isDevBypassAllowed()
    }
    try {
      return verifyPayload(payload, signature, this.licensePublicKey)
    } catch (error) {
      // DR16 fix: Provide specific error types for better debugging
      const msg = error.message?.toLowerCase() || ''

      if (msg.includes('circular reference')) {
        console.error(
          '❌ Signature verification failed: License payload has circular reference'
        )
        console.error(
          '   This indicates data corruption. Please contact support.'
        )
      } else if (msg.includes('key') || msg.includes('pem')) {
        console.error(
          '❌ Signature verification failed: Invalid public key format'
        )
        console.error(
          '   Check QAA_LICENSE_PUBLIC_KEY or QAA_LICENSE_PUBLIC_KEY_PATH'
        )
      } else if (msg.includes('signature') && msg.includes('invalid')) {
        console.error(
          '❌ Signature verification failed: Corrupted signature data'
        )
        console.error(
          '   License may have been tampered with. Please re-activate.'
        )
      } else if (msg.includes('algorithm')) {
        console.error('❌ Signature verification failed: Algorithm mismatch')
        console.error(
          '   License was signed with different algorithm than expected.'
        )
      } else {
        console.warn(`⚠️  Signature verification failed: ${error.message}`)
        console.warn(
          '   If this persists, please contact support with this error message.'
        )
      }
      return false
    }
  }

  verifyRegistrySignature(database) {
    // DR17 fix: Dev mode should still verify signatures if present, only bypass when missing
    const isDevMode = this.isDevBypassAllowed()
    const signature = database?._metadata?.registrySignature

    // Missing signature handling
    if (!signature) {
      if (isDevMode) {
        console.warn(
          '⚠️  DEV MODE: License database signature missing (bypassed)'
        )
        return true
      }
      throw new Error('license database missing registry signature')
    }

    // Missing public key handling
    if (!this.licensePublicKey) {
      if (isDevMode) {
        console.warn(
          '⚠️  DEV MODE: License public key not configured (bypassed)'
        )
        return true
      }
      throw new Error('license public key not configured')
    }

    // Always verify signature if both signature and key are present (destructure to exclude metadata)
    const { _metadata: _unused3, ...licenses } = database
    void _unused3
    const isValid = verifyPayload(licenses, signature, this.licensePublicKey)
    if (!isValid) {
      throw new Error('license database signature verification failed')
    }

    // TD10 fix: Use timing-safe comparison for hash verification
    const expectedHash = database?._metadata?.hash
    if (expectedHash) {
      const computed = this.computeSha256(stableStringify(licenses))
      if (!timingSafeEqual(computed, expectedHash)) {
        throw new Error('license database hash mismatch')
      }
    }
    return true
  }

  /**
   * Activate license (main user entry point)
   */
  async activateLicense(licenseKey, userEmail) {
    try {
      const normalizedKey = this.normalizeLicenseKey(licenseKey)
      // Validate license key format (TD15 fix: use shared constant)
      if (!LICENSE_KEY_PATTERN.test(normalizedKey)) {
        return {
          success: false,
          error:
            'Invalid license key format. Expected format: QAA-XXXX-XXXX-XXXX-XXXX',
        }
      }

      // Validate email format
      if (!userEmail || !userEmail.includes('@')) {
        return {
          success: false,
          error: 'Valid email address required for license activation',
        }
      }

      console.log('🔍 Validating license key...')

      // Validate against database
      const validation = await this.validateLicense(licenseKey, userEmail)

      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || 'License validation failed',
        }
      }

      // Save locally
      const saveResult = this.saveLicense({
        licenseKey: normalizedKey,
        tier: validation.tier,
        isFounder: validation.isFounder,
        email: userEmail,
        customerId: validation.customerId,
        source: validation.source,
        payload: validation.payload,
        signature: validation.signature,
      })

      if (saveResult.success) {
        return {
          success: true,
          tier: validation.tier,
          isFounder: validation.isFounder,
        }
      } else {
        return {
          success: false,
          error: 'License validation succeeded but failed to save locally',
        }
      }
    } catch (error) {
      console.error('License activation failed:', error.message)
      return {
        success: false,
        error: `License activation failed: ${error.message}`,
      }
    }
  }

  /**
   * Remove license (for testing)
   */
  removeLicense() {
    try {
      if (fs.existsSync(this.licenseFile)) {
        fs.unlinkSync(this.licenseFile)
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}

module.exports = { LicenseValidator }
