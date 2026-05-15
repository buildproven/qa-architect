/**
 * Command handlers index
 *
 * Centralizes CLI command handlers for better maintainability.
 * Each command has its own module with focused functionality.
 */

const { handleValidationCommands } = require('./validate')
const {
  handleDependencyMonitoring,
  detectPythonProject,
  detectRustProject,
  detectRubyProject,
} = require('./deps')
const { handleAnalyzeCi } = require('./analyze-ci')
const { handleShipCheck } = require('./ship-check')
const { handlePrCheck } = require('./pr-check')
const { handleHistoryScan } = require('./history-scan')

module.exports = {
  // Validation commands
  handleValidationCommands,

  // Dependency monitoring commands
  handleDependencyMonitoring,
  detectPythonProject,
  detectRustProject,
  detectRubyProject,

  // CI/CD optimization commands
  handleAnalyzeCi,

  // Pro release-confidence commands
  handleShipCheck,
  handlePrCheck,
  handleHistoryScan,
}
