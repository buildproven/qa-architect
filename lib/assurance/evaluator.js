'use strict'

const {
  CHECK_IDS,
  DEFAULT_POLICY,
  FINGERPRINT_VERSION,
  SCHEMA_VERSION,
  SEVERITIES,
} = require('./constants')
const { createFingerprint } = require('./fingerprint')
const { semanticErrors, validateAssurancePolicy } = require('./policy')

const CHECK_ID_SET = new Set(CHECK_IDS)
const INCOMPLETE_OUTCOMES = new Set([
  'unavailable',
  'partial',
  'skipped',
  'missing',
])

function reason(kind, code, message, checkId = null, fingerprint = null) {
  return { kind, code, message, checkId, fingerprint }
}

function missingCheck(id, required) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    applicable: required,
    applicabilityReason: required
      ? 'Declared by the command or policy but no observation was supplied'
      : 'Supported by the command but not applicable to this project',
    required,
    requiredReason: required
      ? 'Declared required'
      : 'Optional and not applicable',
    outcome: required ? 'missing' : 'not-applicable',
    engine: {
      name: 'qa-architect-assurance',
      version: SCHEMA_VERSION,
      rulePackVersion: null,
    },
    members: [],
    summary: required
      ? 'Required observation is missing'
      : 'Check is not applicable',
    details: null,
    coverage: null,
  }
}

function normalizeScope(values, label, reasons) {
  const normalized = []
  for (const id of Array.isArray(values) ? values : []) {
    if (!CHECK_ID_SET.has(id)) {
      reasons.push(
        reason(
          'incomplete',
          'evidence.unknown-check',
          `Unknown ${label} check: ${String(id)}`
        )
      )
    } else if (!normalized.includes(id)) {
      normalized.push(id)
    }
  }
  return normalized
}

function coverageIsValid(check) {
  const coverage = check.coverage
  if (check.id === 'package-registry' && check.applicable && !coverage)
    return false
  if (!coverage) return true
  const { eligible, attempted, completed, excluded, completion } = coverage
  if (completed > attempted || attempted + excluded > eligible) return false
  const complete = completed + excluded === eligible
  if ((completion === 'complete') !== complete) return false
  if (check.outcome === 'passed' && completion !== 'complete') return false
  return true
}

function membersAreValid(check) {
  if (!Array.isArray(check.members)) return false
  const keys = new Set()
  for (const member of check.members) {
    if (!member || typeof member.key !== 'string' || keys.has(member.key)) {
      return false
    }
    keys.add(member.key)
  }
  if (check.outcome === 'passed') {
    return (
      check.members.length > 0 &&
      check.members.every(member => member.outcome === 'passed')
    )
  }
  if (check.outcome === 'failed') {
    return check.members.some(member => member.outcome === 'failed')
  }
  return true
}

function collectChecks(checks, supported, reasons) {
  const byId = new Map()
  for (const supplied of Array.isArray(checks) ? checks : []) {
    if (!supplied || !CHECK_ID_SET.has(supplied.id)) {
      reasons.push(
        reason(
          'incomplete',
          'evidence.unknown-check',
          `Unknown supplied observation: ${String(supplied && supplied.id)}`
        )
      )
      continue
    }
    if (!supported.includes(supplied.id)) {
      reasons.push(
        reason(
          'incomplete',
          'evidence.unknown-check',
          `Observation is outside supported scope: ${supplied.id}`
        )
      )
      continue
    }
    if (byId.has(supplied.id)) {
      reasons.push(
        reason(
          'incomplete',
          'evidence.duplicate-check',
          `Duplicate observation: ${supplied.id}`,
          supplied.id
        )
      )
      continue
    }
    byId.set(supplied.id, { ...supplied })
  }
  return byId
}

function alignRequiredness(current, isRequired, reasons) {
  current.required = isRequired
  if (current.applicable === false && current.outcome !== 'not-applicable') {
    current.outcome = 'partial'
    current.summary = 'Observation applicability contradicts its outcome'
    reasons.push(
      reason(
        'incomplete',
        'check.partial',
        `Observation applicability contradicts its outcome: ${current.id}`,
        current.id
      )
    )
  }
  if (isRequired && current.applicable === false) current.applicable = true
  if (isRequired && current.outcome === 'not-applicable') {
    current.outcome = 'missing'
    current.summary = 'Required observation is missing'
  }
}

