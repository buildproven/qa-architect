/**
 * Quality Tools Generator
 * Generates configuration for advanced quality tools:
 * - Lighthouse CI (performance, accessibility, SEO, best practices)
 * - Bundle size limits (size-limit)
 * - axe-core accessibility testing
 * - Conventional commits (commitlint)
 * - Coverage thresholds
 */

const fs = require('fs')
const path = require('path')

/**
 * Generate Lighthouse CI configuration
 * @param {Object} options - Configuration options
 * @param {string} [options.projectPath] - Path to project (optional)
 * @param {boolean} [options.hasThresholds] - Whether to include score thresholds (Pro)
 * @param {string} [options.collectUrl] - URL to audit (defaults to http://localhost:3000)
 * @param {string} [options.staticDistDir] - Static distribution directory (optional)
 * @returns {string} lighthouserc.js content
 */
function generateLighthouseConfig(options = {}) {
  const {
    hasThresholds = false,
    collectUrl = 'http://localhost:3000',
    staticDistDir = null,
    budgets = null,
  } = options

  const collectConfig = staticDistDir
    ? `staticDistDir: '${staticDistDir}',`
    : `url: ['${collectUrl}'],
      startServerCommand: 'npm run start',
      startServerReadyPattern: 'ready|listening|started',
      startServerReadyTimeout: 30000,`

  let assertConfig
  if (hasThresholds) {
    // Use custom budgets from .qualityrc.json if provided, otherwise defaults
    const b = budgets || {}
    const fcp = b.maxFCP || 2000
    const lcp = b.maxLCP || 2500
    const cls = b.maxCLS || 0.1
    const tbt = b.maxTBT || 300
    const perf = b.performance || 0.8
    const a11y = b.accessibility || 0.9
    const bp = b.bestPractices || 0.9
    const seo = b.seo || 0.9

    assertConfig = `
    assert: {
      preset: 'lighthouse:recommended',
      assertions: {
        // Performance
        'first-contentful-paint': ['warn', { maxNumericValue: ${fcp} }],
        'largest-contentful-paint': ['error', { maxNumericValue: ${lcp} }],
        'cumulative-layout-shift': ['error', { maxNumericValue: ${cls} }],
        'total-blocking-time': ['warn', { maxNumericValue: ${tbt} }],

        // Categories (0-1 scale)
        'categories:performance': ['warn', { minScore: ${perf} }],
        'categories:accessibility': ['error', { minScore: ${a11y} }],
        'categories:best-practices': ['warn', { minScore: ${bp} }],
        'categories:seo': ['warn', { minScore: ${seo} }],

        // Allow some common warnings
        'unsized-images': 'off',
        'uses-responsive-images': 'off',
      },
    },`
  } else {
    assertConfig = `
    assert: {
      // Basic assertions for Free tier - just warnings, no failures
      assertions: {
        'categories:accessibility': ['warn', { minScore: 0.7 }],
        'categories:best-practices': ['warn', { minScore: 0.7 }],
      },
    },`
  }

  return `module.exports = {
  ci: {
    collect: {
      ${collectConfig}
      numberOfRuns: 3,
    },
    upload: {
      target: 'temporary-public-storage',
    },${assertConfig}
  },
}
`
}

/**
 * Generate size-limit configuration for bundle size limits
 * @param {Object} options - Configuration options
 * @param {string} [options.projectPath] - Path to project (optional, defaults to process.cwd())
 * @returns {Array} size-limit config array
 */
function generateSizeLimitConfig(options = {}) {
  const { projectPath = process.cwd(), budgets = null } = options

  // Detect build output paths
  const possibleDists = ['dist', 'build', '.next', 'out', 'public']
  let distDir = 'dist'

  for (const dir of possibleDists) {
    if (fs.existsSync(path.join(projectPath, dir))) {
      distDir = dir
      break
    }
  }

  // Use custom budgets from .qualityrc.json if provided
  const jsLimit = (budgets && budgets.maxJs) || null
  const cssLimit = (budgets && budgets.maxCss) || null

  // Detect if it's a Next.js app
  const isNextJS =
    fs.existsSync(path.join(projectPath, 'next.config.js')) ||
    fs.existsSync(path.join(projectPath, 'next.config.mjs'))

  if (isNextJS) {
    return [
      {
        path: '.next/static/**/*.js',
        limit: jsLimit || '300 kB',
        webpack: false,
      },
    ]
  }

  return [
    {
      path: `${distDir}/**/*.js`,
      limit: jsLimit || '250 kB',
    },
    {
      path: `${distDir}/**/*.css`,
      limit: cssLimit || '50 kB',
    },
  ]
}

