'use strict'

const crypto = require('crypto')
const path = require('path')
const { CONTINUITY_AMBIGUOUS, FINGERPRINT_VERSION } = require('./constants')

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/

function canonicalRuleId(value) {
  const parts = value.split('-')
  return (
    parts.length > 0 &&
    parts.every(
      part =>
        part.length > 0 &&
        [...part].every(character =>
          'abcdefghijklmnopqrstuvwxyz0123456789'.includes(character)
        )
    )
  )
}

function nfc(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.normalize('NFC')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeRelativePath(projectRoot, candidate) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new Error('projectRoot must be explicit')
  }
  const raw = nfc(candidate, 'finding path').replaceAll('\\', '/')
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    throw new Error('finding path must be project-root-relative')
  }
  const normalized = path.posix.normalize(raw)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('finding path traversal is outside project root')
  }
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(root, ...normalized.split('/'))
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('finding path resolves outside project root')
  }
  return normalized
}

function createFingerprint(projectRoot, finding) {
  if (!finding || typeof finding !== 'object') {
    throw new Error('finding must be an object')
  }
  const source = nfc(finding.source, 'source').toLowerCase()
  const ruleId = nfc(finding.ruleId, 'ruleId')
  const identityVersion = nfc(finding.identityVersion, 'identityVersion')
  if (!canonicalRuleId(ruleId)) {
    throw new Error(`ruleId is not canonical kebab case: ${ruleId}`)
  }
  if (!SEMVER.test(identityVersion)) {
    throw new Error(`identityVersion is not semantic: ${identityVersion}`)
  }
  const relativePath = normalizeRelativePath(
    projectRoot,
    finding.location && finding.location.path
  )
  const evidenceIdentity = nfc(finding.evidenceIdentity, 'evidenceIdentity')
  const continuityStable =
    typeof finding.continuityIdentity === 'string' &&
    finding.continuityIdentity.length > 0
  const continuityIdentity = continuityStable
    ? nfc(finding.continuityIdentity, 'continuityIdentity')
    : CONTINUITY_AMBIGUOUS
  const evidenceDigest = sha256(Buffer.from(evidenceIdentity, 'utf8'))
  const continuityDigest = sha256(Buffer.from(continuityIdentity, 'utf8'))
  const canonical = [
    'qaa-fingerprint',
    FINGERPRINT_VERSION,
    source,
    identityVersion,
    ruleId,
    relativePath,
    evidenceDigest,
    continuityDigest,
  ]
  return {
    fingerprintVersion: FINGERPRINT_VERSION,
    fingerprint: sha256(Buffer.from(JSON.stringify(canonical), 'utf8')),
    relativePath,
    evidenceDigest,
    continuityDigest,
    continuity: continuityStable ? 'stable' : 'ambiguous',
  }
}

module.exports = {
  createFingerprint,
  normalizeRelativePath,
  sha256,
}
