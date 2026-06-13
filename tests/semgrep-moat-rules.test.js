/**
 * Precision tests for the vibe-moat semgrep rules (.semgrep/vibe-moat-rules.yaml).
 *
 * These rules target AI-native vulnerability classes generic SAST misses:
 * secrets shipped in client bundles, and data access that trusts a
 * client-supplied id with no ownership scope (the DB-agnostic IDOR / missing-RLS
 * class). Following the 699-false-positive lesson, each rule is pinned to FIRE
 * on a genuine vuln and STAY SILENT on the correct, scoped form.
 *
 * Requires the semgrep CLI; self-skips when absent (CI installs it).
 */

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

let passed = 0
let failed = 0
let skipped = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${err.message}`)
    failed++
  }
}

function semgrepAvailable() {
  const r = spawnSync('semgrep', ['--version'], { encoding: 'utf8' })
  return !r.error && r.status === 0
}

const MOAT_RULES = path.resolve(__dirname, '../.semgrep/vibe-moat-rules.yaml')

/**
 * Write {relPath: source} into a temp tree, run the moat rules, return the set
 * of short rule ids that fired. Relative paths matter (some rules are scoped to
 * .tsx/.jsx/app/ via `paths:`).
 */
function rulesFiredOn(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-moat-'))
  const created = []
  try {
    for (const [rel, source] of Object.entries(files)) {
      const full = path.join(root, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, source, 'utf8')
      created.push(full)
    }
    const r = spawnSync(
      'semgrep',
      ['--json', '--quiet', '--no-git-ignore', '--config', MOAT_RULES, root],
      { encoding: 'utf8', timeout: 60_000 }
    )
    const parsed = JSON.parse(r.stdout || '{"results":[]}')
    return new Set(
      (parsed.results || []).map(x => String(x.check_id).split('.').pop())
    )
  } finally {
    for (const f of created) fs.rmSync(f, { force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (!semgrepAvailable()) {
  console.log('\nsemgrep-moat-rules: ⏭️  semgrep not installed — skipping')
  skipped = 1
} else {
  console.log('\nclient-bundle secret leakage — true positives fire')

  test('public-env-holds-secret fires on NEXT_PUBLIC_*_SECRET_KEY', () => {
    const fired = rulesFiredOn({
      'a.js': 'const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY\n',
    })
    assert.ok(fired.has('public-env-holds-secret'))
  })

  test('public-env-holds-secret fires on import.meta.env VITE_*_API_KEY', () => {
    const fired = rulesFiredOn({
      'a.js': 'const k = import.meta.env.VITE_OPENAI_API_KEY\n',
    })
    assert.ok(fired.has('public-env-holds-secret'))
  })

  test('service-key-in-client-component fires in a "use client" file', () => {
    const fired = rulesFiredOn({
      'app/page.jsx':
        '"use client"\nconst sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)\n',
    })
    assert.ok(fired.has('service-key-in-client-component'))
  })

  console.log('\nclient-bundle secret leakage — false positives stay silent')

  test('a public but non-secret var does NOT fire', () => {
    const fired = rulesFiredOn({
      'a.js': 'const url = process.env.NEXT_PUBLIC_API_URL\n',
    })
    assert.ok(!fired.has('public-env-holds-secret'))
  })

  test('a server-only secret (no public prefix) does NOT fire', () => {
    const fired = rulesFiredOn({
      'a.js': 'const k = process.env.STRIPE_SECRET_KEY\n',
    })
    assert.ok(!fired.has('public-env-holds-secret'))
  })

  console.log('\nunscoped data access — true positives fire')

  test('prisma findUnique by request id (unscoped) fires', () => {
    const fired = rulesFiredOn({
      'a.js':
        'const u = prisma.user.findUnique({ where: { id: req.params.id } })\n',
    })
    assert.ok(fired.has('prisma-find-by-request-id-unscoped'))
  })

  test('drizzle where eq(id, req) fires', () => {
    const fired = rulesFiredOn({
      'a.js':
        'const r = db.select().from(orders).where(eq(orders.id, req.params.id))\n',
    })
    assert.ok(fired.has('drizzle-where-eq-id-unscoped'))
  })

  test('supabase from().select().eq(id, req) fires', () => {
    const fired = rulesFiredOn({
      'a.js':
        'const d = supabase.from("users").select("*").eq("id", req.query.uid)\n',
    })
    assert.ok(fired.has('supabase-select-on-user-table'))
  })

  console.log('\nunscoped data access — false positives stay silent')

  test('prisma query WITH an ownership filter does NOT fire', () => {
    const fired = rulesFiredOn({
      'a.js':
        'const u = prisma.user.findUnique({ where: { id: req.params.id, userId: session.user.id } })\n',
    })
    assert.ok(!fired.has('prisma-find-by-request-id-unscoped'))
  })

  test('prisma query by an internal (non-request) id does NOT fire', () => {
    const fired = rulesFiredOn({
      'a.js':
        'const u = prisma.user.findUnique({ where: { id: internalId } })\n',
    })
    assert.ok(!fired.has('prisma-find-by-request-id-unscoped'))
  })
}

console.log('')
console.log(
  `semgrep-moat-rules.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped`
)

if (failed > 0) process.exit(1)
