#!/usr/bin/env node

/**
 * DR26 fix: Architectural Refactoring Plan for setup.js (2201 lines)
 *
 * PRIORITY: This file should be split into focused modules to improve
 * maintainability, testability, and reduce cognitive load.
 *
 * PROPOSED MODULE STRUCTURE (target: < 500 lines per module):
 *
 * 1. lib/commands/validate.js (~300 lines)
 *    - Validation command logic
 *    - Config validation workflows
 *    - Prelaunch validation integration
 *
 * 2. lib/commands/deps.js (~200 lines)
 *    - Dependency monitoring setup
 *    - Dependabot configuration
 *    - GitHub API integration calls
 *
 * 3. lib/commands/activate.js (~150 lines)
 *    - License activation flow
 *    - Interactive license prompts
 *    - License validation integration
 *
 * 4. lib/commands/setup-main.js (~800 lines)
 *    - Main setup orchestration
 *    - Template generation
 *    - File writing operations
 *    - Husky/lint-staged configuration
 *
 * 5. lib/setup-config.js (~200 lines)
 *    - Configuration merging logic
 *    - Package.json updates
 *    - Workflow injection helpers
 *
 * 6. setup.js (core CLI, ~200 lines)
 *    - Argument parsing
 *    - Command routing
 *    - Help/version display
 *    - Exit code handling
 *
 * MIGRATION CHECKLIST:
 * - [ ] Extract validation command to lib/commands/validate.js
 * - [ ] Extract deps command to lib/commands/deps.js
 * - [ ] Extract license activation to lib/commands/activate.js
 * - [ ] Extract main setup flow to lib/commands/setup-main.js
 * - [ ] Extract config helpers to lib/setup-config.js
 * - [ ] Update all tests to use new module structure
 * - [ ] Verify all CLI commands still work (--help, --deps, --validate, etc.)
 * - [ ] Update integration tests
 * - [ ] Run full test suite and ensure 100% pass rate
 *
 * BENEFITS:
 * - Easier to test individual commands
 * - Reduced cognitive load when modifying specific features
 * - Better code organization and discoverability
 * - Easier to add new commands in the future
 * - Faster development cycles (smaller files to navigate)
 *
 * BLOCKED BY: None (can be done incrementally)
 * ESTIMATED EFFORT: 2-3 days with full test coverage
 * RISK: Medium (need to ensure no regressions in CLI behavior)
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const {
  mergeScripts,
  mergeDevDependencies,
  mergeLintStaged,
} = require('./lib/package-utils')
const { showProgress } = require('./lib/ui-helpers')
const {
  NODE_VERSION,
  SCAN_LIMITS,
  EXCLUDE_DIRECTORIES,
} = require('./config/constants')

/**
 * Check Node version and lazily load @npmcli/package-json
 * This prevents import errors on older Node versions for basic commands like --help
 */
function checkNodeVersionAndLoadPackageJson() {
  const nodeVersion = process.version
  const majorVersion = parseInt(nodeVersion.split('.')[0].slice(1))

  if (majorVersion < NODE_VERSION.MIN_MAJOR) {
    console.error(
      `❌ Node.js ${nodeVersion} is not supported. This tool requires Node.js ${NODE_VERSION.MIN_MAJOR} or higher.`
    )
    console.log('Please upgrade Node.js and try again.')
    console.log('Visit https://nodejs.org/ to download the latest version.')
    process.exit(1)
  }

  try {
    return require('@npmcli/package-json')
  } catch (error) {
    console.error(`❌ Failed to load package.json utilities: ${error.message}`)
    console.log('This tool requires Node.js 20+ with modern module support.')
    process.exit(1)
  }
}

const {
  STYLELINT_EXTENSIONS,
  getDefaultDevDependencies,
  getDefaultLintStaged,
  getDefaultScripts,
} = require('./config/defaults')

// Enhanced validation capabilities
const { validateQualityConfig } = require('./lib/config-validator')

// Interactive mode capabilities
const { InteractivePrompt } = require('./lib/interactive/prompt')
const { runInteractiveFlow } = require('./lib/interactive/questions')

// Note: Dependency monitoring imports moved to ./lib/commands/deps.js

// Custom template loading
const { TemplateLoader } = require('./lib/template-loader')
const {
  detectExistingWorkflowMode,
  injectWorkflowMode,
  injectMatrix,
} = require('./lib/workflow-config')

// Command handlers (extracted for maintainability)
const {
  handleValidationCommands,
  handleDependencyMonitoring,
} = require('./lib/commands')
const { handleDryRun } = require('./lib/commands/dry-run')
const {
  handleLicenseStatus,
  handleLicenseActivation,
} = require('./lib/commands/license-commands')
const { handleMaturityCheck } = require('./lib/commands/maturity-check')
const { handlePrelaunchSetup } = require('./lib/commands/prelaunch-setup')
const { handleInteractiveMode } = require('./lib/commands/interactive-handler')

// Licensing system
const {
  getLicenseInfo,
  hasFeature,
  showUpgradeMessage,
  checkUsageCaps,
  incrementUsage,
} = require('./lib/licensing')

// Smart Test Strategy Generator (Pro/Team/Enterprise feature)
const {
  detectProjectType,
  generateSmartStrategy,
  writeSmartStrategy,
  generateSmartPrePushHook,
  getTestTierScripts,
} = require('./lib/smart-strategy-generator')

// Quality Tools Generator (Lighthouse, size-limit, axe-core, commitlint, coverage)
const {
  writeLighthouseConfig,
  writeSizeLimitConfig,
  writeCommitlintConfig,
  writeCommitMsgHook,
  writeAxeTestSetup,
  getQualityToolsDependencies,
  getQualityToolsScripts,
} = require('./lib/quality-tools-generator')

// Pre-Launch Validation (SEO, links, a11y, docs, env)
const {
  writeValidationScripts,
  writeEnvValidator,
  writePa11yConfig,
  getPrelaunchScripts,
  getPrelaunchDependencies,
} = require('./lib/prelaunch-validator')

// Telemetry (opt-in usage tracking)
const { TelemetrySession, showTelemetryStatus } = require('./lib/telemetry')

// Error reporting (opt-in crash analytics)
const {
  ErrorReporter,
  showErrorReportingStatus,
} = require('./lib/error-reporter')

// Critical setup enhancements (fixes production quality gaps)
const {
  applyProductionQualityFixes,
  validateProjectSetup,
} = require('./lib/setup-enhancements')

const STYLELINT_EXTENSION_SET = new Set(STYLELINT_EXTENSIONS)
const STYLELINT_DEFAULT_TARGET = `**/*.{${STYLELINT_EXTENSIONS.join(',')}}`
const STYLELINT_EXTENSION_GLOB = `*.{${STYLELINT_EXTENSIONS.join(',')}}`
const STYLELINT_SCAN_EXCLUDES = new Set(EXCLUDE_DIRECTORIES.STYLELINT)
const MAX_STYLELINT_SCAN_DEPTH = SCAN_LIMITS.STYLELINT_MAX_DEPTH

function normalizeRepoIdentifier(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') return null

  const scpMatch = remoteUrl.match(/^[^@]+@([^:]+):(.+?)(\.git)?$/)
  if (scpMatch) {
    const host = scpMatch[1]
    const repoPath = scpMatch[2].replace(/^\/+/, '').replace(/\.git$/, '')
    return `${host}/${repoPath}`
  }

  try {
    const parsed = new URL(remoteUrl)
    const host = parsed.hostname
    const repoPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '')
    if (!host || !repoPath) return null
    return `${host}/${repoPath}`
  } catch {
    return null
  }
}

function hashRepoIdentifier(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function injectCollaborationSteps(workflowContent, options = {}) {
  const { enableSlackAlerts = false, enablePrComments = false } = options
  let updated = workflowContent

  if (workflowContent.includes('# ALERTS_PLACEHOLDER')) {
    const alertsJob = enableSlackAlerts
      ? `  alerts:\n    runs-on: ubuntu-latest\n    needs: [summary]\n    if: failure() || cancelled()\n    steps:\n      - name: Notify Slack on failures\n        env:\n          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}\n        run: |\n          if [ -z "$SLACK_WEBHOOK_URL" ]; then\n            echo "::warning::SLACK_WEBHOOK_URL not set; skipping Slack notification"\n            exit 0\n          fi\n          payload='{"text":"❌ Quality checks failed for $GITHUB_REPOSITORY ($GITHUB_REF)"}'\n          curl -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK_URL"\n`
      : '  # Slack alerts not enabled (use --alerts-slack to add)'
    updated = updated.replace('# ALERTS_PLACEHOLDER', alertsJob)
  }

  if (workflowContent.includes('# PR_COMMENTS_PLACEHOLDER')) {
    const prSteps = enablePrComments
      ? `      - name: Post PR summary comment\n        if: github.event_name == 'pull_request'\n        uses: actions/github-script@v7\n        with:\n          script: |\n            const summaryPath = process.env.GITHUB_STEP_SUMMARY\n            const fs = require('fs')\n            const body = summaryPath && fs.existsSync(summaryPath)\n              ? fs.readFileSync(summaryPath, 'utf8')\n              : 'Quality checks completed.'\n            const { context, github } = require('@actions/github')\n            await github.rest.issues.createComment({\n              owner: context.repo.owner,\n              repo: context.repo.repo,\n              issue_number: context.payload.pull_request.number,\n              body,\n            })\n`
      : '      # PR comment step not enabled (use --pr-comments to add)'
    updated = updated.replace('# PR_COMMENTS_PLACEHOLDER', prSteps)
  }

  return updated
}

/**
 * Safely reads directory contents without throwing on permission errors
 *
 * Wraps fs.readdirSync with error handling to prevent crashes when
 * encountering permission denied errors or non-existent directories.
 *
 * @param {string} dir - Directory path to read
 * @returns {fs.Dirent[]} Array of directory entries, empty array on error
 *
 * @example
 * const entries = safeReadDir('./src')
 * // Returns: [Dirent { name: 'index.js', ... }, ...]
 * // On error: []
 */
const safeReadDir = dir => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    // ENOENT is expected (dir doesn't exist) - return empty silently
    if (error?.code === 'ENOENT') {
      if (process.env.DEBUG) {
        console.warn(
          `   Debug: safeReadDir(${dir}) returned empty (directory not found)`
        )
      }
      return []
    }

    // All other errors are unexpected and should be logged with context
    console.error(`❌ Failed to read directory: ${dir}`)
    console.error(`   Error: ${error.message} (${error.code || 'unknown'})`)
    console.error(`   This may indicate a permission or filesystem issue`)

    // Report to error tracking in production
    if (process.env.NODE_ENV === 'production') {
      try {
        const errorReporter = new ErrorReporter()
        errorReporter.captureError(error, {
          context: 'safeReadDir',
          directory: dir,
          errorCode: error.code,
        })
      } catch {
        // Don't fail if error reporting fails
      }
    }

    // Re-throw for critical errors instead of silently returning []
    if (['EACCES', 'EIO', 'ELOOP', 'EMFILE'].includes(error.code)) {
      throw new Error(
        `Cannot read directory ${dir}: ${error.message}. ` +
          `This may indicate a serious filesystem or permission issue.`
      )
    }

    return []
  }
}

