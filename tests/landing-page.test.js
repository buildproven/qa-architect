'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const landingPath = path.join(__dirname, '..', 'docs', 'landing', 'index.html')
const html = fs.readFileSync(landingPath, 'utf8')
const PRO_LAUNCH_LIST =
  'mailto:support@buildproven.ai?subject=QA%20Architect%20Pro%20launch%20list'

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
  hrefs.includes(PRO_LAUNCH_LIST),
  'Pro CTA must join the launch list while checkout is closed'
)
assert.ok(
  !hrefs.includes('https://buildproven.ai/qa-architect'),
  'Pro CTA must not link back to its own product page'
)
assert.match(
  html,
  /Paid checkout is not open\./,
  'Pro offer must disclose that paid checkout is closed'
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
assert.match(
  html,
  /Every release gets a receipt\./,
  'Landing hero must lead with the named product artifact'
)
assert.match(
  html,
  /Example Release Receipt/,
  'Landing page must show a concrete Pro assurance artifact'
)
assert.match(
  html,
  /small AI-development agencies and product studios/,
  'Landing page must explain who should pay'
)
assert.match(
  html,
  /four-week Merge Assurance pilot/,
  'Landing page must expose the bounded team pilot without presenting it as a validated subscription'
)
assert.match(
  html,
  /A PASS means the configured checks and evidence are complete\./,
  'Landing page must state the assurance boundary'
)
assert.match(
  html,
  /AI SaaS Authorization Pack/,
  'Landing page must name the flagship runtime evidence pack'
)
assert.match(
  html,
  /A freshness check does not authenticate the receipt producer or\s*prove\s*trusted execution\./,
  'Landing page must not overstate the self-hashed receipt trust boundary'
)
assert.ok(!html.includes('$49') && !html.includes('$490'))

const beehiivPath = path.join(
  __dirname,
  '..',
  'docs',
  'landing',
  'beehiiv.html'
)
const beehiivHtml = fs.readFileSync(beehiivPath, 'utf8')
const beehiivIds = new Set(
  [...beehiivHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
)
const beehiivHrefs = [
  ...beehiivHtml.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g),
].map(match => match[1])

assert.ok(beehiivHrefs.length > 0, 'Beehiiv page must contain CTA links')
assert.ok(
  !beehiivHrefs.includes('#'),
  'Beehiiv page must not ship placeholder anchors'
)
for (const href of beehiivHrefs.filter(value => value.startsWith('#'))) {
  assert.ok(
    beehiivIds.has(href.slice(1)),
    `missing Beehiiv page target for ${href}`
  )
}
assert.ok(
  beehiivHrefs.includes(
    'https://github.com/buildproven/qa-architect#quick-start'
  ),
  'Beehiiv Free CTA must link to the documented Quick Start'
)
assert.ok(
  beehiivHrefs.includes(PRO_LAUNCH_LIST),
  'Beehiiv Pro CTA must join the launch list while checkout is closed'
)
assert.ok(
  !beehiivHrefs.includes('https://buildproven.ai/qa-architect#pro'),
  'Beehiiv Pro CTA must not link back to its own offer'
)
assert.match(
  beehiivHtml,
  /Paid checkout is not open\./,
  'Beehiiv Pro offer must disclose that paid checkout is closed'
)
assert.match(
  beehiivHtml,
  /Every release gets a receipt\./,
  'Beehiiv page must state the Free/Pro sales boundary'
)
assert.match(
  beehiivHtml,
  /PASS[\s\S]*BLOCK[\s\S]*INCOMPLETE/,
  'Beehiiv page must explain release-assurance outcomes'
)
assert.match(
  beehiivHtml,
  /Need a guided rollout across several repositories\?/,
  'Beehiiv page must expose the bounded team pilot'
)
assert.match(
  beehiivHtml,
  /A PASS means the configured checks and evidence are complete\./,
  'Beehiiv page must state the assurance boundary'
)
assert.match(
  beehiivHtml,
  /A freshness check does not authenticate the receipt producer or\s*prove\s*trusted execution\./,
  'Beehiiv page must state the receipt trust boundary'
)
assert.ok(!beehiivHtml.includes('$49') && !beehiivHtml.includes('$490'))

console.log(
  '✅ Landing page contract passed (marketing and Beehiiv links, pricing, and tier boundary)'
)
