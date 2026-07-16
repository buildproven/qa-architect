/**
 * TypeScript Configuration Generator
 * Fixes critical blind spot: tests excluded from TypeScript checking
 */

const fs = require('fs')
const path = require('path')

/**
 * Ensure tests/tsconfig.json exists so generated test type-check commands always
 * have a valid project. Existing project-owned configuration is preserved.
 *
 * The config deliberately inherits framework/test-runner types from the root
 * project instead of assuming Vitest or Jest. Common test directory layouts are
 * included independently of whether QA Architect creates starter tests.
 *
 * @param {string} [projectPath]
 * @returns {string}
 */
function generateTestsTypeScriptConfig(projectPath = '.') {
  const testsDir = path.join(projectPath, 'tests')
  const testsTsConfigPath = path.join(testsDir, 'tsconfig.json')

  if (fs.existsSync(testsTsConfigPath)) {
    return testsTsConfigPath
  }

  // Create tests directory if it doesn't exist
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true })
  }

  // Generate comprehensive tests TypeScript configuration
  const testsTsConfig = {
    extends: '../tsconfig.json',
    compilerOptions: {
      rootDir: '..',
      noEmit: true,
    },
    include: [
      '../tests/**/*',
      '../test/**/*',
      '../__tests__/**/*',
      '../src/**/*.test.*',
      '../src/**/*.spec.*',
      '../*.test.*',
      '../*.spec.*',
    ],
    exclude: ['../node_modules', '../dist', '../build'],
  }

  // Write tests TypeScript configuration
  fs.writeFileSync(
    testsTsConfigPath,
    JSON.stringify(testsTsConfig, null, 2) + '\n'
  )

  return testsTsConfigPath
}

/**
 * Add enhanced npm scripts for comprehensive TypeScript checking
 * Includes both src and tests validation
 */
function getEnhancedTypeScriptScripts(options = {}) {
  const run =
    typeof options.runScript === 'function'
      ? options.runScript
      : name => `npm run ${name}`
  return {
    'type-check': 'tsc --noEmit',
    'type-check:tests': 'tsc --noEmit --project tests/tsconfig.json',
    'type-check:all': `${run('type-check')} && ${run('type-check:tests')}`,
    'quality:check': `${run('type-check:all')} && ${run('lint')} && ${run('test')}`,
    'quality:ci': `${run('quality:check')} && ${run('security:audit')}`,
  }
}

/**
 * Generate enhanced lint-staged configuration
 * Comprehensive quality checks instead of just CLAUDE.md
 */
function getEnhancedLintStaged(usesPython = false, hasTypeScript = false) {
  const lintStaged = {
    'package.json': ['prettier --write'],
    '**/*.{json,md,yml,yaml}': ['prettier --write'],
    '**/*.{js,jsx,mjs,cjs,html}': ['eslint --fix', 'prettier --write'],
    '**/*.{css,scss,sass,less,pcss}': ['stylelint --fix', 'prettier --write'],
  }

  // Add TypeScript checking to pre-commit if TypeScript detected
  if (hasTypeScript) {
    lintStaged['**/*.{ts,tsx}'] = [
      'tsc --noEmit --skipLibCheck',
      'eslint --fix',
      'prettier --write',
    ]

    // Add tests TypeScript checking
    lintStaged['tests/**/*.{ts,tsx,js,jsx}'] = [
      'tsc --noEmit --project tests/tsconfig.json',
      'eslint --fix',
      'prettier --write',
    ]
  }

  // Add Python support if detected
  if (usesPython) {
    lintStaged['**/*.py'] = [
      'black --check --diff',
      'ruff check --fix',
      'isort --check-only --diff',
    ]
  }

  return lintStaged
}

/**
 * Detect project type for adaptive template selection
 */
function detectProjectType(projectPath = '.') {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return 'unknown'
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }

  // API Service Detection
  if (deps.express || deps.fastify || deps.koa || deps['@nestjs/core']) {
    return 'api-service'
  }

  // Frontend App Detection
  if (deps.react || deps.vue || deps.angular || deps.svelte) {
    return 'frontend-app'
  }

  // Mobile App Detection
  if (deps['react-native'] || deps['@ionic/react'] || deps['@capacitor/core']) {
    return 'mobile-app'
  }

  // Library Detection
  if (packageJson.main || packageJson.module || packageJson.exports) {
    return 'library'
  }

  // CLI Tool Detection
  if (packageJson.bin) {
    return 'cli-tool'
  }

  return 'web-app'
}

/**
 * Generate project-specific quality configuration
 */
function getProjectQualityConfig(projectType) {
  const configs = {
    'api-service': {
      qualityGates: {
        typeCheck: { src: true, tests: true },
        lint: { fix: false, failOnError: true },
        test: { unit: true, integration: true },
        security: { audit: true, secretScan: true },
      },
      testTypes: ['unit', 'integration', 'e2e'],
      scripts: {
        'test:integration': 'vitest run tests/integration/**/*.test.{js,ts}',
        'test:e2e': 'vitest run tests/e2e/**/*.test.{js,ts}',
      },
    },

    'frontend-app': {
      qualityGates: {
        typeCheck: { src: true, tests: true },
        lint: { fix: false, failOnError: true },
        test: { unit: true, e2e: true },
        accessibility: { check: true },
      },
      testTypes: ['unit', 'component', 'e2e'],
      scripts: {
        'test:component': 'vitest run tests/components/**/*.test.{js,ts,tsx}',
        'test:e2e': 'playwright test',
        'accessibility:check': 'axe-core tests/accessibility',
      },
    },

    'cli-tool': {
      qualityGates: {
        typeCheck: { src: true, tests: true },
        lint: { fix: false, failOnError: true },
        test: { unit: true, integration: true, commands: true },
        security: { audit: true, secretScan: true },
      },
      testTypes: ['unit', 'integration', 'command'],
      scripts: {
        'test:commands': 'vitest run tests/commands/**/*.test.{js,ts}',
        'test:integration': 'vitest run tests/integration/**/*.test.{js,ts}',
      },
    },
  }

  return (
    configs[projectType] ||
    configs['web-app'] || {
      qualityGates: {
        typeCheck: { src: true, tests: true },
        lint: { fix: false, failOnError: true },
        test: { unit: true },
      },
      testTypes: ['unit'],
      scripts: {},
    }
  )
}

module.exports = {
  generateTestsTypeScriptConfig,
  getEnhancedTypeScriptScripts,
  getEnhancedLintStaged,
  detectProjectType,
  getProjectQualityConfig,
}
