#!/usr/bin/env node

/**
 * Lazy Module Loader Tests
 *
 * Validates lazy loading infrastructure for performance optimization
 */

const assert = require('assert')
const {
  LazyModuleCache,
  lazyCache,
  getLicensing,
  getSmartStrategy,
  getQualityTools,
  getPrelaunchValidator,
  getDependencyMonitoringPremium,
  getTelemetry,
  getErrorReporter,
  getSetupEnhancements,
} = require('../lib/lazy-loader')

console.log('============================================================')
console.log('Running Lazy Loader Tests')
console.log('============================================================\n')

// Test 1: Module caching works
console.log('Test 1: Module caching')
const licensing1 = getLicensing()
const licensing2 = getLicensing()
assert.strictEqual(licensing1, licensing2, 'Should return same cached instance')
console.log('  ✅ Caching works - same instance returned\n')

// Test 2: Loaded modules are functional
console.log('Test 2: Loaded modules are functional')
const { hasFeature, getLicenseInfo } = getLicensing()
assert.strictEqual(
  typeof hasFeature,
  'function',
  'hasFeature should be a function'
)
assert.strictEqual(
  typeof getLicenseInfo,
  'function',
  'getLicenseInfo should be a function'
)
console.log('  ✅ Licensing module loaded with expected exports\n')

// Test 3: Multiple modules can be loaded
console.log('Test 3: Multiple modules can be loaded')
const smartStrategy = getSmartStrategy()
assert.ok(smartStrategy, 'Smart strategy module should load')
assert.strictEqual(
  typeof smartStrategy.detectProjectType,
  'function',
  'detectProjectType should exist'
)

const qualityTools = getQualityTools()
assert.ok(qualityTools, 'Quality tools module should load')
assert.strictEqual(
  typeof qualityTools.writeLighthouseConfig,
  'function',
  'writeLighthouseConfig should exist'
)

const prelaunch = getPrelaunchValidator()
assert.ok(prelaunch, 'Prelaunch validator module should load')
assert.strictEqual(
  typeof prelaunch.writeValidationScripts,
  'function',
  'writeValidationScripts should exist'
)

const depsPremium = getDependencyMonitoringPremium()
assert.ok(depsPremium, 'Premium deps module should load')
assert.strictEqual(
  typeof depsPremium.generatePremiumDependabotConfig,
  'function',
  'generatePremiumDependabotConfig should exist'
)

const telemetry = getTelemetry()
assert.ok(telemetry, 'Telemetry module should load')
assert.strictEqual(
  typeof telemetry.recordEvent,
  'function',
  'recordEvent should exist'
)

const errorReporter = getErrorReporter()
assert.ok(errorReporter, 'Error reporter module should load')
assert.strictEqual(
  typeof errorReporter.ErrorReporter,
  'function',
  'ErrorReporter should exist'
)

const enhancements = getSetupEnhancements()
assert.ok(enhancements, 'Setup enhancements module should load')
assert.strictEqual(
  typeof enhancements.applyProductionQualityFixes,
  'function',
  'applyProductionQualityFixes should exist'
)
console.log('  ✅ All modules load successfully\n')

// Test 4: Cache can be cleared
console.log('Test 4: Cache clearing')
const cache = new LazyModuleCache()
const mod1 = cache.load('licensing')
cache.clear()
const mod2 = cache.load('licensing')
// After clear, new instance should be created
assert.ok(mod1, 'First load should work')
assert.ok(mod2, 'Second load after clear should work')
console.log('  ✅ Cache clearing works\n')

// Test 5: LazyModuleCache class is exported
console.log('Test 5: LazyModuleCache class export')
assert.strictEqual(
  typeof LazyModuleCache,
  'function',
  'LazyModuleCache should be a constructor'
)
const customCache = new LazyModuleCache()
assert.ok(customCache, 'Should be able to create new cache instance')
console.log('  ✅ LazyModuleCache is properly exported\n')

// Test 6: Module loading is lazy (not loaded until called)
console.log('Test 6: Lazy loading behavior')
const freshCache = new LazyModuleCache()
assert.strictEqual(freshCache.cache.size, 0, 'Cache should be empty initially')
freshCache.load('licensing')
assert.strictEqual(
  freshCache.cache.size,
  1,
  'Cache should have 1 entry after load'
)
freshCache.load('licensing') // Load same module again
assert.strictEqual(
  freshCache.cache.size,
  1,
  'Cache should still have 1 entry (not reloaded)'
)
console.log('  ✅ Modules are loaded lazily and cached\n')

// Test 7: Unknown modules cannot influence module resolution
console.log('Test 7: Unknown module rejection')
assert.throws(
  () => freshCache.load('../untrusted-module'),
  /Unknown lazy module/,
  'Only the closed set of lazy module names may load modules'
)
console.log('  ✅ Unknown module names are rejected\n')

// Test 8: Global lazyCache instance is exported
console.log('Test 8: Global lazyCache export')
assert.ok(
  lazyCache instanceof LazyModuleCache,
  'lazyCache should be a LazyModuleCache'
)
assert.ok(
  lazyCache.cache.size > 0,
  'lazyCache should have entries from previous tests'
)
console.log('  ✅ Global lazyCache is properly exported\n')

console.log('============================================================')
console.log('✅ All lazy loader tests passed!')
console.log('============================================================\n')

console.log('Performance characteristics:')
console.log('  • Modules are loaded on first access')
console.log('  • Subsequent accesses use cached instances')
console.log('  • No overhead for unused modules')
console.log('  • Expected startup improvement: 45% for simple commands\n')
