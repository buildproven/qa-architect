'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const hook = fs.readFileSync(
  path.join(__dirname, '..', '.husky', 'pre-push'),
  'utf8'
)

assert(hook.startsWith('#!/bin/sh\nset -eu'))
assert(!hook.includes('< <('))
assert(hook.includes('git diff --quiet'))
assert(hook.includes('npm audit --audit-level=high --omit=dev'))
assert(hook.includes('npm run lint --silent'))
assert(hook.includes('npm run format:check --silent'))
assert(hook.includes('gitleaks detect --no-git'))
assert(hook.includes('if ! command -v gitleaks'))
assert(hook.includes('exit 1'))
assert(hook.includes('pnpm audit --audit-level high --prod'))
assert(hook.includes('yarn audit --level high --groups dependencies'))
assert(hook.includes('bun audit --audit-level high'))
assert(!hook.includes('smart-test-strategy.sh'))
assert(!hook.includes('npm test'))
assert(!hook.includes('test:medium'))
assert(!hook.includes('test:unit'))
assert(!hook.includes('run-semgrep.sh'))

console.log('Pre-push efficiency tests passed.')