/**
 * Generate commitlint configuration for conventional commits
 * @returns {string} commitlint.config.js content
 */
function generateCommitlintConfig() {
  return `module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Type must be one of the conventional types
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation only
        'style',    // Formatting, no code change
        'refactor', // Code change that neither fixes a bug nor adds a feature
        'perf',     // Performance improvement
        'test',     // Adding tests
        'build',    // Build system or external dependencies
        'ci',       // CI configuration
        'chore',    // Maintenance tasks
        'revert',   // Revert a previous commit
      ],
    ],
    // Subject line max length
    'subject-max-length': [2, 'always', 100],
    // Subject must not be empty
    'subject-empty': [2, 'never'],
    // Type must not be empty
    'type-empty': [2, 'never'],
  },
}
`
}

/**
 * Generate commit-msg hook content for commitlint
 * @returns {string} commit-msg hook content
 */
function generateCommitMsgHook() {
  return `#!/bin/sh
npx --no -- commitlint --edit "$1"
`
}

/**
 * Generate vitest coverage thresholds configuration
 * @param {Object} options - Configuration options
 * @param {number} [options.lines] - Line coverage threshold (default: 70)
 * @param {number} [options.functions] - Function coverage threshold (default: 70)
 * @param {number} [options.branches] - Branch coverage threshold (default: 60)
 * @param {number} [options.statements] - Statement coverage threshold (default: 70)
 * @returns {Object} Coverage threshold config object
 */
function generateCoverageThresholds(options = {}) {
  const { lines = 70, functions = 70, branches = 60, statements = 70 } = options

  return {
    lines,
    functions,
    branches,
    statements,
  }
}

/**
 * Generate vitest.config.ts/js with coverage thresholds
 * @param {Object} options - Configuration options
 * @returns {string} vitest.config content
 */
function generateVitestConfigWithCoverage(options = {}) {
  const { typescript = false, thresholds = {} } = options
  const coverageThresholds = generateCoverageThresholds(thresholds)

  const importStatement = typescript
    ? "import { defineConfig } from 'vitest/config'"
    : "const { defineConfig } = require('vitest/config')"
  const exportStatement = typescript ? 'export default' : 'module.exports ='

  return `${importStatement}

${exportStatement} defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}', 'src/**/*.test.{js,ts}'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.test.{js,ts}',
        '**/*.config.{js,ts,mjs}',
        'coverage/**',
        'dist/**',
        'build/**',
      ],
      thresholds: {
        lines: ${coverageThresholds.lines},
        functions: ${coverageThresholds.functions},
        branches: ${coverageThresholds.branches},
        statements: ${coverageThresholds.statements},
      },
    },
  },
})
`
}

/**
 * Generate axe-core accessibility test setup
 * @returns {string} Accessibility test file content
 */
function generateAxeTestSetup() {
  return `/**
 * Accessibility Testing with axe-core
 *
 * This file sets up automated accessibility testing using axe-core.
 * It can be run as part of your test suite or CI pipeline.
 *
 * Usage:
 *   npm run test:a11y
 *
 * For manual testing, use the browser extension:
 *   https://www.deque.com/axe/browser-extensions/
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// For component testing, use @axe-core/react or @axe-core/playwright
// This example uses puppeteer for full page testing

let browser

describe('Accessibility Tests', () => {
  beforeAll(async () => {
    // If using puppeteer for E2E accessibility testing:
    // const puppeteer = require('puppeteer')
    // browser = await puppeteer.launch()
    // const page = await browser.newPage()

    // For now, this is a placeholder that passes
    // Replace with actual implementation based on your framework
  })

  afterAll(async () => {
    if (browser) {
      await browser.close()
    }
  })

  it.skip('should have no critical accessibility violations on homepage', async () => {
    // Example with puppeteer + @axe-core/puppeteer:
    // const { AxePuppeteer } = require('@axe-core/puppeteer')
    // await page.goto('http://localhost:3000')
    // const results = await new AxePuppeteer(page).analyze()
    // expect(results.violations.filter(v => v.impact === 'critical')).toHaveLength(0)
    expect(true).toBe(true)
  })

  it.skip('should have proper heading hierarchy', async () => {
    // Implement heading hierarchy check
    expect(true).toBe(true)
  })

  it.skip('should have sufficient color contrast', async () => {
    // Implement color contrast check
    expect(true).toBe(true)
  })

  it.skip('should have accessible form labels', async () => {
    // Implement form label check
    expect(true).toBe(true)
  })
})

/**
 * Helper function to run axe-core on a page
 * @param {Object} page - Puppeteer/Playwright page object
 * @returns {Promise<Object>} axe results
 */
export async function runAxeOnPage(page) {
  // Inject axe-core into the page
  await page.addScriptTag({
    path: require.resolve('axe-core'),
  })

  // Run axe
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await axe.run()
  })

  return results
}

/**
 * Filter axe violations by impact level
 * @param {Array} violations - axe violations array
 * @param {Array} levels - Impact levels to include ['critical', 'serious', 'moderate', 'minor']
 * @returns {Array} Filtered violations
 */
export function filterByImpact(violations, levels = ['critical', 'serious']) {
  return violations.filter(v => levels.includes(v.impact))
}
`
}

