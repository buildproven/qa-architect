#!/usr/bin/env node

/**
 * Risk Policy Gate - Carson's Code Factory Pattern
 *
 * Validates PR changes against risk-aware merge policy before expensive CI.
 * Implements Carson's "gate preflight before expensive CI" pattern.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const picomatch = require('picomatch')

// Load harness configuration
const CONFIG_PATH = path.join(__dirname, '..', 'harness-config.json')

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ harness-config.json not found')
    process.exit(1)
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    console.error('❌ Invalid harness-config.json:', error.message)
    process.exit(1)
  }
}

/**
 * Default git runner — uses execFileSync (no shell, no concat). Returns trimmed
 * stdout, throws with `.failed=true` on non-zero exit. Tests inject their own.
 */
function defaultGitRunner(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const err = new Error(`git ${args.join(' ')} failed: ${error.message}`)
    err.failed = true
    throw err
  }
}

/**
 * Resolve the base ref for diffing against HEAD.
 *
 * Algorithm (pure — only the injected runner touches git):
 *   1. CI path: GITHUB_BASE_REF + GITHUB_HEAD_REF set → `origin/<base>`
 *   2. CLI: --base <ref> → use it; fail closed if not resolvable
 *   3. HEAD detached → fail closed
 *   4. Try in order: origin/main, origin/master, main, master
 *   5. None resolvable → fail closed
 *
 * Returns { mode: 'ci'|'local', base: '<ref>' }
 * Throws Error with `.reason` for any fail-closed condition.
 */
function resolveBase({
  env = process.env,
  baseArg = null,
  gitRunner = defaultGitRunner,
} = {}) {
  // Step 1: CI path
  if (env.GITHUB_BASE_REF && env.GITHUB_HEAD_REF) {
    return { mode: 'ci', base: `origin/${env.GITHUB_BASE_REF}` }
  }

  // Step 2: explicit --base
  if (baseArg) {
    if (!refExists(baseArg, gitRunner)) {
      const err = new Error(`--base ${baseArg} is not resolvable in this repo`)
      err.reason = 'base-not-resolvable'
      throw err
    }
    return { mode: 'local', base: baseArg }
  }

  // Step 3: detached HEAD
  if (isHeadDetached(gitRunner)) {
    const err = new Error('HEAD is detached; pass --base <ref> explicitly')
    err.reason = 'detached-head'
    throw err
  }

  // Step 4: candidate base order
  const candidates = ['origin/main', 'origin/master', 'main', 'master']
  for (const ref of candidates) {
    if (refExists(ref, gitRunner)) {
      return { mode: 'local', base: ref }
    }
  }

  // Step 5: nothing resolved
  const err = new Error(
    'No base ref found (tried origin/main, origin/master, main, master); pass --base explicitly'
  )
  err.reason = 'no-base'
  throw err
}

