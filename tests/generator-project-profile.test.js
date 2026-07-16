'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, execSync } = require('child_process')
const { detectProjectProfile } = require('../lib/project-profile')

const setupPath = path.join(__dirname, '..', 'setup.js')

function createRepo(packageJson) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-profile-'))
  execSync('git init', { cwd: directory, stdio: 'ignore' })
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
  return directory
}

function runSetup(directory) {
  const licenseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-profile-license-')
  )
  execFileSync(process.execPath, [setupPath, '--workflow-minimal'], {
    cwd: directory,
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      QAA_DEVELOPER: 'true',
      QAA_LICENSE_DIR: licenseDirectory,
    },
  })
  return licenseDirectory
}

const pnpmRepo = createRepo({
  name: 'next-pnpm-fixture',
  private: true,
  packageManager: 'pnpm@10.12.1',
  scripts: {
    build: 'next build',
    lint: 'eslint .',
    test: 'node --test',
    typecheck: 'tsc --noEmit',
    'format:check': 'prettier --check .',
  },
  dependencies: { next: '^15.0.0', react: '^19.0.0' },
  devDependencies: { typescript: '^5.0.0', eslint: '^9.0.0' },
})

try {
  fs.writeFileSync(
    path.join(pnpmRepo, 'pnpm-lock.yaml'),
    'lockfileVersion: 9\n'
  )
  fs.writeFileSync(path.join(pnpmRepo, 'next.config.ts'), 'export default {}\n')
  fs.writeFileSync(path.join(pnpmRepo, 'tsconfig.json'), '{}\n')
  fs.writeFileSync(
    path.join(pnpmRepo, 'eslint.config.mjs'),
    'export default [{ ignores: [".next/**"] }]\n'
  )
  fs.writeFileSync(path.join(pnpmRepo, '.prettierrc.json'), '{}\n')
  fs.writeFileSync(
    path.join(pnpmRepo, '.gitmodules'),
    '[submodule ".claude-kit"]\n\tpath = .claude-kit\n\turl = https://example.invalid/kit.git\n'
  )
  fs.mkdirSync(path.join(pnpmRepo, 'test'))
  fs.writeFileSync(path.join(pnpmRepo, 'test', 'app.test.ts'), 'export {}\n')

  const profile = detectProjectProfile(pnpmRepo)
  assert.strictEqual(profile.packageManager, 'pnpm')
  assert.strictEqual(profile.packageManagerVersion, '10.12.1')
  assert.deepStrictEqual(profile.frameworks, ['next', 'react'])
  assert.strictEqual(profile.eslintConfig, 'eslint.config.mjs')
  assert.strictEqual(profile.prettierConfig, '.prettierrc.json')
  assert(profile.submodulePaths.includes('.claude-kit'))
  assert(profile.buildOutputs.includes('.next'))

  const licenseDirectory = runSetup(pnpmRepo)
  const packageAfterFirstRun = fs.readFileSync(
    path.join(pnpmRepo, 'package.json'),
    'utf8'
  )
  const workflowAfterFirstRun = fs.readFileSync(
    path.join(pnpmRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(!fs.existsSync(path.join(pnpmRepo, 'eslint.config.cjs')))
  assert(!fs.existsSync(path.join(pnpmRepo, 'eslint-security.config.js')))
  assert(!fs.existsSync(path.join(pnpmRepo, 'tests/placeholder.test.ts')))
  assert(!fs.existsSync(path.join(pnpmRepo, 'tests/unit/sample.test.js')))
  assert(!fs.existsSync(path.join(pnpmRepo, 'tests/e2e/smoke.test.js')))
  const generatedPackage = JSON.parse(packageAfterFirstRun)
  assert.strictEqual(generatedPackage.scripts.test, 'node --test')
  assert(!generatedPackage.devDependencies.vitest)
  assert(!generatedPackage.devDependencies['@vitest/coverage-v8'])
  assert(generatedPackage.scripts['quality:check'].includes('pnpm run'))
  assert(!generatedPackage.volta.npm)
  assert(!workflowAfterFirstRun.includes("version: '8.15.0'"))
  assert(!workflowAfterFirstRun.includes('pnpm/action-setup'))
  assert(
    workflowAfterFirstRun.indexOf('corepack prepare pnpm@10.12.1') <
      workflowAfterFirstRun.indexOf('- name: Setup Node.js')
  )
  assert(workflowAfterFirstRun.includes('timeout 300 pnpm run quality:lint'))
  assert(workflowAfterFirstRun.includes('timeout 300 pnpm run format:check'))
  assert(workflowAfterFirstRun.includes('timeout 300 pnpm run typecheck'))
  assert(workflowAfterFirstRun.includes('timeout 300 pnpm run test'))
  assert(workflowAfterFirstRun.includes('timeout 300 pnpm run build'))
  assert(!workflowAfterFirstRun.includes("test-count: '0'"))
  assert(
    fs
      .readFileSync(path.join(pnpmRepo, '.husky/pre-commit'), 'utf8')
      .includes('pnpm exec lint-staged')
  )
  assert(
    fs
      .readFileSync(path.join(pnpmRepo, '.prettierignore'), 'utf8')
      .includes('.claude-kit')
  )
  assert(
    generatedPackage.scripts['quality:lint'].includes(
      '--ignore-pattern ".claude-kit/**"'
    )
  )

  runSetup(pnpmRepo)
  assert.strictEqual(
    fs.readFileSync(path.join(pnpmRepo, 'package.json'), 'utf8'),
    packageAfterFirstRun
  )
  assert.strictEqual(
    fs.readFileSync(
      path.join(pnpmRepo, '.github/workflows/quality.yml'),
      'utf8'
    ),
    workflowAfterFirstRun
  )
  fs.rmSync(licenseDirectory, { recursive: true, force: true })
} finally {
  fs.rmSync(pnpmRepo, { recursive: true, force: true })
}

const npmRepo = createRepo({
  name: 'npm-jest-fixture',
  scripts: { lint: 'eslint .', test: 'jest --runInBand' },
  devDependencies: { eslint: '^9.0.0', jest: '^30.0.0' },
})

try {
  fs.writeFileSync(path.join(npmRepo, 'package-lock.json'), '{}\n')
  fs.writeFileSync(
    path.join(npmRepo, 'eslint.config.js'),
    'module.exports=[]\n'
  )
  fs.mkdirSync(path.join(npmRepo, '__tests__'))
  fs.writeFileSync(
    path.join(npmRepo, '__tests__/app.test.js'),
    'test("x",()=>{})\n'
  )
  runSetup(npmRepo)
  const generatedPackage = JSON.parse(
    fs.readFileSync(path.join(npmRepo, 'package.json'), 'utf8')
  )
  assert.strictEqual(generatedPackage.scripts.test, 'jest --runInBand')
  assert(!generatedPackage.devDependencies.vitest)
  assert(!fs.existsSync(path.join(npmRepo, 'eslint.config.cjs')))
  assert(
    fs
      .readFileSync(path.join(npmRepo, '.github/workflows/quality.yml'), 'utf8')
      .includes('timeout 300 npm run test')
  )
} finally {
  fs.rmSync(npmRepo, { recursive: true, force: true })
}

const noTestScriptRepo = createRepo({
  name: 'no-test-script-fixture',
  scripts: {
    lint: 'eslint .',
    typecheck: 'tsc --noEmit',
    build: 'node build.js',
  },
  devDependencies: { eslint: '^9.0.0', typescript: '^5.0.0' },
})

try {
  fs.writeFileSync(path.join(noTestScriptRepo, 'package-lock.json'), '{}\n')
  fs.writeFileSync(
    path.join(noTestScriptRepo, 'eslint.config.js'),
    'module.exports=[]\n'
  )
  fs.mkdirSync(path.join(noTestScriptRepo, 'test'))
  fs.writeFileSync(
    path.join(noTestScriptRepo, 'test/app.test.js'),
    'export {}\n'
  )
  runSetup(noTestScriptRepo)
  const workflow = fs.readFileSync(
    path.join(noTestScriptRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(workflow.includes('timeout 300 npm run lint'))
  assert(workflow.includes('timeout 300 npm run typecheck'))
  assert(workflow.includes('timeout 300 npm run build'))
  assert(!workflow.includes('npm test'))
  assert(!workflow.includes('npm run test'))
} finally {
  fs.rmSync(noTestScriptRepo, { recursive: true, force: true })
}

const conflictRepo = createRepo({
  name: 'conflicting-package-manager',
  packageManager: 'pnpm@10.0.0',
})
try {
  fs.writeFileSync(path.join(conflictRepo, 'package-lock.json'), '{}\n')
  assert.throws(
    () => detectProjectProfile(conflictRepo),
    /packageManager declares pnpm.*package-lock\.json belongs to npm/
  )
  fs.writeFileSync(
    path.join(conflictRepo, 'pnpm-lock.yaml'),
    'lockfileVersion: 9\n'
  )
  assert.throws(
    () => detectProjectProfile(conflictRepo),
    /Conflicting package-manager lockfiles/
  )
} finally {
  fs.rmSync(conflictRepo, { recursive: true, force: true })
}

console.log('✅ Generator project profile regression tests passed')
