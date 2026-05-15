/**
 * Historical Secrets Scan — full git-history audit via gitleaks.
 *
 * Runs gitleaks against the project's git history (default: all commits,
 * with a configurable --depth limit), parses JSON output, deduplicates,
 * and reports leaked secrets with commit SHAs and file paths.
 *
 * Gated behind Pro tier (hasFeature('historicalSecretsScan'), with
 * fallback to hasFeature('securityScanning') for backwards compatibility).
 *
 * All process invocations use spawnSync with argv arrays (no shell).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { hasFeature, showUpgradeMessage } = require('../licensing')
const { ConfigSecurityScanner } = require('../validation/config-security')

const SAFE_DEPTH_MAX = 10_000

function parseDepth(input) {
  if (!input) return null
  const n = parseInt(input, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n, SAFE_DEPTH_MAX)
}

function inGitRepo(projectPath) {
  const r = spawnSync(
    'git',
    ['-C', projectPath, 'rev-parse', '--is-inside-work-tree'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      timeout: 10_000,
    }
  )
  return r.status === 0 && (r.stdout || '').trim() === 'true'
}

function countCommits(projectPath) {
  const r = spawnSync(
    'git',
    ['-C', projectPath, 'rev-list', '--count', 'HEAD'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      timeout: 10_000,
    }
  )
  if (r.status !== 0) return null
  const n = parseInt((r.stdout || '').trim(), 10)
  return Number.isFinite(n) ? n : null
}

function buildGitleaksArgs(reportPath, depth) {
  // Note: argv array, no shell. `--log-opts` value is a single argv element.
  // We always pass --log-opts so gitleaks scans history (not just the
  // working tree). Use `--max-count=N` for depth limits — `HEAD~N..HEAD`
  // produces a git fatal error on shallow repos with fewer than N commits.
  const args = [
    'detect',
    '--no-banner',
    '--redact',
    '--report-format',
    'json',
    '--report-path',
    reportPath,
  ]

  if (depth) {
    args.push(`--log-opts=--max-count=${depth}`)
  } else {
    args.push('--log-opts=--all')
  }
  return args
}

function dedupeFindings(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const key = [f.Commit || f.commit, f.File || f.file, f.Secret || f.secret]
      .map(v => String(v || ''))
      .join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

function normalizeFinding(f) {
  return {
    commit: f.Commit || f.commit || '',
    file: f.File || f.file || '',
    line: f.StartLine || f.startLine || null,
    secretType: f.RuleID || f.ruleId || f.Description || f.description || '',
    author: f.Author || f.author || '',
    date: f.Date || f.date || '',
  }
}

function countBySecretType(normalized) {
  const counts = {}
  for (const f of normalized) {
    const key = f.secretType || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function oldestExposures(normalized, limit) {
  // Sort by date ascending (oldest first); fall back to commit string compare.
  const sorted = [...normalized].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date)
    return String(a.commit).localeCompare(String(b.commit))
  })
  return sorted.slice(0, limit)
}

function buildHumanReport(report) {
  const lines = []
  lines.push('')
  lines.push('🔐 Historical Secrets Scan')
  lines.push('─'.repeat(60))
  lines.push(`Scope: ${report.scope}`)
  lines.push(`Commits scanned: ${report.commitsScanned ?? 'unknown'}`)
  lines.push(`Findings: ${report.findings.length}`)
  lines.push('─'.repeat(60))

  if (report.findings.length === 0) {
    lines.push('✅ No secrets detected in git history.')
    lines.push('')
    return lines.join('\n')
  }

  const counts = countBySecretType(report.findings)
  lines.push('By secret type:')
  for (const [type, count] of Object.entries(counts)) {
    lines.push(`  • ${type}: ${count}`)
  }
  lines.push('')

  const oldest = oldestExposures(report.findings, 10)
  lines.push('Top 10 oldest exposures:')
  for (const f of oldest) {
    const date = f.date ? f.date.slice(0, 10) : 'unknown'
    const sha = (f.commit || '').slice(0, 8)
    lines.push(`  • ${date}  ${sha}  ${f.secretType}  ${f.file}`)
  }
  lines.push('')
  lines.push('❌ Secrets found in history. Rotate exposed credentials and')
  lines.push('   consider rewriting history with git-filter-repo or BFG.')
  lines.push('')
  return lines.join('\n')
}

function buildMarkdown(report) {
  const lines = []
  lines.push('# Historical Secrets Scan')
  lines.push('')
  lines.push(`- **Scope:** ${report.scope}`)
  lines.push(`- **Commits scanned:** ${report.commitsScanned ?? 'unknown'}`)
  lines.push(`- **Findings:** ${report.findings.length}`)
  lines.push('')

  if (report.findings.length === 0) {
    lines.push('✅ No secrets detected in git history.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  const counts = countBySecretType(report.findings)
  lines.push('## By secret type')
  lines.push('')
  for (const [type, count] of Object.entries(counts)) {
    lines.push(`- \`${type}\`: ${count}`)
  }
  lines.push('')

  const oldest = oldestExposures(report.findings, 10)
  lines.push('## Top 10 oldest exposures')
  lines.push('')
  lines.push('| Date | Commit | Secret type | File |')
  lines.push('| --- | --- | --- | --- |')
  for (const f of oldest) {
    const date = f.date ? f.date.slice(0, 10) : 'unknown'
    const sha = (f.commit || '').slice(0, 8)
    lines.push(`| ${date} | \`${sha}\` | ${f.secretType} | \`${f.file}\` |`)
  }
  lines.push('')
  lines.push('### Next steps')
  lines.push('1. **Rotate every exposed credential immediately.**')
  lines.push('2. Confirm logs/services for unauthorized use of leaked keys.')
  lines.push(
    '3. Rewrite history with `git-filter-repo` or BFG if you need to purge.'
  )
  lines.push('4. Add a pre-commit `gitleaks` hook to prevent recurrence.')
  lines.push('')
  return `${lines.join('\n')}\n`
}

/**
 * Validate a completed gitleaks invocation. Returns an error string when
 * the run is untrustworthy (so we never silently report "clean"), or null
 * when the result can be parsed.
 */