/**
 * Checks if a filename has a Stylelint-supported extension
 *
 * Validates whether a file should be linted by Stylelint based on
 * its extension. Supports: css, scss, sass, less, pcss
 *
 * @param {string} fileName - Name of the file to check (e.g., 'styles.css')
 * @returns {boolean} True if file has a supported CSS extension
 *
 * @example
 * isStylelintFile('styles.css')     // true
 * isStylelintFile('index.js')       // false
 * isStylelintFile('theme.scss')     // true
 */
const isStylelintFile = fileName => {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  return STYLELINT_EXTENSION_SET.has(ext)
}

const directoryContainsStylelintFiles = (dir, depth = 0) => {
  if (depth > MAX_STYLELINT_SCAN_DEPTH) {
    return false
  }

  const entries = safeReadDir(dir)
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }

    const entryPath = path.join(dir, entry.name)

    if (entry.isFile() && isStylelintFile(entry.name)) {
      return true
    }

    if (entry.isDirectory()) {
      if (STYLELINT_SCAN_EXCLUDES.has(entry.name)) {
        continue
      }
      if (directoryContainsStylelintFiles(entryPath, depth + 1)) {
        return true
      }
    }
  }

  return false
}

/**
 * Intelligently discovers Stylelint target directories in a project
 *
 * Scans the root directory to find which subdirectories contain CSS/SCSS files
 * and generates optimized glob patterns for Stylelint. Avoids scanning excluded
 * directories like node_modules and skips symbolic links for safety.
 *
 * Algorithm:
 * 1. Scan root directory for CSS files and relevant subdirectories
 * 2. Skip excluded dirs (node_modules, .git, etc.) and symlinks
 * 3. Recursively check subdirs up to MAX_STYLELINT_SCAN_DEPTH
 * 4. Generate specific globs for dirs with CSS files
 * 5. Fall back to default glob if no CSS files found
 *
 * @param {string} rootDir - Root directory to scan
 * @returns {string[]} Array of glob patterns for Stylelint targets
 *
 * @example
 * findStylelintTargets('/project')
 * // Project has CSS in root and src/:
 * // ['**\/*.{css,scss,sass,less,pcss}', 'src/**\/*.{css,scss,sass,less,pcss}']
 *
 * @example
 * findStylelintTargets('/empty-project')
 * // No CSS files found:
 * // ['**\/*.{css,scss,sass,less,pcss}'] (default fallback)
 */
const findStylelintTargets = rootDir => {
  const entries = safeReadDir(rootDir)
  const targets = new Set()
  let hasRootCss = false

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }

    const entryPath = path.join(rootDir, entry.name)

    if (entry.isFile()) {
      if (isStylelintFile(entry.name)) {
        hasRootCss = true
      }
      continue
    }

    if (!entry.isDirectory()) {
      continue
    }

    if (STYLELINT_SCAN_EXCLUDES.has(entry.name)) {
      continue
    }

    if (directoryContainsStylelintFiles(entryPath)) {
      targets.add(entry.name)
    }
  }

  const resolvedTargets = []

  if (hasRootCss) {
    resolvedTargets.push(STYLELINT_EXTENSION_GLOB)
  }

  Array.from(targets)
    .sort()
    .forEach(dir => {
      resolvedTargets.push(`${dir}/**/${STYLELINT_EXTENSION_GLOB}`)
    })

  if (!resolvedTargets.length) {
    return [STYLELINT_DEFAULT_TARGET]
  }

  return resolvedTargets
}

const patternIncludesStylelintExtension = pattern => {
  const lower = pattern.toLowerCase()
  return STYLELINT_EXTENSIONS.some(ext => lower.includes(`.${ext}`))
}

