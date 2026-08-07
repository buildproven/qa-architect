'use strict'

const SCHEMA_VERSION = '1.0.0'
const FINGERPRINT_VERSION = 1
const MANIFEST_VERSION = 1
const CONTINUITY_AMBIGUOUS = 'qaa-continuity-ambiguous-v1'

const CHECK_IDS = Object.freeze([
  'sast',
  'format',
  'lint',
  'eslint',
  'stylelint',
  'typecheck',
  'tests',
  'build',
  'coverage',
  'dependency-audit',
  'package-registry',
  'secrets',
  'documentation',
  'lighthouse',
  'bundle',
  'environment',
  'ci-cost',
])

const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info'])

const DEFAULT_POLICY = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  fingerprintVersion: FINGERPRINT_VERSION,
  baseline: Object.freeze({}),
  waivers: Object.freeze({}),
  blockingSeverities: Object.freeze(['critical', 'high']),
  requiredChecks: Object.freeze({}),
})

module.exports = {
  CHECK_IDS,
  CONTINUITY_AMBIGUOUS,
  DEFAULT_POLICY,
  FINGERPRINT_VERSION,
  MANIFEST_VERSION,
  SCHEMA_VERSION,
  SEVERITIES,
}
