'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  PROJECT_CONFIGS,
  detectProjectType,
  generateSmartStrategy,
  writeSmartStrategy,
  generateSmartPrePushHook,
  getTestTierScripts,
} = require('../lib/smart-strategy-generator')

/**
 * Test suite for Smart Strategy Generator
 *
 * Covers:
 * - Project type detection (all 6 types + default fallback)
 * - Strategy generation with template substitution
 * - Strategy file writing
 * - Pre-push hook generation
 * - Test tier script generation
 * - Edge cases: malformed package.json, missing files, custom overrides
 */

// Helper: Create temp project with specific structure
const createTempProject = (options = {}) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-strategy-test-'))

  const { packageJson = null, hasDocs = false, extraFiles = [] } = options

  if (packageJson) {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )
  }

  if (hasDocs) {
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project\n'.repeat(20))
  }

  for (const file of extraFiles) {
    const filePath = path.join(tempDir, file)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `// ${file}\n`)
  }

  return tempDir
}

const cleanup = dir => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

console.log('🧪 Testing Smart Strategy Generator...\n')

// ============================================================
// Test 1: CLI project detection
// ============================================================
{
  console.log('Test 1: CLI project detection')
  const tempDir = createTempProject({
    packageJson: {
      name: 'my-cli',
      bin: { 'my-cli': './index.js' },
    },
  })

  const type = detectProjectType(tempDir)
  assert.strictEqual(type, 'cli', 'Should detect CLI project via bin field')
  console.log('  ✅ CLI project detected via bin field')

  // Also test via scripts.setup
  const tempDir2 = createTempProject({
    packageJson: {
      name: 'my-setup-tool',
      scripts: { setup: 'node setup.js' },
    },
  })
  const type2 = detectProjectType(tempDir2)
  assert.strictEqual(
    type2,
    'cli',
    'Should detect CLI project via scripts.setup'
  )
  console.log('  ✅ CLI project detected via scripts.setup')

  cleanup(tempDir)
  cleanup(tempDir2)
}

// ============================================================
// Test 2: Webapp detection (React, Next.js, Vue, Angular, Svelte)
// ============================================================
{
  console.log('Test 2: Web application detection')

  const frameworks = [
    { dep: 'next', name: 'Next.js' },
    { dep: 'react', name: 'React' },
    { dep: 'vue', name: 'Vue' },
    { dep: '@angular/core', name: 'Angular' },
    { dep: 'svelte', name: 'Svelte' },
  ]

  for (const { dep, name } of frameworks) {
    const tempDir = createTempProject({
      packageJson: {
        name: 'my-app',
        dependencies: { [dep]: '^1.0.0' },
      },
    })

    const type = detectProjectType(tempDir)
    assert.strictEqual(type, 'webapp', `Should detect ${name} as webapp`)
    console.log(`  ✅ ${name} detected as webapp`)
    cleanup(tempDir)
  }
}

// ============================================================
// Test 3: SaaS detection (Stripe, Prisma)
// ============================================================
{
  console.log('Test 3: SaaS application detection')

  const saasMarkers = [
    { dep: 'stripe', name: 'Stripe' },
    { dep: '@stripe/stripe-js', name: 'Stripe.js' },
    { dep: 'prisma', name: 'Prisma' },
  ]

  for (const { dep, name } of saasMarkers) {
    const tempDir = createTempProject({
      packageJson: {
        name: 'my-saas',
        dependencies: { [dep]: '^1.0.0' },
      },
    })

    const type = detectProjectType(tempDir)
    assert.strictEqual(type, 'saas', `Should detect ${name} as SaaS`)
    console.log(`  ✅ ${name} detected as SaaS`)
    cleanup(tempDir)
  }
}

