'use strict'

const crypto = require('crypto')
const fs = require('fs')
const Ajv = require('ajv/dist/2020').default

const previewSchema = require('../../config/preview-assurance-v1.schema.json')

const PREVIEW_CHECK_VERSION = '1.0.0'
const MAX_BODY_BYTES = 65_536
const DEFAULT_DEBUG_PATHS = [
  '/.env',
  '/__debug',
  '/debug',
  '/_next/static/chunks/main.js.map',
]
const SECURITY_HEADERS = [
  'content-security-policy',
  'referrer-policy',
  'x-content-type-options',
]
const LEAK_PATTERNS = [
  /(?:at |File ").+?:\d+:\d+/,
  /Traceback \(most recent call last\)/,
  /(?:DATABASE_URL|API_KEY|SECRET_KEY|PRIVATE_KEY)\s*[:=]/i,
  /node_modules\//,
]

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: true })
const validatePreviewConfig = ajv.compile(previewSchema)

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function loadPreviewConfig(filename) {
  if (!filename) {
    return {
      valid: false,
      config: null,
      errors: ['--preview-config is required'],
    }
  }
  try {
    const source = fs.readFileSync(filename, 'utf8')
    const config = JSON.parse(source)
    const schemaValid = validatePreviewConfig(config)
    const identitiesDistinct =
      !config.authorizationProbe ||
      config.authorizationProbe.userATokenEnv !==
        config.authorizationProbe.userBTokenEnv
    const valid = schemaValid && identitiesDistinct
    const schemaErrors = schemaValid
      ? []
      : (validatePreviewConfig.errors || []).map(
          error => `${error.instancePath || '/'} ${error.message}`
        )
    return {
      valid,
      config: valid ? config : null,
      sourceSha256: sha256(source),
      errors: identitiesDistinct
        ? schemaErrors
        : [...schemaErrors, 'authorization probe token env names must differ'],
    }
  } catch (error) {
    return { valid: false, config: null, errors: [error.message] }
  }
}

function normalizedOrigin(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('preview URL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('preview URL must not contain credentials')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'preview URL must be an origin without a path, query, or hash'
    )
  }
  return url
}

function isLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  )
}

function looksLikePreviewHost(hostname) {
  return (
    isLoopback(hostname) ||
    hostname.endsWith('.vercel.app') ||
    hostname.endsWith('.netlify.app') ||
    /(?:^|[.-])(?:preview|staging|stage|dev|test)(?:[.-]|$)/i.test(hostname)
  )
}

function requestIdentity(url, method) {
  return {
    method,
    origin: url.origin,
    path: url.pathname,
    queryKeys: [...url.searchParams.keys()].sort(),
  }
}

async function readBoundedBody(response) {
  if (!response.body) return { bytes: Buffer.alloc(0), truncated: false }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = MAX_BODY_BYTES - size
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(Buffer.from(value.slice(0, remaining)))
        size = MAX_BODY_BYTES
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(Buffer.from(value))
      size += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return { bytes: Buffer.concat(chunks, size), truncated }
}

async function safeRequest(fetchImpl, origin, request, options = {}) {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  let url
  try {
    url = new URL(request.path, origin)
    if (url.origin !== origin.origin) {
      throw new Error('request target escaped the preview origin')
    }
  } catch {
    return {
      ok: false,
      error: 'request-target-outside-preview-origin',
      evidence: {
        request: {
          method: request.method || 'GET',
          origin: origin.origin,
          path: '[invalid-target]',
          queryKeys: [],
        },
        response: null,
        startedAt,
        durationMs: Date.now() - started,
      },
    }
  }
  const headers = { ...(request.headers || {}) }
  let body
  if (Object.hasOwn(request, 'body')) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(request.body)
  }
  try {
    const response = await fetchImpl(url, {
      method: request.method || 'GET',
      headers,
      body,
      redirect: options.redirect || 'manual',
      signal: AbortSignal.timeout(options.timeoutMs || 10_000),
    })
    const captured = await readBoundedBody(response)
    const text = captured.bytes.toString('utf8')
    return {
      ok: true,
      status: response.status,
      location: response.headers.get('location'),
      header: name => response.headers.get(name),
      text,
      evidence: {
        request: requestIdentity(url, request.method || 'GET'),
        response: {
          status: response.status,
          headerNames: [...response.headers.keys()]
            .map(name => name.toLowerCase())
            .filter(name =>
              [
                ...SECURITY_HEADERS,
                'strict-transport-security',
                'location',
              ].includes(name)
            )
            .sort(),
          bodySha256: sha256(captured.bytes),
          bodyBytes: captured.bytes.length,
          truncated: captured.truncated,
        },
        startedAt,
        durationMs: Date.now() - started,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error.name === 'TimeoutError' ? 'request-timeout' : 'network-error',
      evidence: {
        request: requestIdentity(url, request.method || 'GET'),
        response: null,
        startedAt,
        durationMs: Date.now() - started,
      },
    }
  }
}

