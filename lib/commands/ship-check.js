/**
 * Ship Check — revision-bound assurance manifest
 *
 * Orchestrates existing Pro-tier checks (lint, tests, security, coverage,
 * bundle, lighthouse, env, ci-cost, docs) and produces a single
 * "can I ship?" report in human / JSON / markdown formats.
 *
 * Gated behind Pro tier (proxy: hasFeature('shipCheck')).
 *
 * All process invocations use spawnSync with argument arrays (no shell).
 */

const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const { spawnSync } = require('child_process')
const Ajv = require('ajv/dist/2020').default
const addFormats = require('ajv-formats').default
const { detectExistingWorkflowMode } = require('../workflow-config')
const { RULE_PACK_VERSION } = require('../assurance/rule-catalog')
const { loadAssurancePolicy } = require('../assurance/policy')
const { calculateRiskTier } = require('../../scripts/risk-policy-gate')
const {
  hasFeature,
  showUpgradeMessage,
  ensureLicenseFresh,
} = require('../licensing')

const VERDICT = {
  PASS: 'PASS',
  BLOCK: 'BLOCK',
  INCOMPLETE: 'INCOMPLETE',
}

const STATUS = {
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  SKIP: 'skip',
  INCOMPLETE: 'incomplete',
}

const STATUS_ICON = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  skip: '⏭️',
  incomplete: '❔',
}

const MANIFEST_VERSION = '1.0.0'
const manifestSchema = require('../../config/ship-assurance-manifest-v1.schema.json')
const manifestAjv = new Ajv({ allErrors: true, strict: true })
addFormats(manifestAjv)
const validateManifestSchema = manifestAjv.compile(manifestSchema)

/** @typedef {ReturnType<typeof runShipCheck>} ShipManifest */

/**
 * @param {unknown} value
 * @returns {value is ShipManifest}
 */
function isShipManifest(value) {
  return validateManifestSchema(value)
}
const CHECK_IDS = {
  Format: 'format',
  Lint: 'lint',
  Tests: 'tests',
  Build: 'build',
  'Security (secrets)': 'secrets',
  'Security (npm audit)': 'dependency-audit',
  Coverage: 'coverage',
  'Bundle size': 'bundle',
  'Lighthouse thresholds': 'lighthouse',
  'Env vars': 'env',
  'CI cost': 'ci-cost',
  Docs: 'docs',
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readPackageJson(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }
}

function hasNpmScript(pkg, scriptName) {
  return Boolean(pkg && pkg.scripts && pkg.scripts[scriptName])
}

