'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const assert = require('assert')
const { execSync, spawnSync } = require('child_process')

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

function checkoutSnapshot(cwd) {
  const files = execSync(
    "find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256",
    { cwd, encoding: 'utf8', shell: '/bin/bash' }
  )
  return {
    head: git(cwd, 'rev-parse HEAD'),
    index: git(cwd, 'write-tree'),
    status: git(cwd, 'status --porcelain --untracked-files=all'),
    files,
  }
}

function testDryRunDoesNotMutateConsumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-validation-test-'))
  try {
    const projects = path.join(root, 'Projects')
    const consumer = path.join(projects, 'buildproven')
    fs.mkdirSync(path.join(consumer, '.github', 'workflows'), {
      recursive: true,
    })
    git(consumer, 'init -b main -q')
    git(consumer, 'config user.email test@example.com')
    git(consumer, 'config user.name Test')
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      '{"name":"validation-consumer","version":"1.0.0","private":true}\n'
    )
    fs.writeFileSync(
      path.join(consumer, '.github', 'workflows', 'quality.yml'),
      'name: Quality\n# WORKFLOW_MODE: minimal\n'
    )
    git(consumer, 'add .')
    git(consumer, 'commit -q -m "initial"')

    const before = checkoutSnapshot(consumer)
    const result = spawnSync(
      'bash',
      [DEPLOY_SCRIPT, '--canary-only', '--verbose'],
      {
        env: { ...process.env, HOME: root },
        encoding: 'utf8',
      }
    )
    assert.strictEqual(
      result.status,
      0,
      `dry-run validation failed:\n${result.stdout}\n${result.stderr}`
    )
    const output = result.stdout
    const after = checkoutSnapshot(consumer)

    assert.deepStrictEqual(
      after,
      before,
      'default validation must leave HEAD, index, status, tracked files, and untracked files unchanged'
    )
    assert.ok(output.includes('PASS: Validated'))
    assert.ok(output.includes('Proposed changes:'))
    console.log(
      '  ✓ dry run validates an isolated copy and leaves the consumer unchanged'
    )

    fs.writeFileSync(path.join(consumer, 'user-untracked.txt'), 'keep me\n')
    const dirtyBefore = checkoutSnapshot(consumer)
    const dirtyResult = spawnSync('bash', [DEPLOY_SCRIPT, '--canary-only'], {
      env: { ...process.env, HOME: root },
      encoding: 'utf8',
    })
    assert.notStrictEqual(dirtyResult.status, 0)
    assert.ok(dirtyResult.stdout.includes('REFUSE VALIDATION'))
    assert.deepStrictEqual(checkoutSnapshot(consumer), dirtyBefore)
    console.log('  ✓ dry run refuses dirty state without changing it')

    fs.unlinkSync(path.join(consumer, 'user-untracked.txt'))
    const shimDir = path.join(root, 'bin')
    const validationTemp = path.join(root, 'validation-tmp')
    fs.mkdirSync(shimDir)
    fs.mkdirSync(validationTemp)
    const gitShim = path.join(shimDir, 'git')
    fs.writeFileSync(
      gitShim,
      '#!/bin/sh\ncase "$*" in *" status --porcelain --untracked-files=all"*) exit 1 ;; esac\nexec "$REAL_GIT" "$@"\n'
    )
    fs.chmodSync(gitShim, 0o755)
    const statusFailureBefore = checkoutSnapshot(consumer)
    const statusFailure = spawnSync('bash', [DEPLOY_SCRIPT, '--canary-only'], {
      env: {
        ...process.env,
        HOME: root,
        TMPDIR: validationTemp,
        REAL_GIT: execSync('command -v git', { encoding: 'utf8' }).trim(),
        PATH: `${shimDir}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    })
    assert.notStrictEqual(statusFailure.status, 0)
    assert.ok(
      statusFailure.stdout.includes(
        'Could not inspect the consumer working tree'
      )
    )
    assert.deepStrictEqual(checkoutSnapshot(consumer), statusFailureBefore)
    assert.deepStrictEqual(fs.readdirSync(validationTemp), [])
    console.log('  ✓ status inspection failure stops before validation')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function testCheckoutFailureCleansValidationCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-checkout-test-'))
  try {
    const projects = path.join(root, 'Projects')
    const consumer = path.join(projects, 'buildproven')
    const tempDir = path.join(root, 'tmp')
    const shimDir = path.join(root, 'bin')
    fs.mkdirSync(path.join(consumer, '.github', 'workflows'), {
      recursive: true,
    })
    fs.mkdirSync(tempDir)
    fs.mkdirSync(shimDir)
    git(consumer, 'init -b main -q')
    git(consumer, 'config user.email test@example.com')
    git(consumer, 'config user.name Test')
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      '{"name":"checkout-failure-consumer","version":"1.0.0","private":true}\n'
    )
    fs.writeFileSync(
      path.join(consumer, '.github', 'workflows', 'quality.yml'),
      'name: Quality\n# WORKFLOW_MODE: minimal\n'
    )
    git(consumer, 'add .')
    git(consumer, 'commit -q -m "initial"')
    const gitShim = path.join(shimDir, 'git')
    fs.writeFileSync(
      gitShim,
      '#!/bin/sh\ncase "$*" in *" checkout --quiet --detach "*) exit 1 ;; esac\nexec "$REAL_GIT" "$@"\n'
    )
    fs.chmodSync(gitShim, 0o755)

    const result = spawnSync('bash', [DEPLOY_SCRIPT, '--canary-only'], {
      env: {
        ...process.env,
        HOME: root,
        TMPDIR: tempDir,
        REAL_GIT: execSync('command -v git', { encoding: 'utf8' }).trim(),
        PATH: `${shimDir}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    })
    assert.notStrictEqual(result.status, 0)
    assert.ok(
      result.stdout.includes('Could not check out the exact consumer HEAD'),
      result.stdout
    )
    assert.deepStrictEqual(fs.readdirSync(tempDir), [])
    console.log('  ✓ failed checkout leaves no isolated validation copy')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
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
  assert.ok(
    script.includes('NODE_ENV=test QAA_DEVELOPER=true node'),
    'internal fleet generation must use the complete developer-mode contract'
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
    testDryRunDoesNotMutateConsumer()
    testCheckoutFailureCleansValidationCopy()
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
