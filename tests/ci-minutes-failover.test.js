'use strict'

/**
 * CI minutes and runner failover in the generated quality.yml, every tier:
 * - every job takes its runner from the repo variable CI_RUNS_ON, and a fork PR
 *   always gets ubuntu-latest (untrusted code never reaches a self-hosted runner);
 * - the required `summary` check gates in consumer workflows (it used to ship only
 *   in qa-architect's own workflow): it fails when a needed job failed or was cancelled;
 * - minimal has no push trigger; standard and comprehensive keep it;
 * - gitleaks has pinned binaries for Linux x64 and arm64;
 * - the dependency install budget is longer on self-hosted runners.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const yaml = require('js-yaml')
const { injectWorkflowMode } = require('../lib/workflow-config')

const template = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/quality.yml'),
  'utf8'
)
const RUNNER =
  "${{ fromJSON((github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && vars.CI_RUNS_ON || '\"ubuntu-latest\"') }}"

/** Run the summary job's scripts with the given job results; return the exit code. */
function runSummary(job, results) {
  const env = { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: '/dev/null' }
  for (const [name, result] of Object.entries(results)) env[name] = result
  for (const step of job.steps) {
    if (!step.run) continue
    const script = step.run.replace(/\$\{\{[^}]*\}\}/g, 'x')
    try {
      execFileSync('bash', ['-e', '-c', script], { env, stdio: 'ignore' })
    } catch (error) {
      return error.status ?? 1
    }
  }
  return 0
}

const RESULT_VARS = [
  'DETECT_RESULT',
  'SECURITY_RESULT',
  'AUDIT_RESULT',
  'TESTS_RESULT',
  'DOCS_RESULT',
]
const all = result => Object.fromEntries(RESULT_VARS.map(v => [v, result]))

for (const mode of ['minimal', 'standard', 'comprehensive']) {
  console.log(`🧪 CI minutes and failover: ${mode}`)
  const out = injectWorkflowMode(template, mode, {})
  const workflow = yaml.load(out)

  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.strictEqual(
      job['runs-on'],
      RUNNER,
      `${mode}: job ${name} must take its runner from CI_RUNS_ON with the fork guard`
    )
    assert(job['timeout-minutes'], `${mode}: job ${name} needs timeout-minutes`)
  }

  assert.strictEqual(
    'push' in workflow.on,
    mode !== 'minimal',
    `${mode}: push trigger ${mode === 'minimal' ? 'must be gone' : 'must stay'}`
  )
  assert(
    !workflow.on.pull_request['paths-ignore'],
    `${mode}: PRs must not be path-filtered, or the required summary check never reports`
  )

  const summary = workflow.jobs.summary
  assert(
    summary.steps.some(s => s.name === 'Enforce check results'),
    `${mode}: consumer summary must gate`
  )
  assert(
    !JSON.stringify(summary).includes('coverage'),
    `${mode}: consumer summary must not reference the qa-architect-only coverage job`
  )
  assert.strictEqual(
    runSummary(summary, all('success')),
    0,
    `${mode}: all success passes`
  )
  assert.strictEqual(
    runSummary(summary, {
      ...all('success'),
      DOCS_RESULT: 'skipped',
      SECURITY_RESULT: 'skipped',
    }),
    0,
    `${mode}: skipped passes`
  )
  // BUI-1755: Dependabot PRs auto-merge on `summary`, so nothing may skip
  // detect-maturity for them, and a skipped detect-maturity must not pass.
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === 'release-lock') continue
    assert(
      !String(job.if ?? '').includes("github.actor != 'dependabot[bot]'"),
      `${mode}: job ${name} must not skip Dependabot PRs`
    )
  }
  assert.notStrictEqual(
    runSummary(summary, { ...all('skipped') }),
    0,
    `${mode}: detect-maturity skipped (so nothing ran) must fail the required check`
  )
  assert.notStrictEqual(
    runSummary(summary, { ...all('success'), DETECT_RESULT: 'skipped' }),
    0,
    `${mode}: DETECT_RESULT=skipped must fail the required check`
  )
  for (const v of RESULT_VARS) {
    for (const bad of ['failure', 'cancelled']) {
      assert.notStrictEqual(
        runSummary(summary, { ...all('success'), [v]: bad }),
        0,
        `${mode}: ${v}=${bad} must fail the required check`
      )
    }
  }

  if (out.includes('GITLEAKS_VERSION')) {
    assert(
      out.includes('Linux-ARM64) GITLEAKS_ASSET=linux_arm64'),
      `${mode}: gitleaks arm64`
    )
    assert(
      out.includes('Linux-X64) GITLEAKS_ASSET=linux_x64'),
      `${mode}: gitleaks x64`
    )
  }
  const security = JSON.stringify(workflow.jobs.security)
  assert(
    !/pip3? install|npx semgrep|uv pip/.test(security),
    `${mode}: the blocking security job must not install packages at run time`
  )
  assert(
    security.includes('semgrep/semgrep@sha256:') && security.includes('exit 1'),
    `${mode}: Semgrep runs only from the pinned image and fails closed without Docker`
  )
  assert(
    out.includes(
      "timeout ${{ runner.environment == 'self-hosted' && 360 || 120 }}"
    ),
    `${mode}: longer install budget on self-hosted runners`
  )
  console.log('  ✅ PASS')
}
console.log('✅ CI minutes and failover tests passed')
