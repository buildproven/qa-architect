'use strict'

const { detectDepMajor } = require('../lib/project-module-type')

const STYLELINT_EXTENSIONS = ['css', 'scss', 'sass', 'less', 'pcss']
const DEFAULT_STYLELINT_TARGET = `**/*.{${STYLELINT_EXTENSIONS.join(',')}}`

/**
 * @typedef {Object} DefaultsOptions
 * @property {string[]=} stylelintTargets
 * @property {boolean=} typescript
 * @property {boolean=} python
 */

const baseScripts = {
  prepare: '[ "$CI" = "true" ] && echo \'Skipping Husky in CI\' || husky',
  format: 'prettier --write .',
  'format:check': 'prettier --check .',
  test: 'vitest run --passWithNoTests',
  'test:watch': 'vitest',
  'test:coverage': 'vitest run --coverage',
  'test:changed': 'vitest run --changed HEAD~1 --passWithNoTests',
  'security:audit':
    'if [ -f pnpm-lock.yaml ]; then pnpm audit --audit-level high; elif [ -f yarn.lock ]; then yarn audit; else npm audit --audit-level high; fi',
  'security:secrets':
    "node -e \"const fs=require('fs');const content=fs.readFileSync('package.json','utf8');if(/[\\\"\\'][a-zA-Z0-9+/]{20,}[\\\"\\']/.test(content)){console.error('❌ Potential hardcoded secrets in package.json');process.exit(1)}else{console.log('✅ No secrets detected in package.json')}\"",
  'security:config': 'npx create-qa-architect@latest --security-config',
  'lighthouse:ci': 'lhci autorun',
  'lighthouse:upload': 'lhci upload',
  'validate:docs': 'npx create-qa-architect@latest --validate-docs',
  'validate:comprehensive': 'npx create-qa-architect@latest --comprehensive',
  'validate:all': 'npm run validate:comprehensive && npm run security:audit',
  'validate:pre-push': `npm run test:patterns --if-present && npm run test:commands --if-present && if node -e "const pkg=require('./package.json');process.exit(pkg.scripts&&pkg.scripts['test:changed']?0:1)" 2>/dev/null; then npm run test:changed; else npm test --if-present; fi`,
}

const normalizeStylelintTargets = stylelintTargets => {
  const targets = Array.isArray(stylelintTargets)
    ? stylelintTargets.filter(Boolean)
    : []
  if (!targets.length) {
    return [DEFAULT_STYLELINT_TARGET]
  }
  return [...new Set(targets)]
}

const stylelintBraceGroup = stylelintTargets => {
  const targets = normalizeStylelintTargets(stylelintTargets)
  if (targets.length === 1) {
    return targets[0]
  }
  return `{${targets.join(',')}}`
}

/**
 * @param {DefaultsOptions} [options]
 * @returns {Record<string, string>}
 */
const baseLintScripts = (options = {}) => {
  const { stylelintTargets } = options
  const stylelintTarget = stylelintBraceGroup(stylelintTargets)
  return {
    lint: `eslint . && stylelint "${stylelintTarget}" --allow-empty-input`,
    'lint:fix': `eslint . --fix && stylelint "${stylelintTarget}" --fix --allow-empty-input`,
  }
}

const baseDevDependencies = {
  husky: '^9.1.4',
  'lint-staged': '^15.2.10',
  prettier: '^3.3.3',
  eslint: '^9.12.0',
  'eslint-plugin-security': '^3.0.1',
  globals: '^15.9.0',
  stylelint: '^16.8.0',
  'stylelint-config-standard': '^37.0.0',
  '@lhci/cli': '^0.14.0',
  vitest: '^2.1.8',
  '@vitest/coverage-v8': '^2.1.8',
  commitlint: '^20.4.1',
  '@commitlint/cli': '^20.4.1',
  '@commitlint/config-conventional': '^20.4.1',
}

const typeScriptDevDependencies = {
  '@typescript-eslint/eslint-plugin': '^8.9.0',
  '@typescript-eslint/parser': '^8.9.0',
}

const baseLintStaged = (patterns, stylelintTargets, usesPython = false) => {
  const lintStaged = {
    'package.json': ['prettier --write'],
    [patterns]: ['eslint --fix', 'prettier --write'],
    '**/*.{json,md,yml,yaml}': ['prettier --write'],
  }

  normalizeStylelintTargets(stylelintTargets).forEach(target => {
    lintStaged[target] = ['stylelint --fix', 'prettier --write']
  })

  // Add Python lint-staged support if Python is detected
  if (usesPython) {
    lintStaged['**/*.py'] = [
      'black --check --diff',
      'ruff check --fix',
      'isort --check-only --diff',
    ]
  }

  return lintStaged
}

const JS_LINT_STAGED_PATTERN = '**/*.{js,jsx,mjs,cjs,html}'
const TS_LINT_STAGED_PATTERN = '**/*.{js,jsx,ts,tsx,mjs,cjs,html}'

const clone = value => JSON.parse(JSON.stringify(value))

/**
 * @param {DefaultsOptions} [options]
 */
function getDefaultScripts({ stylelintTargets } = {}) {
  return {
    ...clone(baseScripts),
    ...baseLintScripts({ stylelintTargets }),
  }
}

/**
 * @param {DefaultsOptions & {projectPath?: string}} [options]
 */
function getDefaultDevDependencies({ typescript, projectPath } = {}) {
  const devDeps = { ...clone(baseDevDependencies) }
  if (typescript) {
    Object.assign(devDeps, typeScriptDevDependencies)
  }

  // Align @vitest/coverage-v8 with the target project's installed vitest
  // major. vitest and its coverage adapter must share a major or npm install
  // fails with ERESOLVE. Without this, a project already on vitest@4 gets
  // our @vitest/coverage-v8@^2.x injected and breaks.
  if (projectPath) {
    const vitestMajor = detectDepMajor(projectPath, 'vitest')
    if (vitestMajor && vitestMajor >= 3) {
      devDeps['@vitest/coverage-v8'] = `^${vitestMajor}.0.0`
      // Also drop our pinned vitest so we don't downgrade the project
      delete devDeps.vitest
    }
  }

  return devDeps
}

/**
 * @param {DefaultsOptions} [options]
 */
function getDefaultLintStaged({ typescript, stylelintTargets, python } = {}) {
  const pattern = typescript ? TS_LINT_STAGED_PATTERN : JS_LINT_STAGED_PATTERN
  return clone(baseLintStaged(pattern, stylelintTargets, python))
}

module.exports = {
  getDefaultDevDependencies,
  getDefaultLintStaged,
  getDefaultScripts,
  STYLELINT_EXTENSIONS,
}