function refExists(ref, gitRunner) {
  try {
    gitRunner(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

function isHeadDetached(gitRunner) {
  try {
    gitRunner(['symbolic-ref', '--quiet', 'HEAD'])
    return false
  } catch {
    return true
  }
}

/**
 * Step 6: merge-base + Step 7: union of branch diff + staged + unstaged.
 * Throws with `.reason='no-merge-base'` when merge-base cannot be computed
 * (unrelated history or shallow clone too short).
 */
function getChangedFilesForBase(base, gitRunner = defaultGitRunner) {
  let mergeBase
  try {
    mergeBase = gitRunner(['merge-base', 'HEAD', base])
  } catch {
    const err = new Error(
      `Could not compute merge-base between HEAD and ${base} ` +
        '(unrelated history or shallow clone too short); deepen clone or pass --base explicitly'
    )
    err.reason = 'no-merge-base'
    throw err
  }

  if (!mergeBase) {
    const err = new Error(`merge-base HEAD ${base} returned empty`)
    err.reason = 'no-merge-base'
    throw err
  }

  const branch = gitRunner(['diff', '--name-only', `${mergeBase}...HEAD`])
  const staged = gitRunner(['diff', '--cached', '--name-only'])
  const unstaged = gitRunner(['diff', '--name-only'])

  return [
    ...new Set(
      [branch, staged, unstaged]
        .flatMap(out => out.split('\n'))
        .filter(f => f.length > 0)
    ),
  ]
}

/**
 * Top-level wrapper used by main(). Resolves base + diffs in one call.
 * Any failure throws an Error with `.reason` — caller decides exit message.
 */
function getChangedFiles({
  env = process.env,
  baseArg = null,
  gitRunner = defaultGitRunner,
} = {}) {
  const resolved = resolveBase({ env, baseArg, gitRunner })
  const files = getChangedFilesForBase(resolved.base, gitRunner)
  return { files, resolved }
}

function parseCliArgs(argv) {
  const result = { baseArg: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && i + 1 < argv.length) {
      result.baseArg = argv[i + 1]
      i++
    } else if (argv[i].startsWith('--base=')) {
      result.baseArg = argv[i].slice('--base='.length)
    }
  }
  return result
}

const matcherCache = new Map()
function getMatcher(pattern) {
  let matcher = matcherCache.get(pattern)
  if (!matcher) {
    try {
      matcher = picomatch(pattern, { dot: true })
    } catch {
      console.warn(`Invalid pattern: ${pattern}`)
      matcher = () => false
    }
    matcherCache.set(pattern, matcher)
  }
  return matcher
}

function matchesPattern(filepath, patterns) {
  return patterns.some(pattern => getMatcher(pattern)(filepath))
}

function calculateRiskTier(filepath, config) {
  const { riskTierRules } = config

  if (!riskTierRules || typeof riskTierRules !== 'object') {
    return 'low'
  }

  // Check in order of decreasing risk - use allowlist of known tiers
  const validTiers = ['critical', 'high', 'medium', 'low']
  for (const tier of validTiers) {
    if (riskTierRules[tier] && Array.isArray(riskTierRules[tier])) {
      if (matchesPattern(filepath, riskTierRules[tier])) {
        return tier
      }
    }
  }

  return 'low' // default
}

function validateRequiredChecks(riskTier, config) {
  if (!config.mergePolicy) {
    return {
      valid: false,
      error: 'No mergePolicy defined in config',
    }
  }

  const policy = config.mergePolicy[riskTier]
  if (!policy) {
    return {
      valid: false,
      error: `No merge policy defined for risk tier: ${riskTier}`,
    }
  }

  const { requiredChecks } = policy
  const missingChecks = []

  for (const check of requiredChecks) {
    if (!config.checkDefinitions[check]) {
      missingChecks.push(check)
    }
  }

  if (missingChecks.length > 0) {
    return {
      valid: false,
      error: `Missing check definitions: ${missingChecks.join(', ')}`,
    }
  }

  return { valid: true }
}

function analyzeRisks(changedFiles, config) {
  const riskOrder = ['low', 'medium', 'high', 'critical']
  const riskAnalysis = {}
  let highestRisk = 'low'

  for (const file of changedFiles) {
    const risk = calculateRiskTier(file, config)
    if (!riskAnalysis[risk]) riskAnalysis[risk] = []
    riskAnalysis[risk].push(file)

    if (riskOrder.indexOf(risk) > riskOrder.indexOf(highestRisk)) {
      highestRisk = risk
    }
  }

  return { riskAnalysis, highestRisk }
}

function printRiskAnalysis(riskAnalysis) {
  const TIER_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }
  console.log('📊 Risk Analysis:')
  for (const tier of ['critical', 'high', 'medium', 'low']) {
    const files = riskAnalysis[tier]
    if (!files || files.length === 0) continue
    console.log(
      `   ${TIER_EMOJI[tier]} ${tier.toUpperCase()}: ${files.length} files`
    )
    const preview = files.length <= 3 ? files : files.slice(0, 2)
    preview.forEach(f => console.log(`      - ${f}`))
    if (files.length > 3) console.log(`      ... and ${files.length - 2} more`)
  }
  console.log('')
}

function printPolicyRequirements(highestRisk, policy, config) {
  console.log(`🎯 Merge Policy: ${highestRisk.toUpperCase()} tier requirements`)
  console.log('   Required checks:')
  policy.requiredChecks.forEach(check => {
    const def = config.checkDefinitions[check]
    console.log(`      ✓ ${check} (${def.description})`)
  })
  console.log(`   Review requirement: ${policy.reviewRequirement}`)
  console.log(`   Evidence requirement: ${policy.evidenceRequirement}`)
  console.log('')
}

function checkDocsDrift(changedFiles, config) {
  if (!config.docsDriftRules?.enabled) return
  const affected = changedFiles.filter(file =>
    config.docsDriftRules.watchPaths.some(pattern =>
      matchesPattern(file, [pattern])
    )
  )
  if (affected.length === 0) return
  console.log('📝 Docs drift check:')
  console.log('   Changed files that may require doc updates:')
  affected.forEach(file => console.log(`      - ${file}`))
  console.log('   Required updates:')
  config.docsDriftRules.requiredUpdates.forEach(path =>
    console.log(`      - ${path}`)
  )
  console.log('')
}

function writeGithubOutput(summary) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath || typeof outputPath !== 'string' || outputPath.length === 0)
    return
  try {
    Object.entries(summary).forEach(([key, value]) => {
      fs.appendFileSync(outputPath, `${key}=${value}\n`, { encoding: 'utf8' })
    })
  } catch (error) {
    console.warn('Failed to write GitHub Actions output:', error.message)
  }
}

