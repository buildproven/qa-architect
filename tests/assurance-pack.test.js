#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const yaml = require('js-yaml')
const {
  PACK,
  assertCompatiblePackUpdate,
  assertValidPack,
  selectAssurancePack,
  selectionSummary,
} = require('../lib/assurance/pack')
const {
  defaultScanner,
  selectedPackConfig,
} = require('../lib/commands/pr-assurance')

const FIXTURES = require('./fixtures/assurance-packs/web-saas-v1.json')
const RULES = path.resolve(__dirname, '../.semgrep/vibe-moat-rules.yaml')
let passed = 0
let failed = 0
let skipped = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed += 1
  } catch (error) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${error.stack || error.message}`)
    failed += 1
  }
}

function fixtureProject(dependencies = {}, markers = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-pack-project-'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ dependencies }, null, 2)}\n`
  )
  for (const marker of markers) {
    const filename = path.join(root, marker)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, '')
  }
  return root
}

function semgrepAvailable() {
  const result = spawnSync('semgrep', ['--version'], { encoding: 'utf8' })
  return !result.error && result.status === 0
}

function firedRules(fixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-pack-rule-'))
  try {
    const filename = path.join(root, fixture.path)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, fixture.source)
    const result = spawnSync(
      'semgrep',
      ['--json', '--quiet', '--no-git-ignore', '--config', RULES, root],
      { encoding: 'utf8', timeout: 60_000 }
    )
    const parsed = JSON.parse(result.stdout || '{"results":[]}')
    assert.ok([0, 1].includes(result.status), result.stderr)
    return new Set(
      (parsed.results || []).map(item => String(item.check_id).split('.').pop())
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

console.log('\nWeb SaaS assurance pack')

test('pack conforms to the strict contract and every check has fixtures', () => {
  assert.strictEqual(assertValidPack(PACK), PACK)
  assert.strictEqual(FIXTURES.packVersion, PACK.version)
  assert.deepStrictEqual(
    PACK.checks.map(check => check.id).sort(),
    Object.keys(FIXTURES.checks).sort()
  )
  for (const check of PACK.checks) {
    assert.ok(check.limitations.length > 0)
    assert.ok(FIXTURES.checks[check.id].positive)
    assert.ok(FIXTURES.checks[check.id].negative)
  }
})

test('fixtures cover every declared framework-version variant', () => {
  for (const stack of PACK.stacks) {
    assert.deepStrictEqual(
      FIXTURES.frameworkVariants[stack.id],
      stack.versionVariants
    )
    assert.deepStrictEqual(
      FIXTURES.variantFixtures
        .filter(fixture => fixture.stack === stack.id)
        .map(fixture => fixture.variant),
      stack.versionVariants
    )
  }
})

test('stack detection activates only applicable checks and explains why', () => {
  const root = fixtureProject({ next: '^15.0.0', stripe: '^18.0.0' })
  const selection = selectAssurancePack(root)
  assert.deepStrictEqual(
    selection.detectedStacks.map(stack => stack.id),
    ['nextjs', 'stripe']
  )
  assert.ok(
    selection.checks.every(check =>
      check.stacks.some(stack => ['nextjs', 'stripe'].includes(stack))
    )
  )
  assert.ok(!selection.checks.some(check => check.id === 'prisma-tenant-scope'))
  assert.ok(
    !selection.checks.some(
      check => check.id === 'next-client-privileged-client'
    )
  )
  assert.match(selectionSummary(selection), /next@\^15\.0\.0/)
  assert.match(selectionSummary(selection), /Runtime evidence still required/)
})

test('PR scanning config contains exactly the applicable pack rules', () => {
  const root = fixtureProject({ next: '^15.0.0', stripe: '^18.0.0' })
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-pack-config-'))
  try {
    const configPath = selectedPackConfig(
      path.resolve(__dirname, '../.semgrep'),
      selectAssurancePack(root),
      output
    )
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'))
    const ids = config.rules.map(rule => rule.id).sort()
    assert.ok(ids.includes('qaa-web-saas.next-route-handler-missing-auth'))
    assert.ok(ids.includes('qaa-web-saas.stripe-request-controlled-amount'))
    assert.ok(!ids.includes('qaa-web-saas.prisma-request-body-mass-assignment'))
    assert.ok(!ids.includes('qaa-web-saas.supabase-service-role-client'))
  } finally {
    fs.rmSync(output, { recursive: true, force: true })
  }
})

test('pack rule files cannot escape the shipped .semgrep directory', () => {
  const root = fixtureProject({ next: '^15.0.0' })
  const selection = structuredClone(selectAssurancePack(root))
  selection.checks[0].ruleFile = '../../package.json'
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-pack-config-'))
  try {
    assert.throws(
      () =>
        selectedPackConfig(
          path.resolve(__dirname, '../.semgrep'),
          selection,
          output
        ),
      /outside \.semgrep/
    )
  } finally {
    fs.rmSync(output, { recursive: true, force: true })
  }
})

test('repository markers detect ORM stacks without package metadata', () => {
  const root = fixtureProject({}, ['prisma/schema.prisma', 'drizzle.config.ts'])
  assert.deepStrictEqual(
    selectAssurancePack(root).detectedStacks.map(stack => stack.id),
    ['prisma', 'drizzle']
  )
})

test('rule-version changes require an explicit compatible migration', () => {
  const previous = structuredClone(PACK)
  const next = structuredClone(PACK)
  next.version = '1.2.0'
  next.checks[0].version = '1.1.0'
  assert.throws(() => assertCompatiblePackUpdate(previous, next), /migration/)
  next.migrations.push({
    checkId: next.checks[0].id,
    from: '1.0.0',
    to: '1.1.0',
    reason: 'Fixture semantics changed',
  })
  assert.strictEqual(assertCompatiblePackUpdate(previous, next), true)
})

test('removing a check or changing the pack major fails compatibility', () => {
  const removed = structuredClone(PACK)
  removed.version = '1.2.0'
  removed.checks.pop()
  assert.throws(() => assertCompatiblePackUpdate(PACK, removed), /removed/)
  const major = structuredClone(PACK)
  major.version = '2.0.0'
  assert.throws(() => assertCompatiblePackUpdate(PACK, major), /major-version/)
})

test('semantic changes need a rule bump and pack versions cannot regress', () => {
  const silentChange = structuredClone(PACK)
  silentChange.version = '1.1.1'
  silentChange.checks[0].safePattern = 'Different guidance'
  assert.throws(
    () => assertCompatiblePackUpdate(PACK, silentChange),
    /without a version bump/
  )
  const backward = structuredClone(PACK)
  backward.version = '0.9.0'
  assert.throws(
    () => assertCompatiblePackUpdate(PACK, backward),
    /major-version|backward/
  )
  const unchangedPackVersion = structuredClone(PACK)
  unchangedPackVersion.checks[0].version = '1.0.1'
  unchangedPackVersion.migrations.push({
    checkId: unchangedPackVersion.checks[0].id,
    from: '1.0.0',
    to: '1.0.1',
    reason: 'Fixture semantics changed',
  })
  assert.throws(
    () => assertCompatiblePackUpdate(PACK, unchangedPackVersion),
    /without a pack version bump/
  )
  const backwardRule = structuredClone(PACK)
  backwardRule.version = '1.1.1'
  backwardRule.checks[0].version = '0.9.0'
  assert.throws(
    () => assertCompatiblePackUpdate(PACK, backwardRule),
    /rule version moved backward/
  )
})

if (!semgrepAvailable()) {
  console.error(
    '  ❌ semgrep is required — static precision benchmark did not run'
  )
  failed += 1
} else {
  test('the changed-code scanner executes the selected pack rules', () => {
    const root = fixtureProject({ next: '^15.0.0', stripe: '^18.0.0' })
    const relative = 'app/api/checkout.ts'
    const filename = path.join(root, relative)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(
      filename,
      "await stripe.paymentIntents.create({ amount: req.body.amount, currency: 'usd' })\n"
    )
    const scan = defaultScanner(
      root,
      [relative],
      { timeoutMs: 60_000 },
      selectAssurancePack(root)
    )
    assert.strictEqual(scan.outcome, 'passed', scan.error)
    const fired = scan.findings.map(item =>
      String(item.check_id).split('.').pop()
    )
    assert.ok(fired.includes('stripe-request-controlled-amount'))
    assert.ok(
      scan.findings.some(item =>
        String(item.check_id).includes('qaa-web-saas.')
      )
    )
  })

  test('every framework-version fixture fires only on its insecure variant', () => {
    const failures = []
    for (const fixture of FIXTURES.variantFixtures) {
      const check = PACK.checks.find(item => item.id === fixture.checkId)
      if (!firedRules(fixture.positive).has(check.semgrepRuleId)) {
        failures.push(`${fixture.stack}/${fixture.variant}: missed`)
      }
      if (firedRules(fixture.negative).has(check.semgrepRuleId)) {
        failures.push(`${fixture.stack}/${fixture.variant}: noisy`)
      }
    }
    assert.deepStrictEqual(failures, [])
  })

  test('versioned static fixtures benchmark at 100% positive and 0% negative matches', () => {
    const staticChecks = PACK.checks.filter(check => check.semgrepRuleId)
    const missed = []
    const noisy = []
    let positiveCount = 0
    let negativeCount = 0
    for (const check of staticChecks) {
      const fixtures = FIXTURES.checks[check.id]
      const positives = [
        fixtures.positive,
        ...(fixtures.additionalPositives || []),
      ]
      const negatives = [
        fixtures.negative,
        ...(fixtures.additionalNegatives || []),
      ]
      positiveCount += positives.length
      negativeCount += negatives.length
      for (const [index, fixture] of positives.entries()) {
        if (!firedRules(fixture).has(check.semgrepRuleId)) {
          missed.push(`${check.id}#${index + 1}`)
        }
      }
      for (const [index, fixture] of negatives.entries()) {
        if (firedRules(fixture).has(check.semgrepRuleId)) {
          noisy.push(`${check.id}#${index + 1}`)
        }
      }
    }
    assert.deepStrictEqual(missed, [], `missed fixtures: ${missed.join(', ')}`)
    assert.deepStrictEqual(noisy, [], `noisy fixtures: ${noisy.join(', ')}`)
    console.log(
      `     fixture precision: ${positiveCount}/${positiveCount} positives, 0/${negativeCount} negatives`
    )
  })
}

console.log('')
console.log(
  `assurance-pack.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped`
)
if (failed > 0) process.exit(1)
