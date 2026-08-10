'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const landingPath = path.join(__dirname, '..', 'docs', 'landing', 'index.html')
const html = fs.readFileSync(landingPath, 'utf8')

const ids = new Set(
  [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
)
const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(
  match => match[1]
)

assert.ok(hrefs.length > 0, 'landing page must contain navigation or CTA links')
assert.ok(
  !hrefs.includes('#'),
  'landing page must not ship placeholder anchors'
)

for (const href of hrefs.filter(value => value.startsWith('#'))) {
  assert.ok(ids.has(href.slice(1)), `missing landing-page target for ${href}`)
}

assert.ok(
  hrefs.includes('https://github.com/buildproven/qa-architect#quick-start'),
  'Free audit CTA must link to the documented Quick Start'
)
assert.ok(
  hrefs.includes('https://buildproven.ai/qa-architect'),
  'Pro CTA must link to the canonical product page'
)
assert.match(
  html,
  /Unlimited audit · 1 private repo · 50 pre-push runs \/ month/,
  'Free pricing must state the audit and quality-automation boundary'
)
assert.match(
  html,
  /Revision-bound PR-to-release assurance:\s*PASS, BLOCK, or\s*INCOMPLETE/,
  'Pro pricing must state the release-assurance outcome'
)
assert.ok(!html.includes('$49') && !html.includes('$490'))

console.log(
  '✅ Landing page contract passed (links, pricing, and tier boundary)'
)
