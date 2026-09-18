'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const yaml = require('js-yaml')
const {
  evaluateAssurance,
  loadAssurancePolicy,
  toJson,
  toMarkdown,
  toSarif,
  toTerminal,
} = require('../assurance')
const {
  duplicateJsonKeys,
  validateAssurancePolicy,
} = require('../assurance/policy')
const { RULE_PACK_VERSION } = require('../assurance/rule-catalog')
const {
  checkForRule,
  selectAssurancePack,
  selectionSummary,
} = require('../assurance/pack')

const DEFAULT_TIMEOUT_MS = 120_000
const PACK_RULE_PREFIX = 'qaa-web-saas.'
const DEFAULT_EXCLUDES = [
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
]
const BASE_SCANNABLE = /\.(?:c|cc|cpp|cs|go|java|js|jsx|php|py|rb|rs|ts|tsx)$/i
const SQL_SCANNABLE = /\.sql$/i

function run(projectPath, executable, args, timeoutMs = 30_000) {
  /** @type {import('child_process').SpawnSyncOptionsWithStringEncoding} */
  const options = {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  }
  if (executable === 'git') return spawnSync('git', args, options)
  if (executable === 'semgrep') return spawnSync('semgrep', args, options)
  return {
    status: null,
    stdout: '',
    stderr: `Unsupported assurance executable: ${executable}`,
    error: new Error(`Unsupported assurance executable: ${executable}`),
  }
}

function git(projectPath, args, timeoutMs) {
  return run(projectPath, 'git', args, timeoutMs)
}

function resolveCommit(projectPath, ref) {
  if (typeof ref !== 'string' || ref.startsWith('-') || ref.length > 300) {
    return null
  }
  const result = git(projectPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ])
  const value = (result.stdout || '').trim().toLowerCase()
  return result.status === 0 && /^[a-f0-9]{40}$/.test(value) ? value : null
}

function fetchBase(projectPath, baseRef, remote = 'origin', depth = 100) {
  if (!/^[A-Za-z0-9._/-]+$/.test(baseRef) || baseRef.startsWith('-')) {
    return false
  }
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || remote.startsWith('-')) return false
  const boundedDepth = Math.max(1, Math.min(Number(depth) || 100, 1000))
  const result = git(
    projectPath,
    [
      'fetch',
      '--no-tags',
      `--depth=${boundedDepth}`,
      remote,
      `${baseRef}:refs/remotes/${remote}/${baseRef}`,
    ],
    60_000
  )
  return result.status === 0
}

function fetchCommit(projectPath, commit, remote = 'origin', depth = 100) {
  if (!/^[a-f0-9]{40}$/i.test(commit)) return false
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || remote.startsWith('-')) return false
  const boundedDepth = Math.max(1, Math.min(Number(depth) || 100, 1000))
  return (
    git(
      projectPath,
      ['fetch', '--no-tags', `--depth=${boundedDepth}`, remote, commit],
      60_000
    ).status === 0
  )
}

function resolveHead(projectPath, headRef) {
  const currentHead = resolveCommit(projectPath, 'HEAD')
  const headSha = resolveCommit(projectPath, headRef)
  if (!currentHead || !headSha) {
    return { error: 'Could not resolve the current and requested head commits' }
  }
  if (headSha !== currentHead) {
    return {
      error: `Requested head ${headSha} does not match checked-out HEAD ${currentHead}`,
      headSha,
    }
  }
  return { headSha }
}

function resolveBase(projectPath, baseName, options) {
  const remote = options.remote || 'origin'
  if (options.baseSha) {
    const exact = resolveCommit(projectPath, options.baseSha)
    if (exact || options.fetch === false) return exact
    fetchCommit(projectPath, options.baseSha, remote, options.fetchDepth)
    return resolveCommit(projectPath, options.baseSha)
  }
  const candidates = [baseName, baseName && `${remote}/${baseName}`].filter(
    Boolean
  )
  const existing = candidates
    .map(ref => resolveCommit(projectPath, ref))
    .find(Boolean)
  if (existing || options.fetch === false || !baseName) return existing || null
  fetchBase(projectPath, baseName, remote, options.fetchDepth)
  return resolveCommit(projectPath, `${remote}/${baseName}`)
}