function runNpmScript(
  projectPath,
  scriptName,
  timeoutMs,
  commandRunner = spawnSync
) {
  const started = Date.now()
  // No shell: spawnSync with argv array.
  const args = ['run', '--silent', scriptName]
  const result = commandRunner('npm', args, {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  const errorCode =
    result.error && typeof result.error === 'object' && 'code' in result.error
      ? result.error.code
      : null
  if (errorCode === 'ETIMEDOUT') {
    return {
      status: STATUS.INCOMPLETE,
      summary: `Timed out after ${Math.round(timeoutMs / 1000)}s`,
      details: '',
      command: { executable: 'npm', args, timeoutMs },
      exitCode: null,
      durationMs: Date.now() - started,
    }
  }

  if (result.error || result.status === null) {
    return {
      status: STATUS.INCOMPLETE,
      summary: result.error?.message || `${scriptName} could not execute`,
      details: '',
      command: { executable: 'npm', args, timeoutMs },
      exitCode: result.status,
      durationMs: Date.now() - started,
    }
  }

  const ok = result.status === 0
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    summary: ok
      ? `${scriptName} passed`
      : `${scriptName} exited with ${result.status}`,
    details: output.slice(-500),
    command: { executable: 'npm', args, timeoutMs },
    exitCode: result.status,
    durationMs: Date.now() - started,
  }
}

function checkLint(projectPath, pkg, options = {}) {
  if (!hasNpmScript(pkg, 'lint')) {
    return {
      name: 'Lint',
      status: STATUS.SKIP,
      summary: 'No lint script configured',
    }
  }
  const r = runNpmScript(projectPath, 'lint', 60_000, options.commandRunner)
  return { name: 'Lint', ...r }
}

function checkFormat(projectPath, pkg, options = {}) {
  if (!hasNpmScript(pkg, 'format:check')) {
    return {
      name: 'Format',
      status: STATUS.SKIP,
      summary: 'No format:check script configured',
    }
  }
  const result = runNpmScript(
    projectPath,
    'format:check',
    60_000,
    options.commandRunner
  )
  return { name: 'Format', ...result }
}

function checkTests(projectPath, pkg, options) {
  if (options.skipTests) {
    return {
      name: 'Tests',
      status: STATUS.SKIP,
      summary: 'Skipped (--skip-tests)',
    }
  }
  if (!hasNpmScript(pkg, 'test')) {
    return {
      name: 'Tests',
      status: STATUS.SKIP,
      summary: 'No test script configured',
    }
  }
  const r = runNpmScript(projectPath, 'test', 300_000, options.commandRunner)
  return { name: 'Tests', ...r }
}

function checkBuild(projectPath, pkg, options = {}) {
  if (!hasNpmScript(pkg, 'build')) {
    return {
      name: 'Build',
      status: STATUS.SKIP,
      summary: 'No build script configured',
    }
  }
  const result = runNpmScript(
    projectPath,
    'build',
    300_000,
    options.commandRunner
  )
  return { name: 'Build', ...result }
}

function checkSecrets(projectPath, pkg, options = {}) {
  if (hasNpmScript(pkg, 'security:secrets')) {
    const r = runNpmScript(
      projectPath,
      'security:secrets',
      60_000,
      options.commandRunner
    )
    return { name: 'Security (secrets)', ...r }
  }

  return {
    name: 'Security (secrets)',
    status: STATUS.SKIP,
    summary: 'No security:secrets script configured',
  }
}

function checkDependencyAudit(projectPath, pkg, options = {}) {
  if (!pkg) {
    return {
      name: 'Security (npm audit)',
      status: STATUS.SKIP,
      summary: 'No package.json found',
    }
  }

  const args = ['audit', '--json', '--audit-level=high', '--omit=dev']
  const started = Date.now()
  const result = (options.commandRunner || spawnSync)('npm', args, {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  const errorCode = result.error?.code || null
  if (errorCode === 'ETIMEDOUT' || result.status === null) {
    return {
      name: 'Security (npm audit)',
      status: STATUS.INCOMPLETE,
      summary:
        errorCode === 'ETIMEDOUT'
          ? 'Dependency audit timed out after 60s'
          : result.error?.message || 'Dependency audit could not execute',
      command: { executable: 'npm', args, timeoutMs: 60_000 },
      exitCode: result.status,
      durationMs: Date.now() - started,
    }
  }
  const ok = result.status === 0
  const output = result.stdout || ''
  const vulnerabilityCount = auditBlockingVulnerabilityCount(output)
  if (!ok && vulnerabilityCount === null) {
    return {
      name: 'Security (npm audit)',
      status: STATUS.INCOMPLETE,
      summary: 'Dependency audit returned no usable vulnerability evidence',
      details: `${output}${result.stderr || ''}`.trim().slice(-500),
      command: { executable: 'npm', args, timeoutMs: 60_000 },
      exitCode: result.status,
      durationMs: Date.now() - started,
    }
  }
  return {
    name: 'Security (npm audit)',
    status: ok ? STATUS.PASS : STATUS.FAIL,
    summary: ok
      ? 'No high/critical vulnerabilities'
      : `${vulnerabilityCount} high or critical vulnerability(s) detected`,
    details: output.slice(-500),
    command: { executable: 'npm', args, timeoutMs: 60_000 },
    exitCode: result.status,
    durationMs: Date.now() - started,
  }
}

function auditBlockingVulnerabilityCount(output) {
  try {
    const parsed = JSON.parse(output)
    if (parsed.error || typeof parsed.metadata?.vulnerabilities !== 'object') {
      return null
    }
    const { high, critical } = parsed.metadata.vulnerabilities
    if (!Number.isInteger(high) || !Number.isInteger(critical)) return null
    return high + critical
  } catch {
    return null
  }
}

function readCoverageSummary(projectPath) {
  const candidates = [
    path.join(projectPath, 'coverage', 'coverage-summary.json'),
    path.join(projectPath, 'coverage', 'coverage-final.json'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }
      } catch {
        // try next
      }
    }
  }
  return null
}

function readCoverageThresholds(projectPath) {
  const defaults = { lines: 75, functions: 70, branches: 65 }
  const rcPath = path.join(projectPath, '.qualityrc.json')
  if (!fs.existsSync(rcPath)) return defaults
  try {
    const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'))
    return rc.coverage ? { ...defaults, ...rc.coverage } : defaults
  } catch {
    return defaults
  }
}

function compareThresholds(pcts, thresholds) {
  const failed = []
  for (const key of ['lines', 'functions', 'branches']) {
    if (pcts[key] < thresholds[key]) {
      failed.push(`${key} ${pcts[key]}% < ${thresholds[key]}%`)
    }
  }
  return failed
}

function checkCoverage(projectPath, pkg, options = {}) {
  if (!hasNpmScript(pkg, 'test:coverage')) {
    return {
      name: 'Coverage',
      status: STATUS.SKIP,
      summary: 'No test:coverage script configured',
    }
  }
  const execution = runNpmScript(
    projectPath,
    'test:coverage',
    300_000,
    options.commandRunner
  )
  if (execution.status !== STATUS.PASS) {
    return { name: 'Coverage', ...execution }
  }
  const summary = readCoverageSummary(projectPath)
  if (!summary || !summary.data || !summary.data.total) {
    return {
      name: 'Coverage',
      status: STATUS.INCOMPLETE,
      summary: 'test:coverage passed but produced no readable coverage report',
      command: execution.command,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
    }
  }

  const total = summary.data.total
  const pcts = {
    lines: (total.lines && total.lines.pct) || 0,
    functions: (total.functions && total.functions.pct) || 0,
    branches: (total.branches && total.branches.pct) || 0,
  }
  const thresholds = readCoverageThresholds(projectPath)
  const failed = compareThresholds(pcts, thresholds)

  return {
    name: 'Coverage',
    status: failed.length === 0 ? STATUS.PASS : STATUS.FAIL,
    summary:
      failed.length === 0
        ? `lines ${pcts.lines}% / functions ${pcts.functions}% / branches ${pcts.branches}%`
        : `Below threshold: ${failed.join(', ')}`,
    command: execution.command,
    exitCode: execution.exitCode,
    durationMs: execution.durationMs,
  }
}

function checkBundleSize(projectPath, pkg, options = {}) {
  const hasScript = hasNpmScript(pkg, 'size') || hasNpmScript(pkg, 'size-limit')
  const hasConfig =
    fs.existsSync(path.join(projectPath, '.size-limit.json')) ||
    fs.existsSync(path.join(projectPath, '.size-limit.js')) ||
    (pkg && pkg['size-limit'])

  if (!hasScript && !hasConfig) {
    return {
      name: 'Bundle size',
      status: STATUS.SKIP,
      summary: 'size-limit not configured',
    }
  }

  if (hasScript) {
    const scriptName = hasNpmScript(pkg, 'size') ? 'size' : 'size-limit'
    const r = runNpmScript(
      projectPath,
      scriptName,
      120_000,
      options.commandRunner
    )
    return { name: 'Bundle size', ...r }
  }

  return {
    name: 'Bundle size',
    status: STATUS.WARN,
    summary:
      'size-limit configured but no `size` script — add `"size": "size-limit"`',
  }
}

function checkLighthouse(projectPath, pkg, options = {}) {
  const cfg = path.join(projectPath, '.lighthouserc.js')
  const cfgJson = path.join(projectPath, '.lighthouserc.json')
  if (!fs.existsSync(cfg) && !fs.existsSync(cfgJson)) {
    return {
      name: 'Lighthouse thresholds',
      status: STATUS.SKIP,
      summary: 'Lighthouse CI not configured',
    }
  }
  const scriptName = hasNpmScript(pkg, 'lighthouse:ci')
    ? 'lighthouse:ci'
    : hasNpmScript(pkg, 'lighthouse')
      ? 'lighthouse'
      : null
  if (!scriptName) {
    return {
      name: 'Lighthouse thresholds',
      status: STATUS.INCOMPLETE,
      summary:
        'Lighthouse is configured but no executable project script exists',
    }
  }
  const result = runNpmScript(
    projectPath,
    scriptName,
    300_000,
    options.commandRunner
  )
  return { name: 'Lighthouse thresholds', ...result }
}

function parseEnvKeys(content) {
  const lines = content.split('\n')
  const keys = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    keys.push(line.slice(0, eq).trim())
  }
  return keys
}

