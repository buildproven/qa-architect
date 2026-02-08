/**
 * License command handlers
 * Handles license status and activation commands
 */

'use strict'

const { showLicenseStatus } = require('../licensing')

/**
 * Handle license status command
 * @returns {void}
 */
function handleLicenseStatus() {
  showLicenseStatus()
  process.exit(0)
}

/**
 * Handle license activation command
 * @returns {Promise<void>}
 */
async function handleLicenseActivation() {
  const { promptLicenseActivation } = require('../licensing')

  console.log('🔑 Create Quality Automation - License Activation')
  console.log('════════════════════════════════════════════════')

  try {
    const result = await promptLicenseActivation()

    if (result.success) {
      console.log('\n🎉 Success! Premium features are now available.')
      console.log('\nNext steps:')
      console.log('• Run: npx create-qa-architect@latest --deps')
      console.log('• Enable framework-aware dependency grouping')
      console.log('• Enjoy 60%+ reduction in dependency PRs!')
    } else {
      console.log('\n❌ License activation failed.')
      console.log('• Check your license key format (QAA-XXXX-XXXX-XXXX-XXXX)')
      console.log('• Verify your email address')
      console.log('• Contact support: support@buildproven.ai')
    }
  } catch (error) {
    console.error('\n❌ License activation error:', error.message)
    console.log('Contact support for assistance: support@buildproven.ai')
  }

  process.exit(0)
}

module.exports = {
  handleLicenseStatus,
  handleLicenseActivation,
}
