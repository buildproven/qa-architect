/**
 * Lazy Module Loader
 *
 * Performance optimization: Defer loading of heavy modules until actually needed.
 * This reduces startup time for simple commands like --help, --version, etc.
 *
 * Usage:
 *   const { getLicensing } = require('./lib/lazy-loader')
 *   const { getLicenseInfo } = getLicensing() // Loads on first call
 */

class LazyModuleCache {
  constructor() {
    this.cache = new Map()
  }

  /**
   * Load a module on-demand with caching
   * @param {string} name - Module identifier
   * @returns {any} Module exports
   */
  load(name) {
    if (!this.cache.has(name)) {
      const loader = MODULE_LOADERS[name]
      if (!loader) {
        throw new Error(`Unknown lazy module: ${name}`)
      }
      this.cache.set(name, loader())
    }
    return this.cache.get(name)
  }

  /**
   * Clear cache for testing
   */
  clear() {
    this.cache.clear()
  }
}

// Keep all require targets literal and closed over in this module. LazyModuleCache
// is exported for testing, so accepting a caller-provided module path would make
// its module resolution surface reachable outside the intended CLI loaders.
const MODULE_LOADERS = Object.freeze({
  licensing: () => require('./licensing'),
  'smart-strategy': () => require('./smart-strategy-generator'),
  'quality-tools': () => require('./quality-tools-generator'),
  prelaunch: () => require('./prelaunch-validator'),
  'deps-premium': () => require('./dependency-monitoring-premium'),
  telemetry: () => require('./telemetry'),
  'error-reporter': () => require('./error-reporter'),
  'setup-enhancements': () => require('./setup-enhancements'),
})

const lazyCache = new LazyModuleCache()

/**
 * Lazy loaders for heavy modules
 * These modules are only loaded when their features are actually used
 */

function getLicensing() {
  return lazyCache.load('licensing')
}

function getSmartStrategy() {
  return lazyCache.load('smart-strategy')
}

function getQualityTools() {
  return lazyCache.load('quality-tools')
}

function getPrelaunchValidator() {
  return lazyCache.load('prelaunch')
}

function getDependencyMonitoringPremium() {
  return lazyCache.load('deps-premium')
}

function getTelemetry() {
  return lazyCache.load('telemetry')
}

function getErrorReporter() {
  return lazyCache.load('error-reporter')
}

function getSetupEnhancements() {
  return lazyCache.load('setup-enhancements')
}

module.exports = {
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
}