function checkEnvVars(projectPath) {
  const examplePath = path.join(projectPath, '.env.example')
  const envPath = path.join(projectPath, '.env')

  if (!fs.existsSync(examplePath)) {
    return {
      name: 'Env vars',
      status: STATUS.SKIP,
      summary: 'No .env.example file (skip)',
    }
  }

  const exampleKeys = parseEnvKeys(fs.readFileSync(examplePath, 'utf8'))
  if (exampleKeys.length === 0) {
    return {
      name: 'Env vars',
      status: STATUS.WARN,
      summary: '.env.example is empty',
    }
  }

  if (!fs.existsSync(envPath)) {
    return {
      name: 'Env vars',
      status: STATUS.WARN,
      summary: `${exampleKeys.length} keys in .env.example, but no local .env (CI/prod may be configured)`,
    }
  }

  const localKeys = parseEnvKeys(fs.readFileSync(envPath, 'utf8'))
  const missing = exampleKeys.filter(k => !localKeys.includes(k))

  if (missing.length === 0) {
    return {
      name: 'Env vars',
      status: STATUS.PASS,
      summary: `All ${exampleKeys.length} required keys present locally`,
    }
  }

  return {
    name: 'Env vars',
    status: STATUS.WARN,
    summary: `${missing.length} key(s) missing from local .env: ${missing.slice(0, 5).join(', ')}`,
  }
}

function checkCiCost(projectPath) {
  try {
    const analyzeCi = require('./analyze-ci')
    const workflows = analyzeCi.discoverWorkflows(projectPath)
    if (workflows.length === 0) {
      return {
        name: 'CI cost',
        status: STATUS.SKIP,
        summary: 'No GitHub Actions workflows found',
      }
    }

    const yaml = require('js-yaml')
    const parsed = []
    const skipped = []
    for (const wf of workflows) {
      try {
        const content = fs.readFileSync(wf.path, 'utf8')
        parsed.push({
          name: wf.name,
          path: wf.path,
          parsed: yaml.load(content),
        })
      } catch (err) {
        // Track unparseable workflows — they could mask real CI cost
        // problems if we silently dropped them.
        skipped.push(`${wf.name} (${err.message})`)
      }
    }

    const commitStats = analyzeCi.getCommitFrequency(projectPath)
    const costs = analyzeCi.calculateMonthlyCosts(
      parsed,
      commitStats.commitsPerDay
    )
    const minutes = Math.round(costs.totalMinutes || 0)
    const cost = (costs.totalCost || 0).toFixed(2)

    if (skipped.length > 0) {
      return {
        name: 'CI cost',
        status: STATUS.WARN,
        summary: `~${minutes} min/mo, ~$${cost}/mo across ${parsed.length} workflow(s); skipped ${skipped.length} unparseable: ${skipped.slice(0, 3).join(', ')}`,
      }
    }

    return {
      name: 'CI cost',
      status: STATUS.PASS,
      summary: `~${minutes} min/mo, ~$${cost}/mo across ${parsed.length} workflow(s)`,
    }
  } catch (err) {
    return {
      name: 'CI cost',
      status: STATUS.SKIP,
      summary: `Could not analyze CI cost: ${err.message}`,
    }
  }
}

