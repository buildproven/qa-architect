'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { getDefaultScripts } = require('../config/defaults')

/**
 * Tests for template content validation
 * These tests ensure templates match actual implementation and best practices
 */
async function testTemplateContentValidation() {
  console.log('🧪 Testing template content validation...\n')

  await testSmartTestStrategyTemplateExcludesE2E()
  await testSmartStrategyGeneratorExcludesE2E()
  await testHuskyPrepareScriptCIAware()
  await testDefaultsPrepareScriptCIAware()
  await testDefaultSecurityAuditStopsOnSelectedManagerFailure()
  await testDefaultValidatePrePushDoesNotMaskEarlierFailures()
  await testGeneratedPrePushHookValidatesLicenseDir()

  console.log('\n✅ All template content validation tests passed!\n')
}

/**
 * Test: Smart test strategy template excludes E2E tests
 * Issue: Template was including E2E tests while implementation excluded them
 */
async function testSmartTestStrategyTemplateExcludesE2E() {
  console.log('🔍 Testing smart test strategy template excludes E2E...')

  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    'scripts',
    'smart-test-strategy.sh'
  )

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`)
  }

  const content = fs.readFileSync(templatePath, 'utf8')

  // Test 1: Template should have comment about E2E exclusion
  if (!content.includes('E2E tests') || !content.includes('run in CI only')) {
    throw new Error(
      'Template missing comment about E2E tests running in CI only'
    )
  }

  // Test 2: HIGH RISK section should NOT include test:e2e
  const highRiskSection = content.match(
    /RISK_SCORE -ge 7.*?\{\{TEST_COMPREHENSIVE\}\}/s
  )
  if (!highRiskSection) {
    throw new Error('Could not find HIGH RISK section in template')
  }

  if (highRiskSection[0].includes('test:e2e')) {
    throw new Error(
      'Template HIGH RISK section should NOT include test:e2e (should run in CI only)'
    )
  }

  // Test 3: Should have explicit note about excluding E2E and command tests
  if (!content.includes('E2E and command tests run in CI only')) {
    throw new Error(
      'Template should explicitly state E2E and command tests run in CI only'
    )
  }

  console.log('  ✅ Smart test strategy template correctly excludes E2E tests')
}

/**
 * Test: Smart strategy generator configurations exclude E2E
 * Issue: Generator was including E2E tests in comprehensive commands
 */
async function testSmartStrategyGeneratorExcludesE2E() {
  console.log('🔍 Testing smart strategy generator excludes E2E...')

  const generatorPath = path.join(
    __dirname,
    '..',
    'lib',
    'smart-strategy-generator.js'
  )

  if (!fs.existsSync(generatorPath)) {
    throw new Error(`Generator not found: ${generatorPath}`)
  }

  const content = fs.readFileSync(generatorPath, 'utf8')

  // Test 1: CLI project comprehensive should NOT include test:comprehensive
  const cliSection = content.match(
    /cli:\s*\{[\s\S]*?testCommands:\s*\{[\s\S]*?\},/m
  )
  if (!cliSection) {
    throw new Error('Could not find CLI project configuration')
  }

  if (cliSection[0].includes("'npm run test:comprehensive")) {
    throw new Error(
      'CLI comprehensive command should not use test:comprehensive (includes command tests)'
    )
  }

  // Test 2: Webapp project comprehensive should NOT include test:e2e
  const webappSection = content.match(
    /webapp:\s*\{[\s\S]*?testCommands:\s*\{[\s\S]*?\},/m
  )
  if (!webappSection) {
    throw new Error('Could not find webapp project configuration')
  }

  if (webappSection[0].includes('test:e2e')) {
    throw new Error(
      'Webapp comprehensive command should not include test:e2e (should run in CI only)'
    )
  }

  // Test 3: Should have comments about E2E exclusion
  const hasCliComment = content.includes(
    'Command execution tests excluded from pre-push'
  )
  const hasWebappComment = content.includes('E2E tests excluded from pre-push')

  if (!hasCliComment || !hasWebappComment) {
    throw new Error(
      'Generator should have comments explaining E2E/command test exclusion'
    )
  }

  console.log('  ✅ Smart strategy generator correctly excludes E2E tests')
}

/**
 * Test: Husky prepare script is CI-aware
 * Issue: Husky was trying to install in CI environments, causing failures
 */
async function testHuskyPrepareScriptCIAware() {
  console.log('🔍 Testing Husky prepare script is CI-aware...')

  const packageJsonPath = path.join(__dirname, '..', 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`)
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

  // Test 1: prepare script should exist
  if (!packageJson.scripts || !packageJson.scripts.prepare) {
    throw new Error('package.json should have a prepare script')
  }

  const prepareScript = packageJson.scripts.prepare

  // Test 2: Should check for CI environment
  if (!prepareScript.includes('$CI')) {
    throw new Error(
      'Prepare script should check $CI environment variable to skip in CI'
    )
  }

  // Test 3: Should skip Husky when CI=true
  if (!prepareScript.includes('Skipping Husky in CI')) {
    throw new Error('Prepare script should have message "Skipping Husky in CI"')
  }

  // Test 4: Should run husky in non-CI environments
  if (!prepareScript.includes('husky')) {
    throw new Error('Prepare script should run husky in non-CI environments')
  }

  // Test 5: Should use conditional logic (&&/||)
  if (!prepareScript.includes('&&') && !prepareScript.includes('||')) {
    throw new Error('Prepare script should use conditional logic to skip in CI')
  }

  console.log('  ✅ Husky prepare script is CI-aware')
}