function check(id, status, summary, observations = []) {
  return { id, version: PREVIEW_CHECK_VERSION, status, summary, observations }
}

function securityHeadersCheck(origin, root) {
  const missingHeaders = SECURITY_HEADERS.filter(name => !root.header(name))
  if (
    origin.protocol === 'https:' &&
    !root.header('strict-transport-security')
  ) {
    missingHeaders.push('strict-transport-security')
  }
  return check(
    'security-headers',
    missingHeaders.length === 0 ? 'pass' : 'fail',
    missingHeaders.length === 0
      ? 'Required response headers are present'
      : `Missing response headers: ${missingHeaders.join(', ')}`,
    [root.evidence]
  )
}

function revisionBindingCheck(root, config, expectedRevision) {
  const revisionHeader = config.deployment?.revisionHeader
  const actualRevision = revisionHeader ? root.header(revisionHeader) : null
  let summary = `Deployment did not expose ${revisionHeader}`
  if (!revisionHeader) summary = 'No deployment revision header configured'
  else if (actualRevision === expectedRevision)
    summary = 'Deployment revision matches the expected commit'
  else if (actualRevision)
    summary = 'Deployment revision does not match the expected commit'
  return check(
    'deployment-revision-binding',
    actualRevision === expectedRevision ? 'pass' : 'incomplete',
    summary,
    [root.evidence]
  )
}

function routeCheck(id, incomplete, failures, success, observations) {
  const status = incomplete ? 'incomplete' : failures.length ? 'fail' : 'pass'
  return check(
    id,
    status,
    failures.length ? failures.join('; ') : success,
    observations
  )
}

async function publicRoutesCheck(fetchImpl, origin, config, root) {
  const publicObservations = [root.evidence]
  const publicFailures = []
  let publicIncomplete = false
  if (root.status < 200 || root.status >= 400) {
    publicFailures.push(`${config.publicPaths[0]}: HTTP ${root.status}`)
  }
  for (const publicPath of config.publicPaths.slice(1)) {
    const response = await safeRequest(fetchImpl, origin, {
      method: 'GET',
      path: publicPath,
    })
    publicObservations.push(response.evidence)
    if (!response.ok) {
      publicIncomplete = true
      publicFailures.push(`${publicPath}: ${response.error}`)
    } else if (response.status < 200 || response.status >= 400)
      publicFailures.push(`${publicPath}: HTTP ${response.status}`)
  }
  return routeCheck(
    'public-routes',
    publicIncomplete,
    publicFailures,
    'Public routes responded',
    publicObservations
  )
}

async function privateRoutesCheck(fetchImpl, origin, config) {
  const privateObservations = []
  const privateFailures = []
  let privateIncomplete = false
  for (const route of config.privatePaths) {
    const response = await safeRequest(fetchImpl, origin, {
      method: 'GET',
      path: route.path,
    })
    privateObservations.push(response.evidence)
    if (!response.ok) privateIncomplete = true
    else if (!route.unauthenticatedStatuses.includes(response.status))
      privateFailures.push(`${route.path}: HTTP ${response.status}`)
  }
  return check(
    'private-routes',
    privateIncomplete ? 'incomplete' : privateFailures.length ? 'fail' : 'pass',
    privateIncomplete
      ? 'A private-route probe did not complete'
      : privateFailures.length
        ? `Unauthenticated access was not rejected: ${privateFailures.join('; ')}`
        : 'Unauthenticated private-route access was rejected',
    privateObservations
  )
}

