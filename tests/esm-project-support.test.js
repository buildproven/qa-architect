'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  detectModuleType,
  isESMProject,
  detectDepMajor,
} = require('../lib/project-module-type')
const { writeCommitlintConfig } = require('../lib/quality-tools-generator')
const { getDefaultDevDependencies } = require('../config/defaults')

const makeProject = pkgJson => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-esm-'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(pkgJson, null, 2)
  )
  return dir
}

console.log('🧪 Testing ESM project support (issue #101)...\n')

// --- detectModuleType ---

console.log('Test 1: detectModuleType returns "esm" for type:module project')
{
  const dir = makeProject({ name: 'x', type: 'module' })
  assert.strictEqual(detectModuleType(dir), 'esm')
  assert.strictEqual(isESMProject(dir), true)
  console.log('  ✅')
}

console.log('Test 2: detectModuleType returns "cjs" for CJS project')
{
  const dir = makeProject({ name: 'x' })
  assert.strictEqual(detectModuleType(dir), 'cjs')
  assert.strictEqual(isESMProject(dir), false)
  console.log('  ✅')
}

console.log('Test 3: detectModuleType returns "cjs" when package.json missing')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-esm-empty-'))
  assert.strictEqual(detectModuleType(dir), 'cjs')
  console.log('  ✅')
}

console.log('Test 4: detectModuleType falls back to "cjs" on invalid JSON')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-esm-bad-'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json')
  assert.strictEqual(detectModuleType(dir), 'cjs')
  console.log('  ✅')
}

// --- commitlint filename ---

console.log(
  'Test 5: writeCommitlintConfig uses .cjs extension for ESM projects'
)
{
  const dir = makeProject({ name: 'x', type: 'module' })
  const configPath = writeCommitlintConfig(dir)
  assert(configPath.endsWith('commitlint.config.cjs'), `got ${configPath}`)
  assert(fs.existsSync(path.join(dir, 'commitlint.config.cjs')))
  assert(!fs.existsSync(path.join(dir, 'commitlint.config.js')))
  const content = fs.readFileSync(configPath, 'utf8')
  assert(content.includes('module.exports'))
  console.log('  ✅')
}

console.log('Test 6: writeCommitlintConfig uses .js extension for CJS projects')
{
  const dir = makeProject({ name: 'x' })
  const configPath = writeCommitlintConfig(dir)
  assert(configPath.endsWith('commitlint.config.js'), `got ${configPath}`)
  assert(fs.existsSync(path.join(dir, 'commitlint.config.js')))
  console.log('  ✅')
}

// --- detectDepMajor ---

console.log('Test 7: detectDepMajor reads major from devDependencies')
{
  const dir = makeProject({
    name: 'x',
    devDependencies: { vitest: '^4.1.4' },
  })
  assert.strictEqual(detectDepMajor(dir, 'vitest'), 4)
  console.log('  ✅')
}

console.log('Test 8: detectDepMajor reads major from dependencies')
{
  const dir = makeProject({
    name: 'x',
    dependencies: { vitest: '3.0.0' },
  })
  assert.strictEqual(detectDepMajor(dir, 'vitest'), 3)
  console.log('  ✅')
}

console.log('Test 9: detectDepMajor returns null when dep absent')
{
  const dir = makeProject({ name: 'x' })
  assert.strictEqual(detectDepMajor(dir, 'vitest'), null)
  console.log('  ✅')
}

// --- vitest coverage alignment ---

console.log(
  'Test 10: getDefaultDevDependencies aligns @vitest/coverage-v8 to project vitest@4'
)
{
  const dir = makeProject({
    name: 'x',
    devDependencies: { vitest: '^4.1.4' },
  })
  const devDeps = getDefaultDevDependencies({ projectPath: dir })
  assert.strictEqual(devDeps['@vitest/coverage-v8'], '^4.0.0')
  assert.strictEqual(
    devDeps.vitest,
    undefined,
    'should not inject vitest when project has newer major'
  )
  console.log('  ✅')
}

console.log(
  'Test 11: getDefaultDevDependencies keeps default coverage when no vitest in project'
)
{
  const dir = makeProject({ name: 'x' })
  const devDeps = getDefaultDevDependencies({ projectPath: dir })
  assert.strictEqual(devDeps['@vitest/coverage-v8'], '^2.1.8')
  assert.strictEqual(devDeps.vitest, '^2.1.8')
  console.log('  ✅')
}

console.log(
  'Test 12: getDefaultDevDependencies keeps default when project is on vitest@2'
)
{
  const dir = makeProject({
    name: 'x',
    devDependencies: { vitest: '^2.1.8' },
  })
  const devDeps = getDefaultDevDependencies({ projectPath: dir })
  assert.strictEqual(devDeps['@vitest/coverage-v8'], '^2.1.8')
  console.log('  ✅')
}

console.log('Test 13: getDefaultDevDependencies works without projectPath')
{
  const devDeps = getDefaultDevDependencies({ typescript: true })
  assert.strictEqual(devDeps['@vitest/coverage-v8'], '^2.1.8')
  assert(devDeps['@typescript-eslint/parser'])
  console.log('  ✅')
}

console.log('\n✅ All ESM project support tests passed!')