// Input validation and sanitization functions from WFHroulette patterns
const validateAndSanitizeInput = input => {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string')
  }
  // Normalize and trim input
  const normalized = input.trim()
  if (normalized.length === 0) {
    return null
  }
  // Basic sanitization - remove potentially dangerous characters
  const sanitized = normalized.replace(/[<>'"&]/g, '')
  return sanitized
}

/**
 * Parse CLI arguments and return configuration object
 * @param {string[]} rawArgs - Raw command line arguments
 * @returns {Object} Parsed configuration
 */
function parseArguments(rawArgs) {
  const sanitizedArgs = rawArgs
    .map(arg => validateAndSanitizeInput(arg))
    .filter(Boolean)

  // Interactive mode detection - to be handled at execution time
  const isInteractiveRequested = sanitizedArgs.includes('--interactive')

  const isUpdateMode = sanitizedArgs.includes('--update')
  const isValidationMode = sanitizedArgs.includes('--validate')
  const isConfigSecurityMode = sanitizedArgs.includes('--security-config')
  const isDocsValidationMode = sanitizedArgs.includes('--validate-docs')
  const isComprehensiveMode = sanitizedArgs.includes('--comprehensive')
  const isDependencyMonitoringMode =
    sanitizedArgs.includes('--deps') ||
    sanitizedArgs.includes('--dependency-monitoring')
  const isLicenseStatusMode = sanitizedArgs.includes('--license-status')
  const isTelemetryStatusMode = sanitizedArgs.includes('--telemetry-status')
  const isErrorReportingStatusMode = sanitizedArgs.includes(
    '--error-reporting-status'
  )
  const isCheckMaturityMode = sanitizedArgs.includes('--check-maturity')
  const isValidateConfigMode = sanitizedArgs.includes('--validate-config')
  const isActivateLicenseMode = sanitizedArgs.includes('--activate-license')
  const isAnalyzeCiMode = sanitizedArgs.includes('--analyze-ci')
  const isPrelaunchMode = sanitizedArgs.includes('--prelaunch')
  const isDryRun = sanitizedArgs.includes('--dry-run')
  const isWorkflowMinimal = sanitizedArgs.includes('--workflow-minimal')
  const isWorkflowStandard = sanitizedArgs.includes('--workflow-standard')
  const isWorkflowComprehensive = sanitizedArgs.includes(
    '--workflow-comprehensive'
  )
  const isMatrixEnabled = sanitizedArgs.includes('--matrix')
  const ciProviderIndex = sanitizedArgs.findIndex(arg => arg === '--ci')
  const ciProvider =
    ciProviderIndex !== -1 && sanitizedArgs[ciProviderIndex + 1]
      ? sanitizedArgs[ciProviderIndex + 1].toLowerCase()
      : 'github'
  const enableSlackAlerts = sanitizedArgs.includes('--alerts-slack')
  const enablePrComments = sanitizedArgs.includes('--pr-comments')

  // Custom template directory - use raw args to preserve valid path characters (&, <, >, etc.)
  // Normalize path to prevent traversal attacks and make absolute
  const templateFlagIndex = sanitizedArgs.findIndex(arg => arg === '--template')
  let customTemplatePath =
    templateFlagIndex !== -1 && rawArgs[templateFlagIndex + 1]
      ? path.resolve(rawArgs[templateFlagIndex + 1])
      : null

  // Validate custom template path early to prevent path traversal attacks
  if (customTemplatePath) {
    const inputPath = rawArgs[templateFlagIndex + 1]
    // Check for suspicious patterns (path traversal attempts)
    if (inputPath.includes('..') || inputPath.includes('~')) {
      console.error(
        `❌ Invalid template path: "${inputPath}". Path traversal patterns not allowed.`
      )
      console.error('   Use absolute paths only (e.g., /Users/you/templates)')
      process.exit(1)
    }

    // Verify the resolved path exists and is a directory
    try {
      const stats = fs.statSync(customTemplatePath)
      if (!stats.isDirectory()) {
        console.error(
          `❌ Template path is not a directory: ${customTemplatePath}`
        )
        process.exit(1)
      }
    } catch (error) {
      console.error(`❌ Template path does not exist: ${customTemplatePath}`)
      console.error(`   Error: ${error.message}`)
      process.exit(1)
    }
  }

  // Granular tool disable options
  const disableNpmAudit = sanitizedArgs.includes('--no-npm-audit')
  const disableGitleaks = sanitizedArgs.includes('--no-gitleaks')
  const disableActionlint = sanitizedArgs.includes('--no-actionlint')
  const disableMarkdownlint = sanitizedArgs.includes('--no-markdownlint')
  const disableEslintSecurity = sanitizedArgs.includes('--no-eslint-security')
  const allowLatestGitleaks = sanitizedArgs.includes('--allow-latest-gitleaks')

  return {
    sanitizedArgs,
    isInteractiveRequested,
    isUpdateMode,
    isValidationMode,
    isConfigSecurityMode,
    isDocsValidationMode,
    isComprehensiveMode,
    isDependencyMonitoringMode,
    isLicenseStatusMode,
    isTelemetryStatusMode,
    isErrorReportingStatusMode,
    isCheckMaturityMode,
    isValidateConfigMode,
    isActivateLicenseMode,
    isAnalyzeCiMode,
    isPrelaunchMode,
    isDryRun,
    ciProvider,
    enableSlackAlerts,
    enablePrComments,
    customTemplatePath,
    disableNpmAudit,
    disableGitleaks,
    disableActionlint,
    disableMarkdownlint,
    disableEslintSecurity,
    allowLatestGitleaks,
    isWorkflowMinimal,
    isWorkflowStandard,
    isWorkflowComprehensive,
    isMatrixEnabled,
  }
}

/**
 * Main entry point - wraps everything in async context for interactive mode
 */
;(async function main() {
  // Initial argument parsing
  const args = process.argv.slice(2)
  let parsedConfig = parseArguments(args)

  // Destructure for backward compatibility
  let {
    sanitizedArgs,
    isInteractiveRequested,
    isUpdateMode,
    isValidationMode,
    isConfigSecurityMode,
    isDocsValidationMode,
    isComprehensiveMode,
    isDependencyMonitoringMode,
    isLicenseStatusMode,
    isTelemetryStatusMode,
    isErrorReportingStatusMode,
    isCheckMaturityMode,
    isValidateConfigMode,
    isActivateLicenseMode,
    isPrelaunchMode,
    isAnalyzeCiMode,
    isDryRun,
    ciProvider,
    enableSlackAlerts,
    enablePrComments,
    customTemplatePath,
    disableNpmAudit,
    disableGitleaks,
    disableActionlint,
    disableMarkdownlint,
    disableEslintSecurity,
    allowLatestGitleaks,
    isWorkflowMinimal,
    isWorkflowStandard,
    isWorkflowComprehensive,
    isMatrixEnabled,
  } = parsedConfig

  // Initialize telemetry session (opt-in only, fails silently)
  const telemetry = new TelemetrySession()

  // Handle interactive mode FIRST (before any routing)
  // This must happen before help/dry-run/routing to ensure interactive selections drive behavior
  if (isInteractiveRequested) {
    parsedConfig = await handleInteractiveMode({
      args,
      InteractivePrompt,
      runInteractiveFlow,
      parseArguments,
    })

    // Update all configuration variables from re-parsed config
    ;({
      sanitizedArgs,
      isInteractiveRequested, // Will be false after re-parse since we filtered it out
      isUpdateMode,
      isValidationMode,
      isConfigSecurityMode,
      isDocsValidationMode,
      isComprehensiveMode,
      isDependencyMonitoringMode,
      isLicenseStatusMode,
      isTelemetryStatusMode,
      isErrorReportingStatusMode,
      isCheckMaturityMode,
      isValidateConfigMode,
      isActivateLicenseMode,
      isPrelaunchMode,
      isAnalyzeCiMode,
      isDryRun,
      ciProvider,
      enableSlackAlerts,
      enablePrComments,
      customTemplatePath,
      disableNpmAudit,
      disableGitleaks,
      disableActionlint,
      disableMarkdownlint,
      disableEslintSecurity,
      allowLatestGitleaks,
      isWorkflowMinimal,
      isWorkflowStandard,
      isWorkflowComprehensive,
      isMatrixEnabled,
    } = parsedConfig)
  }

  // Show telemetry status if requested
  if (isTelemetryStatusMode) {
    showTelemetryStatus()
    process.exit(0)
  }

  // Show error reporting status if requested
  if (isErrorReportingStatusMode) {
    showErrorReportingStatus()
    process.exit(0)
  }

  // Show help if requested
  if (sanitizedArgs.includes('--help') || sanitizedArgs.includes('-h')) {
    console.log(`
🚀 Create Quality Automation Setup

Usage: npx create-qa-architect@latest [options]

SETUP OPTIONS:
  (no args)         Run complete quality automation setup
  --interactive     Interactive mode with guided configuration prompts
  --update          Update existing configuration
  --deps            Add basic dependency monitoring (Free Tier)
  --dependency-monitoring  Same as --deps
  --ci <provider>   Select CI provider: github (default) | gitlab | circleci
  --template <path> Use custom templates from specified directory
  --dry-run         Preview changes without modifying files

WORKFLOW TIERS (GitHub Actions optimization):
  --workflow-minimal        Minimal CI (default) - Single Node version, weekly security
                            ~5-10 min/commit, ~$0-5/mo for typical projects
  --workflow-standard       Standard CI - Matrix testing on main, weekly security
                            ~15-20 min/commit, ~$5-20/mo for typical projects
  --workflow-comprehensive  Comprehensive CI - Matrix on every push, security inline
                            ~50-100 min/commit, ~$100-350/mo for typical projects
  --matrix                 Enable Node.js version matrix testing (20 + 22)
                            Use for npm libraries/CLI tools that support multiple Node versions
  --analyze-ci             Analyze GitHub Actions usage and get optimization tips (Pro)

VALIDATION OPTIONS:
  --validate        Run comprehensive validation (same as --comprehensive)
  --comprehensive   Run all validation checks
  --security-config Run configuration security checks only
  --validate-docs   Run documentation validation only
  --validate-config Validate .qualityrc.json configuration file
  --check-maturity  Detect and display project maturity level
  --prelaunch       Add pre-launch validation suite (SEO, links, a11y, docs)

LICENSE, TELEMETRY & ERROR REPORTING:
  --license-status          Show current license tier and available features
  --activate-license        Activate Pro/Team/Enterprise license key from Stripe purchase
  --telemetry-status        Show telemetry status and opt-in instructions
  --error-reporting-status  Show error reporting status and privacy information

GRANULAR TOOL CONTROL:
  --no-npm-audit         Disable npm audit dependency vulnerability checks
  --no-gitleaks          Disable gitleaks secret scanning
  --allow-latest-gitleaks  Allow unpinned latest gitleaks (NOT RECOMMENDED - supply chain risk)
  --no-actionlint        Disable actionlint GitHub Actions workflow validation
  --no-markdownlint      Disable markdownlint markdown formatting checks
  --no-eslint-security   Disable ESLint security rule checking

ALERTING & COLLABORATION (GitHub CI):
  --alerts-slack        Add Slack webhook notification step (expects secret SLACK_WEBHOOK_URL)
  --pr-comments         Add PR summary comment step (uses GitHub token)

EXAMPLES:
  npx create-qa-architect@latest
    → Set up quality automation with all tools

  npx create-qa-architect@latest --deps
    → Add basic dependency monitoring (Dependabot config + weekly updates + GitHub Actions)

  npx create-qa-architect@latest --license-status
    → Show current license tier and upgrade options

  npx create-qa-architect@latest --activate-license
    → Activate Pro/Team/Enterprise license after Stripe purchase

  npx create-qa-architect@latest --telemetry-status
    → Show telemetry status and privacy information

  npx create-qa-architect@latest --error-reporting-status
    → Show error reporting status and crash analytics information

  npx create-qa-architect@latest --check-maturity
    → Detect project maturity level (minimal, bootstrap, development, production-ready)

  npx create-qa-architect@latest --prelaunch
    → Add pre-launch validation: SEO (sitemap, robots, meta), links, a11y, docs

  npx create-qa-architect@latest --validate-config
    → Validate .qualityrc.json configuration file against JSON Schema

  npx create-qa-architect@latest --comprehensive --no-gitleaks
    → Run validation but skip gitleaks secret scanning

  npx create-qa-architect@latest --security-config --allow-latest-gitleaks
    → Run security checks with unpinned gitleaks (NOT RECOMMENDED - supply chain risk)

  npx create-qa-architect@latest --security-config --no-npm-audit
    → Run security checks but skip npm audit

  npx create-qa-architect@latest --dry-run
    → Preview what files and configurations would be created/modified

  npx create-qa-architect@latest --workflow-minimal
    → Set up with minimal CI (default) - fastest, cheapest, ideal for solo devs

  npx create-qa-architect@latest --workflow-standard
    → Set up with standard CI - balanced quality/cost for small teams

  npx create-qa-architect@latest --update --workflow-minimal
    → Convert existing comprehensive workflow to minimal (reduce CI costs)

  npx create-qa-architect@latest --analyze-ci
    → Analyze your GitHub Actions usage and get cost optimization recommendations (Pro)

PRIVACY & TELEMETRY:
  Telemetry and error reporting are OPT-IN only (disabled by default). To enable:
    export QAA_TELEMETRY=true           # Usage tracking (local only)
    export QAA_ERROR_REPORTING=true     # Crash analytics (local only)
  All data stays local (~/.create-qa-architect/)
  No personal information collected. Run --telemetry-status or
  --error-reporting-status for details.

HELP:
  --help, -h        Show this help message
`)
    process.exit(0)
  }

  // Handle dry-run mode and show mode banner
  handleDryRun({ isDryRun, isUpdateMode, isDependencyMonitoringMode })

  // Note: handleValidationCommands, handleDependencyMonitoring, detectPythonProject,
  // detectRustProject, detectRubyProject are now imported from ./lib/commands

  // Handle license status command
  if (isLicenseStatusMode) {
    handleLicenseStatus()
  }

  // Handle license activation command
  if (isActivateLicenseMode) {
    await handleLicenseActivation()
  }

  // Handle check maturity command
  if (isCheckMaturityMode) {
    handleMaturityCheck()
  }

  // Handle CI cost analysis command
  if (isAnalyzeCiMode) {
    return (async () => {
      try {
        const { handleAnalyzeCi } = require('./lib/commands/analyze-ci')
        await handleAnalyzeCi()
        process.exit(0)
      } catch (error) {
        console.error('CI cost analysis error:', error.message)
        process.exit(1)
      }
    })()
  }

  // Handle validate config command
  if (isValidateConfigMode) {
    const { validateAndReport } = require('./lib/config-validator')
    const configPath = path.join(process.cwd(), '.qualityrc.json')
    const isValid = validateAndReport(configPath)
    process.exit(isValid ? 0 : 1)
  }

  // Handle dependency monitoring command
  if (isDependencyMonitoringMode) {
    return (async () => {
      try {
        await handleDependencyMonitoring()
        process.exit(0)
      } catch (error) {
        console.error('Dependency monitoring setup error:', error.message)
        process.exit(1)
      }
    })()
  }

  // Handle pre-launch validation setup command
  if (isPrelaunchMode) {
    await handlePrelaunchSetup({
      checkNodeVersionAndLoadPackageJson,
      writeValidationScripts,
      writePa11yConfig,
      writeEnvValidator,
      getPrelaunchScripts,
      getPrelaunchDependencies,
    })
  }

  // Run validation commands if requested
  if (
    isValidationMode ||
    isConfigSecurityMode ||
    isDocsValidationMode ||
    isComprehensiveMode
  ) {
    // Handle validation commands and exit
    return (async () => {
      try {
        await handleValidationCommands({
          isConfigSecurityMode,
          isDocsValidationMode,
          isComprehensiveMode,
          isValidationMode,
          disableNpmAudit,
          disableGitleaks,
          disableActionlint,
          disableMarkdownlint,
          disableEslintSecurity,
          allowLatestGitleaks,
        })
      } catch (error) {
        console.error('Validation error:', error.message)
        process.exit(1)
      }
    })()
  } else {
    /**
     * Setup quality tools based on license tier
     * - Lighthouse CI (Free: basic, Pro: with thresholds)
     * - Bundle size limits (Pro only)
     * - axe-core accessibility (Free)
     * - Conventional commits (Free)
     * - Coverage thresholds (Pro only)
     */
    async function setupQualityTools(usesTypeScript, packageJson) {
      void usesTypeScript // Reserved for TypeScript-specific quality tools
      void packageJson // Reserved for package.json-based quality configuration
      const qualitySpinner = showProgress('Setting up quality tools...')

      try {
        const projectPath = process.cwd()
        const PackageJson = checkNodeVersionAndLoadPackageJson()
        const pkgJson = await PackageJson.load(projectPath)
        const addedTools = []

        // Determine which features are available
        const hasLighthouse = hasFeature('lighthouseCI')
        const hasLighthouseThresholds = hasFeature('lighthouseThresholds')
        const hasBundleSizeLimits = hasFeature('bundleSizeLimits')
        const hasAxeAccessibility = hasFeature('axeAccessibility')
        const hasConventionalCommits = hasFeature('conventionalCommits')
        const hasCoverageThresholds = hasFeature('coverageThresholds')

        // Load performance budgets from .qualityrc.json if present
        let performanceBudgets = null
        const qualityrcPath = path.join(projectPath, '.qualityrc.json')
        if (fs.existsSync(qualityrcPath)) {
          try {
            const qualityrc = JSON.parse(fs.readFileSync(qualityrcPath, 'utf8'))
            if (qualityrc.performance) {
              performanceBudgets = qualityrc.performance
            }
          } catch {
            // Ignore parse errors - config validation handles this elsewhere
          }
        }

        // 1. Lighthouse CI - available to all, thresholds for Pro+
        if (hasLighthouse) {
          try {
            const lighthousePath = path.join(projectPath, 'lighthouserc.js')
            if (!fs.existsSync(lighthousePath)) {
              writeLighthouseConfig(projectPath, {
                hasThresholds: hasLighthouseThresholds,
                budgets:
                  performanceBudgets && performanceBudgets.lighthouse
                    ? performanceBudgets.lighthouse
                    : null,
              })
              addedTools.push(
                hasLighthouseThresholds
                  ? 'Lighthouse CI (with thresholds)'
                  : 'Lighthouse CI (basic)'
              )
            }
          } catch (error) {
            console.warn('⚠️ Failed to configure Lighthouse CI:', error.message)
            if (process.env.DEBUG) {
              console.error('   Stack:', error.stack)
            }
          }
        }

        // 2. Bundle size limits - Pro only
        if (hasBundleSizeLimits) {
          try {
            if (!pkgJson.content['size-limit']) {
              writeSizeLimitConfig(projectPath, {
                budgets:
                  performanceBudgets && performanceBudgets.bundleSize
                    ? performanceBudgets.bundleSize
                    : null,
              })
              addedTools.push('Bundle size limits (size-limit)')
            }
          } catch (error) {
            console.warn(
              '⚠️ Failed to configure bundle size limits:',
              error.message
            )
            if (process.env.DEBUG) {
              console.error('   Stack:', error.stack)
            }
          }
        }

        // 3. axe-core accessibility testing - available to all
        if (hasAxeAccessibility) {
          try {
            const axeTestPath = path.join(
              projectPath,
              'tests',
              'accessibility.test.js'
            )
            if (!fs.existsSync(axeTestPath)) {
              writeAxeTestSetup(projectPath)
              addedTools.push('axe-core accessibility tests')
            }
          } catch (error) {
            console.warn(
              '⚠️ Failed to configure axe-core tests:',
              error.message
            )
            if (process.env.DEBUG) {
              console.error('   Stack:', error.stack)
            }
          }
        }

        // 4. Conventional commits (commitlint) - available to all
        if (hasConventionalCommits) {
          try {
            const commitlintPath = path.join(
              projectPath,
              'commitlint.config.js'
            )
            if (!fs.existsSync(commitlintPath)) {
              writeCommitlintConfig(projectPath)
              writeCommitMsgHook(projectPath)
              addedTools.push('Conventional commits (commitlint)')
            }
          } catch (error) {
            console.warn('⚠️ Failed to configure commitlint:', error.message)
            if (process.env.DEBUG) {
              console.error('   Stack:', error.stack)
            }
          }
        }

        // 5. Coverage thresholds - Pro only (info message handled elsewhere)
        if (hasCoverageThresholds) {
          addedTools.push('Coverage thresholds (70% lines, 70% functions)')
        }

        // Add dependencies for enabled features
        const deps = getQualityToolsDependencies({
          lighthouse: hasLighthouse,
          sizeLimit: hasBundleSizeLimits,
          commitlint: hasConventionalCommits,
          axeCore: hasAxeAccessibility,
        })

        // Add scripts for enabled features
        const scripts = getQualityToolsScripts({
          lighthouse: hasLighthouse,
          sizeLimit: hasBundleSizeLimits,
          axeCore: hasAxeAccessibility,
          coverage: hasCoverageThresholds,
        })

        // Merge dependencies and scripts
        pkgJson.content.devDependencies = mergeDevDependencies(
          pkgJson.content.devDependencies || {},
          deps
        )
        pkgJson.content.scripts = mergeScripts(
          pkgJson.content.scripts || {},
          scripts
        )
        await pkgJson.save()

        if (addedTools.length > 0) {
          qualitySpinner.succeed(
            `Quality tools configured: ${addedTools.length} tools`
          )
          addedTools.forEach(tool => console.log(`   ✅ ${tool}`))

          // Show Pro upsell for missing features
          if (!hasBundleSizeLimits || !hasCoverageThresholds) {
            console.log('\n💎 Upgrade to Pro for additional quality tools:')
            if (!hasBundleSizeLimits) {
              console.log('   • Bundle size limits (size-limit)')
            }
            if (!hasCoverageThresholds) {
              console.log('   • Coverage threshold enforcement')
            }
          }
        } else {
          qualitySpinner.succeed('Quality tools already configured')
        }
      } catch (error) {
        qualitySpinner.fail('Quality tools setup failed')
        console.error(
          `❌ Unexpected error during quality tools setup: ${error.message}`
        )
        if (process.env.DEBUG) {
          console.error('   Stack:', error.stack)
        }
        console.error(
          '   Please report this issue at https://github.com/your-repo/issues'
        )
        throw error // Re-throw to prevent silent continuation
      }
    }

    // Normal setup flow
    async function runMainSetup() {
      // Record telemetry start event (opt-in only, fails silently)
      telemetry.recordStart({
        mode: isDryRun ? 'dry-run' : isUpdateMode ? 'update' : 'setup',
        hasCustomTemplate: !!customTemplatePath,
        isInteractive: false, // Already handled at this point
      })

      // Check if we're in a git repository
      const gitSpinner = showProgress('Checking git repository...')
      try {
        execSync('git status', { stdio: 'ignore' })
        gitSpinner.succeed('Git repository verified')
      } catch {
        gitSpinner.fail('Not a git repository')
        console.error('❌ This must be run in a git repository')
        console.log('Run "git init" first, then try again.')
        process.exit(1)
      }

      // Enforce FREE tier repo limit (1 private repo)
      // Must happen before any file modifications
      const license = getLicenseInfo()
      let pendingRepoRegistration = null
      let pendingRepoUsageSnapshot = null
      if (license.tier === 'FREE') {
        // Generate unique repo ID from git remote or directory name
        let repoId
        try {
          const remoteUrl = execSync('git remote get-url origin', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim()
          const normalized = normalizeRepoIdentifier(remoteUrl)
          repoId = hashRepoIdentifier(normalized || remoteUrl)
        } catch {
          // No remote - use absolute path as fallback
          repoId = hashRepoIdentifier(process.cwd())
        }

        const repoCheck = checkUsageCaps('repo')
        const currentRepos = repoCheck.usage?.repos || []

        // Only enforce if this is a NEW repo (not already tracked)
        if (!currentRepos.includes(repoId)) {
          if (!repoCheck.allowed) {
            console.error(`\n❌ ${repoCheck.reason}`)
            console.error(
              '   Upgrade to Pro for unlimited repos: https://vibebuildlab.com/qa-architect'
            )
            process.exit(1)
          }

          pendingRepoRegistration = repoId
          pendingRepoUsageSnapshot = repoCheck.usage
        }
      }

      // Validate custom template path BEFORE any mutations
      if (customTemplatePath) {
        if (!fs.existsSync(customTemplatePath)) {
          console.error(
            `❌ Custom template path does not exist: ${customTemplatePath}`
          )
          console.error(
            '\nWhen using --template, the path must exist and be a valid directory.'
          )
          console.error('Please check the path and try again.\n')
          process.exit(1)
        }

        const stats = fs.statSync(customTemplatePath)
        if (!stats.isDirectory()) {
          console.error(
            `❌ Custom template path is not a directory: ${customTemplatePath}`
          )
          console.error(
            '\nThe --template path must be a directory containing template files.'
          )
          console.error('Please provide a valid directory path.\n')
          process.exit(1)
        }

        console.log(`✅ Custom template path validated: ${customTemplatePath}`)
      }

      // Check if package.json exists with validation
      const packageJsonPath = path.join(process.cwd(), 'package.json')
      let packageJson = {}

      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8')
          // Validate JSON content before parsing
          if (packageJsonContent.trim().length === 0) {
            console.error('❌ package.json is empty')
            console.log(
              'Please add valid JSON content to package.json and try again.'
            )
            process.exit(1)
          }

          packageJson = JSON.parse(packageJsonContent)

          // Validate package.json structure
          if (typeof packageJson !== 'object' || packageJson === null) {
            console.error('❌ package.json must contain a valid JSON object')
            console.log('Please fix the package.json structure and try again.')
            process.exit(1)
          }

          // Sanitize package name if present
          if (packageJson.name && typeof packageJson.name === 'string') {
            packageJson.name =
              validateAndSanitizeInput(packageJson.name) || 'my-project'
          }

          console.log('✅ Found existing package.json')
        } catch (error) {
          console.error(`❌ Error parsing package.json: ${error.message}`)
          console.log(
            'Please fix the JSON syntax in package.json and try again.'
          )
          console.log(
            'Common issues: trailing commas, missing quotes, unclosed brackets'
          )
          process.exit(1)
        }
      } else {
        console.log('📦 Creating new package.json')
        const projectName =
          validateAndSanitizeInput(path.basename(process.cwd())) || 'my-project'
        packageJson = {
          name: projectName,
          version: '1.0.0',
          description: '',
          main: 'index.js',
          scripts: {},
          devDependencies: {},
          'lint-staged': {},
        }
      }

      const hasTypeScriptDependency = Boolean(
        (packageJson.devDependencies &&
          packageJson.devDependencies.typescript) ||
        (packageJson.dependencies && packageJson.dependencies.typescript)
      )

      const tsconfigCandidates = ['tsconfig.json', 'tsconfig.base.json']
      const hasTypeScriptConfig = tsconfigCandidates.some(file =>
        fs.existsSync(path.join(process.cwd(), file))
      )

      const usesTypeScript = Boolean(
        hasTypeScriptDependency || hasTypeScriptConfig
      )
      if (usesTypeScript) {
        console.log(
          '🔍 Detected TypeScript configuration; enabling TypeScript lint defaults'
        )
      }

      // Python detection (including in workspace packages for monorepos)
      const pythonCandidates = [
        'pyproject.toml',
        'setup.py',
        'requirements.txt',
        'poetry.lock',
      ]
      const hasPythonConfig = pythonCandidates.some(file =>
        fs.existsSync(path.join(process.cwd(), file))
      )

      /**
       * Count meaningful Python files recursively (excluding boilerplate like __init__.py, conftest.py)
       * Limited to 2 levels deep to avoid performance issues in large monorepos
       */
      function countMeaningfulPythonFiles(dir, depth = 0, maxDepth = 2) {
        if (depth > maxDepth) return 0

        try {
          const entries = safeReadDir(dir)
          const trivialFiles = ['__init__.py', 'conftest.py']

          let count = entries.filter(
            dirent =>
              dirent.isFile() &&
              dirent.name.endsWith('.py') &&
              !trivialFiles.includes(dirent.name)
          ).length

          const skipDirs = [
            'node_modules',
            '.git',
            'dist',
            'build',
            'coverage',
            '__pycache__',
            'venv',
            '.venv',
          ]
          for (const dirent of entries) {
            if (dirent.isDirectory() && !skipDirs.includes(dirent.name)) {
              const subDir = path.join(dir, dirent.name)
              count += countMeaningfulPythonFiles(subDir, depth + 1, maxDepth)
            }
          }

          return count
        } catch (error) {
          if (
            process.env.DEBUG &&
            error.code !== 'ENOENT' &&
            error.code !== 'EACCES'
          ) {
            console.warn(
              `⚠️  Could not scan ${dir} for Python files: ${error.message}`
            )
          }
          return 0
        }
      }

      const meaningfulPyFileCount = countMeaningfulPythonFiles(process.cwd())
      const hasPythonFiles = meaningfulPyFileCount >= 5

      // Config files alone are not enough (qa-architect may have created them previously).
      // Require config + at least 1 meaningful .py file, OR 5+ meaningful .py files standalone.
      const usesPython = Boolean(
        (hasPythonConfig && meaningfulPyFileCount >= 1) || hasPythonFiles
      )
      if (usesPython) {
        console.log(
          '🐍 Detected Python project; enabling Python quality automation'
        )
      }

      // Shell project detection
      const { ProjectMaturityDetector } = require('./lib/project-maturity')
      const maturityDetector = new ProjectMaturityDetector({
        projectPath: process.cwd(),
      })
      const projectStats = maturityDetector.analyzeProject()
      const usesShell = projectStats.isShellProject
      if (usesShell) {
        console.log(
          '🐚 Detected shell script project; enabling shell quality automation'
        )
      }

      const stylelintTargets = findStylelintTargets(process.cwd())
      const usingDefaultStylelintTarget =
        stylelintTargets.length === 1 &&
        stylelintTargets[0] === STYLELINT_DEFAULT_TARGET
      if (!usingDefaultStylelintTarget) {
        console.log(
          `🔍 Detected stylelint targets: ${stylelintTargets.join(', ')}`
        )
      }

      // Add quality automation scripts (conservative: do not overwrite existing)
      console.log('📝 Adding quality automation scripts...')
      const defaultScripts = getDefaultScripts({
        typescript: usesTypeScript,
        stylelintTargets,
      })

      // Import enhanced scripts to fix production quality gaps
      const {
        getEnhancedTypeScriptScripts,
      } = require('./lib/typescript-config-generator')
      const enhancedScripts = getEnhancedTypeScriptScripts()

      // Merge both default and enhanced scripts
      packageJson.scripts = mergeScripts(packageJson.scripts || {}, {
        ...defaultScripts,
        ...enhancedScripts,
      })

      // Add devDependencies
      console.log('📦 Adding devDependencies...')
      const defaultDevDependencies = getDefaultDevDependencies({
        typescript: usesTypeScript,
      })
      packageJson.devDependencies = mergeDevDependencies(
        packageJson.devDependencies || {},
        defaultDevDependencies
      )

      // Add lint-staged configuration
      console.log('⚙️ Adding lint-staged configuration...')
      const defaultLintStaged = getDefaultLintStaged({
        typescript: usesTypeScript,
        stylelintTargets,
        python: usesPython,
      })

      // Import enhanced lint-staged to fix production quality gaps
      const {
        getEnhancedLintStaged,
      } = require('./lib/typescript-config-generator')
      const enhancedLintStaged = getEnhancedLintStaged(
        usesPython,
        usesTypeScript
      )

      // Merge enhanced configuration with defaults
      const finalLintStaged = { ...defaultLintStaged, ...enhancedLintStaged }

      const hasExistingCssPatterns = Object.keys(
        packageJson['lint-staged'] || {}
      ).some(patternIncludesStylelintExtension)

      if (hasExistingCssPatterns) {
        console.log(
          'ℹ️ Detected existing lint-staged CSS globs; preserving current CSS targets'
        )
      }

      packageJson['lint-staged'] = mergeLintStaged(
        finalLintStaged,
        packageJson['lint-staged'] || {},
        { stylelintTargets },
        patternIncludesStylelintExtension
      )

      // Write updated package.json using @npmcli/package-json
      try {
        const PackageJson = checkNodeVersionAndLoadPackageJson()
        let pkgJson
        if (fs.existsSync(packageJsonPath)) {
          // Load existing package.json
          pkgJson = await PackageJson.load(process.cwd())
          // Update with our changes
          Object.assign(pkgJson.content, packageJson)
        } else {
          // Create new package.json
          pkgJson = await PackageJson.create(process.cwd())
          Object.assign(pkgJson.content, packageJson)
        }

        await pkgJson.save()
        console.log('✅ Updated package.json')
      } catch (error) {
        console.error(`❌ Error writing package.json: ${error.message}`)
        process.exit(1)
      }

      // Ensure Node toolchain pinning in target project
      const nvmrcPath = path.join(process.cwd(), '.nvmrc')
      if (!fs.existsSync(nvmrcPath)) {
        fs.writeFileSync(nvmrcPath, '20\n')
        console.log('✅ Added .nvmrc (Node 20)')
      }

      const npmrcPath = path.join(process.cwd(), '.npmrc')
      if (!fs.existsSync(npmrcPath)) {
        fs.writeFileSync(npmrcPath, 'engine-strict = true\n')
        console.log('✅ Added .npmrc (engine-strict)')
      }

      // Generate .qualityrc.json with detected maturity level
      const qualityrcPath = path.join(process.cwd(), '.qualityrc.json')
      if (!fs.existsSync(qualityrcPath)) {
        // Reuse maturityDetector from earlier in this scope
        const detectedMaturity = maturityDetector.detect()
        const stats = maturityDetector.analyzeProject()

        const qualityConfig = {
          version: '1.0.0',
          maturity: 'auto',
          detected: {
            level: detectedMaturity,
            sourceFiles: stats.totalSourceFiles,
            testFiles: stats.testFiles,
            hasDocumentation: stats.hasDocumentation,
            hasDependencies: stats.hasDependencies,
            detectedAt: new Date().toISOString(),
          },
          checks: {
            prettier: { enabled: true, required: true },
            eslint: { enabled: 'auto', required: false },
            stylelint: { enabled: 'auto', required: false },
            tests: { enabled: 'auto', required: false },
            coverage: { enabled: false, required: false, threshold: 80 },
            'security-audit': { enabled: 'auto', required: false },
            documentation: { enabled: false, required: false },
            lighthouse: { enabled: false, required: false },
          },
        }

        fs.writeFileSync(
          qualityrcPath,
          JSON.stringify(qualityConfig, null, 2) + '\n'
        )
        console.log(`✅ Added .qualityrc.json (detected: ${detectedMaturity})`)

        // Validate the generated config
        const validationResult = validateQualityConfig(qualityrcPath)
        if (!validationResult.valid) {
          console.error(
            '\n❌ CRITICAL: Generated .qualityrc.json failed validation'
          )
          console.error(
            '   This should never happen. Please report this bug.\n'
          )

          console.error('Validation errors:')
          validationResult.errors.forEach((error, index) => {
            console.error(`   ${index + 1}. ${error}`)
          })

          console.error(`\n🐛 Report issue with this info:`)
          console.error(`   • File: ${qualityrcPath}`)
          console.error(`   • Detected maturity: ${detectedMaturity}`)
          console.error(`   • Error count: ${validationResult.errors.length}`)
          console.error(
            `   • https://github.com/vibebuildlab/qa-architect/issues/new\n`
          )

          // Don't continue - this is a bug in the tool itself
          throw new Error('Invalid quality config generated - cannot continue')
        }
      } else {
        // TD8 fix: Re-enabled validation (was disabled for debugging)
        const validationResult = validateQualityConfig(qualityrcPath)
        if (!validationResult.valid) {
          console.warn(
            '⚠️  Warning: Existing .qualityrc.json has validation issues:'
          )
          validationResult.errors.forEach(error => {
            console.warn(`   - ${error}`)
          })
          console.warn(
            '   Setup will continue, but you may want to fix these issues.\n'
          )
        }
      }

      // Load and merge templates (custom + defaults)
      // Enable strict mode when custom template path is explicitly provided
      const templateSpinner = showProgress('Loading templates...')
      const templateLoader = new TemplateLoader({
        verbose: true,
        strict: !!customTemplatePath,
      })

      let templates
      try {
        templates = await templateLoader.mergeTemplates(
          customTemplatePath,
          __dirname
        )
        if (customTemplatePath) {
          templateSpinner.succeed('Custom templates loaded successfully')
        } else {
          templateSpinner.succeed('Default templates loaded')
        }
      } catch (error) {
        templateSpinner.fail('Template loading failed')
        console.error(`❌ Template loading failed: ${error.message}`)
        console.error(
          '\nWhen using --template, the path must exist and be a valid directory.'
        )
        console.error('Please check the path and try again.\n')
        process.exit(1)
      }

      // Create CI configuration based on provider
      const configSpinner = showProgress('Copying configuration files...')
      const githubWorkflowDir = path.join(process.cwd(), '.github', 'workflows')

      if (ciProvider === 'gitlab') {
        const gitlabConfigPath = path.join(process.cwd(), '.gitlab-ci.yml')
        if (!fs.existsSync(gitlabConfigPath)) {
          const templateGitlab =
            templateLoader.getTemplate(
              templates,
              path.join('ci', 'gitlab-ci.yml')
            ) ||
            fs.readFileSync(
              path.join(__dirname, 'templates/ci/gitlab-ci.yml'),
              'utf8'
            )
          fs.writeFileSync(gitlabConfigPath, templateGitlab)
          console.log('✅ Added GitLab CI workflow')
        }
      } else if (ciProvider === 'circleci') {
        const circleDir = path.join(process.cwd(), '.circleci')
        if (!fs.existsSync(circleDir)) {
          fs.mkdirSync(circleDir, { recursive: true })
          console.log('📁 Created .circleci directory')
        }
        const circleConfigPath = path.join(circleDir, 'config.yml')
        if (!fs.existsSync(circleConfigPath)) {
          const templateCircle =
            templateLoader.getTemplate(
              templates,
              path.join('ci', 'circleci-config.yml')
            ) ||
            fs.readFileSync(
              path.join(__dirname, 'templates/ci/circleci-config.yml'),
              'utf8'
            )
          fs.writeFileSync(circleConfigPath, templateCircle)
          console.log('✅ Added CircleCI workflow')
        }
      } else {
        // Default: GitHub Actions
        if (!fs.existsSync(githubWorkflowDir)) {
          fs.mkdirSync(githubWorkflowDir, { recursive: true })
          console.log('📁 Created .github/workflows directory')
        }

        const workflowFile = path.join(githubWorkflowDir, 'quality.yml')

        // Determine workflow mode
        /** @type {'minimal'|'standard'|'comprehensive'} */
        let workflowMode = 'minimal' // Default to minimal
        if (isWorkflowMinimal) {
          workflowMode = 'minimal'
        } else if (isWorkflowStandard) {
          workflowMode = 'standard'
        } else if (isWorkflowComprehensive) {
          workflowMode = 'comprehensive'
        } else if (fs.existsSync(workflowFile)) {
          // Detect existing mode when updating
          const existingMode = detectExistingWorkflowMode(process.cwd())
          if (
            existingMode === 'minimal' ||
            existingMode === 'standard' ||
            existingMode === 'comprehensive'
          ) {
            workflowMode = existingMode
          }
        }

        if (!fs.existsSync(workflowFile)) {
          let templateWorkflow =
            templateLoader.getTemplate(
              templates,
              path.join('.github', 'workflows', 'quality.yml')
            ) ||
            fs.readFileSync(
              path.join(__dirname, '.github/workflows/quality.yml'),
              'utf8'
            )

          // Inject workflow mode configuration
          templateWorkflow = injectWorkflowMode(templateWorkflow, workflowMode)

          // Inject matrix testing if enabled (for library authors)
          templateWorkflow = injectMatrix(templateWorkflow, isMatrixEnabled)

          // Inject collaboration steps
          templateWorkflow = injectCollaborationSteps(templateWorkflow, {
            enableSlackAlerts,
            enablePrComments,
          })

          fs.writeFileSync(workflowFile, templateWorkflow)
          console.log(`✅ Added GitHub Actions workflow (${workflowMode} mode)`)
        } else if (isUpdateMode) {
          // Update existing workflow with new mode if explicitly specified
          if (
            isWorkflowMinimal ||
            isWorkflowStandard ||
            isWorkflowComprehensive
          ) {
            // Load fresh template and re-inject
            let templateWorkflow =
              templateLoader.getTemplate(
                templates,
                path.join('.github', 'workflows', 'quality.yml')
              ) ||
              fs.readFileSync(
                path.join(__dirname, '.github/workflows/quality.yml'),
                'utf8'
              )

            // Inject workflow mode configuration
            templateWorkflow = injectWorkflowMode(
              templateWorkflow,
              workflowMode
            )

            // Inject matrix testing if enabled (for library authors)
            templateWorkflow = injectMatrix(templateWorkflow, isMatrixEnabled)

            // Inject collaboration steps (preserve from existing if present)
            const existingWorkflow = fs.readFileSync(workflowFile, 'utf8')
            const hasSlackAlerts =
              existingWorkflow.includes('SLACK_WEBHOOK_URL')
            const hasPrComments = existingWorkflow.includes(
              'PR_COMMENT_PLACEHOLDER'
            )

            templateWorkflow = injectCollaborationSteps(templateWorkflow, {
              enableSlackAlerts: hasSlackAlerts,
              enablePrComments: hasPrComments,
            })

            fs.writeFileSync(workflowFile, templateWorkflow)
            console.log(
              `♻️  Updated GitHub Actions workflow to ${workflowMode} mode`
            )
          }
        }
      }

      // Copy Prettier config if it doesn't exist
      const prettierrcPath = path.join(process.cwd(), '.prettierrc')
      if (!fs.existsSync(prettierrcPath)) {
        const templatePrettierrc =
          templateLoader.getTemplate(templates, '.prettierrc') ||
          fs.readFileSync(path.join(__dirname, '.prettierrc'), 'utf8')
        fs.writeFileSync(prettierrcPath, templatePrettierrc)
        console.log('✅ Added Prettier configuration')
      }

      // Copy ESLint config if it doesn't exist
      const eslintConfigPath = path.join(process.cwd(), 'eslint.config.cjs')
      const eslintTemplateFile = usesTypeScript
        ? 'eslint.config.ts.cjs'
        : 'eslint.config.cjs'
      const templateEslint =
        templateLoader.getTemplate(templates, eslintTemplateFile) ||
        fs.readFileSync(path.join(__dirname, eslintTemplateFile), 'utf8')

      if (!fs.existsSync(eslintConfigPath)) {
        fs.writeFileSync(eslintConfigPath, templateEslint)
        console.log(
          `✅ Added ESLint configuration${usesTypeScript ? ' (TypeScript-aware)' : ''}`
        )
      } else if (usesTypeScript) {
        const existingConfig = fs.readFileSync(eslintConfigPath, 'utf8')
        if (!existingConfig.includes('@typescript-eslint')) {
          fs.writeFileSync(eslintConfigPath, templateEslint)
          console.log('♻️ Updated ESLint configuration with TypeScript support')
        }
      }

      const legacyEslintrcPath = path.join(process.cwd(), '.eslintrc.json')
      if (fs.existsSync(legacyEslintrcPath)) {
        console.log(
          'ℹ️ Detected legacy .eslintrc.json; ESLint 9 prefers eslint.config.cjs. Consider removing the legacy file after verifying the new config.'
        )
      }

      // Copy Stylelint config if it doesn't exist
      const stylelintrcPath = path.join(process.cwd(), '.stylelintrc.json')
      if (!fs.existsSync(stylelintrcPath)) {
        const templateStylelint =
          templateLoader.getTemplate(templates, '.stylelintrc.json') ||
          fs.readFileSync(path.join(__dirname, '.stylelintrc.json'), 'utf8')
        fs.writeFileSync(stylelintrcPath, templateStylelint)
        console.log('✅ Added Stylelint configuration')
      }

      // Copy .prettierignore if it doesn't exist
      const prettierignorePath = path.join(process.cwd(), '.prettierignore')
      if (!fs.existsSync(prettierignorePath)) {
        const templatePrettierignore =
          templateLoader.getTemplate(templates, '.prettierignore') ||
          fs.readFileSync(path.join(__dirname, '.prettierignore'), 'utf8')
        fs.writeFileSync(prettierignorePath, templatePrettierignore)
        console.log('✅ Added Prettier ignore file')
      }

      // Copy Lighthouse CI config if it doesn't exist
      const lighthousercPath = path.join(process.cwd(), '.lighthouserc.js')
      if (!fs.existsSync(lighthousercPath)) {
        const templateLighthouserc =
          templateLoader.getTemplate(
            templates,
            path.join('config', '.lighthouserc.js')
          ) ||
          fs.readFileSync(
            path.join(__dirname, 'config', '.lighthouserc.js'),
            'utf8'
          )
        fs.writeFileSync(lighthousercPath, templateLighthouserc)
        console.log('✅ Added Lighthouse CI configuration')
      }

      // Copy ESLint ignore if it doesn't exist
      const eslintignorePath = path.join(process.cwd(), '.eslintignore')
      const eslintignoreTemplatePath = path.join(__dirname, '.eslintignore')
      if (
        !fs.existsSync(eslintignorePath) &&
        (templateLoader.hasTemplate(templates, '.eslintignore') ||
          fs.existsSync(eslintignoreTemplatePath))
      ) {
        const templateEslintIgnore =
          templateLoader.getTemplate(templates, '.eslintignore') ||
          fs.readFileSync(eslintignoreTemplatePath, 'utf8')
        fs.writeFileSync(eslintignorePath, templateEslintIgnore)
        console.log('✅ Added ESLint ignore file')
      }

      // Copy .editorconfig if it doesn't exist
      const editorconfigPath = path.join(process.cwd(), '.editorconfig')
      if (!fs.existsSync(editorconfigPath)) {
        const templateEditorconfig =
          templateLoader.getTemplate(templates, '.editorconfig') ||
          fs.readFileSync(path.join(__dirname, '.editorconfig'), 'utf8')
        fs.writeFileSync(editorconfigPath, templateEditorconfig)
        console.log('✅ Added .editorconfig')
      }

      configSpinner.succeed('Configuration files copied')

      // Ensure .gitignore exists with essential entries
      const gitignorePath = path.join(process.cwd(), '.gitignore')
      if (!fs.existsSync(gitignorePath)) {
        const essentialGitignore = `# Dependencies
node_modules/
.pnpm-store/

# Environment variables
.env*

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Build outputs
dist/
build/
.next/
.nuxt/
.output/
.vercel/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Coverage
coverage/
.nyc_output/

# Cache
.cache/
.parcel-cache/
.turbo/
`
        fs.writeFileSync(gitignorePath, essentialGitignore)
        console.log('✅ Added .gitignore with essential entries')
      }

      // Ensure Husky pre-commit hook runs lint-staged
      const huskySpinner = showProgress('Setting up Husky git hooks...')
      try {
        const huskyDir = path.join(process.cwd(), '.husky')
        if (!fs.existsSync(huskyDir)) {
          fs.mkdirSync(huskyDir, { recursive: true })
        }
        const preCommitPath = path.join(huskyDir, 'pre-commit')
        if (!fs.existsSync(preCommitPath)) {
          const hook =
            '# Run lint-staged on staged files\nnpx --no -- lint-staged\n'
          fs.writeFileSync(preCommitPath, hook)
          fs.chmodSync(preCommitPath, 0o755)
          console.log('✅ Added Husky pre-commit hook (lint-staged)')
        }
      } catch (e) {
        huskySpinner.warn('Could not create Husky pre-commit hook')
        console.warn('⚠️ Could not create Husky pre-commit hook:', e.message)
      }

      // Ensure Husky pre-push hook runs validation checks
      try {
        const huskyDir = path.join(process.cwd(), '.husky')
        if (!fs.existsSync(huskyDir)) {
          fs.mkdirSync(huskyDir, { recursive: true })
        }
        const prePushPath = path.join(huskyDir, 'pre-push')
        if (!fs.existsSync(prePushPath)) {
          const hook = `echo "🔍 Running pre-push validation..."

# Enforce Free tier pre-push cap (50/month)
node - <<'EOF'
const fs = require('fs')
const path = require('path')
const os = require('os')

const licenseDir =
  process.env.QAA_LICENSE_DIR || path.join(os.homedir(), '.create-qa-architect')
const licenseFile = path.join(licenseDir, 'license.json')
const usageFile = path.join(licenseDir, 'usage.json')
const now = new Date()
const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')

let usage = {
  month: currentMonth,
  prePushRuns: 0,
  dependencyPRs: 0,
  repos: [],
}

let tier = 'FREE'
try {
  const data = JSON.parse(fs.readFileSync(licenseFile, 'utf8'))
  tier = (data && data.tier) || 'FREE'
} catch (error) {
  tier = 'FREE'
}

if (tier !== 'FREE') {
  process.exit(0)
}

try {
  const data = JSON.parse(fs.readFileSync(usageFile, 'utf8'))
  if (data.month === currentMonth) {
    usage = { ...usage, ...data }
  }
} catch (error) {
  // First run or corrupt file – start fresh
}

const CAP = 50
if (usage.prePushRuns >= CAP) {
console.error('❌ Free tier limit reached: ' + usage.prePushRuns + '/' + CAP + ' pre-push runs this month')
  console.error('   Upgrade to Pro, Team, or Enterprise: https://vibebuildlab.com/qa-architect')
  process.exit(1)
}

usage.prePushRuns += 1
fs.mkdirSync(licenseDir, { recursive: true })
fs.writeFileSync(usageFile, JSON.stringify(usage, null, 2))
console.log('🧮 Usage: ' + usage.prePushRuns + '/' + CAP + ' pre-push runs used this month')
EOF

# Best Practice: Pre-push runs checks NOT done in pre-commit
# Pre-commit handles: lint, format (on staged files)
# Pre-push handles: type check, tests on changed files

# Validate command patterns (fast - catches deprecated patterns)
if node -e "const pkg=require('./package.json');process.exit(pkg.scripts['test:patterns']?0:1)" 2>/dev/null; then
  echo "🔍 Validating command patterns..."
  npm run test:patterns || {
    echo "❌ Pattern validation failed! Deprecated patterns detected."
    exit 1
  }
fi

# Type check (if TypeScript - not done in pre-commit because it's slow)
if [ -f tsconfig.json ]; then
  echo "📐 Type checking..."
  npx tsc --noEmit || {
    echo "❌ Type check failed! Fix type errors before pushing."
    exit 1
  }
fi

# Test command execution (CRITICAL - prevents command generation bugs)
if node -e "const pkg=require('./package.json');process.exit(pkg.scripts['test:commands']?0:1)" 2>/dev/null; then
  echo "🧪 Testing command execution..."
  npm run test:commands || {
    echo "❌ Command execution tests failed! Generated commands are broken."
    exit 1
  }
fi

# Run tests on changed files only (delta testing - much faster)
# Falls back to full test suite if test:changed doesn't exist
if node -e "const pkg=require('./package.json');process.exit(pkg.scripts['test:changed']?0:1)" 2>/dev/null; then
  echo "🧪 Running tests on changed files..."
  npm run test:changed || {
    echo "❌ Tests failed! Fix failing tests before pushing."
    exit 1
  }
elif node -e "const pkg=require('./package.json');process.exit(pkg.scripts.test?0:1)" 2>/dev/null; then
  echo "🧪 Running unit tests..."
  npm test || {
    echo "❌ Tests failed! Fix failing tests before pushing."
    exit 1
  }
fi

echo "✅ Pre-push validation passed!"
`
          fs.writeFileSync(prePushPath, hook)
          fs.chmodSync(prePushPath, 0o755)
          console.log('✅ Added Husky pre-push hook (validation)')
        }
        huskySpinner.succeed('Husky git hooks configured')
      } catch (e) {
        huskySpinner.warn('Could not create Husky pre-push hook')
        console.warn('⚠️ Could not create Husky pre-push hook:', e.message)
      }

      // Ensure engines/volta pins in target package.json (enforce minimums)
      try {
        if (fs.existsSync(packageJsonPath)) {
          const PackageJson = checkNodeVersionAndLoadPackageJson()
          const pkgJson = await PackageJson.load(process.cwd())

          // Preserve existing engines but enforce Node >=20 minimum
          const existingEngines = pkgJson.content.engines || {}
          pkgJson.content.engines = {
            ...existingEngines,
            node: '>=20', // Always enforce our minimum
          }

          // Preserve existing volta but set our pinned versions
          const existingVolta = pkgJson.content.volta || {}
          pkgJson.content.volta = {
            ...existingVolta,
            node: '20.11.1',
            npm: '10.2.4',
          }

          await pkgJson.save()
          console.log(
            '✅ Ensured engines and Volta pins in package.json (Node >=20 enforced)'
          )
        }
      } catch (e) {
        console.warn(
          '⚠️ Could not update engines/volta in package.json:',
          e.message
        )
      }

      // Python quality automation setup
      if (usesPython) {
        console.log('\n🐍 Setting up Python quality automation...')

        const pythonSpinner = showProgress(
          'Configuring Python quality tools...'
        )

        // Copy pyproject.toml if it doesn't exist
        const pyprojectPath = path.join(process.cwd(), 'pyproject.toml')
        if (!fs.existsSync(pyprojectPath)) {
          const templatePyproject =
            templateLoader.getTemplate(
              templates,
              path.join('config', 'pyproject.toml')
            ) ||
            fs.readFileSync(
              path.join(__dirname, 'config/pyproject.toml'),
              'utf8'
            )
          fs.writeFileSync(pyprojectPath, templatePyproject)
          console.log(
            '✅ Added pyproject.toml with Black, Ruff, isort, mypy config'
          )
        }

        // Copy pre-commit config
        const preCommitPath = path.join(
          process.cwd(),
          '.pre-commit-config.yaml'
        )
        if (!fs.existsSync(preCommitPath)) {
          const templatePreCommit =
            templateLoader.getTemplate(
              templates,
              path.join('config', '.pre-commit-config.yaml')
            ) ||
            fs.readFileSync(
              path.join(__dirname, 'config/.pre-commit-config.yaml'),
              'utf8'
            )
          fs.writeFileSync(preCommitPath, templatePreCommit)
          console.log('✅ Added .pre-commit-config.yaml')
        }

        // Copy requirements-dev.txt
        const requirementsDevPath = path.join(
          process.cwd(),
          'requirements-dev.txt'
        )
        if (!fs.existsSync(requirementsDevPath)) {
          const templateRequirements =
            templateLoader.getTemplate(
              templates,
              path.join('config', 'requirements-dev.txt')
            ) ||
            fs.readFileSync(
              path.join(__dirname, 'config/requirements-dev.txt'),
              'utf8'
            )
          fs.writeFileSync(requirementsDevPath, templateRequirements)
          console.log('✅ Added requirements-dev.txt')
        }

        // Copy/update Python workflow (GitHub Actions only)
        if (ciProvider === 'github') {
          const pythonWorkflowFile = path.join(
            githubWorkflowDir,
            'quality-python.yml'
          )
          if (!fs.existsSync(pythonWorkflowFile) || isUpdateMode) {
            const templatePythonWorkflow =
              templateLoader.getTemplate(
                templates,
                path.join('config', 'quality-python.yml')
              ) ||
              fs.readFileSync(
                path.join(__dirname, 'config/quality-python.yml'),
                'utf8'
              )
            fs.writeFileSync(pythonWorkflowFile, templatePythonWorkflow)
            console.log(
              isUpdateMode
                ? '🔄 Updated Python GitHub Actions workflow'
                : '✅ Added Python GitHub Actions workflow'
            )
          }
        }

        pythonSpinner.succeed('Python quality tools configured')
      }

      // Shell project setup
      if (usesShell) {
        // Copy/update Shell CI workflow (GitHub Actions only)
        if (ciProvider === 'github') {
          const shellCiWorkflowFile = path.join(
            githubWorkflowDir,
            'shell-ci.yml'
          )
          if (!fs.existsSync(shellCiWorkflowFile) || isUpdateMode) {
            const templateShellCiWorkflow =
              templateLoader.getTemplate(
                templates,
                path.join('config', 'shell-ci.yml')
              ) ||
              fs.readFileSync(
                path.join(__dirname, 'config/shell-ci.yml'),
                'utf8'
              )
            fs.writeFileSync(shellCiWorkflowFile, templateShellCiWorkflow)
            console.log(
              isUpdateMode
                ? '🔄 Updated Shell CI GitHub Actions workflow'
                : '✅ Added Shell CI GitHub Actions workflow'
            )
          }

          // Copy/update Shell Quality workflow
          const shellQualityWorkflowFile = path.join(
            githubWorkflowDir,
            'shell-quality.yml'
          )
          if (!fs.existsSync(shellQualityWorkflowFile) || isUpdateMode) {
            const templateShellQualityWorkflow =
              templateLoader.getTemplate(
                templates,
                path.join('config', 'shell-quality.yml')
              ) ||
              fs.readFileSync(
                path.join(__dirname, 'config/shell-quality.yml'),
                'utf8'
              )
            fs.writeFileSync(
              shellQualityWorkflowFile,
              templateShellQualityWorkflow
            )
            console.log(
              isUpdateMode
                ? '🔄 Updated Shell Quality GitHub Actions workflow'
                : '✅ Added Shell Quality GitHub Actions workflow'
            )
          }
        }

        // Create a basic README if it doesn't exist
        const readmePath = path.join(process.cwd(), 'README.md')
        if (!fs.existsSync(readmePath)) {
          const projectName = path.basename(process.cwd())
          const basicReadme = `# ${projectName}

Shell script collection for ${projectName}.

## Usage

\`\`\`bash
# Make scripts executable
chmod +x *.sh

# Run a script
./script-name.sh
\`\`\`

## Development

Quality checks are automated via GitHub Actions:
- ShellCheck linting
- Syntax validation
- Permission checks
- Best practices analysis
`
          fs.writeFileSync(readmePath, basicReadme)
          console.log('✅ Created basic README.md')
        }
      }

      // Clean up stale language workflows in update mode
      if (isUpdateMode && ciProvider === 'github') {
        const staleWorkflows = []
        if (!usesPython) {
          const pythonWf = path.join(githubWorkflowDir, 'quality-python.yml')
          if (fs.existsSync(pythonWf)) {
            fs.unlinkSync(pythonWf)
            staleWorkflows.push('quality-python.yml')
          }
        }
        if (!usesShell) {
          const shellCiWf = path.join(githubWorkflowDir, 'shell-ci.yml')
          const shellQualityWf = path.join(
            githubWorkflowDir,
            'shell-quality.yml'
          )
          if (fs.existsSync(shellCiWf)) {
            fs.unlinkSync(shellCiWf)
            staleWorkflows.push('shell-ci.yml')
          }
          if (fs.existsSync(shellQualityWf)) {
            fs.unlinkSync(shellQualityWf)
            staleWorkflows.push('shell-quality.yml')
          }
        }
        if (staleWorkflows.length > 0) {
          console.log(
            `🗑️  Removed stale workflows: ${staleWorkflows.join(', ')}`
          )
        }
      }

      if (usesPython) {
        // Create tests directory if it doesn't exist
        const testsDir = path.join(process.cwd(), 'tests')
        if (!fs.existsSync(testsDir)) {
          fs.mkdirSync(testsDir)
          fs.writeFileSync(path.join(testsDir, '__init__.py'), '')
          console.log('✅ Created tests directory')
        }

        // Add Python helper scripts to package.json if it exists and is a JS/TS project too
        if (fs.existsSync(packageJsonPath)) {
          try {
            const PackageJson = checkNodeVersionAndLoadPackageJson()
            const pkgJson = await PackageJson.load(process.cwd())

            const pythonScripts = {
              'python:format': 'black .',
              'python:format:check': 'black --check .',
              'python:lint': 'ruff check .',
              'python:lint:fix': 'ruff check --fix .',
              'python:type-check': 'mypy .',
              'python:quality':
                'black --check . && ruff check . && isort --check-only . && mypy .',
              'python:test': 'pytest',
            }

            if (!pkgJson.content.scripts) {
              pkgJson.content.scripts = {}
            }
            // Use mergeScripts to preserve existing scripts
            pkgJson.content.scripts = mergeScripts(
              pkgJson.content.scripts,
              pythonScripts
            )
            await pkgJson.save()
            console.log('✅ Added Python helper scripts to package.json')
          } catch (e) {
            console.warn(
              '⚠️ Could not add Python scripts to package.json:',
              e.message
            )
          }
        }
      }

      // Smart Test Strategy (Pro/Team/Enterprise feature)
      const smartStrategyEnabled = hasFeature('smartTestStrategy')
      if (smartStrategyEnabled) {
        const smartSpinner = showProgress('Setting up Smart Test Strategy...')

        try {
          // Detect project type and generate customized strategy
          const projectType = detectProjectType(process.cwd())
          const { script, projectTypeName } = generateSmartStrategy({
            projectPath: process.cwd(),
            projectName: packageJson.name || path.basename(process.cwd()),
            projectType,
          })

          // Write smart strategy script
          writeSmartStrategy(process.cwd(), script)
          console.log(`✅ Added Smart Test Strategy (${projectTypeName})`)

          // Update pre-push hook to use smart strategy
          const huskyDir = path.join(process.cwd(), '.husky')
          const prePushPath = path.join(huskyDir, 'pre-push')
          const smartPrePush = generateSmartPrePushHook()
          fs.writeFileSync(prePushPath, smartPrePush)
          fs.chmodSync(prePushPath, 0o755)
          console.log('✅ Updated pre-push hook to use smart strategy')

          // Add test tier scripts to package.json
          const testTierScripts = getTestTierScripts(projectType)
          const PackageJson = checkNodeVersionAndLoadPackageJson()
          const pkgJson = await PackageJson.load(process.cwd())
          pkgJson.content.scripts = mergeScripts(
            pkgJson.content.scripts || {},
            testTierScripts
          )
          await pkgJson.save()
          console.log(
            '✅ Added test tier scripts (test:fast, test:medium, test:comprehensive)'
          )

          smartSpinner.succeed('Smart Test Strategy configured')

          console.log('\n💎 Smart Test Strategy Benefits:')
          console.log('   • 70% faster pre-push validation on average')
          console.log('   • Risk-based test selection')
          console.log('   • Adapts to branch, time of day, and change size')
          console.log(
            '   • Override with SKIP_SMART=1, FORCE_COMPREHENSIVE=1, or FORCE_MINIMAL=1'
          )
        } catch (error) {
          smartSpinner.warn('Could not set up Smart Test Strategy')
          console.warn('⚠️ Smart Test Strategy setup error:', error.message)
        }
      } else {
        // Show upgrade message for Free tier users
        console.log('\n💡 Smart Test Strategy is available with Pro tier:')
        console.log('   • 70% faster pre-push validation')
        console.log('   • Intelligent risk-based test selection')
        console.log('   • Saves 10-20 hours/month per developer')
        showUpgradeMessage('Smart Test Strategy')
      }

      // Quality Tools Integration
      await setupQualityTools(usesTypeScript, packageJson)

      // Generate placeholder test file with helpful documentation
      const testsDir = path.join(process.cwd(), 'tests')
      const testExtension = usesTypeScript ? 'ts' : 'js'
      const placeholderTestPath = path.join(
        testsDir,
        `placeholder.test.${testExtension}`
      )

      if (!fs.existsSync(testsDir)) {
        fs.mkdirSync(testsDir, { recursive: true })
      }

      if (!fs.existsSync(placeholderTestPath)) {
        const placeholderContent = `import { describe, it, expect } from 'vitest'

/**
 * PLACEHOLDER TEST FILE
 *
 * This file ensures your test suite passes even when you're just getting started.
 * Replace these placeholders with real tests as you build your application.
 *
 * Progressive Testing Strategy:
 * 1. Start: Use describe.skip() placeholders (tests pass but are marked as skipped)
 * 2. Planning: Convert to it.todo() when you know what to test
 * 3. Implementation: Write actual test implementations
 * 4. Tighten: Remove --passWithNoTests flag once you have real tests
 *
 * To tighten enforcement, update package.json:
 * - Change: "test": "vitest run --passWithNoTests"
 * - To:     "test": "vitest run" (fails if no tests exist)
 */

describe.skip('Example test suite (placeholder)', () => {
  /**
   * These tests are skipped by default to prevent false positives.
   * Remove .skip and implement these tests when you're ready.
   */

  it.todo('should test core functionality')

  it.todo('should handle edge cases')

  it.todo('should validate error conditions')
})

// Example of a passing test (demonstrates test framework is working)
describe('Test framework validation', () => {
  it('should confirm Vitest is properly configured', () => {
    expect(true).toBe(true)
  })
})

/**
 * Next Steps:
 * 1. Create feature-specific test files (e.g., user.test.${testExtension}, api.test.${testExtension})
 * 2. Move these it.todo() placeholders to appropriate test files
 * 3. Implement actual test logic
 * 4. Delete this placeholder.test.${testExtension} file when you have real tests
 *
 * Resources:
 * - Vitest Docs: https://vitest.dev/guide/
 * - Testing Best Practices: https://github.com/goldbergyoni/javascript-testing-best-practices
 */
`
        fs.writeFileSync(placeholderTestPath, placeholderContent)
        console.log(
          `✅ Added placeholder test file (tests/placeholder.test.${testExtension})`
        )
        console.log(
          '   💡 Replace with real tests as you build your application'
        )
      }

      // Apply critical production quality fixes
      console.log('\n🔧 Applying production quality enhancements...')
      const qualityEnhancements = applyProductionQualityFixes('.', {
        hasTypeScript: usesTypeScript,
        hasPython: usesPython,
        skipTypeScriptTests: false,
      })

      // Display applied fixes
      qualityEnhancements.fixes.forEach(fix => console.log(fix))

      // Validate setup for common gaps
      const { warnings, errors } = validateProjectSetup('.')

      if (errors.length > 0) {
        console.log('\n🚨 CRITICAL ISSUES DETECTED:')
        errors.forEach(error => console.log(error))
      }

      if (warnings.length > 0) {
        console.log('\n⚠️  Setup Warnings:')
        warnings.forEach(warning => console.log(warning))
      }

      console.log('\n🎉 Quality automation setup complete!')

      if (pendingRepoRegistration) {
        incrementUsage('repo', 1, pendingRepoRegistration)
        const repoCount = (pendingRepoUsageSnapshot?.repoCount || 0) + 1
        console.log(`✅ Registered repo (FREE tier: ${repoCount}/1 repos used)`)
      }

      // Record telemetry completion event (opt-in only, fails silently)
      telemetry.recordComplete({
        usesPython,
        usesTypeScript,
        hasStylelintFiles: stylelintTargets.length > 0,
        mode: isDryRun ? 'dry-run' : isUpdateMode ? 'update' : 'setup',
      })

      // Dynamic next steps based on detected languages
      console.log('\n📋 Next steps:')

      if (usesPython && fs.existsSync(packageJsonPath)) {
        console.log('JavaScript/TypeScript setup:')
        console.log('1. Run: npm install')
        console.log('2. Run: npm run prepare')
        console.log('\nPython setup:')
        console.log('3. Run: python3 -m pip install -r requirements-dev.txt')
        console.log('4. Run: pre-commit install')
        console.log('\n5. Commit your changes to activate both workflows')
      } else if (usesPython) {
        console.log('Python setup:')
        console.log('1. Run: python3 -m pip install -r requirements-dev.txt')
        console.log('2. Run: pre-commit install')
        console.log('3. Commit your changes to activate the workflow')
      } else {
        console.log('1. Run: npm install')
        console.log('2. Run: npm run prepare')
        console.log('3. Commit your changes to activate the workflow')
      }
      console.log('\n✨ Your project now has:')
      console.log('  • Prettier code formatting')
      console.log('  • Pre-commit hooks via Husky (lint-staged)')
      console.log('  • Pre-push validation (lint, format, tests)')
      console.log('  • GitHub Actions quality checks')
      console.log('  • Lint-staged for efficient processing')
    } // End of runMainSetup function

    // Run main setup (interactive handling already done at top if requested)
    await runMainSetup()
  } // End of normal setup flow

  // Close the main async function and handle errors
})().catch(error => {
  try {
    // Always show stack trace for debugging
    if (error?.stack) {
      console.error('\n🐛 Error stack trace:')
      console.error(error.stack)
    }

    // Record telemetry failure event (opt-in only, fails silently)
    const telemetry = new TelemetrySession()
    telemetry.recordFailure(error, {
      errorLocation: error?.stack ? error.stack.split('\n')[1] : 'unknown',
    })

    // Capture and report error (opt-in only, fails silently)
    const errorReporter = new ErrorReporter('setup')
    const reportId = errorReporter.captureError(error, {
      operation: 'setup',
      errorLocation: error?.stack ? error.stack.split('\n')[1] : 'unknown',
    })

    // Show friendly error message with category
    errorReporter.promptErrorReport(error)

    // If report was captured, show location
    if (reportId) {
      console.log(`\n📊 Error report saved: ${reportId}`)
      console.log(`View at: ~/.create-qa-architect/error-reports.json`)
    }
  } catch (reportingError) {
    // Error in error reporting - fallback to basic error display
    console.error('\n❌ Setup failed with error:')
    console.error(error?.message || error || 'Unknown error')
    if (error?.stack) {
      console.error('\nStack trace:')
      console.error(error.stack)
    }
    // Show error reporting failure for debugging
    if (process.env.DEBUG) {
      console.error('\n⚠️  Error reporting also failed:')
      console.error(
        reportingError?.stack || reportingError?.message || reportingError
      )
    }
  }

  process.exit(1)
})