function validateCheckEvidence(current, reasons) {
  if (!membersAreValid(current)) {
    current.outcome = 'partial'
    current.summary = 'Observation members contradict the aggregate outcome'
    reasons.push(
      reason(
        'incomplete',
        'check.partial',
        `Observation members are incomplete or contradictory: ${current.id}`,
        current.id
      )
    )
  }
  if (!coverageIsValid(current)) {
    current.outcome = 'partial'
    current.summary = 'Observation coverage is incomplete or contradictory'
    reasons.push(
      reason(
        'incomplete',
        'evidence.invalid-coverage',
        `Invalid coverage evidence: ${current.id}`,
        current.id
      )
    )
  }
}

function addCheckOutcomeReason(current, isRequired, reasons) {
  const { id, outcome } = current
  if (isRequired && outcome === 'failed') {
    reasons.push(reason('block', 'check.failed', `${id} failed`, id))
  } else if (isRequired && INCOMPLETE_OUTCOMES.has(outcome)) {
    reasons.push(
      reason('incomplete', `check.${outcome}`, `${id} is ${outcome}`, id)
    )
  } else if (!isRequired && outcome === 'failed') {
    reasons.push(
      reason('advisory', 'advisory.check-failed', `${id} failed`, id)
    )
  } else if (!isRequired && INCOMPLETE_OUTCOMES.has(outcome)) {
    reasons.push(
      reason(
        'advisory',
        'advisory.check-unavailable',
        `${id} is ${outcome}`,
        id
      )
    )
  }
}

function normalizeChecks(checks, supported, required, reasons) {
  const byId = collectChecks(checks, supported, reasons)
  const normalized = []
  for (const id of supported) {
    const isRequired = required.includes(id)
    const current = byId.get(id) || missingCheck(id, isRequired)
    alignRequiredness(current, isRequired, reasons)
    validateCheckEvidence(current, reasons)
    addCheckOutcomeReason(current, isRequired, reasons)
    normalized.push(current)
  }
  return normalized
}

function policyEntryEvaluation(kind, state, entry = {}) {
  return {
    kind,
    state,
    reason: kind === 'waiver' ? entry.reason || null : null,
    owner: kind === 'waiver' ? entry.owner || null : null,
    createdAt: kind === 'waiver' ? entry.createdAt || null : null,
    expiresAt: kind === 'waiver' ? entry.expiresAt || null : null,
  }
}

function normalizeFinding(projectRoot, raw) {
  const identity = createFingerprint(projectRoot, raw)
  return {
    schemaVersion: SCHEMA_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    fingerprint: identity.fingerprint,
    identityVersion: raw.identityVersion,
    ruleId: raw.ruleId,
    ruleVersion: raw.ruleVersion,
    severity: raw.severity,
    blocksMerge: false,
    message: raw.message,
    source: raw.source.toLowerCase(),
    engine: raw.engine,
    location: {
      path: identity.relativePath,
      line:
        Number.isInteger(raw.location.line) && raw.location.line > 0
          ? raw.location.line
          : null,
      endLine:
        Number.isInteger(raw.location.endLine) && raw.location.endLine > 0
          ? raw.location.endLine
          : null,
    },
    remediation: raw.remediation,
    assuranceMappings: raw.assuranceMappings || [],
    disposition: 'active',
    continuity: identity.continuity,
    policyEvaluation: null,
  }
}

function reportPolicyProblems(policy, now, reasons) {
  const problems = semanticErrors(policy, now)
  for (const problem of problems) {
    const overlap = problem.startsWith('Fingerprint appears')
    const fingerprint = overlap ? problem.split(': ').at(-1) : null
    reasons.push(
      reason(
        'incomplete',
        overlap ? 'policy.fingerprint-overlap' : 'policy.malformed',
        problem,
        null,
        fingerprint
      )
    )
  }
  return problems
}

function markAmbiguous({
  occurrences,
  entry,
  kind,
  fingerprint,
  message,
  reasons,
}) {
  reasons.push(
    reason('incomplete', 'policy.ambiguous-finding', message, null, fingerprint)
  )
  for (const item of occurrences) {
    item.policyEvaluation = policyEntryEvaluation(kind, 'ambiguous', entry)
  }
  return 'ambiguous'
}

