'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const hook = fs.readFileSync(
  path.join(__dirname, '..', '.husky', 'pre-push'),
  'utf8'
)

assert(hook.includes('set -euo pipefail'))
assert(hook.includes('git diff --quiet'))
assert(hook.includes('npm audit --audit-level=high --omit=dev'))
assert(!hook.includes('smart-test-strategy.sh'))
assert(!hook.includes('npm test'))
assert(!hook.includes('test:medium'))
assert(!hook.includes('test:unit'))
assert(!hook.includes('run-semgrep.sh'))

console.log('Pre-push efficiency tests passed.')
