'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, execSync } = require('child_process')
const { detectProjectProfile } = require('../lib/project-profile')
const {
  readProjectFile,
  writeProjectFile,
} = require('../lib/project-file-safety')

const setupPath = path.join(__dirname, '..', 'setup.js')

function createRepo(packageJson) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-contract-'))
  execSync('git init', { cwd: directory, stdio: 'ignore' })
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
  return directory
}

function runSetup(directory) {
  const licenseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-contract-license-')
  )
  try {
    return execFileSync(process.execPath, [setupPath, '--workflow-minimal'], {
      cwd: directory,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        QAA_DEVELOPER: 'true',
        QAA_LICENSE_DIR: licenseDirectory,
      },
    })
  } finally {
    fs.rmSync(licenseDirectory, { recursive: true, force: true })
  }
}

const fileSafetyRepo = createRepo({ name: 'file-safety-contract' })
const outsideSafetyFile = path.join(
  os.tmpdir(),
  `qaa-outside-${process.pid}-${Date.now()}`
)
try {
  fs.mkdirSync(path.join(fileSafetyRepo, 'not-a-file'))
  assert.throws(
    () =>
      readProjectFile(fileSafetyRepo, path.join(fileSafetyRepo, 'not-a-file')),
    /non-regular project file/
  )
  assert.throws(
    () => writeProjectFile(fileSafetyRepo, outsideSafetyFile, 'escaped'),
    /outside project root/
  )
  assert(!fs.existsSync(outsideSafetyFile))
} finally {
  fs.rmSync(fileSafetyRepo, { recursive: true, force: true })
}

const configOnlyRepo = createRepo({ name: 'config-only-tooling' })
try {
  fs.writeFileSync(
    path.join(configOnlyRepo, 'eslint.config.mjs'),
    'export default []\n'
  )
  fs.writeFileSync(path.join(configOnlyRepo, '.prettierrc.json'), '{}\n')

  const profile = detectProjectProfile(configOnlyRepo)
  assert.strictEqual(profile.eslintDependencies.eslint, false)
  assert.strictEqual(profile.prettierDependency, false)

  runSetup(configOnlyRepo)
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(configOnlyRepo, 'package.json'), 'utf8')
  )
  assert(packageJson.devDependencies.eslint)
  assert(packageJson.devDependencies.prettier)
  assert(!fs.existsSync(path.join(configOnlyRepo, 'eslint.config.cjs')))
  assert(!fs.existsSync(path.join(configOnlyRepo, '.prettierrc')))
} finally {
  fs.rmSync(configOnlyRepo, { recursive: true, force: true })
}

const submoduleRepo = createRepo({
  name: 'owned-quality-lint',
  scripts: {
    lint: 'eslint .',
    'quality:lint': 'consumer-owned-lint',
  },
})
try {
  fs.writeFileSync(
    path.join(submoduleRepo, '.gitmodules'),
    '[submodule "kit"]\n\tpath = .claude-kit\n\turl = https://example.invalid/kit.git\n'
  )
  runSetup(submoduleRepo)
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(submoduleRepo, 'package.json'), 'utf8')
  )
  assert.strictEqual(packageJson.scripts['quality:lint'], 'consumer-owned-lint')
} finally {
  fs.rmSync(submoduleRepo, { recursive: true, force: true })
}

const symlinkRepo = createRepo({ name: 'symlink-escape' })
const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-outside-'))
try {
  const outsideFile = path.join(outsideDirectory, 'prettierignore')
  fs.writeFileSync(outsideFile, 'outside-content\n')
  fs.symlinkSync(outsideFile, path.join(symlinkRepo, '.prettierignore'))

  assert.throws(
    () => runSetup(symlinkRepo),
    error => {
      if (!(error instanceof Error)) return false
      const setupError =
        /** @type {Error & {status?: number, stderr?: Buffer|string}} */ (error)
      return (
        setupError.status !== 0 &&
        `${setupError.stderr}`.includes(
          'Refusing to access symbolic link in project path'
        )
      )
    }
  )
  assert.strictEqual(fs.readFileSync(outsideFile, 'utf8'), 'outside-content\n')
} finally {
  fs.rmSync(symlinkRepo, { recursive: true, force: true })
  fs.rmSync(outsideDirectory, { recursive: true, force: true })
}

console.log('✅ Generator safety contract regression tests passed')
