#!/usr/bin/env node
/**
 * check-stray-files.js — flag untracked files sitting under source directories.
 *
 * Why: diff-scoped CI (lint/scan only changed files) never sees an untracked
 * scratch file (`_debug.js`, `scripts/tmp.py`, `lib/test-scratch.js`). It
 * accumulates, dodges every gate, and one day gets committed by accident. This
 * surfaces those files so they're deleted or committed deliberately.
 *
 * It only considers files git itself reports as untracked AND not ignored
 * (`git ls-files --others --exclude-standard`), so anything in .gitignore
 * (.env.local, build output, editor cruft) is never flagged.
 *
 * Exit codes:
 *   0  no stray files (or --warn mode, always 0)
 *   1  stray files found (default / --strict mode)
 *
 * Usage:
 *   node scripts/check-stray-files.js            # fail on stray source files
 *   node scripts/check-stray-files.js --warn     # report only, never fail
 */

'use strict'

const { spawnSync } = require('child_process')

// Directories whose untracked contents are suspicious. A stray file directly in
// the repo root is usually intentional (configs, READMEs); a stray file buried
// in a source tree is usually scratch work.
const SOURCE_DIRS = ['lib', 'src', 'scripts', 'config', 'app', 'pages', 'tests']

// Extensions that represent actual source/code (not data fixtures or docs).
const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|sh|rb|go|rs)$/

// Filename shapes that scream "scratch": _foo.js, tmp-x.js, foo.scratch.js,
// debug-y.py, foo.bak — flagged anywhere, even at the repo root.
const SCRATCH_NAME =
  /(^|\/)(_|tmp[-_.]|temp[-_.]|scratch[-_.]|debug[-_.])|\.(scratch|bak|tmp|orig)\.|[-_.](scratch|tmpfile)\b/i

function untrackedFiles() {
  const r = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
  if (r.status !== 0 || !r.stdout) return []
  return r.stdout.split('\n').filter(Boolean)
}

function isStray(file) {
  if (SCRATCH_NAME.test(file)) return true
  const top = file.split('/')[0]
  return SOURCE_DIRS.includes(top) && SOURCE_EXT.test(file)
}

function main() {
  const warnOnly = process.argv.includes('--warn')
  const stray = untrackedFiles().filter(isStray)

  if (stray.length === 0) {
    console.log('✅ No stray untracked source files.')
    return 0
  }

  const label = warnOnly ? '⚠️ ' : '❌'
  console.log(
    `${label} ${stray.length} untracked file(s) under source directories:`
  )
  for (const f of stray) console.log(`   ${f}`)
  console.log('')
  console.log(
    '   These slip past diff-scoped CI. Commit them deliberately, delete them,'
  )
  console.log('   or add them to .gitignore if they are meant to stay local.')

  return warnOnly ? 0 : 1
}

if (require.main === module) {
  process.exit(main())
}

module.exports = { isStray, SOURCE_DIRS, SOURCE_EXT, SCRATCH_NAME }
