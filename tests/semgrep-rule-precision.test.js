/**
 * Rule-precision regression tests for the vibe-audit semgrep rules.
 *
 * These rules previously matched on bare syntax (every require(), path.join(),
 * ===, ||) and produced 699 findings on qa-architect's own clean codebase —
 * 98% false positives. A scanner that cries wolf gets ignored, burying the
 * real findings. This test pins the precision of the four rules that were
 * fixed: each must FIRE on a genuine vulnerability and STAY SILENT on the
 * benign pattern that previously triggered it.
 *
 * Requires the semgrep CLI. When semgrep is not installed the test no-ops
 * (skips) rather than failing — CI installs semgrep before running it.
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

const RULE_DIR = path.resolve(__dirname, '../.semgrep')
const RULE_FILES = ['defensive-patterns.yaml', 'vibe-audit-rules.yaml'].map(f =>
  path.join(RULE_DIR, f)
)

/**
 * Run the audit rule set over a tree of {relativePath: source} files and
 * return the set of rule ids that fired (short id, e.g. "dynamic-require-variable").
 * Relative paths matter: some rules are scoped via `paths:` to api/server dirs.
 */
function rulesFiredOn(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-rule-test-'))
  const created = []
  try {
    for (const [rel, source] of Object.entries(files)) {
      const full = path.join(root, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, source, 'utf8')
      created.push(full)
    }
    const args = ['--json', '--quiet', '--no-git-ignore']
    for (const f of RULE_FILES) args.push('--config', f)
    args.push(root)
    const r = spawnSync('semgrep', args, {
      encoding: 'utf8',
      timeout: 60_000,
    })
    const parsed = JSON.parse(r.stdout || '{"results":[]}')
    return new Set(
      (parsed.results || []).map(x => String(x.check_id).split('.').pop())
    )
  } finally {
    // Explicit-path cleanup only (no rm -rf through a variable).
    for (const f of created) fs.rmSync(f, { force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (!semgrepAvailable()) {
  console.log('\nsemgrep-rule-precision: ⏭️  semgrep not installed — skipping')
  skipped = 1
} else {
  console.log('\nsemgrep rule precision — true positives fire')

  test('dynamic-require-variable fires on a variable require', () => {
    const fired = rulesFiredOn({
      'lib/a.js': 'const m = require(userSuppliedName)\n',
    })
    assert.ok(fired.has('dynamic-require-variable'))
  })

  test('path-traversal-join fires on request-fed join', () => {
    const fired = rulesFiredOn({
      'lib/a.js': 'const f = path.join(baseDir, req.params.filename)\n',
    })
    assert.ok(fired.has('path-traversal-join'))
  })

  test('auth-bypass-or-condition fires on auth-named OR', () => {
    const fired = rulesFiredOn({
      'lib/a.js': 'if (isAuthenticated || debugMode) { grantAccess() }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('hardcoded-admin-identity fires on admin email check in an API route', () => {
    const fired = rulesFiredOn({
      'pages/api/route.js':
        'export default function h(req,res){ if (req.user.email === "admin@example.com") {} }\n',
    })
    assert.ok(fired.has('hardcoded-admin-identity'))
  })

  // Regression guards (PR review): the precision pass must not silently drop
  // genuine vulnerabilities via operand order, request-data aliasing, or
  // dir-scope narrowing. These three previously fired and must keep firing.

  test('auth-bypass-or-condition fires when auth operand is on the RIGHT (commuted bypass)', () => {
    // `if (debugMode || isAuthenticated) grant()` is the same bypass as the
    // left-operand form — operand order must not decide detection.
    const fired = rulesFiredOn({
      'lib/a.js': 'if (debugMode || isAuthenticated) { grantAccess() }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('path-traversal-join fires on ALIASED request data (assignment)', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        'function h(req){ const filename = req.params.filename; return path.join(baseDir, filename) }\n',
    })
    assert.ok(fired.has('path-traversal-join'))
  })

  test('path-traversal-join fires on DESTRUCTURED request data', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        'function h(req){ const { filename } = req.query; return path.join(baseDir, filename) }\n',
    })
    assert.ok(fired.has('path-traversal-join'))
  })

  test('hardcoded-admin-identity fires in a server-side lib auth helper', () => {
    const fired = rulesFiredOn({
      'lib/auth.js':
        'function isAdmin(userEmail){ return userEmail === "admin@example.com" }\n',
    })
    assert.ok(fired.has('hardcoded-admin-identity'))
  })

  console.log('\nsemgrep rule precision — false positives stay silent')

  test('static require("crypto") does NOT fire dynamic-require-variable', () => {
    const fired = rulesFiredOn({ 'lib/a.js': "const c = require('crypto')\n" })
    assert.ok(!fired.has('dynamic-require-variable'))
  })

  test('path.join with a literal filename does NOT fire path-traversal-join', () => {
    const fired = rulesFiredOn({
      'lib/a.js': "const p = path.join(projectPath, 'package.json')\n",
    })
    assert.ok(!fired.has('path-traversal-join'))
  })

  test('non-auth OR condition does NOT fire auth-bypass-or-condition', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        "if (stepName.includes('test') || stepName.includes('e2e')) {}\n",
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('negated auth guard (fail-closed early return) does NOT fire auth-bypass-or-condition', () => {
    // `if (!isAuthenticated || !token) return` is the SAFE guard shape — it
    // DENIES on missing auth, the opposite of a permissive bypass. The
    // both-operand rule excludes negated operands so this stays silent even
    // though `isAuthenticated`/`token` match the auth-name regex.
    const fired = rulesFiredOn({
      'lib/a.js':
        'function f(){ if (!isAuthenticated || !token) { return [] } }\n',
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('negated auth guard with auth on the RIGHT does NOT fire auth-bypass-or-condition', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        'function f(){ if (!ghCliAvailable() || !ghAuthenticated()) { return [] } }\n',
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('error-classification OR (auth substring) does NOT fire auth-bypass-or-condition', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        "function f(e){ if (e.message.includes('401') || e.message.includes('authentication')) { return true } }\n",
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('error-name string compare does NOT fire hardcoded-admin-identity', () => {
    const fired = rulesFiredOn({
      'pages/api/route.js':
        "export default function h(){ if (error.name === 'BlobNotFoundError') {} }\n",
    })
    assert.ok(!fired.has('hardcoded-admin-identity'))
  })

  test('admin check OUTSIDE api/server dirs is out of scope (no fire)', () => {
    const fired = rulesFiredOn({
      'utils/helper.js':
        'const ok = currentUser.email === "admin@example.com"\n',
    })
    assert.ok(!fired.has('hardcoded-admin-identity'))
  })
}

console.log('')
console.log(
  `semgrep-rule-precision.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped`
)

if (failed > 0) process.exit(1)
