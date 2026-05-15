/**
 * CI Doctor — workflow waste + flaky-test detection.
 *
 * Extends --analyze-ci with deeper diagnostic checks:
 *   - Duplicated jobs (same runs-on + steps signature)
 *   - Workflows triggered on every push without `paths:` filters
 *   - Oversized matrix (>10 cells)
 *   - Unnecessary scheduled runs (more frequent than weekly)
 *   - Flaky tests (parsed from `gh run list` if gh CLI is authenticated)
 *
 * Gated behind hasFeature('ciDoctor'). Invoked via `--analyze-ci --doctor`.
 *
 * All process invocations use spawnSync with argv arrays (no shell).
 */

const crypto = require('crypto')
const { spawnSync } = require('child_process')

const SEVERITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
}

const SEVERITY_ICON = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
}

const MATRIX_CELL_THRESHOLD = 10
const FLAKY_THRESHOLD_PCT = 90
const FLAKY_MIN_RUNS = 5

function fingerprintSteps(steps) {
  if (!Array.isArray(steps)) return ''
  const sig = steps
    .map(step => {
      if (step.uses) return `uses:${step.uses}`
      if (step.run) return `run:${step.run.trim().slice(0, 200)}`
      return 'unknown'
    })
    .join('|')
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 12)
}

function detectDuplicatedJobs(workflows) {
  const findings = []
  const seen = new Map()

  for (const wf of workflows) {
    const jobs = (wf.parsed && wf.parsed.jobs) || {}
    for (const [jobName, job] of Object.entries(jobs)) {
      if (!job || !Array.isArray(job.steps)) continue
      const fp = `${job['runs-on'] || ''}|${fingerprintSteps(job.steps)}`
      if (seen.has(fp)) {
        const prev = seen.get(fp)
        findings.push({
          id: 'duplicated-job',
          severity: SEVERITY.MEDIUM,
          title: 'Duplicated job',
          location: `${wf.name}#${jobName}`,
          description: `Job "${jobName}" has the same runs-on + steps signature as "${prev.job}" in ${prev.workflow}.`,
          fix: 'Extract into a reusable workflow (`workflow_call`) or composite action.',
        })
      } else {
        seen.set(fp, { workflow: wf.name, job: jobName })
      }
    }
  }
  return findings
}

function workflowTriggersOnPush(parsed) {
  if (!parsed || !parsed.on) return false
  if (parsed.on === 'push') return true
  if (typeof parsed.on === 'object' && parsed.on !== null) {
    return Object.prototype.hasOwnProperty.call(parsed.on, 'push')
  }
  if (Array.isArray(parsed.on)) return parsed.on.includes('push')
  return false
}

function pushHasPathFilter(parsed) {
  if (!parsed || !parsed.on || typeof parsed.on !== 'object') return false
  const push = parsed.on.push
  if (!push || typeof push !== 'object') return false
  return Boolean(push.paths || push['paths-ignore'])
}

function detectMissingPathFilters(workflows) {
  const findings = []
  for (const wf of workflows) {
    const parsed = wf.parsed
    if (!workflowTriggersOnPush(parsed)) continue
    if (pushHasPathFilter(parsed)) continue
    findings.push({
      id: 'missing-path-filter',
      severity: SEVERITY.MEDIUM,
      title: 'Missing path filter',
      location: wf.name,
      description:
        'Workflow runs on every push without `paths:` or `paths-ignore:` filters.',
      fix: 'Add `paths:` filter so docs/test-only changes do not trigger this workflow.',
    })
  }
  return findings
}

function matrixCellCount(matrix) {
  if (!matrix || typeof matrix !== 'object') return 0
  // Use the existing logic from analyze-ci if available; fall back to local.
  let product = 1
  let hasAxis = false
  for (const [key, value] of Object.entries(matrix)) {
    if (key === 'include' || key === 'exclude') continue
    if (Array.isArray(value)) {
      hasAxis = true
      product *= value.length || 1
    }
  }
  if (!hasAxis) return 0
  if (Array.isArray(matrix.include)) product += matrix.include.length
  if (Array.isArray(matrix.exclude)) product -= matrix.exclude.length
  return Math.max(product, 0)
}

function detectExpensiveMatrix(workflows) {
  const findings = []
  for (const wf of workflows) {
    const jobs = (wf.parsed && wf.parsed.jobs) || {}
    for (const [jobName, job] of Object.entries(jobs)) {
      if (!job || !job.strategy || !job.strategy.matrix) continue
      const cells = matrixCellCount(job.strategy.matrix)
      if (cells > MATRIX_CELL_THRESHOLD) {
        findings.push({
          id: 'expensive-matrix',
          severity: SEVERITY.HIGH,
          title: 'Oversized matrix',
          location: `${wf.name}#${jobName}`,
          description: `Matrix has ${cells} combinations (threshold: ${MATRIX_CELL_THRESHOLD}).`,
          fix: 'Prune axes or use `include`/`exclude` to keep only the combinations that matter.',
        })
      }
    }
  }
  return findings
}

