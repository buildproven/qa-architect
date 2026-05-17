// @ts-nocheck
/**
 * Risk Policy Gate tests
 *
 * Covers pure helpers: calculateRiskTier, validateRequiredChecks,
 * matchesPattern, parseCliArgs, resolveBase, getChangedFilesForBase,
 * getChangedFiles. The git layer is stubbed via the injectable gitRunner.
 */

const {
  calculateRiskTier,
  validateRequiredChecks,
  matchesPattern,
  resolveBase,
  getChangedFilesForBase,
  getChangedFiles,
  parseCliArgs,
} = require('../scripts/risk-policy-gate')

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

function makeGitRunner(map) {
  return args => {
    const key = args.join(' ')
    const handler = map[key]
    if (handler === undefined) {
      throw new Error(`Unmocked git call: git ${key}`)
    }
    const value = typeof handler === 'function' ? handler(args) : handler
    if (value === 'THROW') {
      const err = new Error(`git ${key} failed (mocked)`)
      err.failed = true
      throw err
    }
    return value
  }
}

// Config that mirrors the real harness-config.json shape for this repo.
const config = {
  riskTierRules: {
    critical: [
      'setup.js',
      'lib/licensing.js',
      'templates/quality.yml',
      'scripts/deploy-consumers.sh',
      '.github/workflows/**',
      'package.json',
    ],
    high: ['lib/commands/**', 'templates/**'],
    medium: ['lib/**', 'tests/**'],
    low: ['docs/**', '*.md'],
  },
  mergePolicy: {
    critical: { requiredChecks: ['lint-and-format', 'test-integration'] },
    high: { requiredChecks: ['lint-and-format', 'test-unit'] },
    medium: { requiredChecks: ['lint-and-format'] },
    low: { requiredChecks: ['lint-and-format'] },
  },
  checkDefinitions: {
    'lint-and-format': { description: 'lint' },
    'test-unit': { description: 'unit tests' },
    'test-integration': { description: 'integration tests' },
  },
}

console.log('🧪 risk-policy-gate.test.js\n')

console.log(
  'Test 0: riskTierRules drift guard — keys are exactly {critical,high,medium,low}'
)
{
  const fs = require('fs')
  const path = require('path')
  const harnessPath = path.join(__dirname, '..', 'harness-config.json')
  const harness = JSON.parse(fs.readFileSync(harnessPath, 'utf8'))
  const actualKeys = Object.keys(harness.riskTierRules).sort()
  const expectedKeys = ['critical', 'high', 'low', 'medium']
  check(
    'harness-config.json riskTierRules keys are exactly the 4 known tiers',
    JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
    `got ${JSON.stringify(actualKeys)}`
  )
  check(
    'harness-config.json mergePolicy keys match riskTierRules keys',
    JSON.stringify(Object.keys(harness.mergePolicy).sort()) ===
      JSON.stringify(expectedKeys)
  )
}

console.log('Test 1: calculateRiskTier — critical glob matches scripts/**')
check(
  'scripts/deploy-consumers.sh → critical',
  calculateRiskTier('scripts/deploy-consumers.sh', config) === 'critical'
)

console.log('\nTest 2: calculateRiskTier — exact filename')
check(
  'setup.js → critical',
  calculateRiskTier('setup.js', config) === 'critical'
)
check(
  'package.json → critical',
  calculateRiskTier('package.json', config) === 'critical'
)

console.log('\nTest 3: calculateRiskTier — workflow globs')
check(
  '.github/workflows/quality.yml → critical',
  calculateRiskTier('.github/workflows/quality.yml', config) === 'critical'
)

console.log('\nTest 4: calculateRiskTier — high tier under lib/commands/')
check(
  'lib/commands/ship-check.js → high',
  calculateRiskTier('lib/commands/ship-check.js', config) === 'high'
)

console.log('\nTest 5: calculateRiskTier — high beats medium when both match')
check(
  'lib/commands/x.js → high (not medium)',
  calculateRiskTier('lib/commands/x.js', config) === 'high'
)

console.log('\nTest 6: calculateRiskTier — medium fallback under lib/')
check(
  'lib/template-loader.js → medium',
  calculateRiskTier('lib/template-loader.js', config) === 'medium'
)

console.log('\nTest 7: calculateRiskTier — low for docs/markdown')
check('README.md → low', calculateRiskTier('README.md', config) === 'low')
check(
  'docs/anything.md → low',
  calculateRiskTier('docs/anything.md', config) === 'low'
)

console.log('\nTest 8: calculateRiskTier — unknown defaults to low')
check(
  'random/unknown.txt → low',
  calculateRiskTier('random/unknown.txt', config) === 'low'
)

console.log('\nTest 9: matchesPattern — ** matches across slashes')
check(
  'a/b/c.js matches lib/**',
  matchesPattern('lib/x/y/z.js', ['lib/**']) === true
)
check(
  'lib itself also matches lib/** (picomatch semantics: ** matches zero or more path segments)',
  matchesPattern('lib', ['lib/**']) === true
)

console.log('\nTest 10: matchesPattern — single * does NOT cross slashes')
check('a/b does not match a/*', matchesPattern('a/b/c', ['a/*']) === false)
check('a/b matches a/*', matchesPattern('a/b', ['a/*']) === true)

console.log('\nTest 11: validateRequiredChecks — happy path')
check(
  'critical tier validates',
  validateRequiredChecks('critical', config).valid === true
)

