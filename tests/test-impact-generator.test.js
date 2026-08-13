'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const yaml = require('js-yaml')
const {
  buildPolicy,
  buildWorkflow,
  writeGeneratedFiles,
} = require('../lib/test-impact-generator')

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-impact-'))
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

function packageJson(extra = {}) {
  return `${JSON.stringify(
    {
      name: 'fixture',
      version: '1.0.0',
      packageManager: 'npm@11.5.2',
      ...extra,
    },
    null,
    2
  )}\n`
}

const runtimeSha = 'a'.repeat(40)

const vitest = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
  '.github/workflows/ci.yml': `name: CI
on: pull_request
jobs:
  test:
    name: Existing tests
    runs-on: ubuntu-latest
    steps: []
`,
})
try {
  const plan = buildPolicy(vitest)
  assert.strictEqual(plan.inventory.jsRunner, 'vitest')
  assert.strictEqual(plan.inventory.workflows[0].jobs[0].name, 'Existing tests')
  assert.deepStrictEqual(plan.blockers, [])
  assert.deepStrictEqual(plan.inventory.installCommands, [
    'npm ci --ignore-scripts',
  ])
  assert.deepStrictEqual(plan.policy.audits[0].commands, [
    { executable: 'npm', args: ['run', 'test'] },
  ])
  const workflow = buildWorkflow(plan, runtimeSha)
  const parsedWorkflow = yaml.load(workflow)
  assert(parsedWorkflow.jobs['quality-required'])
  assert(workflow.includes(`ref: ${runtimeSha}`))
  assert(workflow.includes('name: quality / required'))
  assert(workflow.includes('pull_request_target:'))
  assert(
    workflow.includes(
      'repository: ${{ github.event.pull_request.head.repo.full_name || github.repository }}'
    )
  )
  assert(
    workflow.includes(
      'ref: ${{ github.event.pull_request.head.sha || github.sha }}'
    )
  )
  assert(workflow.includes('path: candidate'))
  assert(workflow.includes('- name: Check out protected policy'))
  assert(workflow.includes('path: protected'))
  assert(workflow.includes('--policy-root ../protected'))
  assert(workflow.includes('name: Create trusted test plan'))
  assert(workflow.includes('name: Run selected tests'))
  assert(workflow.includes('needs: [plan, run-selected, audit]'))
  assert(workflow.includes('npm ci --ignore-scripts'))
  assert(workflow.includes('Verify protected package scripts'))
  assert(workflow.includes('TRUSTED_PLAN: ${{ needs.plan.outputs.plan }}'))
  assert(workflow.includes('persist-credentials: false'))
  assert(!workflow.includes('@latest'))
  const trustedJob = workflow.slice(
    workflow.indexOf('  plan:'),
    workflow.indexOf('  run-selected:')
  )
  const candidateJob = workflow.slice(
    workflow.indexOf('  run-selected:'),
    workflow.indexOf('  audit:')
  )
  assert(!trustedJob.includes('Install declared dependencies'))
  assert(!candidateJob.includes('path: runtime'))
  assert(!candidateJob.includes('path: protected'))
  assert(candidateJob.includes('--ignore-scripts'))
  const files = writeGeneratedFiles(vitest, plan, workflow)
  assert.deepStrictEqual(files, [
    '.buildproven/test-impact.json',
    '.github/workflows/test-impact.yml',
  ])
  assert(fs.existsSync(path.join(vitest, files[0])))
  assert(fs.existsSync(path.join(vitest, files[1])))
} finally {
  fs.rmSync(vitest, { recursive: true, force: true })
}