/**
 * Write Lighthouse CI config to project
 * @param {string} projectPath - Path to project
 * @param {Object} options - Options for config generation
 */
function writeLighthouseConfig(projectPath, options = {}) {
  const configPath = path.join(projectPath, 'lighthouserc.js')
  const config = generateLighthouseConfig(options)

  try {
    fs.writeFileSync(configPath, config)
    return configPath
  } catch (error) {
    const errorMessages = {
      EACCES: `Permission denied: Cannot write to ${configPath}\nTry: sudo chown -R $USER ${path.dirname(configPath)} or run with appropriate permissions`,
      ENOSPC: `No space left on device: Cannot write to ${configPath}\nFree up disk space and try again`,
      EROFS: `Read-only file system: Cannot write to ${configPath}\nEnsure the file system is writable`,
      ENOENT: `Directory does not exist: Cannot write to ${configPath}\nParent directory may be missing. Try: mkdir -p ${path.dirname(configPath)}`,
    }

    const specificMessage =
      errorMessages[error.code] ||
      `Failed to write Lighthouse config to ${configPath}: ${error.message}`
    console.error(`❌ ${specificMessage}`)
    throw new Error(specificMessage)
  }
}

/**
 * Write size-limit config to package.json
 * @param {string} projectPath - Path to project
 * @param {Object} options - Options for config generation
 */
function writeSizeLimitConfig(projectPath, options = {}) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  try {
    if (!fs.existsSync(packageJsonPath)) {
      // Monorepo compatibility: Warn instead of throwing
      // This can happen when running from subdirectories (e.g., apps/factory)
      // or when quality tools are managed at a different level
      console.warn(
        `⚠️  Skipping size-limit config: package.json not found at ${packageJsonPath}`
      )
      console.warn(
        `   This is expected in monorepos or when running from subdirectories`
      )
      return null
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    packageJson['size-limit'] = generateSizeLimitConfig({
      projectPath,
      ...options,
    })
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\n'
    )
    return packageJsonPath
  } catch (error) {
    const errorMessages = {
      EACCES: `Permission denied: Cannot write to ${packageJsonPath}\nTry: sudo chown -R $USER ${path.dirname(packageJsonPath)} or run with appropriate permissions`,
      ENOSPC: `No space left on device: Cannot write to ${packageJsonPath}\nFree up disk space and try again`,
      EROFS: `Read-only file system: Cannot write to ${packageJsonPath}\nEnsure the file system is writable`,
      ENOENT: `Directory does not exist: Cannot write to ${packageJsonPath}\nParent directory may be missing`,
    }

    const specificMessage =
      errorMessages[error.code] ||
      `Failed to write size-limit config to ${packageJsonPath}: ${error.message}`
    console.warn(`⚠️  ${specificMessage}`)
    console.warn(`   Skipping size-limit configuration`)
    return null // Return null instead of throwing
  }
}

/**
 * Write commitlint config to project
 * @param {string} projectPath - Path to project
 */
function writeCommitlintConfig(projectPath) {
  const configPath = path.join(projectPath, 'commitlint.config.js')
  const config = generateCommitlintConfig()

  try {
    fs.writeFileSync(configPath, config)
    return configPath
  } catch (error) {
    const errorMessages = {
      EACCES: `Permission denied: Cannot write to ${configPath}\nTry: sudo chown -R $USER ${path.dirname(configPath)} or run with appropriate permissions`,
      ENOSPC: `No space left on device: Cannot write to ${configPath}\nFree up disk space and try again`,
      EROFS: `Read-only file system: Cannot write to ${configPath}\nEnsure the file system is writable`,
      ENOENT: `Directory does not exist: Cannot write to ${configPath}\nParent directory may be missing. Try: mkdir -p ${path.dirname(configPath)}`,
    }

    const specificMessage =
      errorMessages[error.code] ||
      `Failed to write commitlint config to ${configPath}: ${error.message}`
    console.error(`❌ ${specificMessage}`)
    throw new Error(specificMessage)
  }
}

/**
 * Write commit-msg hook for commitlint
 * @param {string} projectPath - Path to project
 */
