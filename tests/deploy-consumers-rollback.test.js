'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const DEPLOY_SCRIPT = path.join(
  __dirname,
  '..',
  'scripts',
  'deploy-consumers.sh'
)

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function snapshot(cwd) {
  return {
    head: git(cwd, 'rev-parse', 'HEAD'),
    tree: git(cwd, 'write-tree'),
    status: git(cwd, 'status', '--porcelain', '--untracked-files=all'),
  }
}

function createConsumer(root, name) {
  const origins = path.join(root, 'origins')
  const projects = path.join(root, 'Projects')
  const remote = path.join(origins, `${name}.git`)
  const repo = path.join(projects, name)
  fs.mkdirSync(origins, { recursive: true })
  fs.mkdirSync(projects, { recursive: true })
  git(origins, 'init', '--bare', '--initial-branch=main', `${name}.git`)
  git(projects, 'clone', '--quiet', remote, name)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '1.0.0',
        private: true,
        scripts: { test: 'node tests/smoke.test.js' },
      },
      null,
      2
    ) + '\n'
  )
  fs.writeFileSync(
    path.join(repo, 'package-lock.json'),
    JSON.stringify(
      {
        name,
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name, version: '1.0.0' },
        },
      },
      null,
      2
    ) + '\n'
  )
  fs.mkdirSync(path.join(repo, 'tests'))
  fs.writeFileSync(path.join(repo, 'tests', 'smoke.test.js'), "'use strict'\n")
  fs.writeFileSync(
    path.join(repo, '.github', 'workflows', 'quality.yml'),
    'name: Quality\n# WORKFLOW_MODE: minimal\n'
  )
  git(repo, 'add', '.')
  git(repo, 'commit', '--quiet', '-m', 'initial')
  git(repo, 'push', '--quiet', '-u', 'origin', 'main')
  return { remote, repo }
}

function run(root, args, env = {}) {
  return spawnSync('bash', [DEPLOY_SCRIPT, ...args], {
    env: { ...process.env, HOME: root, ...env },
    encoding: 'utf8',
  })
}

function testExplicitCanaryContract() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fleet-canary-'))
  try {
    createConsumer(root, 'canary')
    const missing = run(root, [])
    assert.strictEqual(missing.status, 2)
    assert.match(missing.stderr, /select a canary/)

    const invalid = run(root, ['--canary', 'not-a-consumer'])
    assert.notStrictEqual(invalid.status, 0)
    assert.match(invalid.stderr, /not a canonical generated consumer/)
    assert.doesNotMatch(invalid.stdout, /explicitly skipped/)

    const directPush = run(root, ['--push', '--canary', 'canary'])
    assert.strictEqual(directPush.status, 2)
    assert.match(directPush.stderr, /use --pr/)
    console.log('  ✓ explicit canary fails closed and direct push is removed')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function testLinkedWorktreeIsNotDiscovered() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fleet-worktree-'))
  try {
    const { repo } = createConsumer(root, 'primary')
    const linked = path.join(root, 'Projects', 'feature-copy')
    git(repo, 'worktree', 'add', '--quiet', '-b', 'feature-copy', linked)
    const result = run(root, ['--canary', 'feature-copy', '--canary-only'])
    assert.notStrictEqual(result.status, 0)
    assert.match(result.stderr, /not a canonical generated consumer/)
    console.log('  ✓ linked feature worktrees are not rollout targets')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function testValidationUsesRemoteAndLeavesCheckoutUntouched() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fleet-validate-'))
  try {
    const { repo } = createConsumer(root, 'canary')
    fs.writeFileSync(path.join(repo, 'local-user-work.txt'), 'keep me\n')
    const before = snapshot(repo)
    const result = run(root, ['--canary', 'canary', '--canary-only'])
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /READY:/)
    assert.match(result.stdout, /\.github\/workflows\/quality\.yml/)
    assert.match(result.stdout, /\.buildproven\/test-impact\.json/)
    assert.deepStrictEqual(snapshot(repo), before)
    console.log(
      '  ✓ validation uses the remote default branch and leaves local work untouched'
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function testPullRequestContainsOnlyRolloutFiles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fleet-pr-'))
  try {
    const { remote } = createConsumer(root, 'canary')
    const bin = path.join(root, 'bin')
    const ghLog = path.join(root, 'gh.log')
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!/bin/sh\nif [ "$1 $2" = "pr create" ]; then\n  printf '%s\\n' "$*" >> '${ghLog}'\n  printf 'https://example.test/pr/1\\n'\n  exit 0\nfi\nexec "$REAL_GH" "$@"\n`
    )
    fs.chmodSync(path.join(bin, 'gh'), 0o755)
    const result = run(root, ['--canary', 'canary', '--canary-only', '--pr'], {
      PATH: `${bin}:${process.env.PATH}`,
      REAL_GH: execFileSync('sh', ['-c', 'command -v gh'], {
        encoding: 'utf8',
      }).trim(),
    })
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /READY:/, result.stdout)
    const branch = 'chore/qa-architect-5-16-3'
    assert.notStrictEqual(
      git(remote, 'rev-parse', 'refs/heads/main'),
      git(remote, 'rev-parse', `refs/heads/${branch}`)
    )
    assert.ok(
      git(
        remote,
        'show',
        `refs/heads/${branch}:.buildproven/test-impact.json`
      ).includes('"version": 1')
    )
    assert.doesNotMatch(
      git(remote, 'show', `refs/heads/${branch}:.github/workflows/quality.yml`),
      /create-qa-architect@latest|semgrep\/semgrep-action/
    )
    assert.match(fs.readFileSync(ghLog, 'utf8'), /pr create/)
    console.log('  ✓ rollout PR contains only workflow and test-impact policy')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function testCommitFailureIsNotMasked() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fleet-failure-'))
  try {
    createConsumer(root, 'canary')
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, 'git'),
      `#!/bin/sh\ncase "$*" in *" commit --quiet "*) exit 41 ;; esac\nexec "$REAL_GIT" "$@"\n`
    )
    fs.chmodSync(path.join(bin, 'git'), 0o755)
    const result = run(root, ['--canary', 'canary', '--canary-only', '--pr'], {
      PATH: `${bin}:${process.env.PATH}`,
      REAL_GIT: execFileSync('sh', ['-c', 'command -v git'], {
        encoding: 'utf8',
      }).trim(),
    })
    assert.notStrictEqual(result.status, 0)
    assert.match(result.stdout, /PR FAILURE/)
    console.log('  ✓ commit and push failures cannot become false success')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

console.log('🧪 Testing isolated fleet rollout contract...\n')
testExplicitCanaryContract()
testLinkedWorktreeIsNotDiscovered()
testValidationUsesRemoteAndLeavesCheckoutUntouched()
testPullRequestContainsOnlyRolloutFiles()
testCommitFailureIsNotMasked()
console.log('\n✅ isolated fleet rollout contract holds')