function deepenHistory(projectPath, options) {
  const remote = options.remote || 'origin'
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || remote.startsWith('-')) return false
  const depth = Math.max(1, Math.min(Number(options.fetchDepth) || 100, 1000))
  return (
    git(
      projectPath,
      ['fetch', '--no-tags', `--deepen=${depth}`, remote],
      60_000
    ).status === 0
  )
}

function cleanWorktreeProblem(projectPath) {
  const status = git(projectPath, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (status.status !== 0) return 'Could not verify working-tree cleanliness'
  if ((status.stdout || '').trim()) {
    return 'Working tree is not clean; exact-head evidence cannot include uncommitted inputs'
  }
  return null
}

function resolveMergeBase(projectPath, baseSha, headSha, options) {
  let merge = git(projectPath, ['merge-base', baseSha, headSha])
  if (merge.status !== 0 && options.fetch !== false) {
    deepenHistory(projectPath, options)
    merge = git(projectPath, ['merge-base', baseSha, headSha])
  }
  const value = (merge.stdout || '').trim().toLowerCase()
  return merge.status === 0 && /^[a-f0-9]{40}$/.test(value) ? value : null
}

function resolvePrRange(projectPath, options = {}) {
  const headRef = options.head || process.env.GITHUB_SHA || 'HEAD'
  const resolvedHead = resolveHead(projectPath, headRef)
  if (resolvedHead.error) return resolvedHead
  const { headSha } = resolvedHead
  const worktreeProblem =
    options.allowDirty === true ? null : cleanWorktreeProblem(projectPath)
  if (worktreeProblem) return { error: worktreeProblem, headSha }
  const baseName =
    options.base ||
    process.env.GITHUB_BASE_REF ||
    (resolveCommit(projectPath, 'main') ? 'main' : 'master')
  const baseSha = resolveBase(projectPath, baseName, options)
  if (!baseSha)
    return { error: `Could not resolve base commit for ${baseName}` }

  const mergeBase = resolveMergeBase(projectPath, baseSha, headSha, options)
  if (!mergeBase) {
    return {
      error: 'Could not resolve a merge base for the PR range',
      headSha,
      baseSha,
    }
  }
  return { baseRef: baseName, baseSha, headSha, mergeBase }
}

function parseNameStatus(source) {
  if (!source.trim()) return []
  return source
    .trimEnd()
    .split('\n')
    .map(line => {
      const parts = line.split('\t')
      const status = parts[0]
      return {
        status,
        oldPath:
          status.startsWith('R') || status.startsWith('C') ? parts[1] : null,
        path: parts.at(-1),
      }
    })
    .filter(item => item.path)
}

function parseChangedLines(source) {
  const ranges = new Map()
  let currentPath = null
  for (const line of source.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentPath = line.slice(6)
      if (!ranges.has(currentPath)) ranges.set(currentPath, [])
      continue
    }
    if (!currentPath || !line.startsWith('@@')) continue
    const plus = line.indexOf('+')
    const endMarker = line.indexOf(' @@', plus)
    if (plus === -1 || endMarker === -1) continue
    const [startText, countText] = line.slice(plus + 1, endMarker).split(',')
    const start = Number(startText)
    const count = countText === undefined ? 1 : Number(countText)
    if (count > 0)
      ranges.get(currentPath).push({ start, end: start + count - 1 })
  }
  return ranges
}

function changedSurface(projectPath, range) {
  const diffRange = `${range.mergeBase}..${range.headSha}`
  const names = git(projectPath, [
    'diff',
    '--find-renames',
    '--name-status',
    '--no-ext-diff',
    diffRange,
  ])
  const patch = git(projectPath, [
    'diff',
    '--find-renames',
    '--unified=0',
    '--no-ext-diff',
    '--no-color',
    diffRange,
    '--',
  ])
  if (names.status !== 0 || patch.status !== 0) return null
  return {
    files: parseNameStatus(names.stdout || ''),
    lines: parseChangedLines(patch.stdout || ''),
  }
}

function isExcluded(filePath, excludes) {
  return excludes.some(prefix => {
    const exact = prefix.replace(/\/$/, '')
    return (
      filePath === exact ||
      (prefix.endsWith('/') && filePath.startsWith(prefix))
    )
  })
}