async function debugSurfaceCheck(fetchImpl, origin, config) {
  const debugObservations = []
  const exposed = []
  let debugIncomplete = false
  for (const debugPath of config.debugPaths || DEFAULT_DEBUG_PATHS) {
    const response = await safeRequest(fetchImpl, origin, {
      method: 'GET',
      path: debugPath,
    })
    debugObservations.push(response.evidence)
    if (!response.ok) debugIncomplete = true
    else if (response.status >= 200 && response.status < 300)
      exposed.push(debugPath)
  }
  return check(
    'debug-surface',
    debugIncomplete ? 'incomplete' : exposed.length ? 'fail' : 'pass',
    debugIncomplete
      ? 'A debug-surface probe did not complete'
      : exposed.length
        ? `Unexpected debug routes responded: ${exposed.join(', ')}`
        : 'No configured debug route responded successfully',
    debugObservations
  )
}

async function redirectCheck(fetchImpl, origin, probePath) {
  if (!probePath) return null
  const response = await safeRequest(fetchImpl, origin, {
    method: 'GET',
    path: probePath,
  })
  let redirect = null
  let malformed = false
  try {
    redirect = response.location ? new URL(response.location, origin) : null
  } catch {
    malformed = true
  }
  const escaped = redirect && redirect.origin !== origin.origin
  const status = !response.ok
    ? 'incomplete'
    : malformed || escaped
      ? 'fail'
      : 'pass'
  const summary = !response.ok
    ? response.error
    : malformed
      ? 'Redirect target was malformed'
      : escaped
        ? 'Redirect escaped the preview origin'
        : 'No cross-origin redirect was observed'
  return check('unsafe-redirect', status, summary, [response.evidence])
}

async function errorLeakageCheck(fetchImpl, origin, probePath) {
  if (!probePath) return null
  const response = await safeRequest(fetchImpl, origin, {
    method: 'GET',
    path: probePath,
  })
  const leaked =
    response.ok && LEAK_PATTERNS.some(pattern => pattern.test(response.text))
  const status = !response.ok ? 'incomplete' : leaked ? 'fail' : 'pass'
  const summary = !response.ok
    ? response.error
    : leaked
      ? 'The error response exposed stack or secret-shaped details'
      : 'No stack or secret-shaped details were observed'
  return check('error-leakage', status, summary, [response.evidence])
}

async function baselineProbes(fetchImpl, origin, config, expectedRevision) {
  const root = await safeRequest(fetchImpl, origin, {
    method: 'GET',
    path: config.publicPaths[0],
  })
  if (!root.ok) {
    return {
      checks: [
        check('preview-reachable', 'incomplete', root.error, [root.evidence]),
      ],
      root,
    }
  }
  const checks = [
    check('preview-reachable', 'pass', `HTTP ${root.status}`, [root.evidence]),
    securityHeadersCheck(origin, root),
    revisionBindingCheck(root, config, expectedRevision),
    await publicRoutesCheck(fetchImpl, origin, config, root),
    await privateRoutesCheck(fetchImpl, origin, config),
    await debugSurfaceCheck(fetchImpl, origin, config),
  ]
  const optionalChecks = await Promise.all([
    redirectCheck(fetchImpl, origin, config.redirectProbePath),
    errorLeakageCheck(fetchImpl, origin, config.errorProbePath),
  ])
  checks.push(...optionalChecks.filter(Boolean))
  return { checks, root }
}

function replaceTemplate(value, fixtureId, resourceId) {
  if (typeof value === 'string') {
    return value
      .replaceAll('{{fixtureId}}', fixtureId)
      .replaceAll('{{resourceId}}', resourceId || '')
  }
  if (Array.isArray(value))
    return value.map(item => replaceTemplate(item, fixtureId, resourceId))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceTemplate(item, fixtureId, resourceId),
      ])
    )
  }
  return value
}

function stateRequest(spec, token, fixtureId, resourceId) {
  return {
    method: spec.method,
    path: replaceTemplate(spec.path, fixtureId, resourceId),
    headers: { authorization: `Bearer ${token}` },
    ...(Object.hasOwn(spec, 'body')
      ? { body: replaceTemplate(spec.body, fixtureId, resourceId) }
      : {}),
  }
}

