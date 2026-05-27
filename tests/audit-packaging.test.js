/**
 * Tests that the audit command's runtime dependencies (semgrep rule files)
 * are included in the published npm tarball.
 *
 * Regression guard: the `--audit` free-tier feature requires
 * `.semgrep/defensive-patterns.yaml` and `.semgrep/vibe-audit-rules.yaml`
 * to be present in the installed package. If `package.json#files` ever
 * drops `.semgrep/`, consumers will get "no_rules" and the headline free
 * feature breaks silently. (Caught in code review of PR #155 by the
 * Codex adversarial reviewer.)
 */

'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')

let passed = 0
let failed = 0

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

console.log('\naudit packaging — .semgrep/ ships with the tarball')

// `npm pack --dry-run --json` prints a JSON manifest of files that
// would be included in the tarball. We assert the audit rule files
// are present.
function getPackedFiles() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error(
      `npm pack --dry-run exited ${result.status}: ${result.stderr}`
    )
  }

  // npm pack --json emits an array with one entry per tarball. In CI the
  // `prepare` script runs as part of `npm pack` and prints "Skipping Husky
  // in CI" to stdout BEFORE the JSON, so we can't just JSON.parse the raw
  // stdout. Slice from the first '[' or '{' to end. (Lifecycle scripts
  // cannot be disabled here — `--ignore-scripts` still runs `prepare`
  // because npm treats it as a pack-time hook, not an install script.)
  const stdout = result.stdout
  const jsonStart = stdout.search(/[[{]/)
  if (jsonStart === -1) {
    throw new Error(
      `npm pack --json produced no JSON output. stdout: ${stdout}`
    )
  }
  const parsed = JSON.parse(stdout.slice(jsonStart))
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  return (entry.files || []).map(f => f.path)
}

const packedFiles = getPackedFiles()

test('.semgrep/defensive-patterns.yaml is in the published tarball', () => {
  assert.ok(
    packedFiles.includes('.semgrep/defensive-patterns.yaml'),
    'defensive-patterns.yaml missing from npm pack output — add ".semgrep/" to package.json#files'
  )
})

test('.semgrep/vibe-audit-rules.yaml is in the published tarball', () => {
  assert.ok(
    packedFiles.includes('.semgrep/vibe-audit-rules.yaml'),
    'vibe-audit-rules.yaml missing from npm pack output — add ".semgrep/" to package.json#files'
  )
})

test('setup.js is in the published tarball (sanity check)', () => {
  assert.ok(
    packedFiles.includes('setup.js'),
    'setup.js missing — sanity check, indicates packaging test itself is broken'
  )
})

test('lib/commands/audit.js is in the published tarball', () => {
  assert.ok(
    packedFiles.includes('lib/commands/audit.js'),
    'lib/commands/audit.js missing from tarball'
  )
})

console.log(`\n${passed} passed, ${failed} failed (audit-packaging.test.js)\n`)

if (failed > 0) {
  process.exit(1)
}