function packSupportsPath(assurancePack, filePath) {
  return (
    SQL_SCANNABLE.test(filePath) &&
    assurancePack?.checks.some(
      check => check.semgrepRuleId === 'destructive-database-migration'
    )
  )
}

function eligibleSelection(surface, policy, assurancePack) {
  const excludes = policy.pathExcludes || DEFAULT_EXCLUDES
  const candidates = surface.files
    .filter(item => !item.status.startsWith('D'))
    .map(item => item.path)
    .filter(
      filePath =>
        BASE_SCANNABLE.test(filePath) ||
        packSupportsPath(assurancePack, filePath)
    )
  const eligible = candidates.filter(
    filePath => !isExcluded(filePath, excludes)
  )
  return { eligible, excluded: candidates.length - eligible.length, candidates }
}

function validatePrPolicy(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return ['PR assurance policy must be a JSON object']
  }
  const errors = []
  if (input.engine !== undefined && input.engine !== 'semgrep')
    errors.push('engine must be semgrep')
  if (input.required !== undefined && input.required !== true) {
    errors.push(
      'required must be true; repository policy cannot weaken the command floor'
    )
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1000 ||
      input.timeoutMs > 600000)
  ) {
    errors.push('timeoutMs must be an integer from 1000 through 600000')
  }
  const invalidExcludes =
    input.pathExcludes !== undefined &&
    (!Array.isArray(input.pathExcludes) ||
      input.pathExcludes.some(
        value =>
          typeof value !== 'string' ||
          value.length === 0 ||
          value.startsWith('/') ||
          value.includes('..')
      ))
  if (invalidExcludes)
    errors.push('pathExcludes must contain safe project-relative prefixes')
  const allowed = new Set(['engine', 'required', 'timeoutMs', 'pathExcludes'])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key))
      errors.push(`Unknown PR assurance policy key: ${key}`)
  }
  return errors
}

function parsePrPolicy(source, defaults) {
  const duplicates = duplicateJsonKeys(source)
  if (duplicates.length > 0) {
    return {
      valid: false,
      policy: defaults,
      errors: [...new Set(duplicates)].map(key => `Duplicate JSON key: ${key}`),
    }
  }
  const input = JSON.parse(source)
  const errors = validatePrPolicy(input)
  return {
    valid: errors.length === 0,
    policy: { ...defaults, ...input },
    errors,
  }
}

function fileAtCommit(projectPath, commit, relativePath) {
  if (!/^[a-f0-9]{40}$/i.test(commit)) return null
  if (
    typeof relativePath !== 'string' ||
    relativePath.startsWith('/') ||
    relativePath.includes('..')
  ) {
    return null
  }
  const result = git(projectPath, ['show', `${commit}:${relativePath}`])
  return result.status === 0 ? result.stdout : null
}

function loadPrPolicy(projectPath, explicitPath, baseSha = null) {
  const policyPath =
    explicitPath || path.join(projectPath, '.qa-architect-pr-assurance.json')
  const defaults = {
    engine: 'semgrep',
    required: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pathExcludes: DEFAULT_EXCLUDES,
    assurancePolicyPath: path.join(projectPath, '.qa-architect-assurance.json'),
  }
  if (!explicitPath && baseSha) {
    const source = fileAtCommit(
      projectPath,
      baseSha,
      '.qa-architect-pr-assurance.json'
    )
    if (source === null) return { valid: true, policy: defaults, errors: [] }
    try {
      return parsePrPolicy(source, defaults)
    } catch (error) {
      return { valid: false, policy: defaults, errors: [error.message] }
    }
  }
  if (!fs.existsSync(policyPath)) {
    if (explicitPath) {
      return {
        valid: false,
        policy: defaults,
        errors: [`PR assurance policy file does not exist: ${policyPath}`],
      }
    }
    return { valid: true, policy: defaults, errors: [] }
  }
  try {
    const source = fs.readFileSync(policyPath, 'utf8')
    return parsePrPolicy(source, defaults)
  } catch (error) {
    return { valid: false, policy: defaults, errors: [error.message] }
  }
}