async function createSyntheticResource(
  fetchImpl,
  origin,
  probe,
  userA,
  fixtureId
) {
  const response = await safeRequest(
    fetchImpl,
    origin,
    stateRequest(probe.create, userA, fixtureId, null)
  )
  if (!response.ok)
    return { status: 'incomplete', summary: response.error, response }
  if ([401, 403].includes(response.status))
    return {
      status: 'incomplete',
      summary: 'User A authentication failed',
      response,
    }
  if (!probe.create.successStatuses.includes(response.status))
    return {
      status: 'incomplete',
      summary: `Synthetic resource creation returned HTTP ${response.status}`,
      response,
    }
  let resourceId
  try {
    resourceId = JSON.parse(response.text)[probe.resourceIdField]
  } catch {
    return {
      status: 'incomplete',
      summary: 'Synthetic resource response was not JSON',
      response,
    }
  }
  if (
    typeof resourceId !== 'string' ||
    !/^[A-Za-z0-9._~-]{1,300}$/.test(resourceId)
  ) {
    return {
      status: 'incomplete',
      summary: 'Synthetic resource response omitted a safe resource ID',
      response,
    }
  }
  return {
    status: 'pass',
    summary: 'Synthetic resource created',
    resourceId,
    response,
  }
}

async function probeUserB(context, userB, resourceId) {
  const { fetchImpl, origin, probe, fixtureId } = context
  const observations = []
  for (const [name, spec] of [
    ['read', probe.read],
    ['mutate', probe.mutate],
  ]) {
    const response = await safeRequest(
      fetchImpl,
      origin,
      stateRequest(spec, userB, fixtureId, resourceId)
    )
    observations.push(response.evidence)
    if (!response.ok)
      return {
        status: 'incomplete',
        summary: `User B ${name} probe did not complete`,
        observations,
      }
    if (!probe.forbiddenStatuses.includes(response.status))
      return {
        status: 'fail',
        summary: `User B ${name} was not rejected (HTTP ${response.status})`,
        observations,
      }
  }
  return {
    status: 'pass',
    summary: 'User B could not read or mutate user A synthetic data',
    observations,
  }
}

async function cleanupSyntheticResource(context, userA, resourceId) {
  const { fetchImpl, origin, probe, fixtureId } = context
  const response = await safeRequest(
    fetchImpl,
    origin,
    stateRequest(probe.cleanup, userA, fixtureId, resourceId)
  )
  return {
    status:
      response.ok && probe.cleanup.successStatuses.includes(response.status)
        ? 'complete'
        : 'failed',
    observation: response.evidence,
  }
}

function authorizationNotRun(summary) {
  const result = check('two-user-authorization', 'incomplete', summary)
  result.cleanup = 'not-attempted'
  return result
}

async function authorizationProbe(fetchImpl, origin, config, options) {
  const probe = config.authorizationProbe
  if (!probe) return null
  if (!options.allowMutations) {
    return authorizationNotRun(
      'State-changing probe requires --allow-preview-mutations'
    )
  }
  const userA = options.env[probe.userATokenEnv]
  const userB = options.env[probe.userBTokenEnv]
  if (!userA || !userB) {
    return authorizationNotRun(
      'Configured test identity tokens are unavailable'
    )
  }
  if (userA === userB) {
    return authorizationNotRun(
      'Configured test identities must use distinct credentials'
    )
  }
  const fixtureId = `qaa-preview-${crypto.randomUUID()}`
  const context = { fetchImpl, origin, probe, fixtureId }
  const observations = []
  let resourceId = null
  let outcome = {
    status: 'incomplete',
    summary: 'Synthetic resource creation did not complete',
  }
  let cleanupStatus = 'not-attempted'
  try {
    const created = await createSyntheticResource(
      fetchImpl,
      origin,
      probe,
      userA,
      fixtureId
    )
    observations.push(created.response.evidence)
    outcome = created
    resourceId = created.resourceId || null
    if (resourceId) {
      outcome = await probeUserB(context, userB, resourceId)
      observations.push(...outcome.observations)
    }
  } finally {
    if (resourceId) {
      const cleaned = await cleanupSyntheticResource(context, userA, resourceId)
      observations.push(cleaned.observation)
      cleanupStatus = cleaned.status
      if (cleanupStatus === 'failed') {
        outcome = {
          status: 'incomplete',
          summary: 'Exact synthetic fixture cleanup failed',
        }
      }
    }
  }
  const result = check(
    'two-user-authorization',
    outcome.status,
    outcome.summary,
    observations
  )
  result.cleanup = cleanupStatus
  result.fixtureIdSha256 = sha256(fixtureId)
  result.resourceIdSha256 = resourceId ? sha256(resourceId) : null
  return result
}

