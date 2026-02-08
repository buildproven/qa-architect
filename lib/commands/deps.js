/**
 * Dependency monitoring command handler
 *
 * Extracted from setup.js to improve maintainability.
 * Handles --deps, --dependency-monitoring commands.
 */

const fs = require('fs')
const path = require('path')

const {
  hasNpmProject,
  generateBasicDependabotConfig,
  writeBasicDependabotConfig,
} = require('../dependency-monitoring-basic')

const {
  generatePremiumDependabotConfig,
  writePremiumDependabotConfig,
} = require('../dependency-monitoring-premium')

const {
  getLicenseInfo,
  showUpgradeMessage,
  checkUsageCaps,
  incrementUsage,
} = require('../licensing')

/**
 * Detect Python project
 * @param {string} projectPath - Path to project
 * @returns {boolean} True if Python project detected
 */
function detectPythonProject(projectPath) {
  const pythonFiles = [
    'pyproject.toml',
    'requirements.txt',
    'setup.py',
    'Pipfile',
  ]
  return pythonFiles.some(file => fs.existsSync(path.join(projectPath, file)))
}

/**
 * Detect Rust project
 * @param {string} projectPath - Path to project
 * @returns {boolean} True if Rust project detected
 */
function detectRustProject(projectPath) {
  return fs.existsSync(path.join(projectPath, 'Cargo.toml'))
}

/**
 * Detect Ruby project
 * @param {string} projectPath - Path to project
 * @returns {boolean} True if Ruby project detected
 */
function detectRubyProject(projectPath) {
  return fs.existsSync(path.join(projectPath, 'Gemfile'))
}

/**
 * Handle dependency monitoring command (Free/Pro/Team/Enterprise)
 */