function parseAssurancePolicy(source, now) {
  try {
    const duplicates = duplicateJsonKeys(source)
    if (duplicates.length > 0) {
      return {
        valid: false,
        policy: null,
        errors: [...new Set(duplicates)].map(
          key => `Duplicate JSON key: ${key}`
        ),
      }
    }
    const policy = JSON.parse(source)
    const errors = validateAssurancePolicy(policy, now)
    return { valid: errors.length === 0, policy, errors }
  } catch (error) {
    return { valid: false, policy: null, errors: [error.message] }
  }
}

function normalizeScannedPath(candidate) {
  return String(candidate).replaceAll('\\', '/').replace(/^\.\//, '')
}

function parseSemgrepResult(result, version, expectedPaths) {
  try {
    const parsed = JSON.parse(result.stdout || '{}')
    if (!Array.isArray(parsed.results))
      throw new Error('results is not an array')
    const scanned = Array.isArray(parsed.paths && parsed.paths.scanned)
      ? new Set(parsed.paths.scanned.map(normalizeScannedPath))
      : null
    const missingPaths = scanned
      ? expectedPaths.filter(
          candidate => !scanned.has(normalizeScannedPath(candidate))
        )
      : expectedPaths
    if (
      (Array.isArray(parsed.errors) && parsed.errors.length > 0) ||
      ![0, 1].includes(result.status) ||
      missingPaths.length > 0
    ) {
      return {
        outcome: 'partial',
        version,
        error:
          missingPaths.length > 0
            ? `Semgrep did not confirm scanning: ${missingPaths.join(', ')}`
            : 'Semgrep reported incomplete analysis',
        findings: parsed.results,
      }
    }
    return { outcome: 'passed', version, findings: parsed.results }
  } catch (error) {
    return {
      outcome: 'partial',
      error: `Semgrep returned malformed JSON: ${error.message}`,
      findings: [],
    }
  }
}

function selectedPackConfig(ruleRoot, selection, directory) {
  if (!selection || selection.staticRuleIds.length === 0) return null
  const selected = new Set(selection.staticRuleIds)
  const ruleFiles = [
    ...new Set(selection.checks.map(check => check.ruleFile).filter(Boolean)),
  ]
  const rules = ruleFiles.flatMap(relative => {
    const resolved = path.resolve(ruleRoot, '..', relative)
    const contained = path.relative(ruleRoot, resolved)
    if (
      !contained ||
      contained.startsWith(`..${path.sep}`) ||
      path.isAbsolute(contained)
    ) {
      throw new Error(
        `Assurance pack rule file is outside .semgrep: ${relative}`
      )
    }
    const parsed = yaml.load(fs.readFileSync(resolved, 'utf8'))
    return Array.isArray(parsed?.rules)
      ? parsed.rules.filter(rule => selected.has(rule.id))
      : []
  })
  if (rules.length !== selected.size) {
    const found = new Set(rules.map(rule => rule.id))
    const missing = [...selected].filter(id => !found.has(id))
    throw new Error(`Assurance pack rules are missing: ${missing.join(', ')}`)
  }
  const configPath = path.join(directory, 'selected-web-saas-rules.yaml')
  const namespacedRules = rules.map(rule => ({
    ...rule,
    id: `${PACK_RULE_PREFIX}${rule.id}`,
  }))
  fs.writeFileSync(
    configPath,
    yaml.dump({ rules: namespacedRules }, { lineWidth: 100 })
  )
  return configPath
}

function defaultScanner(projectPath, paths, policy, assurancePack = null) {
  if (paths.length === 0)
    return {
      outcome: 'passed',
      version: null,
      findings: [],
      assurancePack,
    }
  const versionResult = run(projectPath, 'semgrep', ['--version'], 10_000)
  if (versionResult.error || versionResult.status !== 0) {
    return {
      outcome: 'unavailable',
      error: 'Semgrep is not installed or executable',
      findings: [],
    }
  }
  const ruleRoot = path.resolve(__dirname, '..', '..', '.semgrep')
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-assurance-pack-')
  )
  const args = [
    '--json',
    '--quiet',
    '--no-git-ignore',
    '--config',
    path.join(ruleRoot, 'defensive-patterns.yaml'),
    '--config',
    path.join(ruleRoot, 'vibe-audit-rules.yaml'),
  ]
  let result
  try {
    const packConfig = selectedPackConfig(
      ruleRoot,
      assurancePack,
      tempDirectory
    )
    if (packConfig) args.push('--config', packConfig)
    args.push('--', ...paths)
    result = run(projectPath, 'semgrep', args, policy.timeoutMs)
  } catch (error) {
    return {
      outcome: 'partial',
      error: error.message,
      findings: [],
      assurancePack,
    }
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true })
  }
  if (
    result.error &&
    typeof result.error === 'object' &&
    'code' in result.error &&
    result.error.code === 'ETIMEDOUT'
  )
    return {
      outcome: 'partial',
      error: 'Semgrep timed out',
      findings: [],
      assurancePack,
    }
  if (result.error)
    return {
      outcome: 'unavailable',
      error: result.error.message,
      findings: [],
      assurancePack,
    }
  const version = (versionResult.stdout || '').trim().split('\n')[0] || null
  return { ...parseSemgrepResult(result, version, paths), assurancePack }
}