function validateGitleaksRun(result, tmpReport) {
  const stderr = (result.stderr || '').trim()
  if (result.status !== 0 && result.status !== 1) {
    return `gitleaks failed (exit ${result.status}): ${stderr.slice(0, 500)}`
  }
  if (/^fatal:/m.test(stderr)) {
    return `git rev-walk failed during scan: ${stderr.slice(0, 500)}`
  }
  if (!fs.existsSync(tmpReport) && result.status === 1) {
    return `gitleaks reported leaks but produced no report file (stderr: ${stderr.slice(0, 300)})`
  }
  return null
}

/**
 * Read and parse the gitleaks JSON report, cleaning up the temp file.
 * Returns { findings } on success or { error } on parse failure.
 */
function readGitleaksReport(tmpReport) {
  if (!fs.existsSync(tmpReport)) return { findings: [] }
  try {
    const content = fs.readFileSync(tmpReport, 'utf8').trim()
    if (!content) return { findings: [] }
    const parsed = JSON.parse(content)
    return { findings: Array.isArray(parsed) ? parsed : [] }
  } catch (err) {
    return { error: `Failed to parse gitleaks report: ${err.message}` }
  } finally {
    try {
      fs.unlinkSync(tmpReport)
    } catch {
      // cleanup is best-effort
    }
  }
}

async function runHistoryScan(projectPath, options = {}) {
  if (!inGitRepo(projectPath)) {
    return { error: 'Not a git repository' }
  }

  const depth = parseDepth(options.depth)
  const scope = depth
    ? `last ${depth} commit(s) of HEAD`
    : 'full git history (--all)'

  const scanner = new ConfigSecurityScanner({ quiet: true })
  let binary
  try {
    binary = await scanner.resolveGitleaksBinary()
  } catch (err) {
    return { error: `Failed to resolve gitleaks binary: ${err.message}` }
  }

  const tmpReport = path.join(
    os.tmpdir(),
    `qaa-history-scan-${Date.now()}.json`
  )
  const args = buildGitleaksArgs(tmpReport, depth)

  const result = spawnSync(binary, args, {
    cwd: projectPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    timeout: options.timeoutMs || 10 * 60 * 1000,
  })

  const runError = validateGitleaksRun(result, tmpReport)
  if (runError) return { error: runError }

  const parseResult = readGitleaksReport(tmpReport)
  if (parseResult.error) return { error: parseResult.error }

  const normalized = dedupeFindings(parseResult.findings).map(normalizeFinding)
  return {
    scope,
    commitsScanned: countCommits(projectPath),
    findings: normalized,
    generatedAt: new Date().toISOString(),
  }
}

async function handleHistoryScan(options = {}) {
  if (!hasFeature('historicalSecretsScan') && !hasFeature('securityScanning')) {
    showUpgradeMessage('Historical secrets scan')
    process.exit(1)
  }

  const projectPath = options.projectPath || process.cwd()
  const report = await runHistoryScan(projectPath, options)

  if (report.error) {
    process.stderr.write(`❌ ${report.error}\n`)
    process.exit(1)
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(buildHumanReport(report))
  }

  if (options.outPath) {
    fs.writeFileSync(options.outPath, buildMarkdown(report), 'utf8')
    if (!options.json) {
      process.stdout.write(
        `\n📄 Markdown report written to ${options.outPath}\n`
      )
    }
  }

  process.exit(report.findings.length > 0 ? 1 : 0)
}

module.exports = {
  runHistoryScan,
  handleHistoryScan,
  buildHumanReport,
  buildMarkdown,
  buildGitleaksArgs,
  dedupeFindings,
  normalizeFinding,
  parseDepth,
}
