'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'quality.yml'),
  'utf8'
)

assert(workflow.includes('fetch-depth: 0'))
assert(
  workflow.includes('CLAUDE_KIT_SHA: 54f4b6287a9ecd1b69338651cca9d7593257ba6f')
)
assert(workflow.includes('git show "$BASE_SHA:.buildproven/test-impact.json"'))
assert(workflow.includes('--execute --policy-root "$POLICY_ROOT"'))
assert(workflow.includes('Base test-impact policy is absent'))
assert(workflow.includes("github.repository != 'buildproven/qa-architect'"))

console.log('Affected CI adapter tests passed.')
