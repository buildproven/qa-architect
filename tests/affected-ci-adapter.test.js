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
  workflow.includes('CLAUDE_KIT_SHA: 05a42b5f655dc0b558a1a8286e03c27216032d05')
)
assert(workflow.includes('git show "$BASE_SHA:.buildproven/test-impact.json"'))
assert(workflow.includes('--execute --policy-root "$POLICY_ROOT"'))
assert(workflow.includes('Base test-impact policy is absent'))
assert(workflow.includes("github.repository != 'buildproven/qa-architect'"))
assert(workflow.includes('--diff-filter=ACDMR'))

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
    ['diff', '--name-only', '--diff-filter=ACDMR', 'HEAD~1', 'HEAD'],
    { cwd: fixture, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
  assert.deepStrictEqual(changed, ['lib/mapped.js'])
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}

console.log('Affected CI adapter tests passed.')