function canonicalRuleId(value) {
  return (
    String(value || 'unknown-rule')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown-rule'
  )
}

function findingCoordinates(raw) {
  const start = raw.start || {}
  const end = raw.end || {}
  const line = Number.isInteger(start.line) ? start.line : null
  return {
    line,
    endLine: Number.isInteger(end.line) ? end.line : line,
  }
}

function findingExtra(raw) {
  const extra = raw.extra || {}
  const metadata = extra.metadata || {}
  const message = String(
    extra.message || raw.message || 'Semgrep finding'
  ).trim()
  return {
    message,
    evidence: String(extra.lines || message).trim(),
    severity: String(extra.severity || '').toUpperCase(),
    continuity: extra.metavars ? JSON.stringify(extra.metavars) : 'file-scope',
    guidance: String(
      metadata.fix ||
        metadata.note ||
        'Review and remediate this changed-code finding.'
    ),
    ruleVersion: String(metadata['rule-version'] || '1.0.0'),
  }
}

function assurancePackRuleId(checkId) {
  const raw = String(checkId || '')
  if (raw.startsWith(PACK_RULE_PREFIX)) {
    return raw.slice(PACK_RULE_PREFIX.length)
  }
  const marker = `.${PACK_RULE_PREFIX}`
  const markerIndex = raw.lastIndexOf(marker)
  return markerIndex >= 0 ? raw.slice(markerIndex + marker.length) : null
}

function mapFinding(raw, projectPath, engineVersion = null) {
  const relative = path
    .relative(projectPath, path.resolve(projectPath, raw.path || ''))
    .replaceAll('\\', '/')
  if (!relative || relative === '..' || relative.startsWith('../')) {
    throw new Error('Semgrep finding path is outside the project root')
  }
  const { line, endLine } = findingCoordinates(raw)
  const extra = findingExtra(raw)
  const packRuleId = assurancePackRuleId(raw.check_id)
  const packCheck = packRuleId ? checkForRule(packRuleId) : null
  const severityMap = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }
  return {
    source: 'semgrep',
    ruleId: canonicalRuleId(raw.check_id),
    ruleVersion: packCheck?.version || extra.ruleVersion,
    identityVersion: '1.0.0',
    severity: severityMap[extra.severity] || 'medium',
    message: extra.message,
    engine: {
      name: 'semgrep',
      version: engineVersion,
      rulePackVersion: RULE_PACK_VERSION,
    },
    location: { path: relative, line, endLine },
    evidenceIdentity: extra.evidence,
    continuityIdentity: `${canonicalRuleId(raw.check_id)}:${relative}:${extra.continuity}`,
    remediation: {
      guidance: packCheck
        ? `${packCheck.safePattern} Verification: ${packCheck.verification}`
        : extra.guidance,
    },
    assuranceMappings: packCheck?.assuranceMappings || [],
  }
}

function overlapsChangedLines(finding, surface) {
  const ranges = surface.lines.get(finding.location.path) || []
  if (!finding.location.line)
    return surface.files.some(item => item.path === finding.location.path)
  const end = finding.location.endLine || finding.location.line
  return ranges.some(
    range => finding.location.line <= range.end && end >= range.start
  )
}

