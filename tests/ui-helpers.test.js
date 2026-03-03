'use strict'

const assert = require('assert')

/**
 * Test suite for UI Helpers
 *
 * Tests formatting, icon modes, progress indicators, and accessibility support.
 */

console.log('🧪 Testing UI Helpers...\n')

// ============================================================
// Test 1: formatMessage returns correct format
// ============================================================
{
  console.log('Test 1: formatMessage returns icon + message')
  const { formatMessage, icons } = require('../lib/ui-helpers')

  const result = formatMessage('success', 'All good')
  assert(result.includes('All good'), 'Should contain the message')
  assert(result.startsWith(icons.success), 'Should start with success icon')

  const errorResult = formatMessage('error', 'Something broke')
  assert(
    errorResult.includes('Something broke'),
    'Should contain error message'
  )
  assert(errorResult.startsWith(icons.error), 'Should start with error icon')

  console.log('  ✅ PASS')
}

// ============================================================
// Test 2: All icon types exist
// ============================================================
{
  console.log('Test 2: All icon types exist')
  const { icons } = require('../lib/ui-helpers')

  const expectedTypes = ['success', 'error', 'warning', 'info', 'working']
  for (const type of expectedTypes) {
    assert(icons[type], `Should have icon for ${type}`)
    assert(typeof icons[type] === 'string', `${type} icon should be a string`)
    assert(icons[type].length > 0, `${type} icon should not be empty`)
  }
  console.log('  ✅ PASS')
}

// ============================================================
// Test 3: ACCESSIBILITY_MODE is boolean
// ============================================================
{
  console.log('Test 3: ACCESSIBILITY_MODE is boolean')
  const { ACCESSIBILITY_MODE } = require('../lib/ui-helpers')
  assert(typeof ACCESSIBILITY_MODE === 'boolean', 'Should be boolean')
  console.log(`  ✅ PASS (current: ${ACCESSIBILITY_MODE})`)
}

// ============================================================
// Test 4: showProgress returns spinner-like object
// ============================================================
{
  console.log('Test 4: showProgress returns spinner-like object')
  const { showProgress } = require('../lib/ui-helpers')

  // In test environment (non-TTY), should get fallback
  const spinner = showProgress('Testing...')
  assert(typeof spinner.succeed === 'function', 'Should have succeed method')
  assert(typeof spinner.fail === 'function', 'Should have fail method')
  assert(typeof spinner.warn === 'function', 'Should have warn method')
  assert(typeof spinner.info === 'function', 'Should have info method')
  assert(typeof spinner.stop === 'function', 'Should have stop method')
  assert(typeof spinner.start === 'function', 'Should have start method')

  // Methods should not throw
  spinner.succeed('Done')
  spinner.stop()
  console.log('  ✅ PASS')
}

// ============================================================
// Test 5: formatMessage for all types
// ============================================================
{
  console.log('Test 5: formatMessage handles all types')
  const { formatMessage } = require('../lib/ui-helpers')

  const types = ['success', 'error', 'warning', 'info', 'working']
  for (const type of types) {
    const result = formatMessage(type, `test ${type}`)
    assert(result.includes(`test ${type}`), `Should format ${type} message`)
  }
  console.log('  ✅ PASS')
}

// ============================================================
// Test 6: Icons are either emoji or accessibility text
// ============================================================
{
  console.log('Test 6: Icons are valid format')
  const { icons, ACCESSIBILITY_MODE } = require('../lib/ui-helpers')

  if (ACCESSIBILITY_MODE) {
    assert(icons.success === '[OK]', 'Accessibility success should be [OK]')
    assert(icons.error === '[ERROR]', 'Accessibility error should be [ERROR]')
    assert(icons.warning === '[WARN]', 'Accessibility warning should be [WARN]')
    assert(icons.info === '[INFO]', 'Accessibility info should be [INFO]')
    assert(icons.working === '[...]', 'Accessibility working should be [...]')
    console.log('  ✅ PASS (accessibility mode)')
  } else {
    assert(icons.success === '✅', 'Emoji success should be ✅')
    assert(icons.error === '❌', 'Emoji error should be ❌')
    console.log('  ✅ PASS (emoji mode)')
  }
}

console.log('\n✅ All UI Helper tests passed!\n')
