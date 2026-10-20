'use strict'

// BUI-1433: Dependabot's pip update (#286) rebuilt the Semgrep release lock
// without .github/semgrep-release-overrides.txt, restored a vulnerable MCP pin,
// and auto-merged because quality.yml skips its tests for Dependabot PRs.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { stripSection } = require('../lib/workflow-config')

const repoRoot = path.resolve(__dirname, '..')
const RELEASE_LOCK_TEST = 'node tests/release-workflow.test.js'

function readWorkflow(name) {
  const text = fs.readFileSync(
    path.join(repoRoot, '.github/workflows', name),
    'utf8'
  )
  return { text, doc: yaml.load(text) }
}

function asList(value) {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

// Return the ids of jobs with a step that runs the release-workflow test
// and that a failure of the test fails.
function jobsRunningReleaseLockTest(doc) {
  return Object.entries(doc.jobs)
    .filter(([, job]) =>
      (job.steps || []).some(
        step =>
          typeof step.run === 'string' &&
          step.run
            .split('\n')
            .some(line => line.trim() === RELEASE_LOCK_TEST) &&
          step['continue-on-error'] !== true &&
          step.if === undefined
      )
    )
    .map(([id]) => id)
}

function runsForDependabot(job) {
  const condition = String(job.if || '')
  return (
    /github\.actor == 'dependabot\[bot\]'/.test(condition) &&
    !/github\.actor != 'dependabot\[bot\]'/.test(condition)
  )
}

console.log('\nBUI-1433 — Dependabot PRs run the Semgrep release lock test')

// BUI-1433-R1: quality.yml runs the release-workflow test on Dependabot PRs
// and fails the required `summary` check when it fails.
{
  const { text, doc } = readWorkflow('quality.yml')
  const triggers = Object.keys(doc.on)
  assert.ok(
    triggers.includes('pull_request'),
    'BUI-1433-R1: quality.yml must run on pull_request'
  )

  const lockJobs = jobsRunningReleaseLockTest(doc).filter(id =>
    runsForDependabot(doc.jobs[id])
  )
  assert.strictEqual(
    lockJobs.length,
    1,
    `BUI-1433-R1: quality.yml must have one Dependabot job that runs \`${RELEASE_LOCK_TEST}\` unconditionally`
  )
  const [lockJobId] = lockJobs
  const lockJob = doc.jobs[lockJobId]

  assert.ok(
    !asList(lockJob.needs).includes('detect-maturity'),
    'BUI-1433-R1: the lock job must not need detect-maturity, which Dependabot PRs skip'
  )
  assert.ok(
    !/github\.event_name != 'pull_request'/.test(String(lockJob.if)),
    'BUI-1433-R1: the lock job must run for pull_request events'
  )

  const summary = doc.jobs.summary
  assert.ok(
    asList(summary.needs).includes(lockJobId),
    `BUI-1433-R1: summary must need ${lockJobId} so a failed lock test fails the required check`
  )
  const enforce = summary.steps.find(
    step => step.name === 'Enforce check results'
  )
  const resultVar = Object.entries(enforce.env).find(
    ([, value]) => value === `\${{ needs.${lockJobId}.result }}`
  )
  assert.ok(
    resultVar,
    `BUI-1433-R1: Enforce check results must read needs.${lockJobId}.result`
  )
  assert.ok(
    enforce.run
      .split('\n')
      .some(
        line => line.trim() === `checks+=("${lockJobId}:$${resultVar[0]}")`
      ),
    `BUI-1433-R1: Enforce check results must fail on a failed ${lockJobId} job`
  )

  // The release lock belongs to qa-architect. Consumer workflows must not get it.
  const consumer = yaml.load(stripSection(text, 'QA_ARCHITECT_ONLY'))
  assert.ok(
    !consumer.jobs[lockJobId] &&
      jobsRunningReleaseLockTest(consumer).length === 0 &&
      !asList(consumer.jobs.summary.needs).includes(lockJobId),
    'BUI-1433-R1: the lock job must sit in a QA_ARCHITECT_ONLY section'
  )
  console.log(
    '  ✓ BUI-1433-R1 quality.yml gates Dependabot PRs on the lock test'
  )
}

// BUI-1433-R2: the auto-merge workflow does not merge a Dependabot pip update
// unless the release-workflow test passed.
{
  const { doc } = readWorkflow('dependabot-auto-merge.yml')
  const mergeJobs = Object.entries(doc.jobs).filter(([, job]) =>
    (job.steps || []).some(
      step => typeof step.run === 'string' && /gh pr merge/.test(step.run)
    )
  )
  assert.strictEqual(
    mergeJobs.length,
    1,
    'BUI-1433-R2: the auto-merge workflow must have one merge job'
  )
  const [[mergeJobId, mergeJob]] = mergeJobs

  assert.ok(
    jobsRunningReleaseLockTest({ jobs: { [mergeJobId]: mergeJob } }).length ===
      0,
    'BUI-1433-R2: the merge job must not run PR code with a write token'
  )

  const lockJobs = jobsRunningReleaseLockTest(doc)
  assert.strictEqual(
    lockJobs.length,
    1,
    `BUI-1433-R2: the auto-merge workflow must run \`${RELEASE_LOCK_TEST}\` in its own job`
  )
  const [lockJobId] = lockJobs
  const lockJob = doc.jobs[lockJobId]

  assert.ok(
    runsForDependabot(lockJob),
    'BUI-1433-R2: the lock test job must run for Dependabot PRs'
  )
  assert.ok(
    !/package-ecosystem/.test(String(lockJob.if)),
    'BUI-1433-R2: the lock test job must not skip any ecosystem, pip included'
  )
  assert.deepStrictEqual(
    lockJob.permissions,
    { contents: 'read' },
    'BUI-1433-R2: the lock test job must run with a read-only token'
  )

  assert.ok(
    asList(mergeJob.needs).includes(lockJobId),
    `BUI-1433-R2: the merge job must need ${lockJobId}`
  )
  assert.ok(
    !/\b(always|failure|cancelled)\(\)/.test(String(mergeJob.if || '')),
    'BUI-1433-R2: the merge job must not run when the lock test fails or is skipped'
  )
  for (const step of mergeJob.steps) {
    assert.ok(
      !/\b(always|failure|cancelled)\(\)/.test(String(step.if || '')),
      `BUI-1433-R2: merge step "${step.name}" must not run after a failed need`
    )
  }
  console.log('  ✓ BUI-1433-R2 auto-merge waits for the lock test to pass')
}

console.log('\n✅ Dependabot CI tests passed\n')
