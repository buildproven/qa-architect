/**
 * Every generated Dependabot update entry groups security updates.
 * Without `applies-to: security-updates`, groups cover version updates only and
 * security updates ignore open-pull-requests-limit, so enabling automated
 * security fixes opens one PR per advisory.
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const yaml = require('js-yaml')
const {
  generateBasicDependabotConfig,
  writeBasicDependabotConfig,
} = require('../lib/dependency-monitoring-basic')
const {
  generatePremiumDependabotConfig,
  writePremiumDependabotConfig,
} = require('../lib/dependency-monitoring-premium')

const { convertToYaml } = require('../lib/yaml-utils')

const SECURITY_GROUP = { 'applies-to': 'security-updates', patterns: ['*'] }

// A value starting with a YAML indicator (`*` alias, `&` anchor, `!` tag, ...)
// must be quoted, or the written file is invalid or changes meaning.
console.log('🧪 Testing dependabot-security-groups.test.js...')

const indicators = ['*', '&a', '!tag', '%x', ',x', '?x', "'x", '"x']
let roundTrip
try {
  roundTrip = yaml.load(convertToYaml({ values: indicators })).values
} catch (error) {
  assert.fail(
    `convertToYaml wrote YAML that does not parse: ${error.reason || error.message}`
  )
}
assert.deepStrictEqual(
  roundTrip,
  indicators,
  'convertToYaml did not quote a leading YAML indicator'
)

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-dependabot-sec-'))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

function assertEveryEntryGroupsSecurity(config, label) {
  assert.ok(config.updates.length > 0, `${label}: no update entries`)
  for (const entry of config.updates) {
    assert.deepStrictEqual(
      entry.groups && entry.groups['security-updates'],
      SECURITY_GROUP,
      `${label}: ${entry['package-ecosystem']} ${entry.directory} has no security-updates group`
    )
  }
}

const npmPkg = JSON.stringify({
  name: 'x',
  dependencies: { react: '^19.0.0' },
  devDependencies: { vitest: '^4.1.12' },
})

const dirs = []
try {
  // Basic tier: generated object and written YAML.
  const basicDir = project({ 'package.json': npmPkg })
  dirs.push(basicDir)
  const basic = generateBasicDependabotConfig({ projectPath: basicDir })
  assertEveryEntryGroupsSecurity(basic, 'basic')
  const basicOut = path.join(basicDir, '.github', 'dependabot.yml')
  writeBasicDependabotConfig(basic, basicOut)
  assertEveryEntryGroupsSecurity(
    yaml.load(fs.readFileSync(basicOut, 'utf8')),
    'basic written'
  )

  // Premium tier: multi-ecosystem project keeps its framework groups too.
  const premiumDir = project({
    'package.json': npmPkg,
    'requirements.txt': 'requests==2.32.4\n',
  })
  dirs.push(premiumDir)
  const premium = generatePremiumDependabotConfig({ projectPath: premiumDir })
  assertEveryEntryGroupsSecurity(premium.config, 'premium')
  const npmEntry = premium.config.updates.find(
    u => u['package-ecosystem'] === 'npm'
  )
  assert.ok(
    Object.keys(npmEntry.groups).length > 1,
    'premium: framework groups were replaced instead of extended'
  )
  const premiumOut = path.join(premiumDir, '.github', 'dependabot.yml')
  writePremiumDependabotConfig(premium, premiumOut)
  assertEveryEntryGroupsSecurity(
    yaml.load(fs.readFileSync(premiumOut, 'utf8')),
    'premium written'
  )

  console.log('✅ Dependabot security-update groups tests passed')
} finally {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
}
