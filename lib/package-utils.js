'use strict'

/**
 * Package.json merge utilities
 * Shared between setup script and tests to avoid duplication
 */

/**
 * Merge scripts into package.json, preserving existing ones
 * @param {Object} initialScripts - Existing scripts object
 * @param {Object} defaultScripts - Default scripts to add
 * @returns {Object} Merged scripts object
 */
function mergeScripts(initialScripts = {}, defaultScripts) {
  const scripts = { ...initialScripts }
  Object.entries(defaultScripts).forEach(([name, command]) => {
    if (!scripts[name]) {
      scripts[name] = command
    }
  })

  // Ensure husky command is present in prepare script
  const prepareScript = scripts.prepare
  if (!prepareScript) {
    scripts.prepare = 'husky'
  } else if (prepareScript.includes('husky install')) {
    scripts.prepare = prepareScript.replace(/husky install/g, 'husky')
  } else if (!prepareScript.includes('husky')) {
    scripts.prepare = `${prepareScript} && husky`
  }

  return scripts
}

/**
 * Merge devDependencies into package.json, preserving existing ones
 * @param {Object} initialDevDeps - Existing devDependencies object
 * @param {Object} defaultDevDeps - Default devDependencies to add
 * @returns {Object} Merged devDependencies object
 */
function mergeDevDependencies(initialDevDeps = {}, defaultDevDeps) {
  const devDeps = { ...initialDevDeps }
  Object.entries(defaultDevDeps).forEach(([dependency, version]) => {
    if (!devDeps[dependency]) {
      devDeps[dependency] = version
    }
  })
  return devDeps
}

/**
 * Merge lint-staged configuration, preserving existing patterns
 * @param {Record<string, string|string[]>} [existing] - Existing lint-staged config
 * @param {Record<string, string|string[]>} defaults - Default lint-staged config
 * @param {{stylelintTargets?: string[]}} [options] - Merge options
 * @param {(pattern: string) => boolean} [patternChecker] - Function to check if a pattern matches certain criteria
 * @returns {Record<string, string|string[]>} Merged lint-staged config
 */
function mergeLintStaged(
  defaults = {},
  existing = {},
  options = {},
  patternChecker = () => false
) {
  const merged = { ...existing }
  const stylelintTargets = options.stylelintTargets || []
  const stylelintTargetSet = new Set(stylelintTargets)

  // Check if existing config has CSS patterns
  const hasExistingCssPatterns =
    patternChecker && Object.keys(existing).some(patternChecker)

  Object.entries(defaults).forEach(([pattern, commands]) => {
    const isStylelintPattern = stylelintTargetSet.has(pattern)
    if (isStylelintPattern && hasExistingCssPatterns) {
      return // Skip stylelint patterns if existing CSS patterns exist
    }

    if (!merged[pattern]) {
      merged[pattern] = commands
      return
    }

    // Merge commands for existing patterns

    const existingCommands = Array.isArray(merged[pattern])
      ? [...merged[pattern]]
      : [merged[pattern]]

    const newCommands = [...existingCommands]
    const commandList = Array.isArray(commands) ? commands : [commands]
    commandList.forEach(command => {
      if (!newCommands.includes(command)) {
        newCommands.push(command)
      }
    })

    merged[pattern] = newCommands
  })

  return merged
}

/**
 * Detect which package manager is being used in the project
 * @param {string} projectPath - Path to the project directory
 * @returns {string} Package manager name: 'pnpm', 'yarn', 'bun', or 'npm'
 */
function detectPackageManager(projectPath = process.cwd()) {
  const fs = require('fs')
  const path = require('path')

  // Check for lockfiles in order of preference
  if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
    return 'yarn'
  }
  if (
    fs.existsSync(path.join(projectPath, 'bun.lock')) ||
    fs.existsSync(path.join(projectPath, 'bun.lockb'))
  ) {
    return 'bun'
  }
  if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) {
    return 'npm'
  }

  // Check package.json for packageManager field (Corepack)
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.packageManager) {
        // Format: "pnpm@8.0.0" or "yarn@3.0.0"
        const pmName = packageJson.packageManager.split('@')[0]
        if (['pnpm', 'yarn', 'bun', 'npm'].includes(pmName)) {
          return pmName
        }
        // packageManager field exists but has unexpected value
        console.warn(
          `⚠️  Unrecognized packageManager in package.json: ${packageJson.packageManager}. Falling back to lockfile detection.`
        )
      }
    } catch (error) {
      // Log parse errors as they may indicate corrupted package.json
      console.warn(
        `⚠️  Could not parse package.json packageManager field: ${error.message}. Falling back to lockfile detection.`
      )
      if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
        console.log(`Debug: ${error.stack}`)
      }
    }
  }

  // Default to npm if no lockfile found
  return 'npm'
}

