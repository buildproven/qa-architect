'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const setupPath = path.join(__dirname, '..', 'setup.js')

function snapshotTopLevelFiles(directory) {
  return Object.fromEntries(
    fs
      .readdirSync(directory)
      .filter(name => name !== '.git')
      .sort()
      .map(name => {
        const target = path.join(directory, name)
        const stats = fs.statSync(target)
        return [
          name,
          stats.isFile()
            ? { type: 'file', content: fs.readFileSync(target, 'utf8') }
            : { type: 'directory' },
        ]
      })
  )
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-ts-atomicity-'))
const licenseDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qaa-ts-atomicity-license-')
)

try {
  execFileSync('git', ['init', '-q'], { cwd: project })
  fs.writeFileSync(
    path.join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'typescript-config-preflight-failure',
        scripts: { lint: 'eslint .' },
        devDependencies: { typescript: '^5.0.0', eslint: '^9.0.0' },
      },
      null,
      2
    )}\n`
  )
  fs.writeFileSync(path.join(project, 'package-lock.json'), '{}\n')
  fs.writeFileSync(path.join(project, 'tsconfig.json'), '{}\n')
  fs.writeFileSync(
    path.join(project, 'tests'),
    'consumer-owned file blocking the tests directory\n'
  )

  const before = snapshotTopLevelFiles(project)
  const callerGitDirectory = execFileSync(
    'git',
    ['rev-parse', '--absolute-git-dir'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }
  ).trim()
  const result = spawnSync(
    process.execPath,
    [setupPath, '--workflow-minimal'],
    {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        QAA_DEVELOPER: 'true',
        QAA_LICENSE_DIR: licenseDirectory,
        // Git hooks export their caller's index. Project detection must ignore
        // it and inspect the target repository's own index.
        GIT_INDEX_FILE: path.join(callerGitDirectory, 'index'),
      },
    }
  )

  assert.notStrictEqual(
    result.status,
    0,
    'Setup must fail when the required test TypeScript config cannot be created'
  )
  assert.match(
    `${result.stdout}${result.stderr}`,
    /tests is not a directory/,
    'Failure should identify the test-config prerequisite'
  )
  assert.deepStrictEqual(
    snapshotTopLevelFiles(project),
    before,
    'A failed test-config prerequisite must leave all consumer originals unchanged'
  )
  console.log('✅ TypeScript config preflight failure is atomic')
} finally {
  fs.rmSync(project, { recursive: true, force: true })
  fs.rmSync(licenseDirectory, { recursive: true, force: true })
}
