'use strict'

// BUI-1433: Dependabot's pip update (#286) rebuilt the Semgrep release lock
// without .github/semgrep-release-overrides.txt, restored a vulnerable MCP pin,
// and auto-merged because quality.yml skips its tests for Dependabot PRs.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const RELEASE_LOCK_TEST = 'node tests/release-workflow.test.js'

function readWorkflow(name) {
  return fs.readFileSync(path.join(repoRoot, '.github/workflows', name), 'utf8')
}

function jobBlock(workflow, jobId) {
  const marker = `  ${jobId}:\n`
  const start = workflow.indexOf(marker)
  assert.ok(start >= 0, `workflow must define the ${jobId} job`)

  const remaining = workflow.slice(start + marker.length)
  const nextJob = /^ {2}[a-zA-Z0-9_-]+:$/m.exec(remaining)
  const end = nextJob ? start + marker.length + nextJob.index : workflow.length
  return workflow.slice(start, end)
}

function stripQaArchitectOnlySections(workflow) {
  const beginMarker = '# {{QA_ARCHITECT_ONLY_BEGIN}}'
  const endMarker = '# {{QA_ARCHITECT_ONLY_END}}'
  let stripped = workflow
  let begin = stripped.indexOf(beginMarker)

  while (begin >= 0) {
    const lineStart = stripped.lastIndexOf('\n', begin) + 1
    const endMarkerStart = stripped.indexOf(endMarker, begin)
    assert.ok(endMarkerStart >= 0, 'QA_ARCHITECT_ONLY section must close')
    const nextLine = stripped.indexOf('\n', endMarkerStart + endMarker.length)
    const sectionEnd = nextLine >= 0 ? nextLine + 1 : stripped.length
    stripped = stripped.slice(0, lineStart) + stripped.slice(sectionEnd)
    begin = stripped.indexOf(beginMarker)
  }

  return stripped
}

console.log('\nBUI-1433 — Dependabot PRs run the Semgrep release lock test')

// BUI-1433-R1: quality.yml runs the release-workflow test on Dependabot PRs
// and fails the required `summary` check when it fails.
{
  const workflow = readWorkflow('quality.yml')
  assert.match(
    workflow,
    /^ {2}pull_request:$/m,
    'BUI-1433-R1: quality.yml must run on pull_request events'
  )
  const lockJob = jobBlock(workflow, 'release-lock')

  assert.match(
    lockJob,
    /^ {4}if: github\.event_name == 'pull_request' && github\.actor == 'dependabot\[bot\]'$/m,
    'BUI-1433-R1: the lock job must run for Dependabot pull requests'
  )
  assert.doesNotMatch(
    lockJob,
    /^ {4}needs:.*detect-maturity/m,
    'BUI-1433-R1: the lock job must not need detect-maturity, which Dependabot PRs skip'
  )
  assert.ok(
    lockJob.includes(`        run: ${RELEASE_LOCK_TEST}\n`),
    `BUI-1433-R1: the lock job must run \`${RELEASE_LOCK_TEST}\``
  )
  assert.doesNotMatch(
    lockJob,
    /continue-on-error: true/,
    'BUI-1433-R1: a failed lock test must fail its job'
  )

  const summary = jobBlock(workflow, 'summary')
  assert.match(
    summary,
    /^ {6}- release-lock$/m,
    'BUI-1433-R1: summary must need release-lock so its failure fails the required check'
  )
  assert.match(
    summary,
    /^ {10}RELEASE_LOCK_RESULT: \$\{\{ needs\.release-lock\.result \}\}$/m,
    'BUI-1433-R1: summary must read the release-lock result'
  )
  assert.match(
    summary,
    /^ {10}checks\+=\("release-lock:\$RELEASE_LOCK_RESULT"\)$/m,
    'BUI-1433-R1: summary must enforce the release-lock result'
  )
  const consumerWorkflow = stripQaArchitectOnlySections(workflow)
  assert.doesNotMatch(
    consumerWorkflow,
    /release-lock|node tests\/release-workflow\.test\.js/,
    'BUI-1433-R1: the lock job must sit in a QA_ARCHITECT_ONLY section'
  )
  console.log(
    '  ✓ BUI-1433-R1 quality.yml gates Dependabot PRs on the lock test'
  )
}

// BUI-1433-R2: the auto-merge workflow does not merge a Dependabot pip update
// unless the release-workflow test passed.
{
  const workflow = readWorkflow('dependabot-auto-merge.yml')
  assert.match(
    workflow,
    /^on: pull_request$/m,
    'BUI-1433-R2: auto-merge must evaluate Dependabot pull requests'
  )
  const lockJob = jobBlock(workflow, 'release-lock')
  const mergeJob = jobBlock(workflow, 'dependabot')

  assert.match(
    lockJob,
    /^ {4}if: github\.actor == 'dependabot\[bot\]'$/m,
    'BUI-1433-R2: the lock test job must run for Dependabot PRs'
  )
  assert.match(
    lockJob,
    /^ {4}permissions:\n {6}contents: read$/m,
    'BUI-1433-R2: the lock test job must use a read-only token'
  )
  assert.ok(
    lockJob.includes(`        run: ${RELEASE_LOCK_TEST}\n`),
    `BUI-1433-R2: auto-merge must run \`${RELEASE_LOCK_TEST}\` before enabling a merge`
  )
  assert.doesNotMatch(
    lockJob,
    /continue-on-error: true/,
    'BUI-1433-R2: a failed lock test must fail its job'
  )
  assert.doesNotMatch(
    lockJob,
    /package-ecosystem/,
    'BUI-1433-R2: the lock test must not exclude the pip ecosystem'
  )
  assert.doesNotMatch(
    lockJob,
    /contents: write|pull-requests: write|gh pr merge/,
    'BUI-1433-R2: PR code must not execute in a write-token job'
  )

  assert.match(
    mergeJob,
    /^ {4}needs: release-lock$/m,
    'BUI-1433-R2: the merge job must wait for release-lock to pass'
  )
  assert.doesNotMatch(
    mergeJob,
    /\b(?:always|failure|cancelled)\(\)/,
    'BUI-1433-R2: the merge job must not run when the lock test fails or is skipped'
  )
  assert.match(
    mergeJob,
    /gh pr merge --auto --squash/,
    'BUI-1433-R2: the gated job must be the job that enables auto-merge'
  )
  console.log('  ✓ BUI-1433-R2 auto-merge waits for the lock test to pass')
}

console.log('\n✅ Dependabot CI tests passed\n')