function mapScannerFindings(scan, projectPath) {
  const mapped = []
  try {
    for (const raw of Array.isArray(scan.findings) ? scan.findings : []) {
      mapped.push(mapFinding(raw, projectPath, scan.version || null))
    }
    return { scan, findings: mapped }
  } catch (error) {
    return {
      scan: {
        ...scan,
        outcome: 'partial',
        error: `Scanner evidence could not be normalized: ${error.message}`,
      },
      findings: mapped,
    }
  }
}

function makeCheck(scan, selection, required, assurancePack) {
  const { eligible, excluded, candidates } = selection
  const engine = {
    name: 'semgrep',
    version: scan.version || null,
    rulePackVersion: RULE_PACK_VERSION,
  }
  const packSummary = selectionSummary(assurancePack)
  const summary = scan.error
    ? `${scan.error}. ${packSummary}`
    : `Semgrep completed for ${eligible.length} changed file(s). ${packSummary}`
  const runtimeLimitations = assurancePack.runtimeEvidence.map(
    item => `${item.checkId}: ${item.verification}`
  )
  return {
    schemaVersion: '1.0.0',
    id: 'sast',
    applicable: true,
    applicabilityReason: 'Changed-code SAST is configured for this PR',
    required,
    requiredReason: required
      ? 'PR assurance policy requires changed-code SAST'
      : 'PR assurance policy marks SAST advisory',
    outcome: scan.outcome,
    engine,
    members: [
      {
        key: 'changed-code/semgrep',
        engine,
        command: { executable: 'semgrep', args: ['--json', '<changed-files>'] },
        outcome: scan.outcome,
        summary,
        details: packSummary,
      },
    ],
    summary,
    details: packSummary,
    coverage: {
      eligible: candidates.length,
      attempted: scan.outcome === 'unavailable' ? 0 : eligible.length,
      completed: scan.outcome === 'passed' ? eligible.length : 0,
      excluded,
      completion: scan.outcome === 'passed' ? 'complete' : 'partial',
      limitations: [
        ...(scan.error ? [scan.error] : []),
        ...assurancePack.limitations,
        ...runtimeLimitations,
      ],
    },
  }
}

function incompleteResult(projectPath, headSha, message) {
  const engine = {
    name: 'qa-architect-pr-assurance',
    version: '1.0.0',
    rulePackVersion: null,
  }
  return evaluateAssurance({
    projectRoot: projectPath,
    revision: { kind: 'git-commit', value: headSha || '0'.repeat(40) },
    supportedChecks: ['environment'],
    requiredChecks: ['environment'],
    findings: [],
    policy: undefined,
    checks: [
      {
        schemaVersion: '1.0.0',
        id: 'environment',
        applicable: true,
        applicabilityReason: 'A resolvable exact PR range is required',
        required: true,
        requiredReason: 'Command floor',
        outcome: 'unavailable',
        engine,
        members: [
          {
            key: 'git/pr-range',
            engine,
            command: {
              executable: 'git',
              args: ['merge-base', '<base>', '<head>'],
            },
            outcome: 'unavailable',
            summary: message,
            details: message,
          },
        ],
        summary: message,
        details: message,
        coverage: null,
      },
    ],
  })
}