function checkDocs(projectPath) {
  const readme = path.join(projectPath, 'README.md')
  if (!fs.existsSync(readme)) {
    return {
      name: 'Docs',
      status: STATUS.WARN,
      summary: 'No README.md found',
    }
  }
  const content = fs.readFileSync(readme, 'utf8')
  if (content.trim().length < 200) {
    return {
      name: 'Docs',
      status: STATUS.WARN,
      summary: 'README.md is very short (< 200 chars)',
    }
  }
  return { name: 'Docs', status: STATUS.PASS, summary: 'README.md present' }
}

function computeVerdict(results) {
  if (results.some(r => r.required && r.status === STATUS.FAIL)) {
    return VERDICT.BLOCK
  }
  if (results.some(r => r.required && r.status !== STATUS.PASS)) {
    return VERDICT.INCOMPLETE
  }
  return VERDICT.PASS
}

function gitInfo(projectPath, args) {
  // No shell: spawnSync with argv array.
  const result = spawnSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: false,
  })
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim()
  }
  return null
}

function getCurrentBranch(projectPath) {
  return gitInfo(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

function getCurrentCommit(projectPath) {
  return gitInfo(projectPath, ['rev-parse', 'HEAD'])
}

function toolVersion(projectPath, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: false,
  })
  return result.status === 0 ? (result.stdout || '').trim() : null
}

