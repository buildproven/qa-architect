'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  applyProductionQualityFixes,
  generateEnhancedPreCommitHook,
  validateProjectSetup,
  copyQualityTroubleshootingGuide,
} = require('../lib/setup-enhancements')

/**
 * Test suite for Setup Enhancements
 *
 * Tests pre-commit hook generation, project validation, and file copying.
 */

const createTempProject = (options = {}) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-enhance-test-'))
  const {
    hasPackageJson = false,
    scripts = {},
    hasTsConfig = false,
    hasPreCommit = false,
    preCommitContent = '',
  } = options

  if (hasPackageJson) {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test', scripts }, null, 2)
    )
  }

  if (hasTsConfig) {
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}')
  }

  if (hasPreCommit) {
    fs.mkdirSync(path.join(tempDir, '.husky'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, '.husky/pre-commit'), preCommitContent)
  }

  return tempDir
}

const cleanup = dir => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('🧪 Testing Setup Enhancements...\n')

// ============================================================
// Test 1: Pre-commit hook generation - TypeScript
// ============================================================
{
  console.log('Test 1: Pre-commit hook with TypeScript')
  const hook = generateEnhancedPreCommitHook(true, false)

  assert(hook.includes('lint-staged'), 'Should include lint-staged')
  assert(hook.includes('type-check'), 'Should include TypeScript check')
  assert(hook.includes('test:fast'), 'Should include fast tests')
  assert(
    hook.includes('QUALITY_TROUBLESHOOTING'),
    'Should reference troubleshooting guide'
  )
  console.log('  ✅ PASS')
}

// ============================================================
// Test 2: Pre-commit hook generation - no TypeScript
// ============================================================
{
  console.log('Test 2: Pre-commit hook without TypeScript')
  const hook = generateEnhancedPreCommitHook(false, false)

  assert(hook.includes('lint-staged'), 'Should include lint-staged')
  assert(
    !hook.includes('type-check:all'),
    'Should NOT include TypeScript check'
  )
  assert(hook.includes('test:fast'), 'Should include fast tests')
  console.log('  ✅ PASS')
}

// ============================================================
// Test 3: Pre-commit hook is valid shell script
// ============================================================
{
  console.log('Test 3: Pre-commit hook is valid shell')
  const hook = generateEnhancedPreCommitHook(true, true)

  assert(hook.startsWith('#!/'), 'Should have shebang')
  assert(!hook.includes('undefined'), 'Should not contain undefined')
  assert(!hook.includes('null'), 'Should not contain null')
  console.log('  ✅ PASS')
}