function applyEntry({ occurrences, entry, kind, now, fingerprint, reasons }) {
  if (occurrences.length > 1) {
    return markAmbiguous({
      occurrences,
      entry,
      kind,
      fingerprint,
      message: `Fingerprint has ${occurrences.length} indistinguishable occurrences`,
      reasons,
    })
  }
  const item = occurrences[0]
  if (item.continuity === 'ambiguous') {
    return markAmbiguous({
      occurrences,
      entry,
      kind,
      fingerprint,
      message: 'Finding continuity is ambiguous',
      reasons,
    })
  }
  if (entry.identityVersion !== item.identityVersion) {
    item.policyEvaluation = policyEntryEvaluation(kind, 'invalid', entry)
    reasons.push(
      reason(
        'incomplete',
        'policy.identity-version-mismatch',
        'Policy identity version does not match the finding',
        null,
        fingerprint
      )
    )
    return 'invalid'
  }
  if (
    entry.ruleVersion !== item.ruleVersion ||
    SEVERITIES.indexOf(item.severity) < SEVERITIES.indexOf(entry.severity)
  ) {
    item.policyEvaluation = policyEntryEvaluation(kind, 'invalid', entry)
    reasons.push(
      reason(
        'incomplete',
        'policy.entry-invalid',
        'Policy rule version or approved severity does not match',
        null,
        fingerprint
      )
    )
    return 'invalid'
  }
  if (
    kind === 'waiver' &&
    entry.expiresAt &&
    new Date(entry.expiresAt) <= now
  ) {
    item.policyEvaluation = policyEntryEvaluation('waiver', 'expired', entry)
    reasons.push(
      reason(
        'incomplete',
        'policy.waiver-expired',
        'Waiver has expired',
        null,
        fingerprint
      )
    )
    return 'expired'
  }
  const state = kind === 'waiver' ? 'waived' : 'baseline'
  item.disposition = state
  item.policyEvaluation = policyEntryEvaluation(kind, 'applied', entry)
  return state
}

function groupResult(fingerprint, occurrences, policyState) {
  const baselineCount = policyState === 'baseline' ? occurrences.length : 0
  const waivedCount = policyState === 'waived' ? occurrences.length : 0
  return {
    fingerprint,
    policyState,
    totalCount: occurrences.length,
    activeCount: occurrences.length - baselineCount - waivedCount,
    baselineCount,
    waivedCount,
  }
}

function addFindingBlockReasons(findings, policy, reasons) {
  const blocking = new Set(policy.blockingSeverities)
  for (const item of findings) {
    item.blocksMerge =
      item.disposition === 'active' && blocking.has(item.severity)
    if (item.blocksMerge) {
      reasons.push(
        reason(
          'block',
          'finding.active',
          `${item.severity} finding is active`,
          null,
          item.fingerprint
        )
      )
    }
  }
}

function applyPolicy(projectRoot, rawFindings, policy, now, reasons) {
  const findings = rawFindings.map(raw => normalizeFinding(projectRoot, raw))
  const grouped = new Map()
  for (const item of findings) {
    const group = grouped.get(item.fingerprint) || []
    group.push(item)
    grouped.set(item.fingerprint, group)
  }
  const policyProblems = reportPolicyProblems(policy, now, reasons)
  const groups = []
  for (const [fingerprint, occurrences] of grouped) {
    const baseline = policyProblems.length === 0 && policy.baseline[fingerprint]
    const waiver = policyProblems.length === 0 && policy.waivers[fingerprint]
    const entry = waiver || baseline
    const state = entry
      ? applyEntry({
          occurrences,
          entry,
          kind: waiver ? 'waiver' : 'baseline',
          now,
          fingerprint,
          reasons,
        })
      : 'active'
    groups.push(groupResult(fingerprint, occurrences, state))
  }
  addFindingBlockReasons(findings, policy, reasons)
  return { findings, groups }
}