function gitCommand(projectPath, args) {
  const result = spawnSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  return {
    status: result.status,
    error: result.error?.message || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function loadRiskPolicy(projectPath, explicitPath = null) {
  const projectPolicy = path.join(projectPath, 'harness-config.json')
  const bundledPolicy = path.join(__dirname, '..', '..', 'harness-config.json')
  const policyPath =
    explicitPath ||
    (fs.existsSync(projectPolicy) ? projectPolicy : bundledPolicy)
  try {
    const source = fs.readFileSync(policyPath, 'utf8')
    const policy = JSON.parse(source)
    const tiers = ['critical', 'high', 'medium', 'low']
    if (
      !policy.riskTierRules ||
      !policy.mergePolicy ||
      tiers.some(
        tier =>
          !Array.isArray(policy.riskTierRules[tier]) ||
          !policy.riskTierRules[tier].every(
            pattern => typeof pattern === 'string'
          ) ||
          !Array.isArray(policy.mergePolicy[tier]?.requiredChecks) ||
          !policy.mergePolicy[tier].requiredChecks.every(
            check => typeof check === 'string'
          )
      )
    ) {
      throw new Error(
        'risk policy requires string patterns and requiredChecks for every tier'
      )
    }
    return {
      path: policyPath,
      source: explicitPath
        ? 'explicit-policy'
        : policyPath === bundledPolicy
          ? 'bundled-qa-architect-policy'
          : 'project-policy',
      sha256: sha256(source),
      policy,
      error: null,
    }
  } catch (error) {
    return {
      path: policyPath,
      source: explicitPath ? 'explicit-policy' : 'unavailable-policy',
      sha256: null,
      policy: null,
      error:
        error instanceof SyntaxError
          ? 'risk-policy-malformed-json'
          : 'risk-policy-unreadable-or-invalid',
    }
  }
}

function resolveRevision(projectPath, options = {}) {
  const head = getCurrentCommit(projectPath)
  if (!head) return { error: 'not-a-git-checkout' }
  if (options.head && options.head !== head) {
    return { error: 'requested-head-mismatch', head }
  }
  const baseRef =
    options.baseSha ||
    options.base ||
    (process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/main')
  const baseResult = gitCommand(projectPath, [
    'rev-parse',
    '--verify',
    `${baseRef}^{commit}`,
  ])
  if (baseResult.status !== 0) {
    return { error: 'base-not-resolvable', head, baseRef }
  }
  const mergeBase = gitCommand(projectPath, [
    'merge-base',
    head,
    baseResult.stdout.trim(),
  ])
  if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
    return { error: 'merge-base-unavailable', head, baseRef }
  }
  const base = mergeBase.stdout.trim()
  const diff = gitCommand(projectPath, ['diff', '--binary', `${base}..${head}`])
  const names = gitCommand(projectPath, [
    'diff',
    '--name-only',
    `${base}..${head}`,
  ])
  const dirty = gitCommand(projectPath, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (diff.status !== 0 || names.status !== 0 || dirty.status !== 0) {
    return { error: 'revision-evidence-unavailable', head, base, baseRef }
  }
  return {
    error: dirty.stdout ? 'worktree-dirty' : null,
    base,
    baseRef,
    head,
    diffSha256: sha256(diff.stdout),
    changedFiles: names.stdout.split(/\r?\n/).filter(Boolean),
  }
}

function highestRisk(changedFiles, policy) {
  const order = ['low', 'medium', 'high', 'critical']
  let highest = 'low'
  for (const filename of changedFiles) {
    const risk = calculateRiskTier(filename, policy)
    if (order.indexOf(risk) > order.indexOf(highest)) highest = risk
  }
  return highest
}

function configured(projectPath, pkg, id) {
  if (id === 'coverage') {
    return (
      hasNpmScript(pkg, 'test:coverage') ||
      Boolean(readCoverageSummary(projectPath))
    )
  }
  if (id === 'bundle') {
    return Boolean(
      hasNpmScript(pkg, 'size') ||
      hasNpmScript(pkg, 'size-limit') ||
      fs.existsSync(path.join(projectPath, '.size-limit.json')) ||
      fs.existsSync(path.join(projectPath, '.size-limit.js')) ||
      pkg?.['size-limit']
    )
  }
  if (id === 'lighthouse') {
    return (
      fs.existsSync(path.join(projectPath, '.lighthouserc.js')) ||
      fs.existsSync(path.join(projectPath, '.lighthouserc.json'))
    )
  }
  if (id === 'env') {
    return fs.existsSync(path.join(projectPath, '.env.example'))
  }
  if (id === 'ci-cost') {
    return fs.existsSync(path.join(projectPath, '.github', 'workflows'))
  }
  return false
}

function detectStack(projectPath, pkg) {
  const dependencies = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  }
  const stack = []
  if (pkg) stack.push('node')
  for (const [dependency, name] of [
    ['next', 'nextjs'],
    ['typescript', 'typescript'],
    ['@prisma/client', 'prisma'],
    ['drizzle-orm', 'drizzle'],
    ['stripe', 'stripe'],
    ['@supabase/supabase-js', 'supabase'],
  ]) {
    if (dependencies[dependency]) stack.push(name)
  }
  if (
    fs.existsSync(path.join(projectPath, 'pyproject.toml')) ||
    fs.existsSync(path.join(projectPath, 'requirements.txt'))
  ) {
    stack.push('python')
  }
  return [...new Set(stack)].sort()
}

const POLICY_CHECK_MAP = {
  'lint-and-format': ['format', 'lint'],
  'test-unit': ['tests'],
  'test-integration': ['tests'],
  'consumer-workflow-integration': ['tests'],
  'security-scan': ['secrets', 'dependency-audit'],
  'code-review-agent': ['pr-assurance'],
  'manual-approval': ['manual-approval'],
}

function deriveRequiredChecks({
  projectPath,
  pkg,
  workflowTier,
  riskTier,
  policy,
  stack,
}) {
  const required = new Set(['docs'])
  addProjectRequiredChecks(required, { projectPath, pkg, stack })
  addTierRequiredChecks(required, { workflowTier, riskTier })
  addPolicyRequiredChecks(required, policy, riskTier)
  return [...required].sort()
}

function addProjectRequiredChecks(required, { projectPath, pkg, stack }) {
  if (hasNpmScript(pkg, 'lint')) required.add('lint')
  if (pkg) required.add('dependency-audit')
  if (hasNpmScript(pkg, 'security:secrets')) required.add('secrets')
  if (hasNpmScript(pkg, 'build') || stack.includes('nextjs')) {
    required.add('build')
  }
  for (const id of ['coverage', 'bundle', 'lighthouse', 'env', 'ci-cost']) {
    if (configured(projectPath, pkg, id)) required.add(id)
  }
}

function addTierRequiredChecks(required, { workflowTier, riskTier }) {
  if (
    workflowTier !== 'minimal' ||
    ['medium', 'high', 'critical'].includes(riskTier)
  ) {
    required.add('tests')
  }
  if (workflowTier === 'comprehensive') required.add('coverage')
}

function addPolicyRequiredChecks(required, policy, riskTier) {
  const policyChecks = policy.mergePolicy?.[riskTier]?.requiredChecks || []
  for (const policyCheck of policyChecks) {
    for (const id of POLICY_CHECK_MAP[policyCheck] || [policyCheck]) {
      required.add(id)
    }
  }
}

function referenceRevision(value) {
  return (
    value?.assurance?.revision?.value ||
    value?.revision?.value ||
    value?.resultHead ||
    null
  )
}

function referenceVerdict(value) {
  return value?.assurance?.verdict || value?.verdict || value?.status || null
}

function loadEvidenceReferences(projectPath, head, options = {}) {
  const candidates = [
    ...(options.referencePaths || []),
    path.join(projectPath, '.qa-architect', 'assurance.json'),
    path.join(projectPath, '.qa-architect', 'pr-assurance', 'assurance.json'),
  ]
  const remediationDir = path.join(projectPath, '.qa-architect', 'remediation')
  if (fs.existsSync(remediationDir)) {
    for (const filename of fs.readdirSync(remediationDir)) {
      if (filename.endsWith('.evidence.json')) {
        candidates.push(path.join(remediationDir, filename))
      }
    }
  }
  const references = []
  for (const candidate of [...new Set(candidates)]) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue
    const relativePath = path
      .relative(projectPath, candidate)
      .replaceAll('\\', '/')
    if (relativePath === '..' || relativePath.startsWith('../')) continue
    try {
      const source = fs.readFileSync(candidate, 'utf8')
      const parsed = JSON.parse(source)
      references.push({
        type: parsed.resultHead ? 'remediation' : 'pr-assurance',
        path: relativePath,
        sha256: sha256(source),
        revision: referenceRevision(parsed),
        verdict: referenceVerdict(parsed),
        fresh: referenceRevision(parsed) === head,
      })
    } catch {
      references.push({
        type: 'unknown',
        path: relativePath,
        sha256: null,
        revision: null,
        verdict: 'MALFORMED',
        fresh: false,
      })
    }
  }
  return references.sort((left, right) => left.path.localeCompare(right.path))
}

function fileSha256(filename) {
  if (!fs.existsSync(filename)) return null
  try {
    return sha256(fs.readFileSync(filename))
  } catch {
    return null
  }
}

function identityPayload(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    revision: manifest.revision,
    workflowTier: manifest.workflowTier,
    risk: manifest.risk,
    stack: manifest.stack,
    policy: manifest.policy,
    inputs: manifest.inputs,
    rulePackVersion: manifest.rulePackVersion,
    requiredChecks: manifest.requiredChecks,
    waivers: manifest.waivers,
    results: manifest.results.map(result => ({
      id: result.id,
      required: result.required,
      status: result.status,
      summary: result.summary,
      command: result.command || null,
      exitCode: result.exitCode ?? null,
    })),
    references: manifest.references,
    tools: manifest.tools,
    verdict: manifest.verdict,
  }
}

