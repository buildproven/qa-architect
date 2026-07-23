'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const packageJson = require('../package.json')
const releaseWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/release.yml'),
  'utf8'
)

console.log('\nrelease workflow — publish safety gates')

assert.match(
  packageJson.scripts.prerelease,
  /npm run security:audit/,
  'prerelease must fail on high or critical dependency vulnerabilities'
)
assert.match(
  packageJson.scripts.prerelease,
  /npm run format:check && npm run lint && npm run type-check:all/,
  'prerelease must include formatting, linting, and type checks'
)
const tagVerificationStart = releaseWorkflow.indexOf(
  '      - name: Verify tag matches package version'
)
const tagVerificationEnd = releaseWorkflow.indexOf(
  '\n      - name:',
  tagVerificationStart + 1
)
assert.ok(
  tagVerificationStart >= 0 && tagVerificationEnd >= 0,
  'release workflow must define tag verification'
)

const tagVerificationBlock = releaseWorkflow.slice(
  tagVerificationStart,
  tagVerificationEnd
)
assert.ok(
  tagVerificationBlock.includes('TAG_NAME: ${{ github.ref_name }}') &&
    tagVerificationBlock.includes(
      `expected="v$(node -p 'require("./package.json").version')"`
    ),
  'release workflow must reject tags that do not match package.json'
)

const runMarker = '        run: |\n'
const scriptStart = tagVerificationBlock.indexOf(runMarker) + runMarker.length
const tagVerificationScript = tagVerificationBlock
  .slice(scriptStart)
  .replace(/^ {10}/gm, '')
const tagVerification = spawnSync('bash', ['-n'], {
  cwd: repoRoot,
  input: tagVerificationScript,
  encoding: 'utf8',
})
assert.strictEqual(
  tagVerification.status,
  0,
  `tag verification must be valid Bash: ${tagVerification.stderr}`
)

const matchingTag = spawnSync('bash', ['-c', tagVerificationScript], {
  cwd: repoRoot,
  env: { ...process.env, TAG_NAME: `v${packageJson.version}` },
  encoding: 'utf8',
})
assert.strictEqual(
  matchingTag.status,
  0,
  `matching tag must pass verification: ${matchingTag.stderr}`
)
assert.match(
  releaseWorkflow,
  /name: Run pre-release checks[\s\S]*run: npm run prerelease/,
  'release workflow must run the complete prerelease script before publishing'
)

console.log('✅ Release workflow safety gates verified')
