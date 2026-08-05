'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawnSync } = require('child_process')

const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const DEFAULT_CONCURRENCY = 8
const NEW_PACKAGE_DAYS = 30
const COMMON_PACKAGE_NAMES = Object.freeze([
  'axios',
  'commander',
  'dotenv',
  'express',
  'lodash',
  'next',
  'react',
  'typescript',
  'vite',
  'vitest',
  'zod',
])

function normalizeRegistry(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    return url.toString()
  } catch {
    return null
  }
}

function readNpmRegistryConfig(projectPath) {
  const config = { defaultRegistry: PUBLIC_NPM_REGISTRY, scopes: {} }
  const npmrcPath = path.join(projectPath, '.npmrc')
  if (!fs.existsSync(npmrcPath)) return config

  const source = fs.readFileSync(npmrcPath, 'utf8')
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (/\$\{[^}]+\}/.test(value)) {
      if (key === 'registry') config.defaultRegistry = null
      else if (/^@[^:]+:registry$/.test(key)) {
        config.scopes[key.slice(0, key.indexOf(':'))] = null
      }
      continue
    }
    const registry = normalizeRegistry(value)
    if (key === 'registry') config.defaultRegistry = registry
    else if (/^@[^:]+:registry$/.test(key)) {
      config.scopes[key.slice(0, key.indexOf(':'))] = registry
    }
  }
  return config
}

function npmConfigRegistry(projectPath, key, options = {}) {
  const run = options.spawnSync || spawnSync
  const result = run(options.npmCommand || 'npm', ['config', 'get', key], {
    cwd: projectPath,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 8000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) return { state: 'unresolved' }

  const value = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  if (!value || value === 'undefined' || value === 'null') {
    return { state: 'unset' }
  }
  const registry = normalizeRegistry(value)
  return registry ? { state: 'resolved', registry } : { state: 'unresolved' }
}

function resolveNpmRegistryConfig(projectPath, packageNames, options = {}) {
  const defaultResult = npmConfigRegistry(projectPath, 'registry', options)
  const config = {
    defaultRegistry:
      defaultResult.state === 'resolved' ? defaultResult.registry : null,
    scopes: {},
  }
  const scopes = [
    ...new Set(
      packageNames
        .filter(name => name.startsWith('@') && name.includes('/'))
        .map(name => name.slice(0, name.indexOf('/')))
    ),
  ].sort()
  for (const scope of scopes) {
    const result = npmConfigRegistry(projectPath, `${scope}:registry`, options)
    if (result.state === 'resolved') config.scopes[scope] = result.registry
    else if (result.state === 'unresolved') config.scopes[scope] = null
  }
  return config
}

function parseAlias(spec) {
  const value = spec.slice(4)
  if (value.startsWith('@')) {
    const slash = value.indexOf('/')
    if (slash === -1) return null
    const versionSeparator = value.indexOf('@', slash)
    return versionSeparator === -1
      ? { name: value, spec: 'latest' }
      : {
          name: value.slice(0, versionSeparator),
          spec: value.slice(versionSeparator + 1) || 'latest',
        }
  }
  const versionSeparator = value.lastIndexOf('@')
  return versionSeparator <= 0
    ? { name: value, spec: 'latest' }
    : {
        name: value.slice(0, versionSeparator),
        spec: value.slice(versionSeparator + 1) || 'latest',
      }
}

function registryFor(name, config) {
  const scope = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : null
  return scope && Object.hasOwn(config.scopes, scope)
    ? config.scopes[scope]
    : config.defaultRegistry
}

function isRepositoryShorthand(spec) {
  const base = spec.split('#', 1)[0]
  const parts = base.split('/')
  return (
    parts.length === 2 &&
    parts.every(part => part.length > 0 && /^[\w.-]+$/.test(part))
  )
}

function isLocalSpec(spec) {
  return (
    /^(workspace|file|link|portal|patch):/i.test(spec) ||
    spec.startsWith('/') ||
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(spec)
  )
}

function classifyDependency(name, rawSpec, registryConfig) {
  const spec = typeof rawSpec === 'string' ? rawSpec.trim() : ''
  if (!spec) {
    return { kind: 'invalid-spec', resolvedName: name, resolvedSpec: spec }
  }
  if (isLocalSpec(spec)) {
    return { kind: 'local', resolvedName: name, resolvedSpec: spec }
  }
  const lowerSpec = spec.toLowerCase()
  if (
    ['git:', 'git+', 'git@', 'ssh:', 'github:', 'gitlab:', 'bitbucket:'].some(
      prefix => lowerSpec.startsWith(prefix)
    ) ||
    isRepositoryShorthand(spec)
  ) {
    return { kind: 'vcs', resolvedName: name, resolvedSpec: spec }
  }
  if (/^https?:/i.test(spec)) {
    return { kind: 'remote-artifact', resolvedName: name, resolvedSpec: spec }
  }

  let resolvedName = name
  let resolvedSpec = spec
  if (spec.startsWith('npm:')) {
    const alias = parseAlias(spec)
    if (!alias || !alias.name) {
      return { kind: 'invalid-spec', resolvedName: name, resolvedSpec: spec }
    }
    resolvedName = alias.name
    resolvedSpec = alias.spec
  }

  const registry = registryFor(resolvedName, registryConfig)
  if (!registry) {
    return {
      kind: 'registry-config-unresolved',
      resolvedName,
      resolvedSpec,
      registry: null,
    }
  }
  if (registry !== PUBLIC_NPM_REGISTRY) {
    return {
      kind: 'non-public-registry',
      resolvedName,
      resolvedSpec,
      registry,
    }
  }
  return {
    kind: 'public-registry',
    resolvedName,
    resolvedSpec,
    registry,
  }
}

function registryUrl(registry, packageName) {
  return new URL(encodeURIComponent(packageName), registry).toString()
}

function lookupPublicPackage(packageName, options = {}) {
  const registry = options.registry || PUBLIC_NPM_REGISTRY
  const now = options.now || new Date()
  const get = options.get || https.get
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolve({ lookedUpAt: now.toISOString(), registry, ...value })
    }
    const req = get(
      registryUrl(registry, packageName),
      {
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
        timeout: options.timeoutMs || 8000,
      },
      res => {
        const statusCode = res.statusCode || 0
        res.on('error', error =>
          finish({
            state: 'registry-unavailable',
            statusCode,
            failure: error.code || error.message,
          })
        )
        if (statusCode === 404) {
          res.resume()
          finish({ state: 'registry-not-found', statusCode })
          return
        }
        if (statusCode === 401 || statusCode === 403) {
          res.resume()
          finish({ state: 'registry-auth-required', statusCode })
          return
        }
        if (statusCode === 429) {
          res.resume()
          finish({
            state: 'registry-rate-limited',
            statusCode,
            retryAfter: Array.isArray(res.headers['retry-after'])
              ? res.headers['retry-after'].join(', ')
              : res.headers['retry-after'] || null,
          })
          return
        }
        if (statusCode < 200 || statusCode >= 300) {
          res.resume()
          finish({ state: 'registry-unavailable', statusCode })
          return
        }

        const chunks = []
        let bytes = 0
        res.on('data', chunk => {
          bytes += chunk.length
          if (bytes <= MAX_METADATA_BYTES) chunks.push(chunk)
        })
        res.on('end', () => {
          if (bytes > MAX_METADATA_BYTES) {
            finish({
              state: 'registry-present',
              statusCode,
              metadataState: 'too-large',
              createdAt: null,
            })
            return
          }
          try {
            const metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            finish({
              state: 'registry-present',
              statusCode,
              metadataState: 'parsed',
              createdAt: metadata.time?.created || null,
            })
          } catch {
            finish({
              state: 'registry-present',
              statusCode,
              metadataState: 'malformed',
              createdAt: null,
            })
          }
        })
      }
    )
    req.on('error', error =>
      finish({
        state: 'registry-unavailable',
        statusCode: null,
        failure: error.code || error.message,
      })
    )
    req.on('timeout', () => {
      req.destroy()
      finish({
        state: 'registry-timeout',
        statusCode: null,
        failure: 'timeout',
      })
    })
  })
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await operation(items[index], index)
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

