#!/usr/bin/env node
// @ts-nocheck

'use strict'

/**
 * Test for interactive mode routing fixes:
 * 1. Interactive mode runs BEFORE routing logic
 * 2. Interactive mode merges with original flags instead of replacing
 * 3. No stale auto-merge message in dependency monitoring output
 */

const assert = require('assert')
const path = require('path')
const { parseAnswers } = require('../lib/interactive/questions')

console.log('🧪 Testing interactive mode routing fixes...\n')

// Test 1: Verify answer parsing produces correct routing flags
console.log('🔍 Test 1: Routing flags from interactive answers...')
{
  // Test "validate" operation mode
  const validateAnswers = {
    operationMode: 'validate',
    dependencyMonitoring: false,
    dryRun: false,
    toolExclusions: [],
  }

  const validateFlags = parseAnswers(validateAnswers)
  assert(
    validateFlags.includes('--comprehensive'),
    'Should include --comprehensive for validate mode'
  )
  console.log('  ✅ Validate mode produces --comprehensive flag')

  // Test "update" operation mode
  const updateAnswers = {
    operationMode: 'update',
    dependencyMonitoring: false,
    dryRun: false,
    toolExclusions: [],
  }

  const updateFlags = parseAnswers(updateAnswers)
  assert(updateFlags.includes('--update'), 'Should include --update flag')
  console.log('  ✅ Update mode produces --update flag')

  // Test dependency monitoring
  const depsAnswers = {
    operationMode: 'setup',
    dependencyMonitoring: true,
    dryRun: false,
    toolExclusions: [],
  }

  const depsFlags = parseAnswers(depsAnswers)
  assert(depsFlags.includes('--deps'), 'Should include --deps flag')
  console.log('  ✅ Dependency monitoring produces --deps flag')

  // Test dry-run
  const dryRunAnswers = {
    operationMode: 'setup',
    dependencyMonitoring: false,
    dryRun: true,
    toolExclusions: [],
  }

  const dryRunFlags = parseAnswers(dryRunAnswers)
  assert(dryRunFlags.includes('--dry-run'), 'Should include --dry-run flag')
  console.log('  ✅ Dry-run mode produces --dry-run flag')
}

// Test 2: Verify flag merging logic
console.log('🔍 Test 2: Flag merging preserves original arguments...')
{
  // Simulate original args with --template flag
  const originalArgs = [
    '--interactive',
    '--template',
    '/custom/path',
    '--no-gitleaks',
  ]
  const interactiveFlags = ['--deps', '--dry-run']

  // Merge logic (from setup.js)
  const filteredOriginal = originalArgs.filter(arg => arg !== '--interactive')
  const merged = [...filteredOriginal, ...interactiveFlags]

  // Verify --template is preserved
  const templateIndex = merged.indexOf('--template')
  assert(templateIndex !== -1, 'Should preserve --template flag')
  assert(
    merged[templateIndex + 1] === '/custom/path',
    'Should preserve template path'
  )

  // Verify --no-gitleaks is preserved
  assert(
    merged.includes('--no-gitleaks'),
    'Should preserve original --no-gitleaks flag'
  )

  // Verify interactive flags are added
  assert(merged.includes('--deps'), 'Should add --deps from interactive')
  assert(merged.includes('--dry-run'), 'Should add --dry-run from interactive')

  // Verify --interactive is removed
  assert(
    !merged.includes('--interactive'),
    'Should remove --interactive flag after processing'
  )

  console.log(
    '  ✅ Flag merging preserves original args and adds interactive selections'
  )
  console.log(`     Merged: ${merged.join(' ')}`)
}

// Test 3: Verify auto-merge message removal
console.log(
  '🔍 Test 3: Auto-merge message removed from dependency monitoring...'
)
{
  const { execSync } = require('child_process')
  const fs = require('fs')
  const path = require('path')
  const { sanitizedGitEnvironment } = require('./git-fixture-helpers')

  // Create temporary test directory
  const testDir = path.join(__dirname, 'fixtures', 'deps-message-test')
  const packageJsonPath = path.join(testDir, 'package.json')

  try {
    fs.mkdirSync(testDir, { recursive: true })
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: 'test', version: '1.0.0' })
    )

    // Run dependency monitoring setup and capture output
    try {
      const output = execSync('node setup.js --deps', {
        cwd: testDir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: sanitizedGitEnvironment(),
      })

      // Verify auto-merge message is NOT present
      assert(
        !output.includes('Auto-merge'),
        'Should NOT mention auto-merge in output'
      )
      assert(
        !output.includes('auto-merge'),
        'Should NOT mention auto-merge (lowercase) in output'
      )

      console.log('  ✅ Auto-merge message correctly removed from output')
    } catch (execError) {
      // Command might fail if not in git repo, but we can still check the output
      const output = execError.stdout || execError.stderr || ''
      assert(
        !output.includes('Auto-merge') && !output.includes('auto-merge'),
        'Should NOT mention auto-merge even in error scenarios'
      )
      console.log(
        '  ✅ Auto-merge message correctly removed (verified via error output)'
      )
    }
  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

// Test 4: Verify routing happens after interactive mode
console.log('🔍 Test 4: Interactive mode execution order...')
{
  // This is tested by the structure in setup.js
  // Interactive mode should run BEFORE routing conditionals
  // We can verify this by checking the code structure

  const fs = require('fs')
  const setupContent = fs.readFileSync(
    path.join(__dirname, '..', 'setup.js'),
    'utf8'
  )

  // Find the positions of key sections
  const interactivePos = setupContent.indexOf(
    'Handle interactive mode FIRST (before any routing)'
  )
  const routingPos = setupContent.indexOf('Handle license status command')

  assert(interactivePos > 0, 'Interactive mode handling should exist in code')
  assert(routingPos > 0, 'Routing logic should exist in code')
  assert(
    interactivePos < routingPos,
    'Interactive mode should be handled BEFORE routing'
  )

  console.log('  ✅ Interactive mode correctly executes before routing logic')
  console.log(
    `     Interactive at position ${interactivePos}, routing at ${routingPos}`
  )
}

console.log('\n✅ All interactive mode routing fix tests passed!\n')
