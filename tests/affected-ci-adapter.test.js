'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'quality.yml'),
  'utf8'
)

assert(workflow.includes('fetch-depth: 0'))
assert(
  workflow.includes('CLAUDE_KIT_SHA: 6209610058b95a3d3f2a9d1af7a10f9c69f0dd69')
)
assert(workflow.includes('git show "$BASE_SHA:.buildproven/test-impact.json"'))
assert(
  workflow.includes('merge-base --is-ancestor "$CLAUDE_KIT_SHA" FETCH_HEAD')
)
assert(workflow.includes('--policy-sha256 "$POLICY_SHA256"'))
assert(workflow.includes('--git-range "$BASE_SHA" "$HEAD_SHA"'))
assert(workflow.includes('Base test-impact policy is absent'))
assert(
  workflow.includes('Test-impact policy and application code changed together')
)
assert(
  workflow.includes(
    'Only generated quality policy files changed. The release generator already validated the new policy.'
  )
)
assert(
  workflow.includes(
    "grep -vE '^(\\.github/workflows/quality\\.yml|\\.buildproven/test-impact\\.json)$'"
  )
)
assert(
  workflow.includes(
    'cmp -s "$POLICY_ROOT/.buildproven/test-impact.json" .buildproven/test-impact.json'
  )
)
assert(workflow.includes("hashFiles('.buildproven/test-impact.json') != ''"))
assert(workflow.includes("hashFiles('.buildproven/test-impact.json') == ''"))
assert(
  !workflow.includes(
    "github.repository != 'buildproven/qa-architect' || (github.event_name != 'pull_request'"
  )
)
assert(!workflow.includes('--diff-filter='))
assert(!workflow.includes('git diff --name-only -z "$BASE_SHA" "$HEAD_SHA"'))

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-affected-delete-'))
try {
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], {
    cwd: fixture,
  })
  execFileSync('git', ['config', 'user.name', 'QA Test'], { cwd: fixture })
  execFileSync('git', ['config', 'user.email', 'qa@example.com'], {
    cwd: fixture,
  })
  fs.mkdirSync(path.join(fixture, 'lib'))
  fs.writeFileSync(
    path.join(fixture, 'lib', 'mapped.js'),
    'module.exports = 1\n'
  )
  execFileSync('git', ['add', '.'], { cwd: fixture })
  execFileSync('git', ['commit', '--quiet', '-m', 'base'], { cwd: fixture })
  fs.unlinkSync(path.join(fixture, 'lib', 'mapped.js'))
  execFileSync('git', ['add', '-u'], { cwd: fixture })
  execFileSync('git', ['commit', '--quiet', '-m', 'delete mapped source'], {
    cwd: fixture,
  })
  const changed = execFileSync(
    'git',
    ['diff', '--name-only', 'HEAD~1', 'HEAD'],
    { cwd: fixture, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
  assert.deepStrictEqual(changed, ['lib/mapped.js'])

  fs.writeFileSync(
    path.join(fixture, 'mapped-target.js'),
    'module.exports = 2\n'
  )
  fs.writeFileSync(
    path.join(fixture, 'lib', 'typed.js'),
    'module.exports = 2\n'
  )
  execFileSync('git', ['add', '.'], { cwd: fixture })
  execFileSync('git', ['commit', '--quiet', '-m', 'add regular file'], {
    cwd: fixture,
  })
  fs.unlinkSync(path.join(fixture, 'lib', 'typed.js'))
  fs.symlinkSync('../mapped-target.js', path.join(fixture, 'lib', 'typed.js'))
  execFileSync('git', ['add', '.'], { cwd: fixture })
  execFileSync('git', ['commit', '--quiet', '-m', 'change file type'], {
    cwd: fixture,
  })
  const typeChanged = execFileSync(
    'git',
    ['diff', '--name-only', 'HEAD~1', 'HEAD'],
    { cwd: fixture, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
  assert.deepStrictEqual(typeChanged, ['lib/typed.js'])
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

console.log('Affected CI adapter tests passed.')
