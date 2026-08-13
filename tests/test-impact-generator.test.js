'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  buildPolicy,
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
  return `${JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    packageManager: 'npm@11.5.2',
    ...extra,
  })}\n`
}

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
  assert.deepStrictEqual(plan.blockers, [])
  assert.strictEqual(plan.policy.jsRunner, 'vitest')
  assert.deepStrictEqual(plan.policy.mappings, [])
  assert.deepStrictEqual(plan.inventory.installCommands, [
    'npm ci --ignore-scripts',
  ])
  assert.strictEqual(plan.inventory.workflows[0].jobs[0].name, 'Existing tests')
  assert.deepStrictEqual(writeGeneratedFiles(vitest, plan), [
    '.buildproven/test-impact.json',
  ])
  assert(!fs.existsSync(path.join(vitest, '.github/workflows/test-impact.yml')))
} finally {
  fs.rmSync(vitest, { recursive: true, force: true })
}

const nodeProject = fixture({
  'package.json': packageJson({ scripts: { test: 'node --test' } }),
  'package-lock.json': '{}\n',
  'lib/example.js': 'module.exports = true\n',
  'test/example.test.js': "require('assert').ok(true)\n",
  'mappings.json': `${JSON.stringify([
    {
      paths: ['lib/example.js'],
      commands: [{ executable: 'node', args: ['test/example.test.js'] }],
    },
  ])}\n`,
})
try {
  const blocked = buildPolicy(nodeProject)
  assert.match(blocked.blockers[0], /--mapping-file/)
  assert.strictEqual(blocked.inventory.mappingSuggestions.length, 1)
  const planned = buildPolicy(nodeProject, { mappingFile: 'mappings.json' })
  assert.deepStrictEqual(planned.blockers, [])
  writeGeneratedFiles(nodeProject, planned)
  const before = readPolicy(nodeProject).mappings
  const update = buildPolicy(nodeProject)
  writeGeneratedFiles(nodeProject, update, { update: true })
  assert.deepStrictEqual(readPolicy(nodeProject).mappings, before)
} finally {
  fs.rmSync(nodeProject, { recursive: true, force: true })
}

const python = fixture({
  'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
  'requirements.txt': 'pytest==8.4.1\n',
  'tests/test_example.py': 'def test_example():\n    assert True\n',
})
try {
  const plan = buildPolicy(python)
  assert.deepStrictEqual(plan.blockers, [])
  assert.deepStrictEqual(plan.policy.audits[0].commands, [
    { executable: 'pytest', args: [] },
  ])
} finally {
  fs.rmSync(python, { recursive: true, force: true })
}

const noLock = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
})
try {
  assert.match(buildPolicy(noLock).blockers.join(' '), /requires package-lock/)
} finally {
  fs.rmSync(noLock, { recursive: true, force: true })
}

const overwrite = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
  '.buildproven/test-impact.json': `${JSON.stringify({
    version: 1,
    jsRunner: 'vitest',
    mappings: [],
    audits: [],
  })}\n`,
})
try {
  const plan = buildPolicy(overwrite)
  assert.throws(
    () => writeGeneratedFiles(overwrite, plan),
    /Refusing to overwrite/
  )
  writeGeneratedFiles(overwrite, plan, { update: true })
} finally {
  fs.rmSync(overwrite, { recursive: true, force: true })
}

const symlink = fixture({
  'package.json': packageJson({
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^3.0.0' },
  }),
  'package-lock.json': '{}\n',
})
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-impact-outside-'))
try {
  fs.symlinkSync(outside, path.join(symlink, '.buildproven'))
  assert.throws(
    () => writeGeneratedFiles(symlink, buildPolicy(symlink)),
    /must not be a symbolic link/
  )
  assert(!fs.existsSync(path.join(outside, 'test-impact.json')))
} finally {
  fs.rmSync(symlink, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
}

function readPolicy(root) {
  return JSON.parse(
    fs.readFileSync(path.join(root, '.buildproven/test-impact.json'), 'utf8')
  )
}

console.log('Test-impact generator tests passed.')
