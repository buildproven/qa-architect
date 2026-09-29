'use strict'

// BUI-988: the claude-setup repo was archived. Shipped scripts must not probe
// its paths (they silently do nothing) or advertise it as a config location.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const scriptsDir = path.join(__dirname, '..', 'scripts')
const offenders = fs
  .readdirSync(scriptsDir)
  .filter(name => name.endsWith('.sh'))
  .filter(name =>
    /claude-setup/.test(fs.readFileSync(path.join(scriptsDir, name), 'utf8'))
  )

assert.deepStrictEqual(
  offenders,
  [],
  `scripts must not reference the retired claude-setup repo: ${offenders.join(', ')}`
)

console.log('✅ shipped scripts reference no retired repos')
