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

  test('auth-bypass-or-condition fires on a legitimate authz .includes() predicate', () => {
    // `roles.includes('admin')` is a real authz membership check — a permissive
    // OR with it IS a bypass and must fire (not suppressed as "string search").
    const fired = rulesFiredOn({
      'lib/a.js':
        "if (isAuthenticated || roles.includes('admin')) { grantAccess() }\n",
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('auth-bypass-or-condition fires on an RBAC equality predicate ORed with a bypass', () => {
    // `role === requiredRole || debugMode` is a real RBAC check — the equality
    // exclusion is scoped to ERROR properties, so genuine role/token equality
    // auth predicates still fire.
    const fired = rulesFiredOn({
      'lib/a.js':
        'function h(req){ if (req.user.role === requiredRole || debugMode) { grantAccess() } }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('auth-bypass-or-condition fires on a token equality predicate ORed with a bypass', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        'function h(){ if (token === expectedToken || bypass) { allow() } }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('auth-bypass-or-condition fires on a 3+ operand chain with auth in the MIDDLE', () => {
    // `x || isAuthenticated || y` parses as `(x || isAuthenticated) || y`. The
    // auth predicate sits in a nested subtree, so the rule must NOT blanket-
    // exclude OR subtrees or it silently misses this bypass.
    const fired = rulesFiredOn({
      'lib/a.js': 'if (x || isAuthenticated || y) { grantAccess() }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('auth-bypass-or-condition fires on a 3+ operand chain ending in auth', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        'if (isAuthenticated || debugMode || featureFlag) { grantAccess() }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('auth-bypass-or-condition fires on a NEGATED auth operand whose body GRANTS access', () => {
    // `if (!isAuthenticated || debugMode) grantAccess()` grants access to
    // unauthenticated users — a real bypass. Negated operands are NOT
    // blanket-suppressed; genuine fail-closed denial guards in this repo carry
    // an inline nosemgrep instead (we cannot prove body-denies in semgrep OSS).
    const fired = rulesFiredOn({
      'lib/a.js':
        'function h(){ if (!isAuthenticated || debugMode) { grantAccess() } }\n',
    })
    assert.ok(fired.has('auth-bypass-or-condition'))
  })

  test('path-traversal-join fires on a NON-req request object with 3+ segments', () => {
    // Vararg patterns use $REQ, not a literal `req`, so a request object named
    // `request` in a multi-segment join is still caught.
    const fired = rulesFiredOn({
      'lib/a.js':
        "function h(request){ return path.join(baseDir, 'uploads', request.params.filename) }\n",
    })
    assert.ok(fired.has('path-traversal-join'))
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

  test('error-classification OR (error-property substring) does NOT fire auth-bypass-or-condition', () => {
    const fired = rulesFiredOn({
      'lib/a.js':
        "function f(e){ if (e.message.includes('401') || e.message.includes('authentication')) { return true } }\n",
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('error-property EQUALITY comparison does NOT fire auth-bypass-or-condition', () => {
    // `err.message === 'authentication failed' || err.code === 'TOKEN_EXPIRED'`
    // — the auth word lives in the string LITERAL being compared, not in an
    // access-granting predicate. Equality/inequality operands are excluded.
    const fired = rulesFiredOn({
      'lib/a.js':
        "function f(err){ if (err.message === 'authentication failed' || err.code === 'TOKEN_EXPIRED') { return 'auth' } }\n",
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('two-operand error-property search does NOT fire auth-bypass-or-condition', () => {
    // `a || err.message.includes('permission')` — the auth-named operand is an
    // error-PROPERTY substring search; excluded as error classification.
    const fired = rulesFiredOn({
      'lib/a.js':
        "function f(a, err){ if (a || err.message.includes('permission')) { return 'perm' } }\n",
    })
    assert.ok(!fired.has('auth-bypass-or-condition'))
  })

  test('KNOWN LIMITATION: recall-bias means some error-classification still warns', () => {
    // Two cases this WARNING-level heuristic cannot distinguish from real
    // predicates, by design (recall over precision for a security rule):
    //   1. bare-receiver `message.includes('permission')` — structurally
    //      identical to a real authz `roles.includes('admin')`.
    //   2. a 3+ operand error chain `code==='EACCES' || code==='EPERM' ||
    //      err.message.includes('permission')` — the matched subtree is
    //      indistinguishable from a real 3-operand auth-OR bypass, which we
    //      MUST keep firing on (see the middle-of-chain TP above).
    // Real instances (e.g. lib/error-reporter.js:categorizeError) carry a
    // per-site inline `nosemgrep`. This test pins the limitation so a future
    // "fix" that re-suppresses real chained bypasses is caught.
    const bareIncludes = rulesFiredOn({
      'lib/a.js':
        "function f(message){ if (a || message.includes('permission')) { return 'perm' } }\n",
    })
    const errorChain = rulesFiredOn({
      'lib/a.js':
        "function f(code, err){ if (code === 'EACCES' || code === 'EPERM' || err.message.includes('permission')) { return 'perm' } }\n",
    })
    assert.ok(bareIncludes.has('auth-bypass-or-condition'))
    assert.ok(errorChain.has('auth-bypass-or-condition'))
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
