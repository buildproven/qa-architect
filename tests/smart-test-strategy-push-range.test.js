/**
 * Smart Test Strategy must inspect the full pushed range, not just HEAD~1.
 * A high-risk first commit followed by a benign second commit previously hid
 * the risky change from the pre-push test selection.
 */

'use strict'

const assert = require('assert')
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const STRATEGY_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'smart-test-strategy.sh'
)

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 })
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-smart-range-'))
  git(root, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['config', 'user.name', 'QA Architect test'])
  git(root, ['config', 'user.email', 'qa-architect@example.com'])
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'base'])
  git(root, ['remote', 'add', 'origin', root])
  git(root, ['fetch', '--quiet', 'origin', 'main'])
  git(root, ['switch', '--quiet', '-c', 'feature'])

  fs.mkdirSync(path.join(root, 'lib'))
  fs.writeFileSync(path.join(root, 'lib', 'license.js'), 'module.exports = 1\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'risky library change'])

  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n\nsecond commit\n')
  git(root, ['add', 'README.md'])
  git(root, ['commit', '--quiet', '-m', 'benign docs change'])

  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  writeExecutable(path.join(bin, 'npm'), '#!/usr/bin/env bash\nexit 0\n')
  return { root, bin }
}

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${error.message}`)
    failed++
  }
}

console.log('\nsmart test strategy push range')

test('includes a risky first commit in a two-commit push', () => {
  const { root, bin } = createFixture()
  try {
    const result = spawnSync('bash', [STRATEGY_SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        QAA_TEST_BASE_REF: 'origin/main',
      },
    })

    assert.strictEqual(result.status, 0, result.stderr)
    assert.match(result.stdout, /Files changed: 2/)
    assert.match(result.stdout, /Risk Score: 4\/10/)
    assert.match(result.stdout, /MEDIUM RISK/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

console.log(
  `\n${passed} passed, ${failed} failed (smart-test-strategy-push-range.test.js)\n`
)

if (failed > 0) process.exit(1)