// ============================================================
// Test 4: API service detection (Express, Fastify, Koa, Hapi, Restify)
// ============================================================
{
  console.log('Test 4: API service detection')

  const apiFrameworks = [
    { dep: 'express', name: 'Express' },
    { dep: 'fastify', name: 'Fastify' },
    { dep: 'koa', name: 'Koa' },
    { dep: 'hapi', name: 'Hapi' },
    { dep: 'restify', name: 'Restify' },
  ]

  for (const { dep, name } of apiFrameworks) {
    const tempDir = createTempProject({
      packageJson: {
        name: 'my-api',
        dependencies: { [dep]: '^1.0.0' },
      },
    })

    const type = detectProjectType(tempDir)
    assert.strictEqual(type, 'api', `Should detect ${name} as API`)
    console.log(`  ✅ ${name} detected as API`)
    cleanup(tempDir)
  }
}

// ============================================================
// Test 5: Library detection (via main, module, exports)
// ============================================================
{
  console.log('Test 5: Library/package detection')

  const libraryIndicators = [
    { field: 'main', value: './index.js', name: 'main field' },
    { field: 'module', value: './index.mjs', name: 'module field' },
    { field: 'exports', value: { '.': './index.js' }, name: 'exports field' },
  ]

  for (const { field, value, name } of libraryIndicators) {
    const tempDir = createTempProject({
      packageJson: {
        name: 'my-lib',
        [field]: value,
      },
    })

    const type = detectProjectType(tempDir)
    assert.strictEqual(type, 'library', `Should detect library via ${name}`)
    console.log(`  ✅ Library detected via ${name}`)
    cleanup(tempDir)
  }
}

// ============================================================
// Test 6: Documentation project detection
// ============================================================
{
  console.log('Test 6: Documentation project detection')
  const tempDir = createTempProject({
    hasDocs: true,
    // No dependencies — docs project has no deps
  })

  const type = detectProjectType(tempDir)
  assert.strictEqual(type, 'docs', 'Should detect documentation project')
  console.log('  ✅ Documentation project detected')
  cleanup(tempDir)
}

// ============================================================
// Test 7: Default fallback when no type matches
// ============================================================
{
  console.log('Test 7: Default fallback for unknown project type')
  const tempDir = createTempProject({
    packageJson: { name: 'mystery-project' },
  })

  const type = detectProjectType(tempDir)
  assert.strictEqual(type, 'default', 'Should fall back to default')
  console.log('  ✅ Falls back to default for unrecognized project')
  cleanup(tempDir)
}

// ============================================================
// Test 8: Priority order — SaaS beats webapp when both match
// ============================================================
{
  console.log('Test 8: Detection priority order')

  // Stripe + React → should be SaaS (saas checked before webapp)
  const tempDir = createTempProject({
    packageJson: {
      name: 'my-saas-app',
      dependencies: { stripe: '^1.0.0', react: '^18.0.0', next: '^14.0.0' },
    },
  })

  const type = detectProjectType(tempDir)
  assert.strictEqual(type, 'saas', 'SaaS should take priority over webapp')
  console.log('  ✅ SaaS takes priority over webapp when both match')
  cleanup(tempDir)
}

// ============================================================
// Test 9: No package.json → default
// ============================================================
{
  console.log('Test 9: Project with no package.json')
  const tempDir = createTempProject({})

  const type = detectProjectType(tempDir)
  assert.strictEqual(
    type,
    'default',
    'Should fall back to default with no package.json'
  )
  console.log('  ✅ No package.json falls back to default')
  cleanup(tempDir)
}

// ============================================================
// Test 10: Malformed package.json
// ============================================================
{
  console.log('Test 10: Malformed package.json handling')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-strategy-test-'))
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{invalid json}}}')

  const type = detectProjectType(tempDir)
  assert.strictEqual(
    type,
    'default',
    'Should fall back to default for malformed JSON'
  )
  console.log('  ✅ Malformed package.json handled gracefully')
  cleanup(tempDir)
}