function isNewPackage(createdAt, now) {
  if (!createdAt) return false
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime()) || created > now) return false
  return now.getTime() - created.getTime() < NEW_PACKAGE_DAYS * 86400000
}

function sameLengthSingleEdit(left, right) {
  const differences = []
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) differences.push(index)
  }
  return (
    differences.length === 1 ||
    (differences.length === 2 &&
      differences[1] === differences[0] + 1 &&
      left[differences[0]] === right[differences[1]] &&
      left[differences[1]] === right[differences[0]])
  )
}

function oneInsertionApart(shorter, longer) {
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++
      longIndex++
    } else if (skipped) {
      return false
    } else {
      skipped = true
      longIndex++
    }
  }
  return true
}

function isSingleEditApart(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false
  if (left.length === right.length) return sameLengthSingleEdit(left, right)
  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  return oneInsertionApart(shorter, longer)
}

function packageStem(name) {
  return name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name
}

function nameConfusionSignal(name, knownPackages) {
  const stem = packageStem(name).toLowerCase()
  if (stem.length < 4) return null
  const match = knownPackages.find(candidate =>
    isSingleEditApart(stem, candidate)
  )
  return match
    ? {
        kind: 'name-confusion-candidate',
        confidence: 'low',
        comparedTo: match,
        policyVersion: 'builtin-protected-names-v1',
      }
    : null
}