/**
 * Test: Defaults config includes CI-aware prepare script
 * Issue: Template config didn't have CI-aware Husky setup
 */
async function testDefaultsPrepareScriptCIAware() {
  console.log('🔍 Testing defaults config includes CI-aware prepare...')

  const defaultsPath = path.join(__dirname, '..', 'config', 'defaults.js')

  if (!fs.existsSync(defaultsPath)) {
    throw new Error(`defaults.js not found: ${defaultsPath}`)
  }

  const content = fs.readFileSync(defaultsPath, 'utf8')

  // Test 1: baseScripts should include prepare script
  if (!content.includes('prepare:')) {
    throw new Error('baseScripts should include prepare script')
  }

  // Test 2: Should check for CI environment
  if (!content.includes('$CI')) {
    throw new Error(
      'defaults.js prepare script should check $CI environment variable'
    )
  }

  // Test 3: Should skip Husky in CI
  if (!content.includes('Skipping Husky in CI')) {
    throw new Error('defaults.js prepare script should skip Husky when CI=true')
  }

  // Test 4: Should run husky in non-CI
  if (!content.includes('husky')) {
    throw new Error(
      'defaults.js prepare script should run husky in non-CI environments'
    )
  }

  console.log('  ✅ Defaults config includes CI-aware prepare script')
}

async function testDefaultSecurityAuditStopsOnSelectedManagerFailure() {
  console.log('🔍 Testing default security:audit does not mask failures...')

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqa-audit-script-'))
  const binDir = path.join(tempDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '')
  fs.writeFileSync(
    path.join(binDir, 'pnpm'),
    '#!/bin/sh\necho pnpm-fail\nexit 1\n'
  )
  fs.chmodSync(path.join(binDir, 'pnpm'), 0o755)

  try {
    const scripts = getDefaultScripts()
    let exited = false

    try {
      execSync(`sh -c '${scripts['security:audit']}'`, {
        cwd: tempDir,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        stdio: 'pipe',
      })
    } catch (error) {
      exited = true
      const output = `${error.stdout || ''}${error.stderr || ''}`
      if (!output.includes('pnpm-fail')) {
        throw new Error(
          'security:audit did not execute the selected pnpm audit'
        )
      }
    }

    if (!exited) {
      throw new Error(
        'security:audit should fail when the selected audit fails'
      )
    }

    console.log(
      '  ✅ security:audit stops on the selected package manager failure'
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function testDefaultValidatePrePushDoesNotMaskEarlierFailures() {
  console.log('🔍 Testing default validate:pre-push does not mask failures...')

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqa-pre-push-script-'))
  const binDir = path.join(tempDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })

  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'pre-push-repro',
      version: '1.0.0',
      scripts: {
        'test:changed': 'echo changed-pass',
      },
    })
  )

  fs.writeFileSync(
    path.join(binDir, 'npm'),
    `#!/bin/sh
if [ "$1" = "run" ] && [ "$2" = "test:patterns" ]; then
  echo patterns-fail
  exit 1
fi
if [ "$1" = "run" ] && [ "$2" = "test:commands" ]; then
  echo commands-pass
  exit 0
fi
if [ "$1" = "run" ] && [ "$2" = "test:changed" ]; then
  echo changed-pass
  exit 0
fi
if [ "$1" = "test" ]; then
  echo fallback-pass
  exit 0
fi
echo unexpected-npm-call "$@"
exit 1
`
  )
  fs.chmodSync(path.join(binDir, 'npm'), 0o755)

  try {
    const scripts = getDefaultScripts()
    let exited = false

    try {
      execSync(`sh -c '${scripts['validate:pre-push']}'`, {
        cwd: tempDir,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        stdio: 'pipe',
      })
    } catch (error) {
      exited = true
      const output = `${error.stdout || ''}${error.stderr || ''}`
      if (!output.includes('patterns-fail')) {
        throw new Error(
          'validate:pre-push did not surface the first failing step'
        )
      }
      if (output.includes('fallback-pass')) {
        throw new Error('validate:pre-push incorrectly fell back to npm test')
      }
    }

    if (!exited) {
      throw new Error(
        'validate:pre-push should fail when an earlier step fails'
      )
    }

    console.log('  ✅ validate:pre-push preserves failures from earlier checks')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function testGeneratedPrePushHookValidatesLicenseDir() {
  console.log(
    '🔍 Testing embedded pre-push quota hook validates QAA_LICENSE_DIR...'
  )

  const setupScriptPath = path.join(__dirname, '..', 'setup.js')
  const setupContent = fs.readFileSync(setupScriptPath, 'utf8')

  if (!setupContent.includes('function validateLicenseDir(dirPath)')) {
    throw new Error(
      'Embedded pre-push quota hook should validate QAA_LICENSE_DIR'
    )
  }
  if (
    !setupContent.includes(
      'QAA_LICENSE_DIR must be within home or temp directory'
    )
  ) {
    throw new Error(
      'Embedded pre-push quota hook should warn on invalid QAA_LICENSE_DIR'
    )
  }

  console.log('  ✅ Embedded pre-push quota hook validates QAA_LICENSE_DIR')
}

// Run tests
if (require.main === module) {
  testTemplateContentValidation()
    .then(() => {
      process.exit(0)
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error.message)
      console.error(error.stack)
      process.exit(1)
    })
}

module.exports = { testTemplateContentValidation }
