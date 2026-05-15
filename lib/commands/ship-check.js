/**
 * Ship Check — unified release readiness report
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
const path = require('path')
const { spawnSync } = require('child_process')
const { hasFeature, showUpgradeMessage } = require('../licensing')

const VERDICT = {
  SHIP: 'SHIP',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
}

const STATUS = {
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  SKIP: 'skip',
}

const STATUS_ICON = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  skip: '⏭️',
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

function runNpmScript(projectPath, scriptName, timeoutMs) {
  // No shell: spawnSync with argv array.
  const result = spawnSync('npm', ['run', '--silent', scriptName], {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  if (result.error && result.error.code === 'ETIMEDOUT') {
    return {
      status: STATUS.WARN,
      summary: `Timed out after ${Math.round(timeoutMs / 1000)}s`,
      details: '',
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
  }
}

function checkLint(projectPath, pkg) {
  if (!hasNpmScript(pkg, 'lint')) {
    return {
      name: 'Lint',
      status: STATUS.SKIP,
      summary: 'No lint script configured',
    }
  }
  const r = runNpmScript(projectPath, 'lint', 60_000)
  return { name: 'Lint', ...r }
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
  const r = runNpmScript(projectPath, 'test', 300_000)
  return { name: 'Tests', ...r }
}

function checkSecurity(projectPath, pkg) {
  if (hasNpmScript(pkg, 'security:secrets')) {
    const r = runNpmScript(projectPath, 'security:secrets', 60_000)
    return { name: 'Security (secrets)', ...r }
  }

  if (!pkg) {
    return {
      name: 'Security',
      status: STATUS.SKIP,
      summary: 'No package.json found',
    }
  }

  const result = spawnSync(
    'npm',
    ['audit', '--audit-level=high', '--omit=dev'],
    {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    }
  )
  const ok = result.status === 0
  return {
    name: 'Security (npm audit)',
    status: ok ? STATUS.PASS : STATUS.WARN,
    summary: ok
      ? 'No high/critical vulnerabilities'
      : 'High or critical vulnerabilities detected',
    details: (result.stdout || '').slice(-500),
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

function checkCoverage(projectPath) {
  const summary = readCoverageSummary(projectPath)
  if (!summary || !summary.data || !summary.data.total) {
    return {
      name: 'Coverage',
      status: STATUS.SKIP,
      summary: 'No coverage report found (run `npm run test:coverage`)',
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
  }
}

function checkBundleSize(projectPath, pkg) {
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
    const r = runNpmScript(projectPath, scriptName, 120_000)
    return { name: 'Bundle size', ...r }
  }

  return {
    name: 'Bundle size',
    status: STATUS.WARN,
    summary:
      'size-limit configured but no `size` script — add `"size": "size-limit"`',
  }
}

function checkLighthouse(projectPath) {
  const cfg = path.join(projectPath, '.lighthouserc.js')
  const cfgJson = path.join(projectPath, '.lighthouserc.json')
  if (!fs.existsSync(cfg) && !fs.existsSync(cfgJson)) {
    return {
      name: 'Lighthouse thresholds',
      status: STATUS.SKIP,
      summary: 'Lighthouse CI not configured',
    }
  }
  return {
    name: 'Lighthouse thresholds',
    status: STATUS.PASS,
    summary: 'Lighthouse CI configured (run in CI for full report)',
  }
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
  if (results.some(r => r.status === STATUS.FAIL)) return VERDICT.BLOCK
  if (results.some(r => r.status === STATUS.WARN)) return VERDICT.REVIEW
  return VERDICT.SHIP
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
  return gitInfo(projectPath, ['rev-parse', '--short', 'HEAD'])
}

function countByStatus(results) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 }
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

  const counts = countByStatus(report.results)
  lines.push(
    `**Summary:** ${counts.pass} passed · ${counts.warn} warnings · ${counts.fail} failures · ${counts.skip} skipped`
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
  } else if (report.verdict === VERDICT.REVIEW) {
    lines.push('### ⚠️ Ship with review')
    lines.push('No hard failures, but warnings should be acknowledged.')
  } else {
    lines.push('### ✅ Ready to ship')
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
    `Summary: ${counts.pass} passed · ${counts.warn} warn · ${counts.fail} fail · ${counts.skip} skip`
  )
  lines.push('')
  if (report.verdict === VERDICT.SHIP) {
    lines.push('✅ Verdict: SHIP — ready to merge')
  } else if (report.verdict === VERDICT.REVIEW) {
    lines.push('⚠️  Verdict: REVIEW — warnings, but no failures')
  } else {
    lines.push('❌ Verdict: BLOCK — resolve failures before merging')
  }
  lines.push('')
  return lines.join('\n')
}

function runShipCheck(projectPath, options = {}) {
  const pkg = readPackageJson(projectPath)
  const results = [
    checkLint(projectPath, pkg),
    checkTests(projectPath, pkg, options),
    checkSecurity(projectPath, pkg),
    checkCoverage(projectPath),
    checkBundleSize(projectPath, pkg),
    checkLighthouse(projectPath),
    checkEnvVars(projectPath),
    checkCiCost(projectPath),
    checkDocs(projectPath),
  ]

  return {
    verdict: computeVerdict(results),
    branch: getCurrentBranch(projectPath),
    commit: getCurrentCommit(projectPath),
    generatedAt: new Date().toISOString(),
    results,
  }
}

async function handleShipCheck(options = {}) {
  if (!hasFeature('shipCheck')) {
    showUpgradeMessage('Ship check (release readiness report)')
    process.exit(1)
  }

  const projectPath = options.projectPath || process.cwd()
  const report = runShipCheck(projectPath, options)

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(buildHumanReport(report))
  }

  if (options.outPath) {
    const md = buildMarkdown(report)
    fs.writeFileSync(options.outPath, md, 'utf8')
    if (!options.json) {
      process.stdout.write(
        `\n📄 Markdown report written to ${options.outPath}\n`
      )
    }
  }

  const blocked = report.verdict === VERDICT.BLOCK
  process.exit(blocked ? 1 : 0)
}

module.exports = {
  runShipCheck,
  handleShipCheck,
  buildMarkdown,
  buildHumanReport,
  computeVerdict,
  parseEnvKeys,
  VERDICT,
  STATUS,
}