function heuristicSignals(record, options, now) {
  if (!options.advanced) return []
  const signals = []
  if (
    record.state === 'registry-present' &&
    isNewPackage(record.createdAt, now)
  ) {
    signals.push({
      kind: 'low-provenance-new-package',
      confidence: 'low',
      createdAt: record.createdAt,
      policyVersion: 'package-age-v1',
    })
  }
  const confusion = nameConfusionSignal(
    record.resolvedName,
    options.knownPackages || COMMON_PACKAGE_NAMES
  )
  if (confusion) signals.push(confusion)
  return signals
}

function provenanceFindings(record) {
  const findings = []
  if (record.state === 'registry-not-found') {
    findings.push({
      id: `package-registry-not-found-${record.name}`,
      severity: 'medium',
      file: 'package.json',
      line: 0,
      message: `The configured public registry returned 404 for "${record.resolvedName}". Verify the dependency name and registry; this does not by itself establish typosquatting, hallucination, or maliciousness.`,
      fix: `Verify "${record.name}" against its publisher or replace it with an intentionally selected dependency.`,
      cwe: 'CWE-1104',
      owasp: 'A06:2021',
      source: 'package-provenance',
      confidence: 'high',
      evidence: {
        classification: record.state,
        registry: record.registry,
        lookedUpAt: record.lookedUpAt,
        statusCode: record.statusCode,
      },
    })
  }
  for (const signal of record.signals || []) {
    const isNew = signal.kind === 'low-provenance-new-package'
    findings.push({
      id: `package-${signal.kind}-${record.name}`,
      severity: 'medium',
      file: 'package.json',
      line: 0,
      message: isNew
        ? `"${record.resolvedName}" was first published within ${NEW_PACKAGE_DAYS} days. Package age is a review signal, not proof of maliciousness.`
        : `"${record.resolvedName}" is one edit from the common package "${signal.comparedTo}". Name similarity is a review signal, not proof of typo-squatting or maliciousness.`,
      fix: `Review the publisher, repository, release history, and necessity of "${record.name}" before shipping.`,
      cwe: 'CWE-1104',
      owasp: 'A06:2021',
      source: 'package-provenance-heuristic',
      confidence: signal.confidence,
      evidence: {
        classification: signal.kind,
        registryState: record.state,
        registry: record.registry,
        lookedUpAt: record.lookedUpAt,
        createdAt: signal.createdAt || null,
        comparedTo: signal.comparedTo || null,
        policyVersion: signal.policyVersion,
      },
    })
  }
  return findings
}

function excludedRecord(dependency, classification) {
  const stateByKind = {
    local: 'allowed-local-source',
    vcs: 'allowed-vcs-source',
    'remote-artifact': 'allowed-remote-artifact',
    'non-public-registry': 'allowed-non-public-registry',
  }
  return {
    name: dependency.name,
    declaredSpec: dependency.spec,
    resolvedName: classification.resolvedName,
    resolvedSpec: classification.resolvedSpec,
    registry: classification.registry || null,
    state: stateByKind[classification.kind],
    confidence: 'high',
    evidence: { kind: classification.kind },
    signals: [],
    advisoryStatus: 'covered-by-npm-audit-separately',
  }
}

function emptyAnalysis(now, completion, limitation) {
  return {
    schemaVersion: 1,
    analyzedAt: now.toISOString(),
    packages: [],
    findings: [],
    coverage: {
      eligible: 0,
      attempted: 0,
      completed: 0,
      excluded: 0,
      completion,
      limitations: [limitation],
    },
  }
}

function readProductionDependencies(projectPath, now) {
  const pkgPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return {
      error: emptyAnalysis(now, 'complete', 'No package.json was found.'),
    }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const production = {
      ...(pkg.peerDependencies || {}),
      ...(pkg.dependencies || {}),
      ...(pkg.optionalDependencies || {}),
    }
    return {
      dependencies: Object.keys(production)
        .sort()
        .map(name => ({ name, spec: production[name] })),
    }
  } catch (error) {
    return {
      error: emptyAnalysis(
        now,
        'abandoned',
        `package.json could not be parsed: ${error.message}`
      ),
    }
  }
}

