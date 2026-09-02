'use strict'

const RELEASE_RECEIPT_USAGE =
  'Usage: create-qa-architect receipt create [options]\n' +
  '       create-qa-architect receipt check-freshness <manifest-path> [options]'

class ReleaseReceiptUsageError extends Error {
  constructor(detail) {
    super(`${detail}\n\n${RELEASE_RECEIPT_USAGE}`)
    this.name = 'ReleaseReceiptUsageError'
    this.code = 'RELEASE_RECEIPT_USAGE'
  }
}

/**
 * Convert the public Release Receipt interface to the legacy Ship Check flags.
 * Ship Check remains the only assurance engine and manifest implementation.
 *
 * @param {string[]} rawArgs
 * @returns {string[]}
 */
function normalizeReleaseReceiptArgs(rawArgs) {
  if (!Array.isArray(rawArgs)) {
    throw new TypeError('CLI arguments must be an array')
  }
  if (rawArgs[0] !== 'receipt') return [...rawArgs]

  const [, action, manifestPath, ...remainingArgs] = rawArgs
  if (
    action === 'create' &&
    (!manifestPath || manifestPath.startsWith('-')) &&
    !rawArgs.slice(2).includes('--verify-ship-manifest')
  ) {
    return ['--ship-check', ...rawArgs.slice(2)]
  }
  if (
    action === 'check-freshness' &&
    manifestPath &&
    !manifestPath.startsWith('--') &&
    (!remainingArgs[0] || remainingArgs[0].startsWith('-')) &&
    !remainingArgs.some(
      argument =>
        argument === '--verify-ship-manifest' ||
        argument.startsWith('--verify-ship-manifest=')
    )
  ) {
    return [
      '--ship-check',
      '--verify-ship-manifest',
      manifestPath,
      ...remainingArgs,
    ]
  }

  throw new ReleaseReceiptUsageError(
    action === 'create'
      ? 'Receipt creation accepts options, not a positional argument.'
      : action
        ? `Unsupported Release Receipt action or arguments: ${action}`
        : 'A Release Receipt action is required.'
  )
}

module.exports = {
  RELEASE_RECEIPT_USAGE,
  ReleaseReceiptUsageError,
  normalizeReleaseReceiptArgs,
}