function waiverEvidence(projectPath) {
  const filename = path.join(projectPath, '.qa-architect-assurance.json')
  if (!fs.existsSync(filename)) {
    return { policySha256: null, fingerprints: [], error: null }
  }
  let source
  try {
    source = fs.readFileSync(filename, 'utf8')
  } catch {
    return {
      policySha256: null,
      fingerprints: [],
      error: 'waiver-policy-unreadable',
    }
  }
  const loaded = loadAssurancePolicy(filename)
  if (loaded.valid) {
    return {
      policySha256: sha256(source),
      fingerprints: Object.keys(loaded.policy.waivers).sort(),
      error: null,
    }
  }
  return {
    policySha256: sha256(source),
    fingerprints: [],
    error: loaded.errors.join('; '),
  }
}

function collectInputHashes(projectPath) {
  const inputs = {}
  for (const filename of [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    '.qualityrc.json',
    '.qa-architect-assurance.json',
    '.github/workflows/quality.yml',
  ]) {
    const digest = fileSha256(path.join(projectPath, filename))
    if (digest) inputs[filename] = digest
  }
  return inputs
}

function countByStatus(results) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0, incomplete: 0 }
  for (const r of results) {
    if (counts[r.status] !== undefined) counts[r.status]++
  }
  return counts
}

function buildMarkdown(report) {
  const lines = []
  lines.push(`# Ship Check — ${report.verdict}`)
  lines.push('')
  if (report.branch || report.commit) {
    const parts = []
    if (report.branch) parts.push(`branch \`${report.branch}\``)
    if (report.commit) parts.push(`commit \`${report.commit}\``)
    lines.push(`_${parts.join(' · ')}_`)
    lines.push('')
  }
  if (report.evidenceIdentity) {
    lines.push(`_Evidence identity: \`${report.evidenceIdentity}\`_`)
    lines.push('')
  }

  const counts = countByStatus(report.results)
  lines.push(
    `**Summary:** ${counts.pass} passed · ${counts.warn} warnings · ${counts.fail} failures · ${counts.skip} skipped · ${counts.incomplete} incomplete`
  )
  lines.push('')

  lines.push('| Check | Status | Summary |')
  lines.push('| --- | --- | --- |')
  for (const r of report.results) {
    const icon = STATUS_ICON[r.status] || ''
    const summary = (r.summary || '').replace(/\|/g, '\\|')
    lines.push(`| ${r.name} | ${icon} ${r.status} | ${summary} |`)
  }
  lines.push('')

  if (report.verdict === VERDICT.BLOCK) {
    lines.push('### ❌ Not ready to ship')
    lines.push('Resolve the failures above before merging.')
  } else if (report.verdict === VERDICT.INCOMPLETE) {
    lines.push('### ❔ Assurance incomplete')
    lines.push(
      'Every required check needs exact-revision evidence before shipping.'
    )
  } else {
    lines.push('### ✅ Exact revision passed')
  }

  return `${lines.join('\n')}\n`
}