function coverageFor({
  dependencies,
  eligible,
  excluded,
  invalid,
  completed,
  advanced,
  lookedUp,
}) {
  const limitations = []
  if (excluded.length > 0) {
    limitations.push(
      `${excluded.length} local, VCS, remote artifact, or non-public-registry dependencies were classified but not queried against the public npm registry.`
    )
  }
  if (invalid.length > 0) {
    limitations.push(
      `${invalid.length} dependency specifications could not be resolved to a supported registry source.`
    )
  }
  if (completed < eligible.length) {
    limitations.push(
      `${eligible.length - completed} public registry lookups were unavailable, rate-limited, timed out, or otherwise incomplete.`
    )
  }
  if (!advanced) {
    limitations.push(
      'Package age and name-confusion heuristics were not evaluated.'
    )
  }
  const advancedIncomplete = advanced
    ? lookedUp.filter(
        record =>
          record.state === 'registry-present' &&
          record.metadataState !== 'parsed'
      ).length
    : 0
  if (advancedIncomplete > 0) {
    limitations.push(
      `${advancedIncomplete} package metadata responses could not support advanced provenance heuristics.`
    )
  }
  return {
    eligible: dependencies.length,
    attempted: eligible.length,
    completed,
    excluded: excluded.length,
    completion:
      invalid.length === 0 &&
      advancedIncomplete === 0 &&
      completed + excluded.length === dependencies.length
        ? 'complete'
        : 'partial',
    limitations,
  }
}

async function analyzePackageProvenance(projectPath, options = {}) {
  const now =
    options.now instanceof Date
      ? options.now
      : new Date(options.now === undefined ? Date.now() : options.now)
  if (Number.isNaN(now.getTime())) throw new Error('now is invalid')
  const manifest = readProductionDependencies(projectPath, now)
  if (manifest.error) return manifest.error
  const dependencies = manifest.dependencies
  const registryNames = dependencies.map(dependency => {
    const spec =
      typeof dependency.spec === 'string' ? dependency.spec.trim() : ''
    if (!spec.startsWith('npm:')) return dependency.name
    return parseAlias(spec)?.name || dependency.name
  })
  const registryConfig =
    options.registryConfig ||
    resolveNpmRegistryConfig(
      projectPath,
      registryNames,
      options.registryConfigOptions
    )
  const classified = dependencies.map(dependency => ({
    dependency,
    classification: classifyDependency(
      dependency.name,
      dependency.spec,
      registryConfig
    ),
  }))
  const eligible = classified.filter(
    item => item.classification.kind === 'public-registry'
  )
  const excluded = classified.filter(item =>
    ['local', 'vcs', 'remote-artifact', 'non-public-registry'].includes(
      item.classification.kind
    )
  )
  const invalid = classified.filter(
    item =>
      ![
        'public-registry',
        'local',
        'vcs',
        'remote-artifact',
        'non-public-registry',
      ].includes(item.classification.kind)
  )
  const lookup =
    options.lookup ||
    ((name, lookupOptions) => lookupPublicPackage(name, lookupOptions))
  const lookedUp = await mapConcurrent(
    eligible,
    Number.isInteger(options.concurrency) && options.concurrency > 0
      ? options.concurrency
      : DEFAULT_CONCURRENCY,
    async item => {
      const response = await lookup(item.classification.resolvedName, {
        registry: item.classification.registry,
        now,
      })
      const record = {
        name: item.dependency.name,
        declaredSpec: item.dependency.spec,
        resolvedName: item.classification.resolvedName,
        resolvedSpec: item.classification.resolvedSpec,
        registry: item.classification.registry,
        state: response.state,
        confidence: 'high',
        lookedUpAt: response.lookedUpAt,
        statusCode: response.statusCode ?? null,
        retryAfter: response.retryAfter || null,
        failure: response.failure || null,
        metadataState: response.metadataState || null,
        createdAt: response.createdAt || null,
        evidence: { kind: 'registry-response' },
        advisoryStatus: 'covered-by-npm-audit-separately',
      }
      record.signals = heuristicSignals(record, options, now)
      return record
    }
  )
  const invalidRecords = invalid.map(item => ({
    name: item.dependency.name,
    declaredSpec: item.dependency.spec,
    resolvedName: item.classification.resolvedName,
    resolvedSpec: item.classification.resolvedSpec,
    registry: item.classification.registry || null,
    state: item.classification.kind,
    confidence: 'high',
    evidence: { kind: item.classification.kind },
    signals: [],
    advisoryStatus: 'not-assessed',
  }))
  const packages = [
    ...lookedUp,
    ...excluded.map(item =>
      excludedRecord(item.dependency, item.classification)
    ),
    ...invalidRecords,
  ].sort((a, b) => a.name.localeCompare(b.name))
  const completed = lookedUp.filter(
    record =>
      record.state === 'registry-not-found' ||
      (record.state === 'registry-present' && record.metadataState === 'parsed')
  ).length
  return {
    schemaVersion: 1,
    analyzedAt: now.toISOString(),
    packages,
    findings: packages.flatMap(provenanceFindings),
    coverage: coverageFor({
      dependencies,
      eligible,
      excluded,
      invalid,
      completed,
      advanced: options.advanced,
      lookedUp,
    }),
  }
}

module.exports = {
  PUBLIC_NPM_REGISTRY,
  analyzePackageProvenance,
  classifyDependency,
  lookupPublicPackage,
  readNpmRegistryConfig,
  resolveNpmRegistryConfig,
}
