#!/usr/bin/env node

/**
 * Admin script for manually issuing license keys.
 *
 * Manual-fallback only. The primary path is the Polar.sh webhook
 * (webhook-handler.js), which auto-issues keys on subscription.created.
 *
 * Use this tool when:
 *   - Issuing a complimentary license outside the normal purchase flow
 *   - Recovering from a webhook failure where the key wasn't auto-issued
 *   - Granting founder/team/comp licenses for support cases
 *
 * For automatic license issuance on purchase, see docs/POLAR-DEPLOYMENT.md.
 */

const { addLegitimateKey } = require('./lib/licensing')
const { LICENSE_KEY_PATTERN } = require('./lib/license-signing')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 3) {
    console.log(
      'Usage: node admin-license.js <license-key> <customer-id> <tier> [founder] [email]'
    )
    console.log('')
    console.log('Examples:')
    console.log(
      '  node admin-license.js QAA-1234-ABCD-5678-EF90 <customer-id> PRO'
    )
    console.log('')
    console.log('Arguments:')
    console.log('  license-key   The QAA license key to add')
    console.log('  customer-id   Polar customer ID (or any unique identifier)')
    console.log('  tier         PRO')
    console.log('  founder      true/false (optional, default false)')
    console.log('  email        Purchase email (optional, for verification)')
    console.log('')
    console.log('Note:')
    console.log('  For automatic license population, use webhook-handler.js')
    console.log('  This tool is for manual license additions only')
    console.log('')
    process.exit(1)
  }

  // Note: This tool adds licenses directly to the database
  // For automatic Polar.sh integration, use webhook-handler.js instead

  const [licenseKey, customerId, tier, founder, email] = args
  const isFounder = founder === 'true'

  console.log('🔧 Adding legitimate license to database...')
  console.log(`   License Key: ${licenseKey}`)
  console.log(`   Customer ID: ${customerId}`)
  console.log(`   Tier: ${tier}`)
  console.log(`   Founder: ${isFounder ? 'Yes' : 'No'}`)
  if (email) {
    console.log(`   Purchase Email: ${email}`)
  }
  console.log('')

  // Validate tier
  if (tier !== 'PRO') {
    console.error('❌ Error: Tier must be PRO')
    process.exit(1)
  }

  // Validate license key format (TD15 fix: use shared constant)
  if (!LICENSE_KEY_PATTERN.test(licenseKey)) {
    console.error(
      '❌ Error: Invalid license key format. Must be QAA-XXXX-XXXX-XXXX-XXXX (alphanumeric)'
    )
    process.exit(1)
  }

  try {
    const result = await addLegitimateKey(
      licenseKey,
      customerId,
      tier,
      isFounder,
      email
    )

    if (result.success) {
      // Recompute integrity hash for the local database
      const licenseDir = path.join(os.homedir(), '.create-qa-architect')
      const legitimateDBFile = path.resolve(
        licenseDir,
        'legitimate-licenses.json'
      )
      if (fs.existsSync(legitimateDBFile)) {
        const database = JSON.parse(fs.readFileSync(legitimateDBFile, 'utf8'))
        const { _metadata, ...licenses } = database
        const sha = crypto
          .createHash('sha256')
          .update(JSON.stringify(licenses))
          .digest('hex')
        database._metadata = {
          ...(_metadata || {}),
          sha256: sha,
          lastSave: new Date().toISOString(),
        }
        fs.writeFileSync(legitimateDBFile, JSON.stringify(database, null, 2))
      }

      console.log('')
      console.log('🎉 License added successfully!')
      console.log(
        '   Users can now activate this license with their purchase email.'
      )
      console.log('')
      console.log('📋 What happens next:')
      console.log('   1. License is stored in legitimate license database')
      console.log(
        '   2. Users run: npx create-qa-architect@latest --activate-license'
      )
      console.log('   3. Users enter license key and purchase email')
      console.log(
        '   4. Validation happens against the signed registry (no payment provider secrets needed)'
      )
      console.log('')
    } else {
      console.error(`❌ Failed to add license: ${result.error}`)
      process.exit(1)
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`)
    process.exit(1)
  }
}

main().catch(error => {
  console.error(`❌ Unexpected error: ${error.message}`)
  process.exit(1)
})
