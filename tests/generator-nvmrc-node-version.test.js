'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { initializeFixtureRepository } = require('./git-fixture-helpers')

const setupPath = path.join(__dirname, '..', 'setup.js')

function createRepo(packageJson) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-nvmrc-'))
  initializeFixtureRepository(directory)
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
  return directory
}

function generateWorkflow(directory) {
  const licenseDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-nvmrc-license-')
  )
  try {
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
  } finally {
    fs.rmSync(licenseDirectory, { recursive: true, force: true })
  }
  return fs.readFileSync(
    path.join(directory, '.github/workflows/quality.yml'),
    'utf8'
  )
}

// A consumer's .nvmrc is the Node version source of truth: the generated
// workflow must not pin Node 20 and must follow .nvmrc in setup-node steps.
{
  console.log('Generator: node-version follows .nvmrc')
  const repo = createRepo({ name: 'node-version-nvmrc' })
  try {
    fs.writeFileSync(path.join(repo, '.nvmrc'), '24.18.0\n')
    const workflow = generateWorkflow(repo)
    assert(
      !workflow.includes("node-version: '20'"),
      'workflow must not hardcode node-version: 20 when .nvmrc is present'
    )
    assert(
      workflow.includes("node-version-file: '.nvmrc'"),
      'workflow must use node-version-file: .nvmrc'
    )
    assert(
      workflow.includes('node-version: [24.18.0]'),
      'test matrix must default to the .nvmrc version'
    )
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
  console.log('✅ node-version follows .nvmrc')
}
