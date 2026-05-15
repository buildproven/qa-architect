/**
 * PR Check — diff-aware risk classifier for AI-assisted changes.
 *
 * Analyzes `git diff <base>...HEAD`, classifies risk per file, flags
 * missing tests for non-test source changes, and emits a PR-comment-ready
 * markdown report with a SHIP / REVIEW / BLOCK verdict.
 *
 * Gated behind Pro tier (hasFeature('prCheck')).
 *
 * All git invocations use spawnSync with argv arrays (no shell).
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { hasFeature, showUpgradeMessage } = require('../licensing')

const RISK = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
}

const RISK_ICON = {
  HIGH: '🔴',
  MEDIUM: '🟡',
  LOW: '🟢',
}

const VERDICT = {
  SHIP: 'SHIP',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
}

// File-path patterns mapped to risk levels.
// Order matters: first match wins (so high-risk patterns are checked first).
const HIGH_RISK_PATTERNS = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)auth[^/]*\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)(login|logout|session|jwt|oauth)[^/]*\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)(crypto|hash|password)[^/]*\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)(payment|stripe|billing|invoice|checkout)[^/]*\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)webhook[^/]*\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)migrations?\//i,
  /\.sql$/i,
  /(^|\/)(secrets?|tokens?|keys?)[^/]*\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)license[^/]*\.(js|ts|jsx|tsx|py)$/i,
]

const MEDIUM_RISK_PATTERNS = [
  /^package(-lock)?\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^yarn\.lock$/i,
  /^requirements.*\.txt$/i,
  /^pyproject\.toml$/i,
  /^Cargo\.(toml|lock)$/i,
  /^Gemfile(\.lock)?$/i,
  /^tsconfig.*\.json$/i,
  /^eslint\.config\.(c?js|ts)$/i,
  /^\.eslintrc.*$/i,
  /(^|\/)config\//i,
  /(^|\/)index\.(js|ts|jsx|tsx)$/i,
  /^Dockerfile$/i,
  /(^|\/)docker-compose.*\.ya?ml$/i,
]

const LOW_RISK_PATTERNS = [
  /\.(md|mdx)$/i,
  /(^|\/)docs\//i,
  /(^|\/)CHANGELOG/i,
  /\.test\.(js|ts|jsx|tsx|py)$/i,
  /\.spec\.(js|ts|jsx|tsx|py)$/i,
  /(^|\/)tests?\//i,
  /(^|\/)__tests__\//i,
  /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i,
]

function matchesAny(filePath, patterns) {
  return patterns.some(re => re.test(filePath))
}

// Paths under these prefixes are vendor / generated and should never count
// as a high-risk change, even if a segment of the path looks scary
// (e.g. `node_modules/foo/migrations/bar.js`).
const VENDOR_PREFIXES = [
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)\.venv\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
]

function isVendored(filePath) {
  return VENDOR_PREFIXES.some(re => re.test(filePath))
}

function classifyFile(filePath) {
  if (isVendored(filePath)) {
    return { risk: RISK.LOW, reason: 'vendored/generated path' }
  }
  if (matchesAny(filePath, HIGH_RISK_PATTERNS)) {
    return {
      risk: RISK.HIGH,
      reason: 'security/auth/payment/migration surface',
    }
  }
  if (matchesAny(filePath, LOW_RISK_PATTERNS)) {
    return { risk: RISK.LOW, reason: 'docs/tests/assets only' }
  }
  if (matchesAny(filePath, MEDIUM_RISK_PATTERNS)) {
    return {
      risk: RISK.MEDIUM,
      reason: 'config/dependency/public-API surface',
    }
  }
  return { risk: RISK.MEDIUM, reason: 'source change' }
}

function gitSpawn(projectPath, args, timeoutMs) {
  return spawnSync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: timeoutMs || 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
}

function inGitRepo(projectPath) {
  const r = gitSpawn(projectPath, ['rev-parse', '--is-inside-work-tree'])
  return r.status === 0 && (r.stdout || '').trim() === 'true'
}

// Permit `name`, `name/with/slashes`, `name-1.2.3`. Reject leading dashes
// (git would treat them as option flags) and obvious shell metacharacters
// even though we never invoke a shell.
const SAFE_REF_PATTERN = /^[A-Za-z0-9._/-]+$/

function isSafeRef(value) {
  if (!value || typeof value !== 'string') return false
  if (value.startsWith('-')) return false
  if (value.length > 200) return false
  return SAFE_REF_PATTERN.test(value)
}

function detectBaseBranch(projectPath, override) {
  if (override) {
    if (!isSafeRef(override)) return null
    // Confirm the override actually exists as a ref before we trust it.
    const r = gitSpawn(projectPath, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${override}^{commit}`,
    ])
    if (r.status === 0) return override
    return null
  }

  for (const candidate of ['main', 'master']) {
    const r = gitSpawn(projectPath, [
      'rev-parse',
      '--verify',
      '--quiet',
      candidate,
    ])
    if (r.status === 0) return candidate
  }
  return null
}

function getCurrentBranch(projectPath) {
  const r = gitSpawn(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.status === 0 ? (r.stdout || '').trim() : null
}

function getChangedFiles(projectPath, baseRef) {
  // `--name-status` gives us A/M/D/R per file.
  const r = gitSpawn(projectPath, [
    'diff',
    '--name-status',
    `${baseRef}...HEAD`,
  ])
  if (r.status !== 0) return null

  const out = (r.stdout || '').trim()
  if (!out) return []

  const files = []
  for (const line of out.split('\n')) {
    // Format: "M\tpath" or "R100\told\tnew"
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const code = parts[0]
    const filePath = parts[parts.length - 1] // for renames, the new path
    files.push({ code, path: filePath })
  }
  return files
}

function isTestFile(filePath) {
  return /\.(test|spec)\.(js|ts|jsx|tsx|py)$/i.test(filePath)
}

function isSourceCodeFile(filePath) {
  if (isTestFile(filePath)) return false
  return /\.(js|ts|jsx|tsx|py|rs|rb|go|java)$/i.test(filePath)
}

function findMissingTests(changedFiles) {
  const changedTestPaths = new Set(
    changedFiles.filter(f => isTestFile(f.path)).map(f => f.path)
  )
  const changedSourceFiles = changedFiles.filter(
    f => isSourceCodeFile(f.path) && f.code !== 'D'
  )

  const missing = []
  for (const src of changedSourceFiles) {
    if (hasMatchingTest(src.path, changedTestPaths)) continue
    missing.push(src.path)
  }
  return missing
}

function hasMatchingTest(srcPath, changedTestPaths) {
  const base = path.basename(srcPath).replace(/\.[^.]+$/, '')
  for (const testPath of changedTestPaths) {
    if (testPath.includes(base)) return true
  }
  return false
}

function classifyAll(changedFiles) {
  return changedFiles.map(f => ({
    path: f.path,
    code: f.code,
    ...classifyFile(f.path),
  }))
}

function summarizeRisks(classified) {
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const c of classified) {
    counts[c.risk]++
  }
  return counts
}

function computeVerdict(classified, missingTests) {
  const counts = summarizeRisks(classified)
  // BLOCK if any HIGH-risk file is in the missing-tests set. Adding an
  // unrelated README.md change must not downgrade verdict from BLOCK to
  // REVIEW — the high-risk file still has no test.
  const missingSet = new Set(missingTests)
  const highRiskMissingTest = classified.some(
    f => f.risk === RISK.HIGH && missingSet.has(f.path)
  )
  if (counts.HIGH > 0 && highRiskMissingTest) {
    return VERDICT.BLOCK
  }
  if (counts.HIGH > 0 || missingTests.length > 0) return VERDICT.REVIEW
  if (counts.MEDIUM > 0) return VERDICT.REVIEW
  return VERDICT.SHIP
}

function buildMarkdown(report) {
  const lines = []
  lines.push(`# PR Risk Check — ${report.verdict}`)
  lines.push('')
  if (report.baseRef && report.headRef) {
    lines.push(`_${report.headRef} vs \`${report.baseRef}\`_`)
    lines.push('')
  }

  const counts = report.riskCounts
  lines.push(
    `**Risk summary:** ${RISK_ICON.HIGH} ${counts.HIGH} high · ${RISK_ICON.MEDIUM} ${counts.MEDIUM} medium · ${RISK_ICON.LOW} ${counts.LOW} low`
  )
  if (report.missingTests.length > 0) {
    lines.push(
      `**Missing tests:** ${report.missingTests.length} source file(s) changed without matching test changes`
    )
  }
  lines.push('')

  const high = report.files.filter(f => f.risk === RISK.HIGH)
  if (high.length > 0) {
    lines.push('### 🔴 High-risk changes')
    for (const f of high) {
      lines.push(`- \`${f.path}\` — ${f.reason}`)
    }
    lines.push('')
  }

  if (report.missingTests.length > 0) {
    lines.push('### ⚠️ Source changes without matching tests')
    for (const p of report.missingTests.slice(0, 20)) {
      lines.push(`- \`${p}\``)
    }
    if (report.missingTests.length > 20) {
      lines.push(`- _…and ${report.missingTests.length - 20} more_`)
    }
    lines.push('')
  }

  lines.push('### All changed files')
  lines.push('| Risk | File | Reason |')
  lines.push('| --- | --- | --- |')
  for (const f of report.files) {
    const icon = RISK_ICON[f.risk] || ''
    lines.push(`| ${icon} ${f.risk} | \`${f.path}\` | ${f.reason} |`)
  }
  lines.push('')

  if (report.verdict === VERDICT.BLOCK) {
    lines.push('### ❌ Block')
    lines.push(
      'High-risk changes detected with no accompanying test changes. Add tests or get explicit reviewer sign-off.'
    )
  } else if (report.verdict === VERDICT.REVIEW) {
    lines.push('### ⚠️ Needs review')
    lines.push(
      'Non-trivial changes — request a careful review focused on the high-risk files above.'
    )
  } else {
    lines.push('### ✅ Low-risk diff')
    lines.push('Looks like docs / tests / minor changes only.')
  }

  return `${lines.join('\n')}\n`
}

function buildHumanReport(report) {
  const lines = []
  lines.push('')
  lines.push('🔍 PR Risk Check')
  lines.push('─'.repeat(60))
  if (report.baseRef) {
    lines.push(`Base: ${report.baseRef}  Head: ${report.headRef || 'HEAD'}`)
  }

  const counts = report.riskCounts
  lines.push(
    `Risk: ${RISK_ICON.HIGH} ${counts.HIGH} high  ${RISK_ICON.MEDIUM} ${counts.MEDIUM} medium  ${RISK_ICON.LOW} ${counts.LOW} low`
  )
  lines.push(`Files changed: ${report.files.length}`)
  if (report.missingTests.length > 0) {
    lines.push(`Missing tests: ${report.missingTests.length} source file(s)`)
  }
  lines.push('─'.repeat(60))

  for (const f of report.files) {
    const icon = RISK_ICON[f.risk] || ' '
    lines.push(`${icon} ${f.risk.padEnd(6)} ${f.path}`)
  }
  lines.push('─'.repeat(60))

  if (report.verdict === VERDICT.SHIP) {
    lines.push('✅ Verdict: SHIP — low-risk diff')
  } else if (report.verdict === VERDICT.REVIEW) {
    lines.push('⚠️  Verdict: REVIEW — request careful review')
  } else {
    lines.push('❌ Verdict: BLOCK — add tests or get explicit sign-off')
  }
  lines.push('')
  return lines.join('\n')
}

function runPrCheck(projectPath, options = {}) {
  if (!inGitRepo(projectPath)) {
    return { error: 'Not a git repository' }
  }

  const baseRef = detectBaseBranch(projectPath, options.base)
  if (!baseRef) {
    return {
      error:
        'Could not detect base branch (no main or master found). Pass --base <branch>.',
    }
  }

  const headRef = getCurrentBranch(projectPath)
  const changed = getChangedFiles(projectPath, baseRef)
  if (changed === null) {
    return { error: `Failed to compute git diff against ${baseRef}` }
  }

  if (changed.length === 0) {
    return {
      verdict: VERDICT.SHIP,
      baseRef,
      headRef,
      files: [],
      missingTests: [],
      riskCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      empty: true,
      generatedAt: new Date().toISOString(),
    }
  }

  const classified = classifyAll(changed)
  const missingTests = findMissingTests(changed)
  const riskCounts = summarizeRisks(classified)
  const verdict = computeVerdict(classified, missingTests)

  return {
    verdict,
    baseRef,
    headRef,
    files: classified,
    missingTests,
    riskCounts,
    empty: false,
    generatedAt: new Date().toISOString(),
  }
}

async function handlePrCheck(options = {}) {
  if (!hasFeature('prCheck')) {
    showUpgradeMessage('PR Risk Check (diff-aware risk classifier)')
    process.exit(1)
  }

  const projectPath = options.projectPath || process.cwd()
  const report = runPrCheck(projectPath, options)

  if (report.error) {
    process.stderr.write(`❌ ${report.error}\n`)
    process.exit(1)
  }

  if (report.empty) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(
        `\n✅ No changes vs \`${report.baseRef}\` — nothing to review.\n\n`
      )
    }
    process.exit(0)
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

  if (options.noFail) {
    process.exit(0)
  }
  process.exit(report.verdict === VERDICT.BLOCK ? 1 : 0)
}

module.exports = {
  runPrCheck,
  handlePrCheck,
  classifyFile,
  findMissingTests,
  computeVerdict,
  buildMarkdown,
  buildHumanReport,
  RISK,
  VERDICT,
}