async function handleDependencyMonitoring() {
  const projectPath = process.cwd()
  const license = getLicenseInfo()

  // Detect all supported ecosystems (npm, Python, Ruby, Rust, etc.)
  const hasNpm = hasNpmProject(projectPath)
  const hasPython = detectPythonProject(projectPath)
  const hasRust = detectRustProject(projectPath)
  const hasRuby = detectRubyProject(projectPath)

  if (!hasNpm && !hasPython && !hasRust && !hasRuby) {
    console.error(
      '❌ No supported dependency file found (package.json, pyproject.toml, requirements.txt, Gemfile, Cargo.toml).'
    )
    console.log("💡 Make sure you're in a directory with dependency files.")
    process.exit(1)
  }

  if (hasNpm) console.log('📦 Detected: npm project')
  if (hasPython) console.log('🐍 Detected: Python project')
  if (hasRust) console.log('🦀 Detected: Rust project')
  if (hasRuby) console.log('💎 Detected: Ruby project')
  console.log(`📋 License tier: ${license.tier.toUpperCase()}`)

  // Use sentinel value instead of null for consistent access patterns
  const capCheck =
    license.tier === 'FREE'
      ? checkUsageCaps('dependency-pr')
      : { allowed: true, usage: {}, caps: {} }

  if (!capCheck.allowed) {
    console.error(`❌ ${capCheck.reason}`)
    console.error(
      '   Upgrade to Pro, Team, or Enterprise for unlimited runs: https://buildproven.ai/qa-architect'
    )
    process.exit(1)
  }

  const dependabotPath = path.join(projectPath, '.github', 'dependabot.yml')

  // Use premium or basic config based on license tier
  const shouldUsePremium = license.tier === 'PRO'

  // Free tier only supports npm projects. Fail fast with a clear message.
  if (!shouldUsePremium && !hasNpm && (hasPython || hasRust || hasRuby)) {
    console.error(
      '❌ Dependency monitoring for this project requires a Pro, Team, or Enterprise license.'
    )
    console.error(
      '   Free tier supports npm projects only. Detected non-npm ecosystems.'
    )
    console.error(
      '   Options: add npm/package.json, or upgrade and re-run: npx create-qa-architect@latest --deps after activation.'
    )
    process.exit(1)
  }

  if (shouldUsePremium) {
    console.log(
      '\n🚀 Setting up framework-aware dependency monitoring (Premium)...\n'
    )

    const configData = generatePremiumDependabotConfig({
      projectPath,
      schedule: 'weekly',
    })

    if (configData) {
      const { ecosystems } = configData
      const ecosystemNames = Object.keys(ecosystems)

      if (ecosystemNames.length > 0) {
        console.log('🔍 Detected ecosystems:')

        let primaryEcosystem = null
        ecosystemNames.forEach(ecoName => {
          const eco = ecosystems[ecoName]
          const frameworks = Object.keys(eco.detected || {})
          const totalPackages = frameworks.reduce((sum, fw) => {
            return sum + (eco.detected[fw]?.count || 0)
          }, 0)

          console.log(`   • ${ecoName}: ${totalPackages} packages`)

          if (eco.primary) {
            primaryEcosystem = ecoName
          }
        })

        if (primaryEcosystem) {
          console.log(`\n🎯 Primary ecosystem: ${primaryEcosystem}`)
        }
      }

      writePremiumDependabotConfig(configData, dependabotPath)
      console.log('\n✅ Created .github/dependabot.yml with framework grouping')

      console.log('\n🎉 Premium dependency monitoring setup complete!')
      console.log('\n📋 What was added (Pro Tier):')
      console.log('   • Framework-aware dependency grouping')
      console.log(
        `   • ${Object.keys(configData.config.updates[0].groups || {}).length} dependency groups created`
      )
      console.log('   • Intelligent update batching (reduces PRs by 60%+)')
      console.log('   • GitHub Actions dependency monitoring')
    }
  } else {
    console.log('\n🔍 Setting up basic dependency monitoring (Free Tier)...\n')

    const dependabotConfig = generateBasicDependabotConfig({
      projectPath,
      schedule: 'weekly',
    })

    if (dependabotConfig) {
      writeBasicDependabotConfig(dependabotConfig, dependabotPath)
      console.log('✅ Created .github/dependabot.yml')
    }

    console.log('\n🎉 Basic dependency monitoring setup complete!')
    console.log('\n📋 What was added (Free Tier):')
    console.log('   • Basic Dependabot configuration for npm packages')
    console.log('   • Weekly dependency updates on Monday 9am')
    console.log('   • GitHub Actions dependency monitoring')

    // Show upgrade message for premium features
    console.log('\n🔒 Premium features now available:')
    console.log('   ✅ Framework-aware package grouping (React, Vue, Angular)')
    console.log('   • Coming soon: Multi-language support (Python, Rust, Go)')
    console.log('   • Planned: Advanced security audit workflows')
    console.log('   • Planned: Custom update schedules and notifications')

    showUpgradeMessage('Framework-Aware Dependency Grouping')
  }

  if (license.tier === 'FREE') {
    const increment = incrementUsage('dependency-pr')
    const usage = increment.usage || capCheck.usage
    const caps = capCheck.caps
    if (usage && caps && caps.maxDependencyPRsPerMonth !== undefined) {
      console.log(
        `🧮 Usage: ${usage.dependencyPRs}/${caps.maxDependencyPRsPerMonth} dependency monitoring runs used this month`
      )
    }
  }

  // Auto-enable Dependabot on GitHub if token available
  console.log('\n🔧 Attempting to enable Dependabot on GitHub...')
  try {
    const { setupDependabot } = require('../github-api')
    const result = await setupDependabot(projectPath, { verbose: true })

    if (result.success) {
      console.log('✅ Dependabot alerts and security updates enabled!')
    } else if (result.errors.length > 0) {
      console.log('⚠️  Could not auto-enable Dependabot:')
      result.errors.forEach(err => console.log(`   • ${err}`))
      console.log('\n💡 Manual steps needed:')
      console.log('   • Go to GitHub repo → Settings → Code security')
      console.log(
        '   • Enable "Dependabot alerts" and "Dependabot security updates"'
      )
    }
  } catch (error) {
    const errorId = 'DEPENDABOT_AUTO_ENABLE_FAILED'

    // Diagnose specific error types
    let diagnosis = 'Unknown error'
    let remedy = 'Check the error message for details'

    if (
      error.message.includes('401') ||
      error.message.includes('authentication')
    ) {
      diagnosis = 'GitHub token is invalid or missing'
      remedy = 'Set GITHUB_TOKEN environment variable with a valid token'
    } else if (error.message.includes('404')) {
      diagnosis = 'Repository not found or insufficient permissions'
      remedy = 'Ensure token has repo:write access to this repository'
    } else if (error.message.includes('rate limit')) {
      diagnosis = 'GitHub API rate limit exceeded'
      remedy = 'Wait 1 hour or use authenticated token for higher limits'
    } else if (
      error.code === 'ENOTFOUND' ||
      error.message.includes('network')
    ) {
      diagnosis = 'Network connectivity issue'
      remedy = 'Check internet connection and GitHub API status'
    } else if (error.message.includes('timeout')) {
      diagnosis = 'Request timed out'
      remedy = 'Retry the operation or check network connectivity'
    }

    console.error(`\n❌ [${errorId}] Could not auto-enable Dependabot`)
    console.error(`   Diagnosis: ${diagnosis}`)
    console.error(`   Error: ${error.message}`)
    console.error(`\n   🔧 Recommended fix: ${remedy}`)

    if (process.env.DEBUG) {
      console.error(`\n   Debug info:`)
      console.error(`   • Error code: ${error.code || 'N/A'}`)
      console.error(`   • Stack: ${error.stack}`)
    }

    console.log('\n💡 Alternative: Enable manually:')
    console.log('   1. Go to GitHub repo → Settings → Code security')
    console.log('   2. Enable "Dependabot alerts"')
    console.log('   3. Enable "Dependabot security updates"')
    console.log(
      `\n   • Report issue: https://github.com/buildproven/qa-architect/issues/new?title=${errorId}`
    )
  }

  console.log('\n💡 Next steps:')
  console.log('   • Review and commit .github/dependabot.yml')
  console.log(
    '   • Dependabot will start monitoring weekly for dependency updates'
  )
}

module.exports = {
  handleDependencyMonitoring,
  detectPythonProject,
  detectRustProject,
  detectRubyProject,
}
