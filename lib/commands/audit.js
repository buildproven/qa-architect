/**
 * Vibe-Code Audit — security scan for AI-generated codebases
 *
 * Runs semgrep (SAST) + npm audit (CVEs) + hallucination check (Pro)
 * and produces a structured Critical/High/Medium/Low report.
 *
 * Free: semgrep with both rule files + npm audit
 * Pro:  + hallucinated package detection (npm registry check)
 *       + --fix flag generates Claude Code prompts per finding
 *
 * All external process invocations use spawnSync with argument arrays (no shell).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawnSync } = require('child_process')
const {
  hasFeature,
  showUpgradeMessage,
  ensureLicenseFresh,
} = require('../licensing')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
}

const SEVERITY_ORDER = [
  SEVERITY.CRITICAL,
  SEVERITY.HIGH,
  SEVERITY.MEDIUM,
  SEVERITY.LOW,
  SEVERITY.INFO,
]

const SEMGREP_TO_SEVERITY = {
  ERROR: SEVERITY.HIGH,
  WARNING: SEVERITY.MEDIUM,
  INFO: SEVERITY.LOW,
}

// OWASP categories that map to Critical (escalate from ERROR)
const CRITICAL_CWE = new Set([
  'CWE-89', // SQL injection
  'CWE-78', // Command injection
  'CWE-798', // Hardcoded credentials
  'CWE-639', // IDOR
  'CWE-95', // Eval injection
])

const SEVERITY_ICON = {
  [SEVERITY.CRITICAL]: '🚨',
  [SEVERITY.HIGH]: '❌',
  [SEVERITY.MEDIUM]: '⚠️ ',
  [SEVERITY.LOW]: '💡',
  [SEVERITY.INFO]: 'ℹ️ ',
}

// ---------------------------------------------------------------------------
// Semgrep detection
// ---------------------------------------------------------------------------

function detectSemgrep() {
  const result = spawnSync('semgrep', ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.error || result.status !== 0) return null
  const version = (result.stdout || '').trim().split('\n')[0]
  return version || 'installed'
}

function semgrepInstallHint() {
  return [
    '',
    '  semgrep is not installed. Install it to enable code-pattern scanning:',
    '',
    '    pip install semgrep          # Python (recommended)',
    '    brew install semgrep         # macOS Homebrew',
    '    npm install -g @semgrep/semgrep  # npm (slower)',
    '',
    '  Then re-run: npx create-qa-architect@latest --audit',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Semgrep runner
// ---------------------------------------------------------------------------

function runSemgrep(projectPath, ruleFiles) {
  const args = ['--json', '--quiet', '--no-git-ignore']
  for (const f of ruleFiles) {
    args.push('--config', f)
  }
  args.push('.')

  const result = spawnSync('semgrep', args, {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  if (result.error) {
    const errorCode =
      result.error && typeof result.error === 'object' && 'code' in result.error
        ? result.error.code
        : null
    if (errorCode === 'ENOENT') return { error: 'not_installed' }
    if (errorCode === 'ETIMEDOUT') return { error: 'timeout' }
    return { error: result.error.message }
  }

  // semgrep exits 1 when findings exist — that's normal
  if (!result.stdout) return { findings: [] }

  try {
    const parsed = JSON.parse(result.stdout)
    return { findings: parsed.results || [] }
  } catch {
    return { error: 'parse_error', raw: result.stdout.slice(0, 500) }
  }
}

// ---------------------------------------------------------------------------
// Semgrep finding → structured finding
// ---------------------------------------------------------------------------

function mapSemgrepFinding(raw) {
  const cwe = raw.extra?.metadata?.cwe || ''
  const baseSeverity =
    SEMGREP_TO_SEVERITY[raw.extra?.severity?.toUpperCase()] || SEVERITY.MEDIUM

  // Escalate to CRITICAL for high-impact CWEs
  const severity = CRITICAL_CWE.has(cwe) ? SEVERITY.CRITICAL : baseSeverity

  const fix = raw.extra?.metadata?.fix || null
  const note = raw.extra?.metadata?.note || null

  return {
    id: raw.check_id,
    severity,
    file: raw.path,
    line: raw.start?.line ?? 0,
    endLine: raw.end?.line ?? 0,
    message: (raw.extra?.message || raw.message || '').trim(),
    fix,
    note,
    cwe,
    owasp: raw.extra?.metadata?.owasp || '',
    source: 'semgrep',
  }
}

// ---------------------------------------------------------------------------
// npm audit runner
// ---------------------------------------------------------------------------

function runNpmAudit(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(pkgPath)) return []

  const result = spawnSync(
    'npm',
    ['audit', '--json', '--audit-level', 'none'],
    {
      cwd: projectPath,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    }
  )

  if (result.error || !result.stdout) return []

  try {
    const data = JSON.parse(result.stdout)
    const findings = []

    // npm v7+ audit JSON format
    const vulns = data.vulnerabilities || {}
    for (const [pkgName, vuln] of Object.entries(vulns)) {
      const severity = mapNpmSeverity(vuln.severity)
      const via = Array.isArray(vuln.via)
        ? vuln.via
            .filter(v => typeof v === 'object')
            .map(v => v.title || v.url || '')
            .filter(Boolean)
        : []
      findings.push({
        id: `npm-audit-${pkgName}`,
        severity,
        file: 'package.json',
        line: 0,
        message: `${pkgName}@${vuln.range || 'unknown'}: ${via[0] || vuln.severity + ' severity vulnerability'}`,
        fix: vuln.fixAvailable
          ? typeof vuln.fixAvailable === 'object'
            ? `npm install ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
            : 'npm audit fix'
          : 'No automatic fix available — check for alternative package',
        cwe: '',
        owasp: '',
        source: 'npm-audit',
      })
    }
    return findings
  } catch {
    return []
  }
}

function mapNpmSeverity(severity) {
  const map = {
    critical: SEVERITY.CRITICAL,
    high: SEVERITY.HIGH,
    moderate: SEVERITY.MEDIUM,
    low: SEVERITY.LOW,
    info: SEVERITY.INFO,
  }
  return map[severity?.toLowerCase()] || SEVERITY.MEDIUM
}

// ---------------------------------------------------------------------------
// Hallucinated package check (Pro)
// ---------------------------------------------------------------------------

function checkHallucinatedPackages(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(pkgPath)) return Promise.resolve([])

  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch {
    return Promise.resolve([])
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }

  const packageNames = Object.keys(allDeps)
  if (packageNames.length === 0) return Promise.resolve([])

  // Check up to 50 packages to avoid rate limits
  const toCheck = packageNames.slice(0, 50)

  const checks = toCheck.map(name => checkNpmRegistry(name))

  return Promise.all(checks).then(results => {
    const findings = []
    results.forEach((exists, i) => {
      if (!exists) {
        findings.push({
          id: `hallucinated-package-${toCheck[i]}`,
          severity: SEVERITY.CRITICAL,
          file: 'package.json',
          line: 0,
          message: `"${toCheck[i]}" does not exist on npm registry — possible hallucinated package (slopsquatting risk)`,
          fix: `Remove "${toCheck[i]}" from dependencies and find a verified replacement`,
          cwe: 'CWE-1104',
          owasp: 'A06:2021',
          source: 'hallucination-check',
        })
      }
    })
    return findings
  })
}

function checkNpmRegistry(packageName) {
  return new Promise(resolve => {
    // Scoped packages: @org/name → encode for URL
    const encoded = encodeURIComponent(packageName)
      .replace('%40', '@')
      .replace('%2F', '%2F')
    const url = `https://registry.npmjs.org/${encoded}`

    const req = https.get(
      url,
      {
        headers: { Accept: 'application/json' },
        timeout: 8000,
      },
      res => {
        resolve(res.statusCode !== 404)
        res.resume()
      }
    )
    req.on('error', () => resolve(true)) // Network error = assume exists (avoid false positives)
    req.on('timeout', () => {
      req.destroy()
      resolve(true)
    })
  })
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function groupBySeverity(findings) {
  const grouped = {}
  for (const sev of SEVERITY_ORDER) {
    grouped[sev] = []
  }
  for (const f of findings) {
    const sev = SEVERITY_ORDER.includes(f.severity) ? f.severity : SEVERITY.LOW
    grouped[sev].push(f)
  }
  return grouped
}

function buildHumanReport(findings, options = {}) {
  const grouped = groupBySeverity(findings)
  const totalCritical = grouped[SEVERITY.CRITICAL].length
  const totalHigh = grouped[SEVERITY.HIGH].length
  const total = findings.length

  const lines = []

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('  QA Architect — Vibe-Code Security Audit')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('')

  if (total === 0) {
    lines.push('  ✅  No security issues found.')
    lines.push('')
    lines.push('  Run periodically as your codebase grows.')
    lines.push('')
    return lines.join('\n')
  }

  // Summary line
  const verdict =
    totalCritical > 0
      ? '🚨 NOT SAFE TO SHIP'
      : totalHigh > 0
        ? '⚠️  REVIEW BEFORE SHIPPING'
        : '💛 MINOR ISSUES'
  lines.push(`  ${verdict}`)
  lines.push('')
  lines.push(`  Total findings: ${total}`)
  if (grouped[SEVERITY.CRITICAL].length)
    lines.push(`  🚨 Critical: ${grouped[SEVERITY.CRITICAL].length}`)
  if (grouped[SEVERITY.HIGH].length)
    lines.push(`  ❌ High:     ${grouped[SEVERITY.HIGH].length}`)
  if (grouped[SEVERITY.MEDIUM].length)
    lines.push(`  ⚠️  Medium:   ${grouped[SEVERITY.MEDIUM].length}`)
  if (grouped[SEVERITY.LOW].length)
    lines.push(`  💡 Low:      ${grouped[SEVERITY.LOW].length}`)
  lines.push('')

  for (const sev of SEVERITY_ORDER) {
    const sevFindings = grouped[sev]
    if (sevFindings.length === 0) continue

    const label = sev.toUpperCase()
    lines.push(`  ${SEVERITY_ICON[sev]} ${label} (${sevFindings.length})`)
    lines.push('  ' + '─'.repeat(55))

    for (const f of sevFindings) {
      const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file
      lines.push(`  ${loc}`)
      lines.push(`  ${f.message}`)
      if (f.fix) lines.push(`  → Fix: ${f.fix}`)
      if (f.note) lines.push(`  ℹ️  ${f.note}`)
      if (options.showIds && f.id) lines.push(`  [${f.id}]`)
      lines.push('')
    }
  }

  if (options.fix && findings.length > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    lines.push('  CLAUDE CODE FIX PROMPTS')
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    lines.push('')

    const toFix = findings
      .filter(f => [SEVERITY.CRITICAL, SEVERITY.HIGH].includes(f.severity))
      .slice(0, 10)

    for (const f of toFix) {
      lines.push(`  ── ${f.file}${f.line > 0 ? ':' + f.line : ''} ──`)
      lines.push('  Copy this prompt into Claude Code:')
      lines.push('')
      lines.push('  """')
      lines.push(buildClaudePrompt(f))
      lines.push('  """')
      lines.push('')
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('')

  return lines.join('\n')
}

// Report emitted in --no-fail mode when the audit could not actually run
// (semgrep missing, rule files absent, scan failure). PR-comment-ready so
// teams see *why* the scan was skipped instead of a silently-green check.
function buildSkippedReport(result) {
  const reasons = {
    semgrep_not_installed:
      'semgrep is not installed on the runner, so code-pattern scanning was skipped.',
    no_rules:
      'Semgrep rule files were not found, so code-pattern scanning was skipped.',
  }
  const detail = reasons[result.error] || `audit error: ${result.error}`

  const lines = []
  lines.push('## QA Architect — Vibe-Code Security Audit')
  lines.push('')
  lines.push('**Verdict:** ⏭️ **SCAN SKIPPED**')
  lines.push('')
  lines.push(`The vibe-code audit could not run: ${detail}`)
  lines.push('')
  lines.push(
    'Report-only mode (`--no-fail`) is enabled, so this did not fail the build.'
  )
  if (result.hint) {
    lines.push('')
    lines.push('```')
    lines.push(String(result.hint).trim())
    lines.push('```')
  }
  lines.push('')
  return lines.join('\n')
}

function buildMarkdownReport(findings, options = {}) {
  const grouped = groupBySeverity(findings)
  const total = findings.length
  const totalCritical = grouped[SEVERITY.CRITICAL].length
  const totalHigh = grouped[SEVERITY.HIGH].length

  const verdict =
    totalCritical > 0
      ? '🚨 **NOT SAFE TO SHIP**'
      : totalHigh > 0
        ? '⚠️ **REVIEW BEFORE SHIPPING**'
        : total > 0
          ? '💛 **MINOR ISSUES**'
          : '✅ **SAFE TO SHIP**'

  const lines = []

  lines.push('## QA Architect — Vibe-Code Security Audit')
  lines.push('')
  lines.push(`**Verdict:** ${verdict}`)
  lines.push('')
  lines.push('| Severity | Count |')
  lines.push('|---|---|')
  if (grouped[SEVERITY.CRITICAL].length)
    lines.push(`| 🚨 Critical | ${grouped[SEVERITY.CRITICAL].length} |`)
  if (grouped[SEVERITY.HIGH].length)
    lines.push(`| ❌ High     | ${grouped[SEVERITY.HIGH].length} |`)
  if (grouped[SEVERITY.MEDIUM].length)
    lines.push(`| ⚠️ Medium   | ${grouped[SEVERITY.MEDIUM].length} |`)
  if (grouped[SEVERITY.LOW].length)
    lines.push(`| 💡 Low      | ${grouped[SEVERITY.LOW].length} |`)
  if (total === 0) lines.push('| ✅ None     | 0 |')
  lines.push('')

  for (const sev of SEVERITY_ORDER) {
    const sevFindings = grouped[sev]
    if (sevFindings.length === 0) continue

    lines.push(
      `### ${SEVERITY_ICON[sev]} ${sev.charAt(0).toUpperCase() + sev.slice(1)}`
    )
    lines.push('')

    for (const f of sevFindings) {
      const loc = f.line > 0 ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``
      lines.push(`**${loc}**`)
      lines.push('')
      lines.push(f.message)
      if (f.fix) lines.push('')
      if (f.fix) lines.push(`**Fix:** ${f.fix}`)
      if (f.note) lines.push(`> ${f.note}`)
      if (f.cwe) lines.push(`_${f.cwe}_${f.owasp ? ` · ${f.owasp}` : ''}`)
      lines.push('')
    }
  }

  if (options.fix && findings.length > 0) {
    lines.push('---')
    lines.push('## Claude Code Fix Prompts')
    lines.push('')
    const toFix = findings
      .filter(f => [SEVERITY.CRITICAL, SEVERITY.HIGH].includes(f.severity))
      .slice(0, 10)

    for (const f of toFix) {
      lines.push(`### ${f.file}${f.line > 0 ? ':' + f.line : ''}`)
      lines.push('')
      lines.push('```')
      lines.push(buildClaudePrompt(f))
      lines.push('```')
      lines.push('')
    }
  }

  return lines.join('\n')
}

function buildClaudePrompt(finding) {
  const lines = [
    `Fix a security issue in ${finding.file}${finding.line > 0 ? ' at line ' + finding.line : ''}.`,
    '',
    `Issue: ${finding.message}`,
  ]
  if (finding.cwe)
    lines.push(
      `Category: ${finding.cwe}${finding.owasp ? ' (' + finding.owasp + ')' : ''}`
    )
  if (finding.fix) {
    lines.push('')
    lines.push(`Recommended fix: ${finding.fix}`)
  }
  lines.push('')
  lines.push('Please fix this issue while preserving existing functionality.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main audit orchestrator
// ---------------------------------------------------------------------------

async function runAudit(projectPath, options = {}) {
  const semgrepVersion = detectSemgrep()

  if (!semgrepVersion) {
    return {
      error: 'semgrep_not_installed',
      hint: semgrepInstallHint(),
    }
  }

  // Rule files — relative to this file's location
  const semgrepDir = path.resolve(__dirname, '../../.semgrep')
  const ruleFiles = [
    path.join(semgrepDir, 'defensive-patterns.yaml'),
    path.join(semgrepDir, 'vibe-audit-rules.yaml'),
    path.join(semgrepDir, 'vibe-moat-rules.yaml'),
  ].filter(f => fs.existsSync(f))

  if (ruleFiles.length === 0) {
    return {
      error: 'no_rules',
      hint: 'Semgrep rule files not found. Reinstall create-qa-architect.',
    }
  }

  // Run semgrep
  const semgrepResult = runSemgrep(projectPath, ruleFiles)
  if (semgrepResult.error) {
    return { error: semgrepResult.error }
  }

  const findings = semgrepResult.findings.map(mapSemgrepFinding)

  // Run npm audit
  const npmFindings = runNpmAudit(projectPath)
  findings.push(...npmFindings)

  // Hallucination check (Pro only)
  if (options.pro) {
    const hallucinated = await checkHallucinatedPackages(projectPath)
    findings.push(...hallucinated)
  }

  // Sort: critical first, then by file path
  findings.sort((a, b) => {
    const ai = SEVERITY_ORDER.indexOf(a.severity)
    const bi = SEVERITY_ORDER.indexOf(b.severity)
    if (ai !== bi) return ai - bi
    return a.file.localeCompare(b.file)
  })

  return { findings, semgrepVersion }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function handleAudit(options = {}) {
  const projectPath = options.projectPath || process.cwd()
  const isJson = options.json || false
  const outPath = options.outPath || null
  const wantFix = options.fix || false

  // Basic audit is free; only the Pro --fix path needs a license re-check.
  if (wantFix) {
    await ensureLicenseFresh()
  }

  // Feature gate: audit is free for basic, Pro for hallucination check
  const isPro = hasFeature('auditPro')
  const auditOptions = { pro: isPro, fix: wantFix }

  if (wantFix && !isPro) {
    showUpgradeMessage('Audit --fix (Claude Code prompt generation)')
    // Continue without fix prompts rather than blocking
    auditOptions.fix = false
  }

  const result = await runAudit(projectPath, auditOptions)

  // Infrastructure errors (semgrep missing, no rule files, scan failure) mean
  // the audit could not run — distinct from "ran and found issues". In CI
  // report-only mode (--no-fail) these MUST NOT break the build: emit a report
  // explaining the scan was skipped and exit 0. Without --no-fail, surface the
  // error and exit 1 so a human running it locally knows the scan didn't run.
  if (result.error) {
    if (result.error === 'semgrep_not_installed') {
      console.error('❌ semgrep is not installed.')
      console.error(result.hint)
    } else if (result.error === 'no_rules') {
      console.error(`❌ Audit error: ${result.error}`)
      if (result.hint) console.error(result.hint)
    } else {
      console.error(`❌ Audit error: ${result.error}`)
    }

    if (options.noFail) {
      const skipReport = buildSkippedReport(result)
      if (outPath) {
        fs.writeFileSync(outPath, skipReport, 'utf8')
        console.log(`✅ Audit report written to ${outPath} (scan skipped)`)
      }
      console.log('⏭️  --no-fail set: audit could not run; exiting 0.')
      process.exit(0)
    }

    process.exit(1)
  }

  const { findings } = result

  if (isJson) {
    const output = JSON.stringify(
      {
        summary: {
          total: findings.length,
          critical: findings.filter(f => f.severity === SEVERITY.CRITICAL)
            .length,
          high: findings.filter(f => f.severity === SEVERITY.HIGH).length,
          medium: findings.filter(f => f.severity === SEVERITY.MEDIUM).length,
          low: findings.filter(f => f.severity === SEVERITY.LOW).length,
        },
        findings,
      },
      null,
      2
    )
    if (outPath) {
      fs.writeFileSync(outPath, output, 'utf8')
      console.log(`✅ Audit report written to ${outPath}`)
    } else {
      console.log(output)
    }
  } else {
    const report = outPath
      ? buildMarkdownReport(findings, auditOptions)
      : buildHumanReport(findings, auditOptions)

    if (outPath) {
      fs.writeFileSync(outPath, report, 'utf8')
      console.log(`✅ Audit report written to ${outPath}`)
      // Also print summary to stdout
      const total = findings.length
      const critical = findings.filter(
        f => f.severity === SEVERITY.CRITICAL
      ).length
      const high = findings.filter(f => f.severity === SEVERITY.HIGH).length
      console.log(`   ${total} finding(s): ${critical} critical, ${high} high`)
    } else {
      console.log(report)
    }
  }

  const hasCritical = findings.some(f => f.severity === SEVERITY.CRITICAL)
  const hasHigh = findings.some(f => f.severity === SEVERITY.HIGH)

  if (options.noFail) {
    process.exit(0)
  } else if (hasCritical || hasHigh) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

module.exports = {
  handleAudit,
  runAudit,
  mapSemgrepFinding,
  groupBySeverity,
  buildMarkdownReport,
  buildHumanReport,
  buildSkippedReport,
}