// ============================================================
// Test 4: validateProjectSetup - missing tests/tsconfig.json
// ============================================================
{
  console.log('Test 4: Validation catches missing tests/tsconfig.json')
  const tempDir = createTempProject({
    hasTsConfig: true,
    hasPackageJson: true,
    scripts: {},
  })

  const result = validateProjectSetup(tempDir)
  assert(
    result.errors.length > 0,
    'Should report error for missing tests/tsconfig.json'
  )
  assert(
    result.errors.some(e => e.includes('tests/tsconfig.json')),
    'Error should mention tests/tsconfig.json'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 5: validateProjectSetup - no TypeScript (no errors)
// ============================================================
{
  console.log('Test 5: No TypeScript project has no tsconfig errors')
  const tempDir = createTempProject({ hasPackageJson: true, scripts: {} })

  const { errors } = validateProjectSetup(tempDir)
  const tsErrors = errors.filter(e => e.includes('tsconfig'))
  assert.strictEqual(tsErrors.length, 0, 'Should have no tsconfig errors')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 6: validateProjectSetup - pre-commit missing type-check
// ============================================================
{
  console.log('Test 6: Validation warns about incomplete pre-commit')
  const tempDir = createTempProject({
    hasPreCommit: true,
    preCommitContent: '#!/bin/sh\nnpx lint-staged\n',
    hasPackageJson: true,
    scripts: {},
  })

  const { warnings } = validateProjectSetup(tempDir)
  assert(
    warnings.some(w => w.includes('type-check')),
    'Should warn about missing type-check'
  )
  assert(
    warnings.some(w => w.includes('test')),
    'Should warn about missing test'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 7: validateProjectSetup - good pre-commit (no warnings)
// ============================================================
{
  console.log('Test 7: Complete pre-commit has no warnings about hooks')
  const tempDir = createTempProject({
    hasPreCommit: true,
    preCommitContent:
      '#!/bin/sh\nnpm run type-check:all\nnpm run test:fast\nnpx lint-staged\n',
    hasPackageJson: true,
    scripts: {
      'type-check:all': 'tsc --noEmit',
      'quality:check': 'npm run lint && npm test',
    },
  })

  const { warnings } = validateProjectSetup(tempDir)
  const hookWarnings = warnings.filter(w => w.includes('Pre-commit'))
  assert.strictEqual(
    hookWarnings.length,
    0,
    'Should have no pre-commit warnings'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 8: validateProjectSetup - missing quality scripts
// ============================================================
{
  console.log('Test 8: Validation warns about missing quality scripts')
  const tempDir = createTempProject({
    hasPackageJson: true,
    scripts: { test: 'jest' },
  })

  const { warnings } = validateProjectSetup(tempDir)
  assert(
    warnings.some(w => w.includes('type-check:all')),
    'Should warn about missing type-check:all'
  )
  assert(
    warnings.some(w => w.includes('quality:check')),
    'Should warn about missing quality:check'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 9: copyQualityTroubleshootingGuide
// ============================================================
{
  console.log('Test 9: Quality troubleshooting guide copy')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-enhance-test-'))
  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    'QUALITY_TROUBLESHOOTING.md'
  )

  if (fs.existsSync(templatePath)) {
    copyQualityTroubleshootingGuide(tempDir)
    assert(
      fs.existsSync(path.join(tempDir, 'QUALITY_TROUBLESHOOTING.md')),
      'Guide should be copied'
    )
    console.log('  ✅ PASS')
  } else {
    console.log('  ⏭️ SKIP (template not found)')
  }
  cleanup(tempDir)
}

// ============================================================
// Test 10: validateProjectSetup - no package.json
// ============================================================
{
  console.log('Test 10: No package.json produces no script warnings')
  const tempDir = createTempProject({})

  const { warnings } = validateProjectSetup(tempDir)
  const scriptWarnings = warnings.filter(w => w.includes('script'))
  assert.strictEqual(
    scriptWarnings.length,
    0,
    'No script warnings without package.json'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Test 11: Existing tests do not suppress required TS config
// ============================================================
{
  console.log(
    'Test 11: Existing tests preserve content and still get TS config'
  )
  const tempDir = createTempProject({
    hasTsConfig: true,
    hasPackageJson: true,
    scripts: { test: 'node --test' },
  })
  const testDir = path.join(tempDir, 'test')
  const testPath = path.join(testDir, 'existing.test.ts')
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(testPath, 'export const preserved = true\n')

  applyProductionQualityFixes(tempDir, {
    hasTypeScript: true,
    preserveExistingTests: true,
  })

  assert(
    fs.existsSync(path.join(tempDir, 'tests/tsconfig.json')),
    'Preserving tests must not suppress the required tests TypeScript config'
  )
  assert.strictEqual(
    fs.readFileSync(testPath, 'utf8'),
    'export const preserved = true\n',
    'Existing test content must remain unchanged'
  )
  const testsTsConfigPath = path.join(tempDir, 'tests/tsconfig.json')
  const customTestsConfig =
    '{"extends":"../tsconfig.json","include":["custom/**/*"]}\n'
  fs.writeFileSync(testsTsConfigPath, customTestsConfig)
  applyProductionQualityFixes(tempDir, {
    hasTypeScript: true,
    preserveExistingTests: true,
  })
  assert.strictEqual(
    fs.readFileSync(testsTsConfigPath, 'utf8'),
    customTestsConfig,
    'Existing test TypeScript configuration must remain user-owned'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

console.log('\n✅ All Setup Enhancement tests passed!\n')
