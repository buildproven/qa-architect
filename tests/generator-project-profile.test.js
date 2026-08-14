'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, execSync, spawnSync } = require('child_process')
const { detectProjectProfile } = require('../lib/project-profile')
const {
  addGitlink,
  initializeFixtureRepository,
  runFixtureGit,
} = require('./git-fixture-helpers')

const setupPath = path.join(__dirname, '..', 'setup.js')

function createRepo(packageJson) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-profile-'))
  initializeFixtureRepository(directory)
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
  return directory
}

function runSetup(directory, options = {}) {
  const { developer = true } = options
  const licenseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-profile-license-')
  )
  const env = /** @type {NodeJS.ProcessEnv} */ ({
    ...process.env,
    NODE_ENV: 'test',
    QAA_LICENSE_DIR: licenseDirectory,
  })
  if (developer) {
    env.QAA_DEVELOPER = 'true'
  } else {
    delete env.QAA_DEVELOPER
  }
  execFileSync(process.execPath, [setupPath, '--workflow-minimal'], {
    cwd: directory,
    stdio: 'pipe',
    env,
  })
  return licenseDirectory
}

function runGeneratedScript(directory, scriptName) {
  const localBin = path.join(__dirname, '..', 'node_modules', '.bin')
  execFileSync('npm', ['run', scriptName], {
    cwd: directory,
    stdio: 'pipe',
    env: {
      ...process.env,
      PATH: `${localBin}${path.delimiter}${process.env.PATH || ''}`,
    },
  })
}

function runGeneratedPreCommit(directory, pathPrefix = '') {
  execFileSync('sh', [path.join(directory, '.husky', 'pre-commit')], {
    cwd: directory,
    stdio: 'pipe',
    env: {
      ...process.env,
      PATH: `${pathPrefix}${pathPrefix ? path.delimiter : ''}${process.env.PATH || ''}`,
    },
  })
}

function runGeneratedPrePush(directory, licenseDirectory) {
  return spawnSync('sh', [path.join(directory, '.husky', 'pre-push')], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      QAA_DEVELOPER: 'true',
      QAA_LICENSE_DIR: licenseDirectory,
    },
  })
}

const nonGitProject = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qaa-profile-non-git-')
)
try {
  fs.writeFileSync(
    path.join(nonGitProject, 'package.json'),
    `${JSON.stringify({ name: 'non-git-project', version: '1.0.0' })}\n`
  )
  assert.deepStrictEqual(
    detectProjectProfile(nonGitProject).submodulePaths,
    [],
    'A normal project outside Git must not fail submodule discovery'
  )
} finally {
  fs.rmSync(nonGitProject, { recursive: true, force: true })
}

