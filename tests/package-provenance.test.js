#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const AjvImport = require('ajv')
const addFormatsImport = require('ajv-formats')

const Ajv = /** @type {any} */ (AjvImport.default || AjvImport)
const addFormats = /** @type {(ajv: any) => void} */ (
  addFormatsImport.default || addFormatsImport
)

const {
  PUBLIC_NPM_REGISTRY,
  analyzePackageProvenance,
  classifyDependency,
  lookupPublicPackage,
  readNpmRegistryConfig,
  readYarnRegistryConfig,
  redactDependencySpec,
  resolveNpmRegistryConfig,
  resolveRegistryConfig,
} = require('../lib/package-provenance')
const { buildAuditJson, buildAuditSarif } = require('../lib/commands/audit')

const now = new Date('2026-08-05T12:00:00.000Z')
let passed = 0
let failed = 0
const cases = []

function test(name, fn) {
  cases.push({ name, fn })
}

function tempProject(pkg, npmrc = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-provenance-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  if (npmrc !== null) fs.writeFileSync(path.join(dir, '.npmrc'), npmrc)
  return dir
}

function response(state, overrides = {}) {
  return {
    state,
    registry: PUBLIC_NPM_REGISTRY,
    lookedUpAt: now.toISOString(),
    statusCode: state === 'registry-not-found' ? 404 : 200,
    metadataState: 'parsed',
    createdAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

console.log('\nPackage provenance')

test('classifies aliases, local sources, VCS, and private registries', () => {
  const dir = tempProject(
    {},
    '@internal:registry=https://npm.example.com/repository/npm/\n'
  )
  try {
    const config = readNpmRegistryConfig(dir)
    assert.strictEqual(
      classifyDependency('alias', 'npm:@scope/real@^2', config).resolvedName,
      '@scope/real'
    )
    assert.strictEqual(
      classifyDependency('@internal/api', '^1', config).kind,
      'non-public-registry'
    )
    assert.strictEqual(
      classifyDependency('workspace-lib', 'workspace:*', config).kind,
      'local'
    )
    assert.strictEqual(
      classifyDependency(
        'git-lib',
        'git+https://github.com/acme/lib.git',
        config
      ).kind,
      'vcs'
    )
    assert.strictEqual(
      classifyDependency('ssh-lib', 'git@github.com:acme/lib.git', config).kind,
      'vcs'
    )
    assert.strictEqual(
      classifyDependency('folder-lib', '../local-package', config).kind,
      'local'
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('honors user and environment registry precedence without public lookups', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-provenance-home-'))
  const userConfig = path.join(home, '.npmrc')
  fs.writeFileSync(
    userConfig,
    '@internal:registry=https://npm.internal.example.com/\n'
  )
  const userProject = tempProject({
    dependencies: { '@internal/api': '^1' },
  })
  const envProject = tempProject({ dependencies: { external: '^1' } })
  let lookups = 0
  try {
    const userEnv = /** @type {NodeJS.ProcessEnv} */ ({
      ...process.env,
      HOME: home,
      npm_config_userconfig: userConfig,
    })
    delete userEnv.NPM_CONFIG_REGISTRY
    delete userEnv.npm_config_registry
    const userRegistry = resolveNpmRegistryConfig(
      userProject,
      ['@internal/api'],
      { env: userEnv }
    )
    assert.strictEqual(
      userRegistry.scopes['@internal'],
      'https://npm.internal.example.com/'
    )
    const userResult = await analyzePackageProvenance(userProject, {
      now,
      registryConfig: userRegistry,
      lookup: async () => {
        lookups++
        return response('registry-present')
      },
    })
    assert.strictEqual(
      userResult.packages[0].state,
      'allowed-non-public-registry'
    )

    const envRegistry = resolveNpmRegistryConfig(envProject, ['external'], {
      env: {
        ...process.env,
        npm_config_registry: 'https://npm.proxy.example.com/',
        npm_config_userconfig: path.join(home, 'missing-npmrc'),
      },
    })
    assert.strictEqual(
      envRegistry.defaultRegistry,
      'https://npm.proxy.example.com/'
    )
    const envResult = await analyzePackageProvenance(envProject, {
      now,
      registryConfig: envRegistry,
      lookup: async () => {
        lookups++
        return response('registry-present')
      },
    })
    assert.strictEqual(
      envResult.packages[0].state,
      'allowed-non-public-registry'
    )
    assert.strictEqual(lookups, 0)
    assert.ok(userResult.coverage.limitations.length > 0)
    assert.ok(envResult.coverage.limitations.length > 0)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(userProject, { recursive: true, force: true })
    fs.rmSync(envProject, { recursive: true, force: true })
  }
})

test('honors Yarn classic and modern registry configuration', () => {
  const modern = tempProject({
    packageManager: 'yarn@4.9.2',
    dependencies: { '@internal/api': '^1' },
  })
  const classic = tempProject({ dependencies: { '@legacy/api': '^1' } })
  try {
    fs.writeFileSync(path.join(modern, 'yarn.lock'), '')
    fs.writeFileSync(
      path.join(modern, '.yarnrc.yml'),
      [
        'npmRegistryServer: "https://npm.proxy.example.com"',
        'npmScopes:',
        '  internal:',
        '    npmRegistryServer: "https://npm.internal.example.com"',
        '',
      ].join('\n')
    )
    assert.deepStrictEqual(readYarnRegistryConfig(modern), {
      defaultRegistry: 'https://npm.proxy.example.com/',
      scopes: { '@internal': 'https://npm.internal.example.com/' },
    })
    assert.strictEqual(
      resolveRegistryConfig(modern, ['@internal/api']).scopes['@internal'],
      'https://npm.internal.example.com/'
    )

    fs.writeFileSync(path.join(classic, 'yarn.lock'), '')
    fs.writeFileSync(
      path.join(classic, '.yarnrc'),
      'registry "https://registry.example.com"\n"@legacy:registry" "https://legacy.example.com"\n'
    )
    assert.deepStrictEqual(readYarnRegistryConfig(classic), {
      defaultRegistry: 'https://registry.example.com/',
      scopes: { '@legacy': 'https://legacy.example.com/' },
    })
  } finally {
    fs.rmSync(modern, { recursive: true, force: true })
    fs.rmSync(classic, { recursive: true, force: true })
  }
})

test('requests full npm metadata only for advanced provenance', async () => {
  const accepts = []
  const get = (_url, requestOptions, callback) => {
    accepts.push(requestOptions.headers.Accept)
    const request = Object.assign(new EventEmitter(), { destroy() {} })
    process.nextTick(() => {
      const responseStream = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: {},
        resume() {},
      })
      callback(responseStream)
      responseStream.emit(
        'data',
        Buffer.from('{"time":{"created":"2026-08-01T00:00:00.000Z"}}')
      )
      responseStream.emit('end')
    })
    return request
  }
  const basic = await lookupPublicPackage('basic', { now, get })
  const advanced = await lookupPublicPackage('advanced', {
    now,
    get,
    advanced: true,
  })
  assert.deepStrictEqual(accepts, [
    'application/vnd.npm.install-v1+json',
    'application/json',
  ])
  assert.strictEqual(basic.metadataState, 'parsed')
  assert.strictEqual(advanced.createdAt, '2026-08-01T00:00:00.000Z')
})

test('redacts credential-bearing specs and safely normalizes invalid values', async () => {
  const dir = tempProject({
    dependencies: {
      vcs: 'git+https://user:token@example.com/repo.git',
      artifact: 'https://example.com/pkg.tgz?token=secret&signature=signed',
      malformed: 123,
    },
  })
  try {
    const result = await analyzePackageProvenance(dir, {
      now,
      registryConfig: { defaultRegistry: PUBLIC_NPM_REGISTRY, scopes: {} },
    })
    const serialized = JSON.stringify(result)
    assert.ok(!serialized.includes('token@example.com'))
    assert.ok(!serialized.includes('token=secret'))
    assert.ok(!serialized.includes('signature=signed'))
    assert.ok(serialized.includes('REDACTED'))
    assert.strictEqual(
      result.packages.find(item => item.name === 'malformed').declaredSpec,
      '[invalid number]'
    )
    assert.strictEqual(redactDependencySpec(null), '[invalid null]')

    const schema = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'config',
          'package-provenance-v1.schema.json'
        ),
        'utf8'
      )
    )
    const ajv = new Ajv({ allErrors: true, strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    assert.strictEqual(validate(result), true, ajv.errorsText(validate.errors))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('analyzes every direct production dependency without a first-50 cap', async () => {
  const dependencies = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`package-${index}`, '^1.0.0'])
  )
  const dir = tempProject({
    dependencies,
    devDependencies: { 'dev-only': '^1.0.0' },
  })
  const lookedUp = []
  try {
    const result = await analyzePackageProvenance(dir, {
      now,
      lookup: async name => {
        lookedUp.push(name)
        return response('registry-present')
      },
    })
    assert.strictEqual(lookedUp.length, 65)
    assert.strictEqual(result.packages.length, 65)
    assert.strictEqual(result.coverage.eligible, 65)
    assert.strictEqual(result.coverage.completed, 65)
    assert.strictEqual(result.coverage.completion, 'complete')
    assert.ok(!result.packages.some(item => item.name === 'dev-only'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('preserves 404, timeout, rate-limit, private, local, alias, and git states', async () => {
  const dir = tempProject(
    {
      dependencies: {
        missing: '^1',
        timeout: '^1',
        limited: '^1',
        auth: '^1',
        unavailable: '^1',
        malformed: '^1',
        alias: 'npm:real-package@^2',
        '@internal/api': '^1',
        '@unresolved/api': '^1',
        local: 'file:../local',
        workspace: 'workspace:*',
        git: 'github:acme/repository',
      },
    },
    '@internal:registry=https://npm.example.com/\n@unresolved:registry=${PRIVATE_REGISTRY}\n'
  )
  try {
    const result = await analyzePackageProvenance(dir, {
      now,
      lookup: async name => {
        if (name === 'missing') return response('registry-not-found')
        if (name === 'timeout') {
          return response('registry-timeout', {
            statusCode: null,
            failure: 'timeout',
          })
        }
        if (name === 'limited') {
          return response('registry-rate-limited', {
            statusCode: 429,
            retryAfter: '60',
          })
        }
        if (name === 'auth') {
          return response('registry-auth-required', { statusCode: 401 })
        }
        if (name === 'unavailable') {
          return response('registry-unavailable', {
            statusCode: 503,
            failure: 'upstream unavailable',
          })
        }
        if (name === 'malformed') {
          return response('registry-present', {
            metadataState: 'malformed',
            createdAt: null,
          })
        }
        return response('registry-present')
      },
    })
    const states = Object.fromEntries(
      result.packages.map(item => [item.name, item.state])
    )
    assert.deepStrictEqual(states, {
      '@internal/api': 'allowed-non-public-registry',
      '@unresolved/api': 'registry-config-unresolved',
      alias: 'registry-present',
      auth: 'registry-auth-required',
      git: 'allowed-vcs-source',
      limited: 'registry-rate-limited',
      local: 'allowed-local-source',
      malformed: 'registry-present',
      missing: 'registry-not-found',
      timeout: 'registry-timeout',
      unavailable: 'registry-unavailable',
      workspace: 'allowed-local-source',
    })
    assert.strictEqual(result.coverage.completion, 'partial')
    assert.strictEqual(result.coverage.eligible, 12)
    assert.strictEqual(result.coverage.attempted, 7)
    assert.strictEqual(result.coverage.completed, 2)
    assert.strictEqual(result.coverage.excluded, 4)
    assert.ok(
      result.coverage.attempted + result.coverage.excluded <=
        result.coverage.eligible
    )
    assert.strictEqual(
      result.packages.find(item => item.name === 'malformed').metadataState,
      'malformed'
    )
    assert.ok(
      result.coverage.limitations.some(limitation =>
        limitation.includes('otherwise incomplete')
      )
    )
    const missingFinding = result.findings.find(
      finding => finding.evidence.classification === 'registry-not-found'
    )
    assert.strictEqual(missingFinding.severity, 'medium')
    assert.ok(
      !/possible hallucinated|slopsquatting risk/i.test(missingFinding.message)
    )
    assert.ok(/does not by itself establish/i.test(missingFinding.message))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('package age remains a labeled low-confidence Pro heuristic', async () => {
  const dir = tempProject({ dependencies: { newborn: '^1' } })
  try {
    const basic = await analyzePackageProvenance(dir, {
      now,
      lookup: async () =>
        response('registry-present', {
          createdAt: '2026-08-01T00:00:00.000Z',
        }),
    })
    assert.strictEqual(basic.findings.length, 0)
    assert.strictEqual(basic.packages[0].state, 'registry-present')

    const advanced = await analyzePackageProvenance(dir, {
      now,
      advanced: true,
      lookup: async () =>
        response('registry-present', {
          createdAt: '2026-08-01T00:00:00.000Z',
        }),
    })
    assert.strictEqual(advanced.packages[0].state, 'registry-present')
    assert.strictEqual(
      advanced.packages[0].signals[0].kind,
      'low-provenance-new-package'
    )
    assert.strictEqual(advanced.findings[0].confidence, 'low')
    assert.ok(/not proof/i.test(advanced.findings[0].message))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('name confusion is a separate low-confidence signal, not a registry fact', async () => {
  const dir = tempProject({ dependencies: { axioz: '^1' } })
  try {
    const result = await analyzePackageProvenance(dir, {
      now,
      advanced: true,
      lookup: async () => response('registry-not-found'),
    })
    assert.strictEqual(result.packages[0].state, 'registry-not-found')
    assert.deepStrictEqual(result.packages[0].signals, [
      {
        kind: 'name-confusion-candidate',
        confidence: 'low',
        comparedTo: 'axios',
        policyVersion: 'builtin-protected-names-v1',
      },
    ])
    assert.ok(
      result.findings.some(
        finding =>
          finding.source === 'package-provenance-heuristic' &&
          finding.confidence === 'low' &&
          finding.evidence.registryState === 'registry-not-found'
      )
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('SARIF keeps provenance facts, heuristics, confidence, and coverage', async () => {
  const dir = tempProject({ dependencies: { missing: '^1' } })
  try {
    const packageProvenance = await analyzePackageProvenance(dir, {
      now,
      lookup: async () => response('registry-not-found'),
    })
    const sarif = buildAuditSarif({
      findings: packageProvenance.findings,
      packageProvenance,
    })
    assert.strictEqual(sarif.version, '2.1.0')
    assert.strictEqual(
      sarif.runs[0].results[0].properties.evidence.classification,
      'registry-not-found'
    )
    assert.strictEqual(sarif.runs[0].results[0].properties.confidence, 'high')
    assert.strictEqual(
      sarif.runs[0].properties.packageProvenance.coverage.completed,
      1
    )
    const json = buildAuditJson({
      findings: packageProvenance.findings,
      packageProvenance,
    })
    assert.strictEqual(json.summary.medium, 1)
    assert.strictEqual(
      json.packageProvenance.packages[0].state,
      'registry-not-found'
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('provenance results conform to the shipped strict JSON schema', async () => {
  const dir = tempProject({ dependencies: { axioz: '^1' } })
  try {
    const result = await analyzePackageProvenance(dir, {
      now,
      advanced: true,
      lookup: async () => response('registry-not-found'),
    })
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          '..',
          'config',
          'package-provenance-v1.schema.json'
        ),
        'utf8'
      )
    )
    const ajv = new Ajv({ allErrors: true, strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    assert.strictEqual(validate(result), true, ajv.errorsText(validate.errors))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function main() {
  for (const item of cases) {
    try {
      await item.fn()
      console.log(`  ✅ ${item.name}`)
      passed++
    } catch (error) {
      console.error(`  ❌ ${item.name}`)
      console.error(`     ${error.stack || error.message}`)
      failed++
    }
  }
  if (failed > 0) {
    console.error(
      `\n${passed} passed, ${failed} failed (package-provenance.test.js)`
    )
    process.exit(1)
  }
  console.log(`\n${passed} passed, 0 failed (package-provenance.test.js)`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