async function runPrAssurance(projectPath, options = {}) {
  const range = resolvePrRange(projectPath, options)
  if (range.error)
    return {
      result: incompleteResult(projectPath, range.headSha, range.error),
      range,
      surface: null,
    }
  const surface = changedSurface(projectPath, range)
  if (!surface)
    return {
      result: incompleteResult(
        projectPath,
        range.headSha,
        'Could not compute the exact PR diff'
      ),
      range,
      surface: null,
    }
  const loadedPrPolicy = loadPrPolicy(
    projectPath,
    options.prPolicyPath,
    range.baseSha
  )
  if (!loadedPrPolicy.valid)
    return {
      result: incompleteResult(
        projectPath,
        range.headSha,
        loadedPrPolicy.errors.join('; ')
      ),
      range,
      surface,
    }
  const prPolicy = loadedPrPolicy.policy
  const assurancePack = selectAssurancePack(projectPath)
  const selection = eligibleSelection(surface, prPolicy, assurancePack)
  const { eligible } = selection
  const scanner = options.scanner || defaultScanner
  const scanned = await scanner(projectPath, eligible, prPolicy, assurancePack)
  const verifiedRange = resolvePrRange(projectPath, {
    ...options,
    baseSha: range.baseSha,
    head: range.headSha,
    fetch: false,
  })
  if (
    verifiedRange.error ||
    verifiedRange.baseSha !== range.baseSha ||
    verifiedRange.headSha !== range.headSha ||
    verifiedRange.mergeBase !== range.mergeBase
  ) {
    return {
      result: incompleteResult(
        projectPath,
        range.headSha,
        verifiedRange.error || 'PR range changed while assurance was running'
      ),
      range,
      surface,
    }
  }
  const normalized = mapScannerFindings(scanned, projectPath)
  const scan = normalized.scan
  const rawFindings = normalized.findings
  const findings = rawFindings.filter(finding =>
    overlapsChangedLines(finding, surface)
  )
  let assurancePolicy
  const assurancePath =
    options.assurancePolicyPath || prPolicy.assurancePolicyPath
  if (
    options.assurancePolicyPath &&
    !fs.existsSync(options.assurancePolicyPath)
  ) {
    return {
      result: incompleteResult(
        projectPath,
        range.headSha,
        `Assurance policy file does not exist: ${options.assurancePolicyPath}`
      ),
      range,
      surface,
    }
  }
  if (options.assurancePolicyPath) {
    assurancePolicy = loadAssurancePolicy(assurancePath, options.now)
  } else {
    const source = fileAtCommit(
      projectPath,
      range.baseSha,
      '.qa-architect-assurance.json'
    )
    if (source !== null)
      assurancePolicy = parseAssurancePolicy(source, options.now || new Date())
  }
  const required = true
  const result = evaluateAssurance({
    projectRoot: projectPath,
    revision: { kind: 'git-commit', value: range.headSha },
    supportedChecks: ['sast'],
    requiredChecks: required ? ['sast'] : [],
    findings,
    checks: [makeCheck(scan, selection, required, assurancePack)],
    policy: assurancePolicy,
    now: options.now,
  })
  return { result, range, surface, eligible, assurancePack }
}

function writeEvidenceBundle(directory, execution) {
  fs.mkdirSync(directory, { recursive: true })
  const files = {
    'assurance.json': `${JSON.stringify(toJson(execution.result), null, 2)}\n`,
    'assurance.sarif': `${JSON.stringify(toSarif(execution.result), null, 2)}\n`,
    'summary.md': `${toMarkdown(execution.result)}\n`,
    'annotations.json': `${JSON.stringify(
      execution.result.findings
        .filter(item => item.disposition === 'active')
        .map(item => ({
          path: item.location.path,
          line: item.location.line,
          endLine: item.location.endLine,
          severity: item.severity,
          message: item.message,
          fingerprint: item.fingerprint,
        })),
      null,
      2
    )}\n`,
    'manifest.json': `${JSON.stringify({ schemaVersion: '1.0.0', baseSha: execution.range.baseSha || null, mergeBase: execution.range.mergeBase || null, headSha: execution.result.revision.value, verdict: execution.result.verdict, changedFiles: execution.surface ? execution.surface.files : [], assurancePack: execution.assurancePack || null }, null, 2)}\n`,
  }
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(directory, name), content, 'utf8')
  return Object.keys(files).map(name => path.join(directory, name))
}

function exitCode(verdict) {
  return verdict === 'PASS' ? 0 : verdict === 'BLOCK' ? 1 : 2
}

module.exports = {
  changedSurface,
  defaultScanner,
  eligibleSelection,
  exitCode,
  loadPrPolicy,
  mapFinding,
  overlapsChangedLines,
  parseChangedLines,
  parseNameStatus,
  parseSemgrepResult,
  resolvePrRange,
  runPrAssurance,
  selectedPackConfig,
  toJson,
  toMarkdown,
  toSarif,
  toTerminal,
  writeEvidenceBundle,
}
