'use strict'

const assert = require('assert')
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
assert.match(
  releaseWorkflow,
  /name: Verify tag matches package version[\s\S]*TAG_NAME: \$\{\{ github\.ref_name \}\}[\s\S]*expected="v\$\(node -p \\"require\('\.\/package\.json'\)\.version\\"\)"/,
  'release workflow must reject tags that do not match package.json'
)
assert.match(
  releaseWorkflow,
  /name: Run pre-release checks[\s\S]*run: npm run prerelease/,
  'release workflow must run the complete prerelease script before publishing'
)

console.log('✅ Release workflow safety gates verified')
