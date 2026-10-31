/**
 * Basic Dependency Monitoring Library (Free Tier)
 * Generates simple Dependabot configuration without advanced features
 */

const fs = require('fs')
const path = require('path')
const { convertToYaml } = require('./yaml-utils')

/**
 * Give every update entry a group for security updates. Groups without
 * `applies-to` cover version updates only, and security updates ignore
 * open-pull-requests-limit, so without this each advisory opens its own PR.
 */
function withSecurityUpdateGroups(updates) {
  return updates.map(entry => ({
    ...entry,
    groups: {
      'security-updates': {
        'applies-to': 'security-updates',
        patterns: ['*'],
      },
      ...(entry.groups || {}),
    },
  }))
}

/**
 * Detect if project has package.json (npm projects only for free tier)
 */
function hasNpmProject(projectPath) {
  return fs.existsSync(path.join(projectPath, 'package.json'))
}

/**
 * Generate basic Dependabot configuration (Free Tier)
 * Limited to npm only, no framework detection, basic settings
 * Supports monorepo per-package directories
 */
function generateBasicDependabotConfig(options = {}) {
  const {
    projectPath = '.',
    schedule = 'monthly',
    day = 'monday',
    time = '09:00',
    monorepoInfo = null, // Optional monorepo detection result
  } = options

  if (!hasNpmProject(projectPath)) {
    return null // Only npm projects supported in free tier
  }

  const updates = []

  // If monorepo with resolved packages, create per-package entries
  if (
    monorepoInfo &&
    monorepoInfo.isMonorepo &&
    monorepoInfo.resolvedPackages &&
    monorepoInfo.resolvedPackages.length > 0
  ) {
    // Root package
    updates.push({
      'package-ecosystem': 'npm',
      directory: '/',
      schedule: {
        interval: schedule,
        day: day,
        time: time,
      },
      'open-pull-requests-limit': 2,
      labels: ['dependencies', 'root'],
      'commit-message': {
        prefix: 'deps(root)',
        include: 'scope',
      },
    })

    // Per-package entries
    for (const pkg of monorepoInfo.resolvedPackages) {
      const dir = '/' + pkg.relativePath.replace(/\\/g, '/')
      updates.push({
        'package-ecosystem': 'npm',
        directory: dir,
        schedule: {
          interval: schedule,
          day: day,
          time: time,
        },
        'open-pull-requests-limit': 2,
        labels: ['dependencies', pkg.name],
        'commit-message': {
          prefix: `deps(${pkg.name})`,
          include: 'scope',
        },
      })
    }
  } else {
    // Single package (non-monorepo)
    updates.push({
      'package-ecosystem': 'npm',
      directory: '/',
      schedule: {
        interval: schedule,
        day: day,
        time: time,
      },
      'open-pull-requests-limit': 2,
      labels: ['dependencies'],
      'commit-message': {
        prefix: 'deps',
        include: 'scope',
      },
    })
  }

  // GitHub Actions monitoring (free tier includes this)
  updates.push({
    'package-ecosystem': 'github-actions',
    directory: '/',
    schedule: {
      interval: schedule,
      day: day,
      time: time,
    },
    labels: ['dependencies', 'github-actions'],
    'commit-message': {
      prefix: 'deps(actions)',
    },
  })

  const config = {
    version: 2,
    updates: withSecurityUpdateGroups(updates),
  }

  return config
}

/**
 * Validate Dependabot configuration structure
 * Ensures the configuration matches Dependabot schema requirements
 */
function validateDependabotConfig(config) {
  // Basic structure validation
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be a valid object')
  }

  if (!config.version || config.version !== 2) {
    throw new Error('Dependabot configuration must specify version: 2')
  }

  if (!config.updates || !Array.isArray(config.updates)) {
    throw new Error('Dependabot configuration must have an updates array')
  }

  if (config.updates.length === 0) {
    throw new Error(
      'Dependabot configuration must have at least one update configuration'
    )
  }

  // Validate each update configuration
  config.updates.forEach((update, index) => {
    if (!update['package-ecosystem']) {
      throw new Error(
        `Update configuration ${index} must specify package-ecosystem`
      )
    }

    if (!update.directory) {
      throw new Error(`Update configuration ${index} must specify directory`)
    }

    if (!update.schedule || !update.schedule.interval) {
      throw new Error(
        `Update configuration ${index} must specify schedule.interval`
      )
    }

    // Validate package-ecosystem values
    const validEcosystems = [
      'npm',
      'github-actions',
      'docker',
      'pip',
      'composer',
      'bundler',
      'go',
      'nuget',
      'maven',
      'gradle',
      'terraform',
    ]
    if (!validEcosystems.includes(update['package-ecosystem'])) {
      throw new Error(
        `Invalid package-ecosystem '${update['package-ecosystem']}' in update configuration ${index}`
      )
    }

    // Validate schedule intervals
    const validIntervals = ['daily', 'weekly', 'monthly']
    if (!validIntervals.includes(update.schedule.interval)) {
      throw new Error(
        `Invalid schedule interval '${update.schedule.interval}' in update configuration ${index}`
      )
    }
  })

  return true
}

/**
 * Write basic Dependabot configuration to file
 */
function writeBasicDependabotConfig(config, outputPath) {
  // Validate configuration before writing
  validateDependabotConfig(config)

  const yamlContent = `# Basic Dependabot configuration (Free Tier)
# Auto-generated by create-qa-architect
# Upgrade to Pro for framework-aware grouping and multi-language support
# See: https://create-qa-architect.dev/pro

${convertToYaml(config)}`

  const configDir = path.dirname(outputPath)
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(outputPath, yamlContent)

  // Post-write validation: verify the file can be parsed
  try {
    const yaml = require('js-yaml')
    const writtenContent = fs.readFileSync(outputPath, 'utf8')
    yaml.load(writtenContent)
  } catch (error) {
    throw new Error(
      `Generated Dependabot configuration is invalid YAML: ${error.message}`
    )
  }
}
module.exports = {
  withSecurityUpdateGroups,
  hasNpmProject,
  generateBasicDependabotConfig,
  writeBasicDependabotConfig,
}