// ============================================================
// Test 11: Strategy generation produces valid script
// ============================================================
{
  console.log('Test 11: Strategy generation')
  const tempDir = createTempProject({
    packageJson: {
      name: 'test-cli',
      bin: { 'test-cli': './index.js' },
    },
  })

  const result = generateSmartStrategy({
    projectPath: tempDir,
    projectName: 'test-cli',
  })

  assert.strictEqual(result.projectType, 'cli', 'Should detect cli type')
  assert.strictEqual(
    result.projectTypeName,
    'CLI Tool',
    'Should have correct type name'
  )
  assert(
    result.script.includes('test-cli'),
    'Script should include project name'
  )
  assert(
    result.script.includes('#!/bin/bash'),
    'Script should have bash shebang'
  )
  assert(result.highRiskRegex, 'Should have high risk regex')
  assert(result.testCommands, 'Should have test commands')
  assert(
    result.testCommands.comprehensive,
    'Should have comprehensive test command'
  )
  assert(result.testCommands.medium, 'Should have medium test command')
  assert(result.testCommands.fast, 'Should have fast test command')
  assert(result.testCommands.minimal, 'Should have minimal test command')
  console.log('  ✅ Strategy generation produces complete result')
  cleanup(tempDir)
}

// ============================================================
// Test 12: Custom overrides in strategy generation
// ============================================================
{
  console.log('Test 12: Custom overrides')
  const tempDir = createTempProject({
    packageJson: { name: 'custom-project' },
  })

  const result = generateSmartStrategy({
    projectPath: tempDir,
    projectType: 'webapp',
    customHighRiskRegex: 'custom-pattern|auth',
    customTestCommands: { fast: 'custom-test-command' },
  })

  assert.strictEqual(result.projectType, 'webapp', 'Should use provided type')
  assert.strictEqual(
    result.highRiskRegex,
    'custom-pattern|auth',
    'Should use custom regex'
  )
  assert.strictEqual(
    result.testCommands.fast,
    'custom-test-command',
    'Should use custom test command'
  )
  assert(
    result.testCommands.comprehensive,
    'Should keep non-overridden commands from config'
  )
  console.log('  ✅ Custom overrides applied correctly')
  cleanup(tempDir)
}

// ============================================================
// Test 13: writeSmartStrategy creates script file
// ============================================================
{
  console.log('Test 13: Write strategy to disk')
  const tempDir = createTempProject({
    packageJson: {
      name: 'write-test',
      bin: { 'write-test': './index.js' },
    },
  })

  const result = generateSmartStrategy({ projectPath: tempDir })
  const scriptPath = writeSmartStrategy(tempDir, result.script)

  assert(fs.existsSync(scriptPath), 'Script file should exist')
  assert(
    scriptPath.endsWith('smart-test-strategy.sh'),
    'Should be named correctly'
  )

  const stat = fs.statSync(scriptPath)
  // Check executable bit (owner execute: 0o100)
  assert(stat.mode & 0o100, 'Script should be executable')

  const content = fs.readFileSync(scriptPath, 'utf8')
  assert(content.includes('#!/bin/bash'), 'Script content should have shebang')
  console.log('  ✅ Strategy written to disk with correct permissions')
  cleanup(tempDir)
}

// ============================================================
// Test 14: Pre-push hook generation
// ============================================================
{
  console.log('Test 14: Pre-push hook generation')
  const hook = generateSmartPrePushHook()

  assert(
    hook.includes('smart pre-push validation'),
    'Should mention smart pre-push'
  )
  assert(
    hook.includes('smart-test-strategy.sh'),
    'Should reference strategy script'
  )
  assert(hook.includes('gitleaks'), 'Should include gitleaks scanning')
  assert(hook.includes('npm audit'), 'Should include npm audit')
  assert(hook.includes('pnpm'), 'Should support pnpm')
  assert(hook.includes('yarn'), 'Should support yarn')
  assert(hook.includes('XSS'), 'Should include XSS detection')
  assert(hook.includes('innerHTML'), 'Should scan for innerHTML injection')
  assert(hook.includes('eval'), 'Should scan for eval injection')
  console.log('  ✅ Pre-push hook includes all security scans')
}

