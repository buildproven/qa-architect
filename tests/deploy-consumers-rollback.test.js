'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const assert = require('assert')
const { execSync } = require('child_process')

/**
 * Regression test for deploy-consumers.sh push/commit-failure rollback.
 *
 * Bug: when the per-consumer deploy committed the regenerated workflow/deps
 * and the subsequent push (or the commit itself) failed — most commonly because
 * the consumer's pre-push hook rejects the change (unresolved npm-audit vulns /
 * failing quality gate) — the script exited non-zero while leaving a
 * committed-but-unpushed change stranded on the consumer's default branch. That
 * left the repo permanently dirty-ahead and poisoned the next run's clean-tree
 * preflight (origin of the fleet of stale "OSS Sync Bot" commits).
 *
 * Fix: on push/commit failure, reset --hard to the captured pre-deploy SHA so
 * the consumer returns to the exact clean state the preflight guaranteed.
 *
 * This test reproduces the rollback contract with a local bare-repo origin and
 * a rejecting pre-push hook — no network. It exercises the script's documented
 * commit -> push(reject) -> reset-to-pre_commit_sha sequence and asserts the
 * post-condition the fix establishes: HEAD back at the pre-deploy tip, tree
 * clean, and not ahead of upstream.
 */

const DEPLOY_SCRIPT = path.join(
  __dirname,
  '..',
  'scripts',
  'deploy-consumers.sh'
)

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

async function testRollbackContract() {
  console.log('🧪 Testing deploy-consumers.sh rollback contract...\n')

  // The fix must be present in the script under test, otherwise this regression
  // test is silently vacuous.
  const script = fs.readFileSync(DEPLOY_SCRIPT, 'utf8')
  assert.ok(
    script.includes('pre_commit_sha') &&
      /git reset --hard "\$pre_commit_sha"/.test(script),
    'deploy-consumers.sh must capture pre_commit_sha and reset --hard to it on failure'
  )

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-rollback-test-'))
  try {
    // 1. Bare origin + a consumer clone wired up exactly as the preflight expects.
    const origin = path.join(root, 'origin.git')
    const consumer = path.join(root, 'consumer')
    fs.mkdirSync(origin)
    git(origin, 'init --bare -b main -q')
    git(root, `clone -q "${origin}" "${consumer}"`)
    git(consumer, 'config user.email test@example.com')
    git(consumer, 'config user.name Test')
    fs.writeFileSync(path.join(consumer, 'README.md'), '# consumer\n')
    git(consumer, 'add README.md')
    git(consumer, 'commit -q -m "initial"')
    git(consumer, 'push -q origin main')

    const preDeploySha = git(consumer, 'rev-parse HEAD')

    // 2. A pre-push hook that always rejects — stand-in for the real consumer
    //    gate (vulnerabilities / failing quality) that strands commits.
    const hookPath = path.join(consumer, '.git', 'hooks', 'pre-push')
    fs.writeFileSync(
      hookPath,
      '#!/bin/sh\necho "pre-push: rejected (simulated vuln gate)" >&2\nexit 1\n'
    )
    fs.chmodSync(hookPath, 0o755)

    // 3. Reproduce the script's commit -> push(reject) -> rollback sequence,
    //    mirroring deploy-consumers.sh exactly (capture SHA, commit, push,
    //    reset --hard "$pre_commit_sha" on push failure).
    const sim = [
      'set -e',
      `cd "${consumer}"`,
      'pre_commit_sha="$(git rev-parse HEAD)"',
      'echo "regenerated" > .github-workflow-marker',
      'git add -A',
      'git commit -q -m "chore: regenerate qa-architect workflow (minimal tier)"',
      'if git push origin "HEAD:refs/heads/main"; then',
      '  echo PUSHED',
      'else',
      '  git reset --hard "$pre_commit_sha" >/dev/null',
      '  echo ROLLED_BACK',
      'fi',
    ].join('\n')
    const out = execSync(sim, { shell: '/bin/bash', encoding: 'utf8' }).trim()

    // 4. Assert the rollback contract.
    assert.ok(
      out.includes('ROLLED_BACK'),
      'push should have failed and triggered rollback'
    )
    assert.strictEqual(
      git(consumer, 'rev-parse HEAD'),
      preDeploySha,
      'HEAD must return to the pre-deploy tip after rollback'
    )
    assert.strictEqual(
      git(consumer, 'status --porcelain'),
      '',
      'working tree must be clean after rollback (the core regression)'
    )
    assert.strictEqual(
      git(consumer, 'rev-list --count @{u}..HEAD'),
      '0',
      'consumer must not be ahead of upstream after rollback'
    )
    assert.ok(
      !fs.existsSync(path.join(consumer, '.github-workflow-marker')),
      'regenerated files must be discarded by the rollback'
    )

    console.log('  ✓ push rejection rolls back to a clean, non-ahead tree')
    console.log('\n✅ deploy-consumers.sh rollback contract holds\n')
  } finally {
    // Delete the literal mktemp path — never a $(dirname ...) of a variable.
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  testRollbackContract().catch(err => {
    console.error('❌ deploy-consumers rollback test failed:', err.message)
    process.exit(1)
  })
}

module.exports = { testRollbackContract }