/**
 * Get install command for detected package manager
 * @param {string} packageManager - Package manager name
 * @param {boolean} frozen - Use frozen/immutable lockfile (CI mode)
 * @returns {string} Install command
 */
function getInstallCommand(packageManager, frozen = true) {
  const commands = {
    pnpm: frozen ? 'pnpm install --frozen-lockfile' : 'pnpm install',
    yarn: frozen ? 'yarn install --frozen-lockfile' : 'yarn install',
    bun: frozen ? 'bun install --frozen-lockfile' : 'bun install',
    npm: frozen ? 'npm ci' : 'npm install',
  }

  return commands[packageManager] || 'npm install'
}

/**
 * Get audit command for detected package manager
 * @param {string} packageManager - Package manager name
 * @returns {string} Audit command
 */
function getAuditCommand(packageManager) {
  const commands = {
    pnpm: 'pnpm audit',
    yarn: 'yarn audit',
    bun: 'bun audit', // Bun has audit support
    npm: 'npm audit',
  }

  return commands[packageManager] || 'npm audit'
}

/**
 * Detect monorepo type and configuration
 * @param {string} projectPath - Path to the project directory
 * @returns {Object} Monorepo info: { type, isMonorepo, packages, tool }
 */
function detectMonorepoType(projectPath = process.cwd()) {
  const fs = require('fs')
  const path = require('path')

  const result = {
    isMonorepo: false,
    type: null, // 'workspaces' | 'lerna' | 'nx' | 'turborepo' | 'rush'
    tool: null, // Specific tool name
    packages: [], // List of workspace package paths
    packageManager: detectPackageManager(projectPath),
  }

  // Check for Nx (nx.json)
  const nxJsonPath = path.join(projectPath, 'nx.json')
  if (fs.existsSync(nxJsonPath)) {
    result.isMonorepo = true
    result.type = 'nx'
    result.tool = 'nx'
    try {
      const nxJson = JSON.parse(fs.readFileSync(nxJsonPath, 'utf8'))
      result.config = nxJson
    } catch (error) {
      // nx.json exists but is malformed - warn user
      console.warn(`⚠️  Could not parse nx.json: ${error.message}`)
      if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
        console.log(`Debug: ${error.stack}`)
      }
    }
  }

  // Check for Turborepo (turbo.json)
  const turboJsonPath = path.join(projectPath, 'turbo.json')
  if (fs.existsSync(turboJsonPath)) {
    result.isMonorepo = true
    result.type = 'turborepo'
    result.tool = 'turborepo'
    try {
      const turboJson = JSON.parse(fs.readFileSync(turboJsonPath, 'utf8'))
      result.config = turboJson
    } catch (error) {
      // turbo.json exists but is malformed - warn user
      console.warn(`⚠️  Could not parse turbo.json: ${error.message}`)
      if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
        console.log(`Debug: ${error.stack}`)
      }
    }
  }

  // Check for Rush (rush.json)
  const rushJsonPath = path.join(projectPath, 'rush.json')
  if (fs.existsSync(rushJsonPath)) {
    result.isMonorepo = true
    result.type = 'rush'
    result.tool = 'rush'
  }

  // Check for Lerna (lerna.json)
  const lernaJsonPath = path.join(projectPath, 'lerna.json')
  if (fs.existsSync(lernaJsonPath)) {
    result.isMonorepo = true
    result.type = 'lerna'
    result.tool = 'lerna'
    try {
      const lernaJson = JSON.parse(fs.readFileSync(lernaJsonPath, 'utf8'))
      result.packages = lernaJson.packages || ['packages/*']
    } catch (error) {
      // lerna.json exists but is malformed - warn and use default
      console.warn(
        `⚠️  Could not parse lerna.json: ${error.message}. Using default packages pattern.`
      )
      if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
        console.log(`Debug: ${error.stack}`)
      }
      result.packages = ['packages/*']
    }
  }

  // Check for pnpm workspaces (pnpm-workspace.yaml)
  const pnpmWorkspacePath = path.join(projectPath, 'pnpm-workspace.yaml')
  if (fs.existsSync(pnpmWorkspacePath)) {
    result.isMonorepo = true
    result.type = result.type || 'workspaces'
    result.tool = result.tool || 'pnpm'
    try {
      const yaml = fs.readFileSync(pnpmWorkspacePath, 'utf8')
      // Simple line-by-line YAML parsing (safer than regex)
      const lines = yaml.split('\n')
      let inPackages = false
      const packages = []
      for (const line of lines) {
        if (line.trim() === 'packages:') {
          inPackages = true
          continue
        }
        if (inPackages) {
          // Check if line is a list item (starts with -)
          const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/)
          if (match) {
            packages.push(match[1])
          } else if (
            line.trim() &&
            !line.startsWith(' ') &&
            !line.startsWith('\t')
          ) {
            // New top-level key, stop parsing packages
            break
          }
        }
      }
      if (packages.length > 0) {
        result.packages = packages
      }
    } catch (error) {
      // pnpm-workspace.yaml exists but could not be parsed
      console.warn(`⚠️  Could not parse pnpm-workspace.yaml: ${error.message}`)
      if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
        console.log(`Debug: ${error.stack}`)
      }
    }
  }

  // Check for npm/yarn workspaces in package.json
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.workspaces) {
        result.isMonorepo = true
        result.type = result.type || 'workspaces'
        // workspaces can be array or object with packages key
        const workspaces = Array.isArray(packageJson.workspaces)
          ? packageJson.workspaces
          : packageJson.workspaces.packages || []
        result.packages = result.packages.length ? result.packages : workspaces
        if (!result.tool) {
          result.tool =
            result.packageManager === 'yarn' ? 'yarn' : result.packageManager
        }
      }
    } catch (error) {
      // package.json exists but workspaces field could not be parsed
      console.warn(
        `⚠️  Could not parse package.json workspaces: ${error.message}`
      )
      if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
        console.log(`Debug: ${error.stack}`)
      }
    }
  }

  // Resolve workspace package paths to actual directories
  if (result.isMonorepo && result.packages.length > 0) {
    result.resolvedPackages = resolveWorkspacePackages(
      projectPath,
      result.packages
    )
  }

  return result
}