const nodeTest = fixture({
  'package.json': packageJson({ scripts: { test: 'node --test' } }),
  'package-lock.json': '{}\n',
  'lib/example.js': 'module.exports = true\n',
  'test/example.test.js': "require('assert').ok(true)\n",
})
try {
  const plan = buildPolicy(nodeTest)
  assert.strictEqual(plan.policy.jsRunner, 'node')
  assert.match(plan.blockers[0], /repository-owned dependency or coverage/)
  assert.deepStrictEqual(plan.policy.mappings, [])
  assert.deepStrictEqual(plan.inventory.mappingSuggestions, [
    {
      paths: ['lib/example.js'],
      commands: [{ executable: 'node', args: ['test/example.test.js'] }],
    },
  ])
} finally {
  fs.rmSync(nodeTest, { recursive: true, force: true })
}

const nodeWithUnusedVitest = fixture({
  'package.json': packageJson({
    scripts: { test: 'node tests/example.test.js' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
  'tests/example.test.js': "require('assert').ok(true)\n",
})
try {
  const plan = buildPolicy(nodeWithUnusedVitest)
  assert.strictEqual(plan.policy.jsRunner, 'node')
  assert.deepStrictEqual(plan.blockers, [])
} finally {
  fs.rmSync(nodeWithUnusedVitest, { recursive: true, force: true })
}

const mixedRunners = fixture({
  'package.json': packageJson({
    scripts: { test: 'jest --runInBand' },
    devDependencies: { jest: '^30.0.0', vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
})
try {
  const plan = buildPolicy(mixedRunners)
  assert.strictEqual(plan.policy.jsRunner, 'jest')
  assert.deepStrictEqual(plan.blockers, [])
} finally {
  fs.rmSync(mixedRunners, { recursive: true, force: true })
}

const python = fixture({
  'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
  'requirements.txt': 'pytest==8.4.1\n',
  'tests/test_example.py': 'def test_example():\n    assert True\n',
})
try {
  const plan = buildPolicy(python)
  assert.deepStrictEqual(plan.blockers, [])
  assert.deepStrictEqual(plan.inventory.installCommands, [
    'python -m pip install -r requirements.txt',
  ])
  assert.deepStrictEqual(plan.policy.audits[0].commands, [
    { executable: 'pytest', args: [] },
  ])
} finally {
  fs.rmSync(python, { recursive: true, force: true })
}

assert.throws(
  () =>
    buildWorkflow(
      {
        policy: {
          audits: [{ commands: [{ executable: 'npm', args: ['test'] }] }],
        },
      },
      'main'
    ),
  /immutable 40-character commit SHA/
)

const collision = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
  '.github/workflows/existing.yml': `name: Existing
on: pull_request
jobs:
  gate:
    name: quality / required
    runs-on: ubuntu-latest
    steps: []
`,
})
try {
  assert.match(buildPolicy(collision).blockers[0], /already exists/)
} finally {
  fs.rmSync(collision, { recursive: true, force: true })
}

const overwrite = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
  '.buildproven/test-impact.json': '{"owned":true}\n',
})
try {
  const plan = buildPolicy(overwrite)
  const workflow = buildWorkflow(plan, runtimeSha)
  assert.throws(
    () => writeGeneratedFiles(overwrite, plan, workflow),
    /Refusing to overwrite/
  )
  assert.strictEqual(
    fs.readFileSync(
      path.join(overwrite, '.buildproven/test-impact.json'),
      'utf8'
    ),
    '{"owned":true}\n'
  )
} finally {
  fs.rmSync(overwrite, { recursive: true, force: true })
}

const update = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
})
try {
  const plan = buildPolicy(update)
  const first = buildWorkflow(plan, runtimeSha)
  writeGeneratedFiles(update, plan, first)
  const rotated = buildWorkflow(plan, 'b'.repeat(40))
  assert.deepStrictEqual(
    writeGeneratedFiles(update, plan, rotated, { update: true }),
    ['.buildproven/test-impact.json', '.github/workflows/test-impact.yml']
  )
  assert(
    fs
      .readFileSync(
        path.join(update, '.github/workflows/test-impact.yml'),
        'utf8'
      )
      .includes(`ref: ${'b'.repeat(40)}`)
  )
} finally {
  fs.rmSync(update, { recursive: true, force: true })
}

console.log('Test-impact generator tests passed.')