console.log('\nTest 12: validateRequiredChecks — missing check definition')
const badConfig = {
  mergePolicy: { high: { requiredChecks: ['lint', 'nonexistent'] } },
  checkDefinitions: { lint: { description: 'lint' } },
}
const result = validateRequiredChecks('high', badConfig)
check('missing check is flagged', result.valid === false)
check(
  'error names the missing check',
  result.error && result.error.includes('nonexistent')
)

console.log('\nTest 13: validateRequiredChecks — unknown tier')
const unknownTier = validateRequiredChecks('does-not-exist', config)
check('unknown tier rejected', unknownTier.valid === false)

console.log('\nTest 14: parseCliArgs — --base <ref>')
check('--base main parsed', parseCliArgs(['--base', 'main']).baseArg === 'main')
check(
  '--base=main parsed',
  parseCliArgs(['--base=origin/main']).baseArg === 'origin/main'
)
check('no --base → null', parseCliArgs([]).baseArg === null)

console.log('\nTest 15: resolveBase — CI path via GITHUB_BASE_REF')
const ciResolved = resolveBase({
  env: { GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'feature/x' },
  gitRunner: makeGitRunner({}),
})
check('CI mode detected', ciResolved.mode === 'ci')
check('CI base is origin/<base>', ciResolved.base === 'origin/main')

console.log('\nTest 16: resolveBase — local fallback to origin/main')
const localResolved = resolveBase({
  env: {},
  gitRunner: makeGitRunner({
    'symbolic-ref --quiet HEAD': 'refs/heads/feature/x',
    'rev-parse --verify --quiet origin/main^{commit}': 'abc123',
  }),
})
check('local mode detected', localResolved.mode === 'local')
check('origin/main resolved', localResolved.base === 'origin/main')

console.log('\nTest 17: resolveBase — detached HEAD fails closed')
let detachedErr
try {
  resolveBase({
    env: {},
    gitRunner: makeGitRunner({
      'symbolic-ref --quiet HEAD': 'THROW',
    }),
  })
} catch (e) {
  detachedErr = e
}
check('detached HEAD throws', detachedErr !== undefined)
check(
  'reason=detached-head',
  detachedErr && detachedErr.reason === 'detached-head'
)

console.log('\nTest 18: resolveBase — no base found fails closed')
let noBaseErr
try {
  resolveBase({
    env: {},
    gitRunner: makeGitRunner({
      'symbolic-ref --quiet HEAD': 'refs/heads/feature/x',
      'rev-parse --verify --quiet origin/main^{commit}': 'THROW',
      'rev-parse --verify --quiet origin/master^{commit}': 'THROW',
      'rev-parse --verify --quiet main^{commit}': 'THROW',
      'rev-parse --verify --quiet master^{commit}': 'THROW',
    }),
  })
} catch (e) {
  noBaseErr = e
}
check('no-base throws', noBaseErr !== undefined)
check('reason=no-base', noBaseErr && noBaseErr.reason === 'no-base')

console.log('\nTest 19: resolveBase — explicit --base validates ref exists')
let badBaseErr
try {
  resolveBase({
    env: {},
    baseArg: 'nonexistent',
    gitRunner: makeGitRunner({
      'rev-parse --verify --quiet nonexistent^{commit}': 'THROW',
    }),
  })
} catch (e) {
  badBaseErr = e
}
check('bad --base rejected', badBaseErr !== undefined)
check(
  'reason=base-not-resolvable',
  badBaseErr && badBaseErr.reason === 'base-not-resolvable'
)

console.log('\nTest 20: getChangedFilesForBase — union of diff sources')
const files = getChangedFilesForBase(
  'origin/main',
  makeGitRunner({
    'merge-base HEAD origin/main': 'deadbeef',
    'diff --name-only deadbeef...HEAD': 'a.js\nb.js',
    'diff --cached --name-only': 'b.js\nc.js',
    'diff --name-only': 'd.js',
  })
)
check('files deduplicated', files.length === 4)
check(
  'includes all sources',
  ['a.js', 'b.js', 'c.js', 'd.js'].every(f => files.includes(f))
)

console.log('\nTest 21: getChangedFilesForBase — empty diff returns []')
const emptyFiles = getChangedFilesForBase(
  'origin/main',
  makeGitRunner({
    'merge-base HEAD origin/main': 'deadbeef',
    'diff --name-only deadbeef...HEAD': '',
    'diff --cached --name-only': '',
    'diff --name-only': '',
  })
)
check('empty diff → empty array', emptyFiles.length === 0)

console.log('\nTest 22: getChangedFilesForBase — no merge-base fails closed')
let noMbErr
try {
  getChangedFilesForBase(
    'origin/main',
    makeGitRunner({
      'merge-base HEAD origin/main': 'THROW',
    })
  )
} catch (e) {
  noMbErr = e
}
check('no-merge-base throws', noMbErr !== undefined)
check('reason=no-merge-base', noMbErr && noMbErr.reason === 'no-merge-base')

console.log('\nTest 23: getChangedFiles — end-to-end with stubbed git')
const e2e = getChangedFiles({
  env: { GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'feature/x' },
  gitRunner: makeGitRunner({
    'merge-base HEAD origin/main': 'cafe1234',
    'diff --name-only cafe1234...HEAD': 'setup.js\nREADME.md',
    'diff --cached --name-only': '',
    'diff --name-only': '',
  }),
})
check('resolved.mode is ci', e2e.resolved.mode === 'ci')
check('files include setup.js', e2e.files.includes('setup.js'))
check('files include README.md', e2e.files.includes('README.md'))

console.log('')
if (failures > 0) {
  console.error(`❌ ${failures} test(s) failed`)
  process.exit(1)
}
console.log('✅ All risk-policy-gate tests passed')