/**
 * Resolve workspace glob patterns to actual package directories
 * @param {string} projectPath - Root project path
 * @param {Array<string>} patterns - Workspace patterns (e.g., ['packages/*', 'apps/*'])
 * @returns {Array<Object>} Resolved packages with name and path
 */
function resolveWorkspacePackages(projectPath, patterns) {
  const fs = require('fs')
  const path = require('path')
  const packages = []

  for (const pattern of patterns) {
    // Handle simple glob patterns like 'packages/*'
    if (pattern.endsWith('/*')) {
      const baseDir = path.join(projectPath, pattern.slice(0, -2))
      if (fs.existsSync(baseDir)) {
        try {
          const entries = fs.readdirSync(baseDir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pkgPath = path.join(baseDir, entry.name)
              const pkgJsonPath = path.join(pkgPath, 'package.json')
              if (fs.existsSync(pkgJsonPath)) {
                try {
                  const pkgJson = JSON.parse(
                    fs.readFileSync(pkgJsonPath, 'utf8')
                  )
                  packages.push({
                    name: pkgJson.name || entry.name,
                    path: pkgPath,
                    relativePath: path.relative(projectPath, pkgPath),
                  })
                } catch (error) {
                  // package.json exists but is malformed - use directory name
                  if (
                    process.env.QAA_DEBUG ||
                    process.env.NODE_ENV === 'test'
                  ) {
                    console.log(
                      `Debug: Could not parse ${pkgJsonPath}: ${error.message}`
                    )
                  }
                  packages.push({
                    name: entry.name,
                    path: pkgPath,
                    relativePath: path.relative(projectPath, pkgPath),
                  })
                }
              }
            }
          }
        } catch (error) {
          // Could not read workspace directory - permission or filesystem error
          console.warn(
            `⚠️  Could not read workspace directory ${baseDir}: ${error.message}`
          )
          if (process.env.QAA_DEBUG || process.env.NODE_ENV === 'test') {
            console.log(`Debug: ${error.stack}`)
          }
        }
      }
    } else if (!pattern.includes('*')) {
      // Direct path without glob
      const pkgPath = path.join(projectPath, pattern)
      const pkgJsonPath = path.join(pkgPath, 'package.json')
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
          packages.push({
            name: pkgJson.name || path.basename(pkgPath),
            path: pkgPath,
            relativePath: pattern,
          })
        } catch {
          packages.push({
            name: path.basename(pkgPath),
            path: pkgPath,
            relativePath: pattern,
          })
        }
      }
    }
  }

  return packages
}

module.exports = {
  mergeScripts,
  mergeDevDependencies,
  mergeLintStaged,
  detectPackageManager,
  getInstallCommand,
  getAuditCommand,
  detectMonorepoType,
  resolveWorkspacePackages,
}