function main() {
  console.log('🔍 Risk Policy Gate - Validating PR changes...\n')

  const config = loadConfig()
  const { baseArg } = parseCliArgs(process.argv.slice(2))

  let changedFiles
  let resolved
  try {
    ;({ files: changedFiles, resolved } = getChangedFiles({ baseArg }))
  } catch (error) {
    // Fail-closed for any base-resolution / merge-base failure.
    console.error(`❌ Failed to determine changed files: ${error.message}`)
    if (error.reason) {
      console.error(`   Reason: ${error.reason}`)
    }
    process.exit(1)
  }

  console.log(`🔎 Base resolution: mode=${resolved.mode} base=${resolved.base}`)

  if (changedFiles.length === 0) {
    console.log('✅ No changed files detected - policy gate passed')
    return
  }

  console.log(`📁 Changed files (${changedFiles.length}):`)
  changedFiles.forEach(file => console.log(`   ${file}`))
  console.log('')

  const { riskAnalysis, highestRisk } = analyzeRisks(changedFiles, config)
  printRiskAnalysis(riskAnalysis)

  const validation = validateRequiredChecks(highestRisk, config)
  if (!validation.valid) {
    console.error(`❌ Policy validation failed: ${validation.error}`)
    process.exit(1)
  }

  const policy = config.mergePolicy[highestRisk]
  printPolicyRequirements(highestRisk, policy, config)
  checkDocsDrift(changedFiles, config)

  if (process.env.GITHUB_OUTPUT) {
    writeGithubOutput({
      highestRisk,
      requiredChecks: policy.requiredChecks.join(','),
      reviewRequired: policy.reviewRequirement !== 'none',
      changedFileCount: changedFiles.length,
      resolvedBase: resolved.base,
      resolutionMode: resolved.mode,
    })
  }

  console.log('✅ Risk policy gate passed')
  console.log(
    `📈 Proceeding with ${highestRisk.toUpperCase()} tier requirements`
  )
}

if (require.main === module) {
  main()
}

module.exports = {
  calculateRiskTier,
  validateRequiredChecks,
  matchesPattern,
  resolveBase,
  getChangedFilesForBase,
  getChangedFiles,
  parseCliArgs,
}
