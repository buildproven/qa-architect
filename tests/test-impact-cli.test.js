'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-impact-cli-'))
const license = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-impact-license-'))
const setup = path.join(__dirname, '..', 'setup.js')
const env = {
  ...process.env,
  NODE_ENV: 'test',
  QAA_DEVELOPER: 'true',
  QAA_LICENSE_DIR: license,
}

try {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      packageManager: 'npm@11.5.2',
      scripts: { test: 'vitest run' },
      devDependencies: { vitest: '^3.0.0' },
    })}\n`
  )
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n')

  const dryRun = JSON.parse(
    execFileSync(process.execPath, [setup, '--test-impact-plan', '--json'], {
      cwd: root,
      env,
      encoding: 'utf8',
    })
  )
  assert.strictEqual(dryRun.status, 'ready')
  assert.strictEqual(dryRun.mode, 'dry-run')
  assert(!fs.existsSync(path.join(root, '.buildproven')))

  const written = JSON.parse(
    execFileSync(
      process.execPath,
      [setup, '--write-test-impact', '--runtime-sha', 'b'.repeat(40), '--json'],
      { cwd: root, env, encoding: 'utf8' }
    )
  )
  assert.strictEqual(written.mode, 'write')
  assert.strictEqual(written.files.length, 2)
  assert(fs.existsSync(path.join(root, '.buildproven/test-impact.json')))
  assert(fs.existsSync(path.join(root, '.github/workflows/test-impact.yml')))

  const updated = JSON.parse(
    execFileSync(
      process.execPath,
      [
        setup,
        '--update-test-impact',
        '--runtime-sha',
        'd'.repeat(40),
        '--json',
      ],
      { cwd: root, env, encoding: 'utf8' }
    )
  )
  assert.strictEqual(updated.mode, 'update')
  assert(
    fs
      .readFileSync(
        path.join(root, '.github/workflows/test-impact.yml'),
        'utf8'
      )
      .includes(`ref: ${'d'.repeat(40)}`)
  )
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(license, { recursive: true, force: true })
}

const unsafe = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-impact-unsafe-'))
const unsafeLicense = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qaa-impact-unsafe-license-')
)
try {
  fs.writeFileSync(
    path.join(unsafe, 'package.json'),
    `${JSON.stringify({
      name: 'unsafe-fixture',
      version: '1.0.0',
      packageManager: 'npm@11.5.2',
      scripts: { test: 'custom-test-runner' },
    })}\n`
  )
  const result = spawnSync(
    process.execPath,
    [setup, '--write-test-impact', '--runtime-sha', 'c'.repeat(40), '--json'],
    {
      cwd: unsafe,
      env: { ...env, QAA_LICENSE_DIR: unsafeLicense },
      encoding: 'utf8',
    }
  )
  assert.strictEqual(result.status, 2)
  assert.strictEqual(JSON.parse(result.stdout).status, 'mapping-required')
  assert(!fs.existsSync(path.join(unsafe, '.buildproven')))
  assert(!fs.existsSync(path.join(unsafe, '.github')))
} finally {
  fs.rmSync(unsafe, { recursive: true, force: true })
  fs.rmSync(unsafeLicense, { recursive: true, force: true })
}

console.log('Test-impact CLI tests passed.')