function policyVersionProblems(policy, reasons) {
  let incompatible = false
  if (policy && policy.fingerprintVersion !== FINGERPRINT_VERSION) {
    incompatible = true
    reasons.push(
      reason(
        'incomplete',
        'policy.fingerprint-version-mismatch',
        `Unsupported policy fingerprint version: ${String(policy.fingerprintVersion)}`
      )
    )
  }
  for (const collectionName of ['baseline', 'waivers']) {
    const collection = policy && policy[collectionName]
    if (!collection || typeof collection !== 'object') continue
    for (const [fingerprint, entry] of Object.entries(collection)) {
      if (entry && entry.fingerprintVersion !== FINGERPRINT_VERSION) {
        incompatible = true
        reasons.push(
          reason(
            'incomplete',
            'policy.fingerprint-version-mismatch',
            `Unsupported fingerprint version in ${collectionName}`,
            null,
            fingerprint
          )
        )
      }
    }
  }
  return incompatible
}

function reportUnknownPolicyChecks(policy, reasons) {
  const requiredChecks = policy && policy.requiredChecks
  if (!requiredChecks || typeof requiredChecks !== 'object') return false
  let unknown = false
  for (const id of Object.keys(requiredChecks)) {
    if (!CHECK_ID_SET.has(id)) {
      unknown = true
      reasons.push(
        reason(
          'incomplete',
          'execution-config.unknown-required-check',
          `Unknown policy-required check: ${id}`
        )
      )
    }
  }
  return unknown
}

function effectivePolicy(input, now, reasons) {
  if (!input) return DEFAULT_POLICY
  if (input.valid === false) {
    policyVersionProblems(input.policy, reasons)
    reportUnknownPolicyChecks(input.policy, reasons)
    const policyErrors =
      Array.isArray(input.errors) && input.errors.length > 0
        ? input.errors
        : ['Malformed assurance policy']
    for (const error of policyErrors) {
      reasons.push(reason('incomplete', 'policy.malformed', error))
    }
    return DEFAULT_POLICY
  }
  const policy = input.policy || input
  const incompatible = policyVersionProblems(policy, reasons)
  const unknownChecks = reportUnknownPolicyChecks(policy, reasons)
  const validationErrors = validateAssurancePolicy(policy, now)
  if (validationErrors.length > 0 || incompatible || unknownChecks) {
    for (const error of validationErrors) {
      reasons.push(reason('incomplete', 'policy.malformed', error))
    }
    return DEFAULT_POLICY
  }
  return policy
}

function evaluateAssurance({
  projectRoot,
  revision,
  supportedChecks,
  requiredChecks,
  findings,
  checks,
  policy: policyInput,
  now = new Date(),
}) {
  const evaluatedAt = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error('now is invalid')
  const reasons = []
  const policy = effectivePolicy(policyInput, evaluatedAt, reasons)
  const supported = normalizeScope(supportedChecks, 'supported', reasons)
  const declaredRequired = normalizeScope(requiredChecks, 'required', reasons)
  const required = []

  for (const id of declaredRequired) {
    if (supported.includes(id)) {
      required.push(id)
    } else {
      reasons.push(
        reason(
          'incomplete',
          'execution-config.unknown-required-check',
          `Command-required check is outside supported scope: ${id}`
        )
      )
    }
  }

  for (const [id, value] of Object.entries(policy.requiredChecks)) {
    if (value === true) {
      if (!supported.includes(id)) {
        reasons.push(
          reason(
            'incomplete',
            'execution-config.unknown-required-check',
            `Policy-required check is outside supported scope: ${id}`
          )
        )
      } else if (!required.includes(id)) {
        required.push(id)
      }
    }
  }

  const normalizedChecks = normalizeChecks(checks, supported, required, reasons)
  const normalizedEvidence = applyPolicy(
    projectRoot,
    Array.isArray(findings) ? findings : [],
    policy,
    evaluatedAt,
    reasons
  )
  const verdict = reasons.some(item => item.kind === 'incomplete')
    ? 'INCOMPLETE'
    : reasons.some(item => item.kind === 'block')
      ? 'BLOCK'
      : 'PASS'

  return {
    schemaVersion: SCHEMA_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    evaluatedAt: evaluatedAt.toISOString(),
    revision,
    supportedChecks: supported,
    requiredChecks: required,
    verdict,
    findings: normalizedEvidence.findings,
    groups: normalizedEvidence.groups,
    checks: normalizedChecks,
    reasons,
  }
}

module.exports = { evaluateAssurance }