function buildHumanReport(report) {
  const lines = []
  lines.push('')
  lines.push('🚀 Ship Check')
  lines.push('─'.repeat(60))
  for (const r of report.results) {
    const icon = STATUS_ICON[r.status] || ' '
    lines.push(`${icon} ${r.name.padEnd(22)} ${r.summary || ''}`)
  }
  lines.push('─'.repeat(60))
  const counts = countByStatus(report.results)
  lines.push(
    `Summary: ${counts.pass} passed · ${counts.warn} warn · ${counts.fail} fail · ${counts.skip} skip · ${counts.incomplete} incomplete`
  )
  lines.push('')
  if (report.verdict === VERDICT.PASS) {
    lines.push(
      '✅ Verdict: PASS — this exact revision satisfied its assurance policy'
    )
  } else if (report.verdict === VERDICT.INCOMPLETE) {
    lines.push('❔ Verdict: INCOMPLETE — required evidence is missing or stale')
  } else {
    lines.push('❌ Verdict: BLOCK — resolve failures before merging')
  }
  lines.push('')
  return lines.join('\n')
}

function executeChecks(projectPath, pkg, options, requiredChecks) {
  return [
    checkFormat(projectPath, pkg, options),
    checkLint(projectPath, pkg, options),
    checkTests(projectPath, pkg, options),
    checkBuild(projectPath, pkg, options),
    checkSecrets(projectPath, pkg, options),
    checkDependencyAudit(projectPath, pkg, options),
    checkCoverage(projectPath, pkg, options),
    checkBundleSize(projectPath, pkg, options),
    checkLighthouse(projectPath, pkg, options),
    checkEnvVars(projectPath),
    checkCiCost(projectPath),
    checkDocs(projectPath),
  ].map(result => {
    const id = CHECK_IDS[result.name]
    return { id, required: requiredChecks.includes(id), ...result }
  })
}

function addFreshnessResults(
  results,
  { projectPath, options, revision, riskPolicy }
) {
  const finalRevision = resolveRevision(projectPath, options)
  if (
    finalRevision.error ||
    finalRevision.head !== revision.head ||
    finalRevision.diffSha256 !== revision.diffSha256
  ) {
    results.push({
      id: 'execution-freshness',
      name: 'Execution freshness',
      required: true,
      status: STATUS.INCOMPLETE,
      summary: finalRevision.error || 'revision-changed-during-checks',
    })
  }
  const finalRiskPolicy = loadRiskPolicy(projectPath, options.riskPolicyPath)
  if (finalRiskPolicy.sha256 !== riskPolicy.sha256) {
    results.push({
      id: 'policy-freshness',
      name: 'Policy freshness',
      required: true,
      status: STATUS.INCOMPLETE,
      summary: 'risk-policy-changed-during-checks',
    })
  }
}

function addRequiredEvidenceResults(
  results,
  { requiredChecks, references, revision, options }
) {
  for (const id of requiredChecks) {
    if (results.some(result => result.id === id)) continue
    let status = STATUS.INCOMPLETE
    let summary = `Required policy check '${id}' has no exact-revision evidence`
    if (id === 'pr-assurance') {
      const assurance = references.find(
        reference =>
          reference.type === 'pr-assurance' &&
          reference.fresh &&
          reference.verdict === 'PASS'
      )
      if (assurance) {
        status = STATUS.PASS
        summary = `Exact-revision PR assurance: ${assurance.path}`
      }
    }
    if (
      id === 'manual-approval' &&
      options.manualApproval?.revision === revision.head
    ) {
      status = STATUS.PASS
      summary = 'Revision-bound manual approval supplied by caller'
    }
    results.push({ id, name: id, required: true, status, summary })
  }
}

function addInputFailureResults(results, { revision, riskPolicy, waivers }) {
  if (revision.error) {
    results.push({
      id: 'revision-binding',
      name: 'Revision binding',
      required: true,
      status: STATUS.INCOMPLETE,
      summary: revision.error,
    })
  }
  if (riskPolicy.error) {
    results.push({
      id: 'risk-policy',
      name: 'Risk policy',
      required: true,
      status: STATUS.INCOMPLETE,
      summary: riskPolicy.error,
    })
  }
  if (waivers.error) {
    results.push({
      id: 'waiver-policy',
      name: 'Waiver policy',
      required: true,
      status: STATUS.INCOMPLETE,
      summary: waivers.error,
    })
  }
}

function collectToolVersions(projectPath) {
  return {
    node: process.version,
    npm: toolVersion(projectPath, 'npm', ['--version']),
    git: toolVersion(projectPath, 'git', ['--version']),
    gitleaks: toolVersion(projectPath, 'gitleaks', ['version']),
    semgrep: toolVersion(projectPath, 'semgrep', ['--version']),
  }
}