function aggregateStatus(checks) {
  if (checks.some(item => item.status === 'incomplete')) return 'incomplete'
  if (checks.some(item => item.status === 'fail')) return 'fail'
  return 'pass'
}

function previewEvidence({
  origin = null,
  classification = 'unknown',
  configSha256 = null,
  checks,
  revisionBinding = 'unverified',
  deploymentIdSha256 = null,
}) {
  return {
    schemaVersion: '1.0.0',
    checkVersion: PREVIEW_CHECK_VERSION,
    status: aggregateStatus(checks),
    target: origin?.origin || null,
    environment: {
      classification,
      revisionBinding,
      ...(deploymentIdSha256 ? { deploymentIdSha256 } : {}),
    },
    configSha256,
    checks,
    evaluatedAt: new Date().toISOString(),
  }
}

function configurationFailure(origin, loaded) {
  return previewEvidence({
    origin,
    configSha256: loaded.sourceSha256 || null,
    checks: [
      check('preview-configuration', 'incomplete', loaded.errors.join('; ')),
    ],
  })
}

function previewPreflight(options) {
  let origin
  try {
    origin = normalizedOrigin(options.previewUrl)
  } catch (error) {
    return {
      evidence: configurationFailure(null, { errors: [error.message] }),
    }
  }
  const loaded = loadPreviewConfig(options.configPath)
  if (!loaded.valid) return { evidence: configurationFailure(origin, loaded) }

  const previewLike = looksLikePreviewHost(origin.hostname)
  const classification = previewLike ? 'preview' : 'production'
  if (
    !previewLike &&
    !(loaded.config.allowProduction && options.allowProduction)
  ) {
    return {
      evidence: previewEvidence({
        origin,
        classification,
        configSha256: loaded.sourceSha256,
        checks: [
          check(
            'production-host-protection',
            'incomplete',
            'Production-like host refused; both config and --allow-production-preview are required'
          ),
        ],
      }),
    }
  }
  if (origin.protocol !== 'https:' && !isLoopback(origin.hostname)) {
    return {
      evidence: previewEvidence({
        origin,
        classification,
        configSha256: loaded.sourceSha256,
        checks: [
          check('transport-security', 'fail', 'Remote preview must use HTTPS'),
        ],
      }),
    }
  }
  return { origin, loaded, classification }
}

function deploymentIdHash(config, baseline) {
  if (!config.deployment?.deploymentIdHeader || !baseline.root?.ok) return null
  const deploymentId = baseline.root.header(
    config.deployment.deploymentIdHeader
  )
  return deploymentId ? sha256(deploymentId) : null
}

async function authorizationForBaseline(
  fetchImpl,
  origin,
  config,
  options,
  binding
) {
  if (!config.authorizationProbe) return null
  if (binding?.status !== 'pass') {
    return authorizationNotRun(
      'State-changing probe requires a verified deployment revision'
    )
  }
  return authorizationProbe(fetchImpl, origin, config, options)
}

async function runPreviewVerification(options) {
  const preflight = previewPreflight(options)
  if (preflight.evidence) return preflight.evidence
  const { origin, loaded, classification } = preflight
  const config = loaded.config

  const fetchImpl = options.fetchImpl || globalThis.fetch
  const baseline = await baselineProbes(
    fetchImpl,
    origin,
    config,
    options.expectedRevision
  )
  const binding = baseline.checks.find(
    item => item.id === 'deployment-revision-binding'
  )
  const auth = await authorizationForBaseline(
    fetchImpl,
    origin,
    config,
    {
      allowMutations: options.allowMutations,
      env: options.env || process.env,
    },
    binding
  )
  const checks = auth ? [...baseline.checks, auth] : baseline.checks
  return previewEvidence({
    origin,
    classification,
    configSha256: loaded.sourceSha256,
    checks,
    revisionBinding: binding?.status === 'pass' ? 'verified' : 'unverified',
    deploymentIdSha256: deploymentIdHash(config, baseline),
  })
}

module.exports = {
  PREVIEW_CHECK_VERSION,
  loadPreviewConfig,
  looksLikePreviewHost,
  runPreviewVerification,
}