const emptyGitmodulesRepo = createRepo({
  name: 'empty-gitmodules-fixture',
  version: '1.0.0',
})
try {
  fs.writeFileSync(path.join(emptyGitmodulesRepo, '.gitmodules'), '')
  assert.deepStrictEqual(
    detectProjectProfile(emptyGitmodulesRepo).submodulePaths,
    [],
    'An empty .gitmodules file must mean that no submodules are configured'
  )
} finally {
  fs.rmSync(emptyGitmodulesRepo, { recursive: true, force: true })
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
  addGitlink(pnpmRepo, '.claude-kit')
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
  const generatedTestsTsConfigPath = path.join(
    pnpmRepo,
    'tests',
    'tsconfig.json'
  )
  assert(
    fs.existsSync(generatedTestsTsConfigPath),
    'Existing tests must not suppress the config referenced by type-check:tests'
  )
  const generatedTestsTsConfig = JSON.parse(
    fs.readFileSync(generatedTestsTsConfigPath, 'utf8')
  )
  assert(
    generatedTestsTsConfig.include.includes('../test/**/*'),
    'Generated test config must cover singular test/ directories'
  )
  assert.strictEqual(generatedPackage.scripts.test, 'node --test')
  assert(
    generatedPackage.scripts['type-check:tests'].includes('tests/tsconfig.json')
  )
  assert(
    generatedPackage.scripts['type-check:all'].includes('type-check:tests'),
    'type-check:all must include the separate test TypeScript project'
  )
  assert.deepStrictEqual(
    generatedPackage['lint-staged']['**/*.{ts,tsx}'],
    ['eslint --fix', 'prettier --write'],
    'lint-staged must not append staged filenames to project-wide TypeScript checks'
  )
  assert.deepStrictEqual(
    generatedPackage['lint-staged']['tests/**/*.{ts,tsx,js,jsx}'],
    ['eslint --fix', 'prettier --write'],
    'Test TypeScript checks must run through type-check:all rather than lint-staged'
  )
  runGeneratedScript(pnpmRepo, 'type-check:tests')
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
  assert.strictEqual(
    [...workflowAfterFirstRun.matchAll(/create-qa-architect@latest/g)].length,
    1,
    'Only the licensed PR assurance job may execute the published CLI'
  )
  assert(
    workflowAfterFirstRun.includes('npx create-qa-architect@latest --pr-check')
  )
  assert(workflowAfterFirstRun.includes('permissions:\n  contents: read'))
  assert(
    [...workflowAfterFirstRun.matchAll(/uses: actions\/checkout@[^\s]+/g)]
      .length ===
      [...workflowAfterFirstRun.matchAll(/persist-credentials: false/g)].length
  )
  assert(
    fs
      .readFileSync(path.join(pnpmRepo, '.husky/pre-commit'), 'utf8')
      .includes('pnpm exec lint-staged || exit $?'),
    'The pre-commit hook must preserve lint-staged failures'
  )
  assert(
    fs
      .readFileSync(path.join(pnpmRepo, '.husky/pre-commit'), 'utf8')
      .includes('pnpm run type-check:all'),
    'The pre-commit hook must run TypeScript checks project-wide'
  )
  assert(
    fs
      .readFileSync(path.join(pnpmRepo, '.prettierignore'), 'utf8')
      .includes('.claude-kit')
  )
  assert(
    generatedPackage.scripts['quality:lint'].includes(
      "--ignore-pattern '.claude-kit/**'"
    )
  )

  const preCommitPath = path.join(pnpmRepo, '.husky', 'pre-commit')
  fs.writeFileSync(
    preCommitPath,
    '# Run lint-staged on staged files\npnpm exec lint-staged\n'
  )
  runSetup(pnpmRepo)
  const upgradedPreCommit = fs.readFileSync(preCommitPath, 'utf8')
  assert(
    upgradedPreCommit.includes('pnpm exec lint-staged || exit $?'),
    'A legacy generated hook must preserve lint-staged failures after upgrade'
  )
  assert(
    upgradedPreCommit.includes('pnpm run type-check:all'),
    'A legacy generated hook must gain project-wide TypeScript validation'
  )
  const failingTypeCheckBin = path.join(pnpmRepo, 'failing-type-check-bin')
  fs.mkdirSync(failingTypeCheckBin)
  fs.writeFileSync(
    path.join(failingTypeCheckBin, 'pnpm'),
    `#!/bin/sh
if [ "$1" = "exec" ] && [ "$2" = "lint-staged" ]; then exit 0; fi
if [ "$1" = "run" ] && [ "$2" = "type-check:all" ]; then exit 1; fi
exit 64
`
  )
  fs.chmodSync(path.join(failingTypeCheckBin, 'pnpm'), 0o755)
  assert.throws(
    () => runGeneratedPreCommit(pnpmRepo, failingTypeCheckBin),
    /Command failed/,
    'A failing project-wide TypeScript check must block the generated pre-commit hook'
  )
  runGeneratedScript(pnpmRepo, 'type-check:tests')
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
  packageManager: 'npm@11.5.2',
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
  const workflow = fs.readFileSync(
    path.join(npmRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(workflow.includes('timeout 300 npm run test'))
  assert(
    workflow.includes('timeout 300 npm run format:check'),
    'Generated check-mode gates must survive the final project-profile overlay'
  )
  assert(workflow.includes('npm install --global npm@11.5.2'))
  assert(workflow.includes('echo "install-cmd=npm ci"'))
  assert(workflow.includes("cache: 'npm'"))
} finally {
  fs.rmSync(npmRepo, { recursive: true, force: true })
}

const writeFormatRepo = createRepo({
  name: 'write-format-fixture',
  scripts: { format: 'prettier --write .' },
  devDependencies: { prettier: '^3.0.0' },
})

try {
  fs.writeFileSync(path.join(writeFormatRepo, 'package-lock.json'), '{}\n')
  const initialProfile = detectProjectProfile(writeFormatRepo)
  assert.strictEqual(
    initialProfile.scripts.format,
    null,
    'A write-mode format script must not be classified as a CI format check'
  )

  runSetup(writeFormatRepo)
  const generatedPackage = JSON.parse(
    fs.readFileSync(path.join(writeFormatRepo, 'package.json'), 'utf8')
  )
  const workflow = fs.readFileSync(
    path.join(writeFormatRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert.strictEqual(generatedPackage.scripts.format, 'prettier --write .')
  assert.strictEqual(
    generatedPackage.scripts['format:check'],
    'prettier --check .'
  )
  assert(workflow.includes('timeout 300 npm run format:check'))
  assert(!workflow.includes('timeout 300 npm run format\n'))
} finally {
  fs.rmSync(writeFormatRepo, { recursive: true, force: true })
}

for (const detectedTestScript of ['test', 'test:unit', 'test:ci']) {
  const markerName = detectedTestScript.replace(':', '-')
  const testScriptRepo = createRepo({
    name: `${markerName}-pre-push-fixture`,
    scripts: {
      [detectedTestScript]: `node -e "require('fs').writeFileSync('${markerName}.ran', 'yes')"`,
    },
  })
  try {
    fs.writeFileSync(path.join(testScriptRepo, 'package-lock.json'), '{}\n')
    const licenseDirectory = runSetup(testScriptRepo, { developer: false })
    const prePush = runGeneratedPrePush(testScriptRepo, licenseDirectory)
    assert.strictEqual(prePush.status, 0)
    assert(!fs.existsSync(path.join(testScriptRepo, `${markerName}.ran`)))
    assert.match(
      prePush.stdout,
      /No affected-test selector is configured/,
      'Generated pre-push hook must explain the CI safety net'
    )
    fs.rmSync(licenseDirectory, { recursive: true, force: true })
  } finally {
    fs.rmSync(testScriptRepo, { recursive: true, force: true })
  }
}

const executablePrettierConfigRepo = createRepo({
  name: 'untrusted-prettier-config-fixture',
  scripts: { test: 'node --test' },
  devDependencies: { prettier: '^3.0.0' },
})

try {
  fs.writeFileSync(
    path.join(executablePrettierConfigRepo, 'package-lock.json'),
    '{}\n'
  )
  fs.writeFileSync(
    path.join(executablePrettierConfigRepo, 'prettier.config.cjs'),
    "require('fs').writeFileSync('formatter-executed', 'unsafe')\nmodule.exports = {}\n"
  )
  const binDirectory = path.join(
    executablePrettierConfigRepo,
    'node_modules',
    '.bin'
  )
  fs.mkdirSync(binDirectory, { recursive: true })
  const fakePrettier = path.join(binDirectory, 'prettier')
  fs.writeFileSync(
    fakePrettier,
    '#!/bin/sh\nnode -e "require(process.cwd() + \'/prettier.config.cjs\')"\n'
  )
  fs.chmodSync(fakePrettier, 0o755)

  runSetup(executablePrettierConfigRepo)
  assert(
    !fs.existsSync(
      path.join(executablePrettierConfigRepo, 'formatter-executed')
    ),
    'setup must not execute repository-controlled Prettier configuration'
  )
} finally {
  fs.rmSync(executablePrettierConfigRepo, {
    recursive: true,
    force: true,
  })
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
  const generatedPackage = JSON.parse(
    fs.readFileSync(path.join(noTestScriptRepo, 'package.json'), 'utf8')
  )
  const workflow = fs.readFileSync(
    path.join(noTestScriptRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(workflow.includes('timeout 300 npm run lint'))
  assert(workflow.includes('timeout 300 npm run typecheck'))
  assert(workflow.includes('timeout 300 npm run build'))
  assert(!workflow.includes('npm test'))
  assert(!workflow.includes('npm run test'))
  assert(
    workflow.includes(
      'A test-impact policy requires a declared complete test command.'
    )
  )
  assert(!generatedPackage.scripts['quality:check'].includes('run test'))
  assert(!generatedPackage.scripts['quality:ci'].includes('run test'))

  const binDirectory = path.join(noTestScriptRepo, 'bin')
  const invocationLog = path.join(noTestScriptRepo, 'quality-invocations.log')
  fs.mkdirSync(binDirectory)
  fs.writeFileSync(
    path.join(binDirectory, 'npm'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${invocationLog}"\nexit 0\n`
  )
  fs.chmodSync(path.join(binDirectory, 'npm'), 0o755)
  execSync(generatedPackage.scripts['quality:check'], {
    cwd: noTestScriptRepo,
    stdio: 'pipe',
    env: {
      ...process.env,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH || ''}`,
    },
  })
  const invokedCommands = fs.readFileSync(invocationLog, 'utf8')
  assert(invokedCommands.includes('run type-check:all'))
  assert(invokedCommands.includes('run lint'))
  assert(!invokedCommands.includes('run test'))
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

const bunRepo = createRepo({
  name: 'bun-fixture',
  packageManager: 'bun@1.2.20',
  scripts: { lint: 'eslint .' },
  devDependencies: { eslint: '^9.0.0' },
})
try {
  fs.writeFileSync(path.join(bunRepo, 'bun.lock'), '')
  fs.writeFileSync(
    path.join(bunRepo, 'eslint.config.js'),
    'module.exports=[]\n'
  )
  const profile = detectProjectProfile(bunRepo)
  assert.strictEqual(profile.packageManager, 'bun')
  assert.strictEqual(profile.packageManagerVersion, '1.2.20')
  assert.strictEqual(profile.installCommand, 'bun install --frozen-lockfile')
  assert.strictEqual(
    profile.auditCommand,
    'bun audit --audit-level=high --production'
  )
  assert.strictEqual(profile.exec('lint-staged'), 'bun x lint-staged')
  runSetup(bunRepo)
  const workflow = fs.readFileSync(
    path.join(bunRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(workflow.includes('echo "manager=bun"'))
  assert(workflow.includes('echo "install-cmd=bun install --frozen-lockfile"'))
  assert(workflow.includes("bun-version: '1.2.20'"))
  assert(!workflow.includes("cache: 'bun'"))
  assert(
    fs
      .readFileSync(path.join(bunRepo, '.husky/pre-commit'), 'utf8')
      .includes('bun x lint-staged')
  )
} finally {
  fs.rmSync(bunRepo, { recursive: true, force: true })
}

const yarnClassicRepo = createRepo({
  name: 'yarn-classic-fixture',
  packageManager: 'yarn@1.22.22',
})
const yarnBerryRepo = createRepo({
  name: 'yarn-berry-fixture',
  packageManager: 'yarn@4.9.2',
  scripts: { build: 'node build.js' },
})
try {
  fs.writeFileSync(path.join(yarnClassicRepo, 'yarn.lock'), '')
  fs.writeFileSync(path.join(yarnBerryRepo, 'yarn.lock'), '')
  const classic = detectProjectProfile(yarnClassicRepo)
  const berry = detectProjectProfile(yarnBerryRepo)
  assert.strictEqual(classic.installCommand, 'yarn install --frozen-lockfile')
  assert.strictEqual(
    classic.auditCommand,
    'yarn audit --level high --groups dependencies'
  )
  assert.strictEqual(berry.installCommand, 'yarn install --immutable')
  assert.strictEqual(
    berry.auditCommand,
    'yarn npm audit --severity high --environment production --recursive'
  )
  runSetup(yarnBerryRepo)
  const workflow = fs.readFileSync(
    path.join(yarnBerryRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(workflow.includes('corepack prepare yarn@4.9.2 --activate'))
  assert(
    workflow.indexOf('corepack prepare yarn@4.9.2 --activate') <
      workflow.indexOf('- name: Setup Node.js')
  )
  assert(workflow.includes("cache: 'yarn'"))
  assert(workflow.includes('echo "install-cmd=yarn install --immutable"'))
  assert(
    workflow.includes(
      'yarn npm audit --severity high --environment production --recursive'
    )
  )
  assert(!workflow.includes('yarn audit --level'))
  assert(
    (workflow.match(/yarn install --immutable/g) || []).length >= 2,
    'Yarn Berry workflow should use immutable install for install and integrity checks'
  )
  assert(workflow.includes('timeout 300 yarn build'))
} finally {
  fs.rmSync(yarnClassicRepo, { recursive: true, force: true })
  fs.rmSync(yarnBerryRepo, { recursive: true, force: true })
}

const pnpmLockOnlyRepo = createRepo({ name: 'pnpm-lock-only-fixture' })
const yarnClassicLockOnlyRepo = createRepo({
  name: 'yarn-classic-lock-only-fixture',
})
const yarnModernLockOnlyRepo = createRepo({
  name: 'yarn-modern-lock-only-fixture',
  packageManager: 'yarn',
})
try {
  fs.writeFileSync(
    path.join(pnpmLockOnlyRepo, 'pnpm-lock.yaml'),
    'lockfileVersion: 9\n'
  )
  fs.writeFileSync(
    path.join(yarnClassicLockOnlyRepo, 'yarn.lock'),
    '# yarn lockfile v1\n'
  )
  fs.writeFileSync(
    path.join(yarnModernLockOnlyRepo, 'yarn.lock'),
    '__metadata:\n  version: 8\n'
  )
  fs.writeFileSync(path.join(yarnModernLockOnlyRepo, '.yarnrc.yml'), '')

  const pnpm = detectProjectProfile(pnpmLockOnlyRepo)
  const classic = detectProjectProfile(yarnClassicLockOnlyRepo)
  const modern = detectProjectProfile(yarnModernLockOnlyRepo)
  assert.strictEqual(pnpm.packageManagerVersion, '10.34.5')
  assert.strictEqual(classic.packageManagerVersion, '1.22.22')
  assert.strictEqual(classic.installCommand, 'yarn install --frozen-lockfile')
  assert.strictEqual(
    classic.auditCommand,
    'yarn audit --level high --groups dependencies'
  )
  assert.strictEqual(modern.packageManagerVersion, '4.9.2')
  assert.strictEqual(modern.installCommand, 'yarn install --immutable')
  assert.strictEqual(
    modern.auditCommand,
    'yarn npm audit --severity high --environment production --recursive'
  )

  runSetup(pnpmLockOnlyRepo)
  runSetup(yarnModernLockOnlyRepo)
  assert(
    fs
      .readFileSync(
        path.join(pnpmLockOnlyRepo, '.github/workflows/quality.yml'),
        'utf8'
      )
      .includes('corepack prepare pnpm@10.34.5 --activate')
  )
  assert(
    fs
      .readFileSync(
        path.join(yarnModernLockOnlyRepo, '.github/workflows/quality.yml'),
        'utf8'
      )
      .includes('corepack prepare yarn@4.9.2 --activate')
  )
} finally {
  fs.rmSync(pnpmLockOnlyRepo, { recursive: true, force: true })
  fs.rmSync(yarnClassicLockOnlyRepo, { recursive: true, force: true })
  fs.rmSync(yarnModernLockOnlyRepo, { recursive: true, force: true })
}

const bunLockOnlyRepo = createRepo({ name: 'bun-lock-only-fixture' })
const bunUnversionedRepo = createRepo({
  name: 'bun-unversioned-fixture',
  packageManager: 'bun',
})
try {
  fs.writeFileSync(path.join(bunLockOnlyRepo, 'bun.lock'), '')
  fs.writeFileSync(path.join(bunUnversionedRepo, 'bun.lock'), '')
  assert.throws(
    () => detectProjectProfile(bunLockOnlyRepo),
    /Bun projects must declare an exact packageManager version/
  )
  assert.throws(
    () => detectProjectProfile(bunUnversionedRepo),
    /Bun projects must declare an exact packageManager version/
  )
} finally {
  fs.rmSync(bunLockOnlyRepo, { recursive: true, force: true })
  fs.rmSync(bunUnversionedRepo, { recursive: true, force: true })
}

const injectionRepo = createRepo({
  name: 'injection-fixture',
  packageManager: 'pnpm@10.0.0; echo INJECTED',
})
try {
  assert.throws(
    () => detectProjectProfile(injectionRepo),
    /must pin an exact pnpm version/
  )
} finally {
  fs.rmSync(injectionRepo, { recursive: true, force: true })
}

const submoduleRepo = createRepo({
  name: 'submodule-escaping-fixture',
  scripts: { lint: 'eslint .' },
})
try {
  fs.writeFileSync(
    path.join(submoduleRepo, '.gitmodules'),
    '[submodule "safe"]\n\tpath = vendor/module with spaces\n\turl = https://example.invalid/module.git\n'
  )
  addGitlink(submoduleRepo, 'vendor/module with spaces')
  runSetup(submoduleRepo)
  const generatedPackage = JSON.parse(
    fs.readFileSync(path.join(submoduleRepo, 'package.json'), 'utf8')
  )
  assert(
    generatedPackage.scripts['quality:lint'].includes(
      "'vendor/module with spaces/**'"
    )
  )
  const eslintConfig = fs.readFileSync(
    path.join(submoduleRepo, 'eslint.config.cjs'),
    'utf8'
  )
  assert(eslintConfig.includes('"**/vendor/module with spaces/**"'))
} finally {
  fs.rmSync(submoduleRepo, { recursive: true, force: true })
}

const submoduleInjectionRepo = createRepo({
  name: 'submodule-glob-injection-fixture',
})
try {
  fs.writeFileSync(
    path.join(submoduleInjectionRepo, '.gitmodules'),
    '[submodule "injection"]\n\tpath = src/**\n\turl = https://example.invalid/module.git\n'
  )
  addGitlink(submoduleInjectionRepo, 'src/**')
  assert.throws(
    () => detectProjectProfile(submoduleInjectionRepo),
    /Unsafe submodule path: src\/\*\*/
  )
} finally {
  fs.rmSync(submoduleInjectionRepo, { recursive: true, force: true })
}

const fakeSubmoduleRepo = createRepo({ name: 'fake-submodule-fixture' })
try {
  fs.mkdirSync(path.join(fakeSubmoduleRepo, 'src'))
  fs.writeFileSync(
    path.join(fakeSubmoduleRepo, 'src', 'normal.js'),
    'export {}\n'
  )
  fs.writeFileSync(
    path.join(fakeSubmoduleRepo, '.gitmodules'),
    '[submodule "fake"]\n\tpath = src\n\turl = https://example.invalid/module.git\n'
  )
  assert.throws(
    () => detectProjectProfile(fakeSubmoduleRepo),
    /Submodule config\/gitlink mismatch.*missing gitlinks \[src\]/
  )
} finally {
  fs.rmSync(fakeSubmoduleRepo, { recursive: true, force: true })
}

const undeclaredGitlinkRepo = createRepo({
  name: 'undeclared-gitlink-fixture',
})
try {
  addGitlink(undeclaredGitlinkRepo, 'vendor/undeclared')
  assert.throws(
    () => detectProjectProfile(undeclaredGitlinkRepo),
    /Gitlink entries require a regular \.gitmodules file/
  )
} finally {
  fs.rmSync(undeclaredGitlinkRepo, { recursive: true, force: true })
}

const largeIndexRepo = createRepo({ name: 'large-index-fixture' })
try {
  const blob = String(
    runFixtureGit(largeIndexRepo, ['hash-object', '-w', '--stdin'], {
      encoding: 'utf8',
      input: '',
    })
  ).trim()
  const indexRecords = Array.from({ length: 18_000 }, (_, index) => {
    const sequence = String(index).padStart(6, '0')
    return `100644 ${blob}\tgenerated/${sequence}-${'x'.repeat(32)}.js\n`
  }).join('')
  assert(
    Buffer.byteLength(indexRecords) > 1024 * 1024,
    'Large-index fixture must exceed the child_process default output buffer'
  )
  runFixtureGit(largeIndexRepo, ['update-index', '--index-info'], {
    input: indexRecords,
  })
  fs.writeFileSync(
    path.join(largeIndexRepo, '.gitmodules'),
    '[submodule "large"]\n\tpath = vendor/large\n\turl = https://example.invalid/large.git\n'
  )
  addGitlink(largeIndexRepo, 'vendor/large')

  const profile = detectProjectProfile(largeIndexRepo)
  assert.deepStrictEqual(profile.submodulePaths, ['vendor/large'])
} finally {
  fs.rmSync(largeIndexRepo, { recursive: true, force: true })
}

for (const configName of [
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.json5',
  '.prettierrc.toml',
  '.prettierrc.ts',
  '.prettierrc.mts',
  '.prettierrc.cts',
  'prettier.config.ts',
  'prettier.config.mts',
  'prettier.config.cts',
]) {
  const prettierRepo = createRepo({ name: `prettier-${configName}` })
  try {
    fs.writeFileSync(path.join(prettierRepo, configName), '{}\n')
    runSetup(prettierRepo)
    assert(!fs.existsSync(path.join(prettierRepo, '.prettierrc')))
  } finally {
    fs.rmSync(prettierRepo, { recursive: true, force: true })
  }
}

const freshRepo = createRepo({ name: 'fresh-project-fixture' })
try {
  runSetup(freshRepo)
  const workflow = fs.readFileSync(
    path.join(freshRepo, '.github/workflows/quality.yml'),
    'utf8'
  )
  assert(!workflow.includes('      false'))
  assert(workflow.includes('- name: Tests'))
} finally {
  fs.rmSync(freshRepo, { recursive: true, force: true })
}

// BUI-515: every generated dependency-audit gate must scope to production
// deps. Dev-tooling CVEs don't ship to users, and gating on them permanently
// blocks consumer repos on advisories with no consumer-side fix (framework-
// bundled or dev-only transitives). The severity bar stays at high — the fix
// is narrowing scope, never lowering severity or adding `|| true`.
{
  const { getDefaultScripts } = require('../config/defaults')
  const { getSecurityScripts } = require('../lib/security-enhancements')

  const PROD_SCOPE_FLAGS = [
    '--omit=dev', // npm
    '--prod', // pnpm
    '--production', // bun
    '--groups dependencies', // yarn classic
    '--environment production', // yarn berry
  ]

  const assertProdScoped = (label, command) => {
    // Each package-manager branch inside the script must carry a prod-scope
    // flag; a single flag anywhere isn't enough when the script branches.
    const branches = command
      .split(/;|\|\||&&/)
      .map(part => part.trim())
      .filter(part => /\b(npm|pnpm|yarn|bun) (npm )?audit\b/.test(part))
      .filter(part => !/audit (--)?fix/.test(part))

    assert(branches.length > 0, `${label}: expected at least one audit branch`)

    for (const branch of branches) {
      assert(
        PROD_SCOPE_FLAGS.some(flag => branch.includes(flag)),
        `${label}: audit branch must scope to production deps: "${branch}"`
      )
      assert(
        !/\|\|\s*true/.test(branch),
        `${label}: audit must not be silenced with "|| true": "${branch}"`
      )
    }
  }

  assertProdScoped(
    'config/defaults.js security:audit',
    getDefaultScripts()['security:audit']
  )
  assertProdScoped(
    'security-enhancements.js security:audit',
    getSecurityScripts()['security:audit']
  )

  // Generated per-package-manager audit commands (lib/project-profile.js)
  for (const [manager, lockfile, packageManager] of [
    ['npm', 'package-lock.json', undefined],
    ['pnpm', 'pnpm-lock.yaml', 'pnpm@10.12.1'],
    ['yarn-classic', 'yarn.lock', 'yarn@1.22.22'],
    ['yarn-berry', 'yarn.lock', 'yarn@4.9.2'],
    ['bun', 'bun.lock', 'bun@1.2.20'],
  ]) {
    const repo = createRepo({
      name: `audit-scope-${manager}`,
      ...(packageManager ? { packageManager } : {}),
    })
    try {
      fs.writeFileSync(path.join(repo, lockfile), '')
      const { auditCommand } = detectProjectProfile(repo)
      assertProdScoped(`project-profile ${manager}`, auditCommand)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  }

  console.log('✅ Generated audit gates scope to production dependencies')
}

// pnpm 11 dropped support for Node <22 (requires the node:sqlite built-in,
// added in Node 22). The generated workflow hardcodes node-version: '20' on
// several non-matrix jobs (detect-maturity, security, audit-report,
// documentation) that run `corepack prepare pnpm@<version> --activate` with
// the consumer's exact pinned version — activating a pinned pnpm@11.x under
// Node 20 crashes those jobs outright with ERR_UNKNOWN_BUILTIN_MODULE.
{
  console.log('Generator: node-version bumped for pnpm 11+, untouched below')

  for (const [label, packageManagerVersion, expectedNodeVersion] of [
    ['pnpm 11.x', 'pnpm@11.13.1', "'22'"],
    ['pnpm 10.x', 'pnpm@10.12.1', "'20'"],
  ]) {
    const repo = createRepo({
      name: `node-version-${label.replace(/[^a-z0-9]/gi, '-')}`,
      packageManager: packageManagerVersion,
    })
    try {
      fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), '')
      runSetup(repo)
      const workflow = fs.readFileSync(
        path.join(repo, '.github/workflows/quality.yml'),
        'utf8'
      )
      const hardcodedNodeVersions = [
        ...workflow.matchAll(/^ {10}node-version: ('20'|'22')$/gm),
      ].map(match => match[1])
      assert(
        hardcodedNodeVersions.length > 0,
        `${label}: expected to find hardcoded node-version lines`
      )
      for (const found of hardcodedNodeVersions) {
        assert.strictEqual(
          found,
          expectedNodeVersion,
          `${label}: hardcoded node-version should be ${expectedNodeVersion}, found ${found}`
        )
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  }

  console.log('✅ node-version matches pnpm major version compatibility')
}

// setup.js's Lighthouse config copy always wrote .lighthouserc.js — a
// CommonJS template (`module.exports = {...}`) — even into ESM projects
// ("type": "module" in package.json), where Node treats a plain .js file as
// ESM and throws "module is not defined in ES module scope" the moment
// `lhci autorun` tries to require() it. @lhci/cli's own RC_FILE_NAMES list
// checks .lighthouserc.cjs before .lighthouserc.js, so writing the .cjs
// extension for ESM projects needs no lhci/script changes to be picked up.
{
  console.log('Generator: Lighthouse config extension matches module type')

  const lighthouseFixtures = [
    { label: 'ESM project', isESM: true, expectedFile: '.lighthouserc.cjs' },
    { label: 'CJS project', isESM: false, expectedFile: '.lighthouserc.js' },
  ]

  for (const { label, isESM, expectedFile } of lighthouseFixtures) {
    const repo = createRepo({
      name: `lighthouserc-${label.replace(/[^a-z0-9]/gi, '-')}`,
      ...(isESM ? { type: 'module' } : {}),
    })
    try {
      runSetup(repo)
      assert(
        fs.existsSync(path.join(repo, expectedFile)),
        `${label}: expected ${expectedFile} to exist`
      )
      const otherFile =
        expectedFile === '.lighthouserc.cjs'
          ? '.lighthouserc.js'
          : '.lighthouserc.cjs'
      assert(
        !fs.existsSync(path.join(repo, otherFile)),
        `${label}: did not expect ${otherFile} to exist`
      )
      // Must actually load without throwing in a fresh process — the real
      // bug was a module-system mismatch (Node treating the file as ESM),
      // not a missing file. A dynamic require() in-process would trip
      // eslint's non-literal-require rule and doesn't reproduce how lhci
      // actually loads it (its own subprocess), so shell out instead.
      execFileSync(
        process.execPath,
        ['-e', `require(${JSON.stringify(path.join(repo, expectedFile))})`],
        { stdio: 'pipe' }
      )
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  }

  console.log('✅ Lighthouse config extension matches project module type')
}

// Companion to the write-side fix above: the generated workflow's own
// Lighthouse step is gated behind `hashFiles('.lighthouserc.js', ...)`, which
// didn't list `.lighthouserc.cjs`. Without this, an ESM project's Lighthouse
// step wouldn't even fail loudly — hashFiles would return '' and the step's
// `if:` would skip it entirely, silently disabling Lighthouse rather than
// running it.
{
  console.log('Generator: Lighthouse hashFiles gate recognizes .cjs')
  const repo = createRepo({ name: 'lighthouserc-hashfiles-gate' })
  try {
    runSetup(repo)
    const workflow = fs.readFileSync(
      path.join(repo, '.github/workflows/quality.yml'),
      'utf8'
    )
    const hashFilesLine = workflow
      .split('\n')
      .find(line => line.includes("hashFiles('.lighthouserc"))
    assert(hashFilesLine, 'Expected to find the Lighthouse hashFiles gate')
    assert(
      hashFilesLine.includes('.lighthouserc.cjs'),
      `Lighthouse hashFiles gate must include .lighthouserc.cjs: ${hashFilesLine}`
    )
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
  console.log('✅ Lighthouse hashFiles gate recognizes .cjs')
}

console.log('✅ Generator project profile regression tests passed')