function runShipCheck(projectPath, options = {}) {
  const pkg = readPackageJson(projectPath)
  const revision = resolveRevision(projectPath, options)
  const riskPolicy = loadRiskPolicy(projectPath, options.riskPolicyPath)
  const workflowTier =
    options.workflowTier || detectExistingWorkflowMode(projectPath) || 'minimal'
  const riskTier = revision.error
    ? 'critical'
    : riskPolicy.policy
      ? highestRisk(revision.changedFiles || [], riskPolicy.policy)
      : 'unknown'
  const stack = detectStack(projectPath, pkg)
  const requiredChecks = riskPolicy.policy
    ? deriveRequiredChecks({
        projectPath,
        pkg,
        workflowTier,
        riskTier,
        policy: riskPolicy.policy,
        stack,
      })
    : []
  const references = loadEvidenceReferences(projectPath, revision.head, options)
  const waivers = waiverEvidence(projectPath)
  const results = executeChecks(projectPath, pkg, options, requiredChecks)
  addFreshnessResults(results, { projectPath, options, revision, riskPolicy })
  addRequiredEvidenceResults(results, {
    requiredChecks,
    references,
    revision,
    options,
  })
  addInputFailureResults(results, { revision, riskPolicy, waivers })
  results.sort((left, right) => left.id.localeCompare(right.id))
  const verdict = computeVerdict(results)
  const manifest = {
    schemaVersion: MANIFEST_VERSION,
    verdict,
    evidenceIdentity: null,
    revision: {
      base: revision.base || null,
      baseRef: revision.baseRef || null,
      head: revision.head || null,
      diffSha256: revision.diffSha256 || null,
    },
    branch: getCurrentBranch(projectPath),
    commit: revision.head || null,
    workflowTier,
    risk: {
      tier: riskTier,
      changedFiles: revision.changedFiles || [],
    },
    stack,
    policy: {
      source: riskPolicy.source,
      sha256: riskPolicy.sha256,
    },
    inputs: collectInputHashes(projectPath),
    rulePackVersion: RULE_PACK_VERSION,
    requiredChecks,
    waivers,
    results,
    references,
    tools: collectToolVersions(projectPath),
    generatedAt: new Date().toISOString(),
  }
  manifest.evidenceIdentity = sha256(JSON.stringify(identityPayload(manifest)))

  return manifest
}

/**
 * @param {string} projectPath
 * @param {unknown} manifest
 */
function verifyShipManifest(projectPath, manifest, options = {}) {
  const reasons = []
  if (!isShipManifest(manifest)) {
    return { fresh: false, reasons: ['invalid-manifest'] }
  }
  const identity = sha256(JSON.stringify(identityPayload(manifest)))
  if (identity !== manifest.evidenceIdentity) reasons.push('identity-mismatch')
  if (
    manifest.rulePackVersion !== (options.rulePackVersion || RULE_PACK_VERSION)
  ) {
    reasons.push('rule-pack-changed')
  }
  const revision = resolveRevision(projectPath, {
    ...options,
    baseSha: manifest.revision.base,
    head: manifest.revision.head,
  })
  if (revision.error) reasons.push(revision.error)
  if (revision.diffSha256 !== manifest.revision.diffSha256) {
    reasons.push('diff-changed')
  }
  const policy = loadRiskPolicy(projectPath, options.riskPolicyPath)
  if (policy.sha256 !== manifest.policy.sha256) reasons.push('policy-changed')
  const referencePaths = manifest.references.map(reference =>
    path.resolve(projectPath, reference.path)
  )
  const references = loadEvidenceReferences(
    projectPath,
    manifest.revision.head,
    {
      referencePaths,
    }
  )
  if (JSON.stringify(references) !== JSON.stringify(manifest.references)) {
    reasons.push('references-changed')
  }
  if (
    JSON.stringify(collectInputHashes(projectPath)) !==
    JSON.stringify(manifest.inputs)
  ) {
    reasons.push('inputs-changed')
  }
  return { fresh: reasons.length === 0, reasons: [...new Set(reasons)] }
}

function handleManifestVerification(projectPath, options) {
  const manifest = JSON.parse(
    fs.readFileSync(options.verifyShipManifestPath, 'utf8')
  )
  const verification = verifyShipManifest(projectPath, manifest, options)
  const output = {
    fresh: verification.fresh,
    reasons: verification.reasons,
    evidenceIdentity: manifest.evidenceIdentity || null,
    verdict: manifest.verdict || null,
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } else {
    process.stdout.write(
      verification.fresh
        ? `✅ Ship manifest is fresh for ${manifest.revision?.head}\n`
        : `❌ Ship manifest is stale: ${verification.reasons.join(', ')}\n`
    )
  }
  process.exit(verification.fresh ? verdictExitCode(manifest.verdict) : 2)
}

function writeShipReport(report, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(buildHumanReport(report))
  }
  if (!options.outPath) return
  fs.writeFileSync(options.outPath, buildMarkdown(report), 'utf8')
  if (!options.json) {
    process.stdout.write(`\n📄 Markdown report written to ${options.outPath}\n`)
  }
}

function verdictExitCode(verdict) {
  if (verdict === VERDICT.PASS) return 0
  if (verdict === VERDICT.BLOCK) return 1
  return 2
}

async function handleShipCheck(options = {}) {
  await ensureLicenseFresh()
  if (!hasFeature('shipCheck')) {
    showUpgradeMessage('Ship check (release readiness report)')
    process.exit(1)
  }

  const projectPath = options.projectPath || process.cwd()
  if (options.verifyShipManifestPath) {
    handleManifestVerification(projectPath, options)
    return
  }
  const report = runShipCheck(projectPath, options)
  writeShipReport(report, options)
  process.exit(verdictExitCode(report.verdict))
}

module.exports = {
  runShipCheck,
  handleShipCheck,
  buildMarkdown,
  buildHumanReport,
  computeVerdict,
  deriveRequiredChecks,
  identityPayload,
  loadRiskPolicy,
  parseEnvKeys,
  resolveRevision,
  verifyShipManifest,
  VERDICT,
  STATUS,
}
