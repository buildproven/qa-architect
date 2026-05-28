/**
 * Pre-launch validation setup command handler
 */

'use strict'

const {
  getLicenseInfo,
  hasFeature,
  showUpgradeMessage,
  ensureLicenseFresh,
} = require('../licensing')

/**
 * Handle pre-launch validation setup command
 * @param {Object} options - Configuration options
 * @param {Function} options.checkNodeVersionAndLoadPackageJson - Function to check Node version and load PackageJson
 * @param {Function} options.writeValidationScripts - Function to write validation scripts
 * @param {Function} options.writePa11yConfig - Function to write pa11y config
 * @param {Function} options.writeEnvValidator - Function to write env validator
 * @param {Function} options.getPrelaunchScripts - Function to get prelaunch scripts
 * @param {Function} options.getPrelaunchDependencies - Function to get prelaunch dependencies
 * @returns {Promise<void>}
 */
async function handlePrelaunchSetup(options) {
  const {
    checkNodeVersionAndLoadPackageJson,
    writeValidationScripts,
    writePa11yConfig,
    writeEnvValidator,
    getPrelaunchScripts,
    getPrelaunchDependencies,
  } = options

  try {
    const projectPath = process.cwd()
    const PackageJson = checkNodeVersionAndLoadPackageJson()
    const pkgJson = await PackageJson.load(projectPath)
    // Re-check the signed registry before unlocking Pro pre-launch features so
    // a revoked/cancelled subscription stops unlocking them (fails open offline).
    await ensureLicenseFresh()
    const license = getLicenseInfo()
    const isPro = license.tier === 'PRO'

    console.log('\n📋 Setting up pre-launch validation suite...\n')
    console.log(`   License tier: ${license.tier.toUpperCase()}`)

    if (!hasFeature('prelaunchValidation')) {
      console.error('❌ Pre-launch validation requires a valid license.')
      showUpgradeMessage('Pre-launch validation')
      process.exit(1)
    }

    const scriptsWritten = writeValidationScripts(projectPath)
    console.log(`   ✅ Created ${scriptsWritten.length} validation scripts`)

    writePa11yConfig(projectPath)
    console.log('   ✅ Created .pa11yci config')

    if (isPro && hasFeature('envValidation')) {
      writeEnvValidator(projectPath)
      console.log('   ✅ Created env vars validator (Pro)')
    }

    const prelaunchScripts = getPrelaunchScripts(isPro)
    const prelaunchDeps = getPrelaunchDependencies(isPro)

    const existingScripts = pkgJson.content.scripts || {}
    pkgJson.update({
      scripts: { ...existingScripts, ...prelaunchScripts },
    })

    const existingDevDeps = pkgJson.content.devDependencies || {}
    pkgJson.update({
      devDependencies: { ...existingDevDeps, ...prelaunchDeps },
    })

    await pkgJson.save()

    console.log('\n✅ Pre-launch validation setup complete!\n')
    console.log('Available scripts:')
    console.log('  npm run validate:sitemap   - Check sitemap.xml')
    console.log('  npm run validate:robots    - Check robots.txt')
    console.log('  npm run validate:meta      - Check meta tags')
    console.log('  npm run validate:links     - Check for broken links')
    console.log('  npm run validate:a11y      - Run accessibility audit')
    console.log('  npm run validate:docs      - Check documentation')
    if (isPro) {
      console.log('  npm run validate:env       - Audit env vars (Pro)')
    }
    console.log('  npm run validate:prelaunch - Run all checks')
    console.log('\n💡 Run: npm install && npm run validate:prelaunch')

    process.exit(0)
  } catch (error) {
    console.error('Pre-launch validation setup error:', error.message)
    process.exit(1)
  }
}

module.exports = { handlePrelaunchSetup }