function writeCommitMsgHook(projectPath) {
  const huskyDir = path.join(projectPath, '.husky')
  const hookPath = path.join(huskyDir, 'commit-msg')

  try {
    if (!fs.existsSync(huskyDir)) {
      fs.mkdirSync(huskyDir, { recursive: true })
    }

    const hook = generateCommitMsgHook()
    fs.writeFileSync(hookPath, hook)
    fs.chmodSync(hookPath, 0o755)
    return hookPath
  } catch (error) {
    const errorMessages = {
      EACCES: `Permission denied: Cannot write to ${hookPath}\nTry: sudo chown -R $USER ${path.dirname(hookPath)} or run with appropriate permissions`,
      ENOSPC: `No space left on device: Cannot write to ${hookPath}\nFree up disk space and try again`,
      EROFS: `Read-only file system: Cannot write to ${hookPath}\nEnsure the file system is writable`,
      ENOENT: `Directory does not exist: Cannot create ${hookPath}\nParent directory may be missing`,
    }

    const specificMessage =
      errorMessages[error.code] ||
      `Failed to write commit-msg hook to ${hookPath}: ${error.message}`
    console.error(`❌ ${specificMessage}`)
    throw new Error(specificMessage)
  }
}

/**
 * Write axe test setup to project
 * @param {string} projectPath - Path to project
 */
function writeAxeTestSetup(projectPath) {
  const testsDir = path.join(projectPath, 'tests')
  const testPath = path.join(testsDir, 'accessibility.test.js')

  try {
    if (!fs.existsSync(testsDir)) {
      fs.mkdirSync(testsDir, { recursive: true })
    }

    const content = generateAxeTestSetup()
    fs.writeFileSync(testPath, content)
    return testPath
  } catch (error) {
    const errorMessages = {
      EACCES: `Permission denied: Cannot write to ${testPath}\nTry: sudo chown -R $USER ${path.dirname(testPath)} or run with appropriate permissions`,
      ENOSPC: `No space left on device: Cannot write to ${testPath}\nFree up disk space and try again`,
      EROFS: `Read-only file system: Cannot write to ${testPath}\nEnsure the file system is writable`,
      ENOENT: `Directory does not exist: Cannot create ${testPath}\nParent directory may be missing`,
    }

    const specificMessage =
      errorMessages[error.code] ||
      `Failed to write axe test setup to ${testPath}: ${error.message}`
    console.error(`❌ ${specificMessage}`)
    throw new Error(specificMessage)
  }
}

/**
 * Get dev dependencies for quality tools
 * @param {Object} features - Which features to include
 * @returns {Object} Dev dependencies object
 */
function getQualityToolsDependencies(features = {}) {
  const deps = {}

  if (features.lighthouse) {
    deps['@lhci/cli'] = '^0.14.0'
  }

  if (features.sizeLimit) {
    deps['size-limit'] = '^11.0.0'
    deps['@size-limit/file'] = '^11.0.0'
  }

  if (features.commitlint) {
    deps['@commitlint/cli'] = '^20.4.1'
    deps['@commitlint/config-conventional'] = '^20.4.1'
  }

  if (features.axeCore) {
    deps['axe-core'] = '^4.10.0'
  }

  return deps
}

/**
 * Get npm scripts for quality tools
 * @param {Object} features - Which features to include
 * @returns {Object} Scripts object
 */
function getQualityToolsScripts(features = {}) {
  const scripts = {}

  if (features.lighthouse) {
    scripts['lighthouse:ci'] = 'lhci autorun'
    scripts['lighthouse:upload'] = 'lhci upload'
  }

  if (features.sizeLimit) {
    scripts['size'] = 'size-limit'
    scripts['size:why'] = 'size-limit --why'
  }

  if (features.axeCore) {
    scripts['test:a11y'] = 'vitest run tests/accessibility.test.js'
  }

  if (features.coverage) {
    scripts['test:coverage'] = 'vitest run --coverage'
    scripts['test:coverage:check'] =
      'vitest run --coverage --coverage.thresholds.lines=70 --coverage.thresholds.functions=70'
  }

  return scripts
}

module.exports = {
  // Config generators
  generateLighthouseConfig,
  generateSizeLimitConfig,
  generateCommitlintConfig,
  generateCommitMsgHook,
  generateCoverageThresholds,
  generateVitestConfigWithCoverage,
  generateAxeTestSetup,
  // Writers
  writeLighthouseConfig,
  writeSizeLimitConfig,
  writeCommitlintConfig,
  writeCommitMsgHook,
  writeAxeTestSetup,
  // Helpers
  getQualityToolsDependencies,
  getQualityToolsScripts,
}