function parseCronFrequency(cron) {
  // Returns approximate runs per week for a cron expression.
  // We only need to flag "more frequent than weekly".
  // Cron: minute hour dom month dow
  if (typeof cron !== 'string') return 0
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return 0
  const [minute, hour, dom, , dow] = parts

  // If every minute or every hour, very frequent.
  if (minute === '*' || /\*\//.test(minute)) return 7 * 24 * 60
  if (hour === '*' || /\*\//.test(hour)) return 7 * 24
  // Daily if dom and dow are unrestricted.
  if (dom === '*' && dow === '*') return 7
  // Weekly if dow is a specific day.
  if (dow !== '*') return 1
  return 1
}

function detectUnnecessarySchedules(workflows) {
  const findings = []
  for (const wf of workflows) {
    const on = wf.parsed && wf.parsed.on
    if (!on || typeof on !== 'object') continue
    const schedule = on.schedule
    if (!Array.isArray(schedule)) continue
    for (const entry of schedule) {
      if (!entry || !entry.cron) continue
      const runsPerWeek = parseCronFrequency(entry.cron)
      if (runsPerWeek > 1) {
        findings.push({
          id: 'frequent-schedule',
          severity: SEVERITY.LOW,
          title: 'Frequent scheduled run',
          location: `${wf.name} (cron: ${entry.cron})`,
          description: `Cron runs ~${runsPerWeek}× per week. Most maintenance jobs only need weekly.`,
          fix: 'Reduce frequency unless this is load-bearing (e.g. dependency updates can be weekly).',
        })
      }
    }
  }
  return findings
}

function ghCliAvailable() {
  const r = spawnSync('gh', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: 5_000,
  })
  return r.status === 0
}

function ghAuthenticated() {
  const r = spawnSync('gh', ['auth', 'status'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: 5_000,
  })
  return r.status === 0
}

function fetchRecentRuns(projectPath, limit) {
  const r = spawnSync(
    'gh',
    [
      'run',
      'list',
      '--limit',
      String(limit),
      '--json',
      'workflowName,conclusion,name,status',
    ],
    {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      timeout: 15_000,
    }
  )
  if (r.status !== 0) return null
  try {
    return JSON.parse(r.stdout || '[]')
  } catch {
    return null
  }
}

function tallyRunsByWorkflow(runs) {
  const byWorkflow = new Map()
  for (const run of runs) {
    const key = run.workflowName || run.name
    if (!key || run.status !== 'completed') continue
    if (!byWorkflow.has(key)) {
      byWorkflow.set(key, { total: 0, success: 0 })
    }
    const bucket = byWorkflow.get(key)
    bucket.total++
    if (run.conclusion === 'success') bucket.success++
  }
  return byWorkflow
}

function flakyFinding(workflowName, total, success) {
  const successPct = Math.round((success / total) * 100)
  if (successPct >= FLAKY_THRESHOLD_PCT) return null
  return {
    id: 'flaky-workflow',
    severity: SEVERITY.HIGH,
    title: 'Flaky workflow',
    location: workflowName,
    description: `${success}/${total} recent runs succeeded (${successPct}%, threshold ${FLAKY_THRESHOLD_PCT}%).`,
    fix: 'Identify the flaky job/test — retry-with-backoff is a smell. Fix root cause (timing, external service, shared state).',
  }
}

function detectFlakyWorkflows(projectPath, options) {
  if (options && options.skipFlakyCheck) return []
  if (!ghCliAvailable() || !ghAuthenticated()) return []

  const runs = fetchRecentRuns(projectPath, 50)
  if (!runs || runs.length === 0) return []

  const byWorkflow = tallyRunsByWorkflow(runs)
  const findings = []
  for (const [workflowName, { total, success }] of byWorkflow.entries()) {
    if (total < FLAKY_MIN_RUNS) continue
    const finding = flakyFinding(workflowName, total, success)
    if (finding) findings.push(finding)
  }
  return findings
}

function runDoctorChecks(workflows, projectPath, options = {}) {
  const findings = []
  findings.push(...detectDuplicatedJobs(workflows))
  findings.push(...detectMissingPathFilters(workflows))
  findings.push(...detectExpensiveMatrix(workflows))
  findings.push(...detectUnnecessarySchedules(workflows))
  if (projectPath) {
    findings.push(...detectFlakyWorkflows(projectPath, options))
  }
  // Order: HIGH first, then MEDIUM, then LOW.
  const order = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])
  return findings
}

function buildDoctorReport(findings) {
  const lines = []
  lines.push('')
  lines.push('🩺 CI Doctor')
  lines.push('─'.repeat(60))
  if (findings.length === 0) {
    lines.push('✅ No CI health issues detected.')
    lines.push('')
    return lines.join('\n')
  }

  const counts = { high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity]++
  lines.push(
    `Findings: ${counts.high} high · ${counts.medium} medium · ${counts.low} low`
  )
  lines.push('─'.repeat(60))

  for (const f of findings) {
    const icon = SEVERITY_ICON[f.severity] || ' '
    lines.push(`${icon} ${f.title} — ${f.location}`)
    lines.push(`   ${f.description}`)
    lines.push(`   Fix: ${f.fix}`)
    lines.push('')
  }
  return lines.join('\n')
}

module.exports = {
  runDoctorChecks,
  buildDoctorReport,
  detectDuplicatedJobs,
  detectMissingPathFilters,
  detectExpensiveMatrix,
  detectUnnecessarySchedules,
  detectFlakyWorkflows,
  matrixCellCount,
  parseCronFrequency,
  fingerprintSteps,
  SEVERITY,
}