// ============================================================
// Test 15: Test tier scripts
// ============================================================
{
  console.log('Test 15: Test tier scripts')
  const scripts = getTestTierScripts()

  assert(scripts['test:fast'], 'Should have test:fast')
  assert(scripts['test:medium'], 'Should have test:medium')
  assert(scripts['test:comprehensive'], 'Should have test:comprehensive')
  assert(scripts['test:smart'], 'Should have test:smart')
  assert(
    scripts['test:smart'].includes('smart-test-strategy.sh'),
    'test:smart should use strategy script'
  )
  console.log('  ✅ Test tier scripts are correct')
}

// ============================================================
// Test 16: PROJECT_CONFIGS has all expected types
// ============================================================
{
  console.log('Test 16: PROJECT_CONFIGS completeness')
  const expectedTypes = [
    'cli',
    'webapp',
    'saas',
    'api',
    'library',
    'docs',
    'default',
  ]

  for (const type of expectedTypes) {
    assert(PROJECT_CONFIGS[type], `Should have config for ${type}`)
    assert(PROJECT_CONFIGS[type].name, `${type} should have name`)
    assert(
      PROJECT_CONFIGS[type].highRiskRegex,
      `${type} should have highRiskRegex`
    )
    assert(
      PROJECT_CONFIGS[type].testCommands,
      `${type} should have testCommands`
    )
    assert(
      PROJECT_CONFIGS[type].testCommands.comprehensive,
      `${type} should have comprehensive test command`
    )
    assert(
      PROJECT_CONFIGS[type].testCommands.medium,
      `${type} should have medium test command`
    )
    assert(
      PROJECT_CONFIGS[type].testCommands.fast,
      `${type} should have fast test command`
    )
    assert(
      PROJECT_CONFIGS[type].testCommands.minimal,
      `${type} should have minimal test command`
    )
    assert(
      typeof PROJECT_CONFIGS[type].detection === 'function',
      `${type} should have detection function`
    )
  }
  console.log('  ✅ All project configs are complete')
}

// ============================================================
// Test 17: High risk regex patterns are valid strings
// ============================================================
{
  console.log('Test 17: High risk regex patterns are valid')
  const types = ['cli', 'webapp', 'saas', 'api', 'library', 'docs', 'default']

  for (const type of types) {
    const regex = PROJECT_CONFIGS[type].highRiskRegex
    assert(typeof regex === 'string', `${type} should have string regex`)
    assert(regex.length > 0, `${type} regex should not be empty`)
    console.log(`  ✅ ${type} regex is valid: ${regex.substring(0, 40)}...`)
  }
}

// ============================================================
// Test 18: Each project type has unique risk patterns
// ============================================================
{
  console.log('Test 18: Risk patterns match expected domains')

  // CLI should match setup files (regex contains 'setup\\.js')
  assert(
    PROJECT_CONFIGS.cli.highRiskRegex.includes('setup'),
    'CLI risk regex should include setup pattern'
  )

  // Webapp should match auth/payment paths
  assert(
    PROJECT_CONFIGS.webapp.highRiskRegex.includes('auth'),
    'Webapp risk regex should include auth pattern'
  )

  // SaaS should match billing/stripe
  assert(
    PROJECT_CONFIGS.saas.highRiskRegex.includes('billing'),
    'SaaS risk regex should include billing pattern'
  )
  assert(
    PROJECT_CONFIGS.saas.highRiskRegex.includes('stripe'),
    'SaaS risk regex should include stripe pattern'
  )

  // API should match routes/controllers
  assert(
    PROJECT_CONFIGS.api.highRiskRegex.includes('routes'),
    'API risk regex should include routes pattern'
  )

  console.log('  ✅ Risk patterns match expected file paths')
}

console.log('\n✅ All Smart Strategy Generator tests passed!\n')
