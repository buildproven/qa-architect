#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const {
  loadPreviewConfig,
  runPreviewVerification,
} = require('../lib/assurance/preview')

const REVISION = 'a'.repeat(40)
const USER_A = 'preview-user-a-secret-token'
const USER_B = 'preview-user-b-secret-token'
const BODY_LIMIT = 65_536
let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
    passed += 1
  } catch (error) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${error.stack || error.message}`)
    failed += 1
  }
}

function config() {
  return {
    schemaVersion: '1.0.0',
    deployment: {
      revisionHeader: 'x-qaa-revision',
      deploymentIdHeader: 'x-qaa-deployment-id',
    },
    publicPaths: ['/', '/public'],
    privatePaths: [
      { path: '/private', unauthenticatedStatuses: [401, 403, 404] },
    ],
    debugPaths: ['/.env', '/__debug'],
    redirectProbePath: '/redirect?next=https://attacker.example',
    errorProbePath: '/error',
    authorizationProbe: {
      consent: 'state-changing-preview-probe-v1',
      userATokenEnv: 'PREVIEW_USER_A_TOKEN',
      userBTokenEnv: 'PREVIEW_USER_B_TOKEN',
      resourceIdField: 'id',
      forbiddenStatuses: [401, 403, 404],
      create: {
        method: 'POST',
        path: '/resources',
        successStatuses: [201],
        body: { marker: '{{fixtureId}}' },
      },
      read: {
        method: 'GET',
        path: '/resources/{{resourceId}}',
        successStatuses: [200],
      },
      mutate: {
        method: 'PATCH',
        path: '/resources/{{resourceId}}',
        successStatuses: [200],
        body: { marker: '{{fixtureId}}', changed: true },
      },
      cleanup: {
        method: 'DELETE',
        path: '/resources/{{resourceId}}',
        successStatuses: [204],
      },
    },
  }
}

function writeConfig(root, value = config()) {
  const filename = path.join(root, 'preview.json')
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`)
  return filename
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function setFixtureHeaders(response) {
  response.setHeader('content-security-policy', "default-src 'self'")
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-qaa-revision', REVISION)
  response.setHeader('x-qaa-deployment-id', 'deploy-private-123')
}

function publicFixtureBody(mode) {
  if (mode === 'large-exact') return Buffer.alloc(BODY_LIMIT, 'a')
  if (mode === 'large-over') return Buffer.alloc(BODY_LIMIT + 1, 'a')
  return 'public email: person@example.com'
}

function handleSurfaceRoute(url, response, mode) {
  if (url.pathname === '/' || url.pathname === '/public') {
    response.end(publicFixtureBody(mode))
    return true
  }
  if (url.pathname === '/private') {
    response.statusCode = mode === 'vulnerable' ? 200 : 401
    response.end(mode === 'vulnerable' ? 'private data' : 'unauthorized')
    return true
  }
  if (url.pathname === '/__debug' && mode === 'vulnerable') {
    response.end('debug')
    return true
  }
  if (url.pathname === '/.env' || url.pathname === '/__debug') {
    response.statusCode = 404
    response.end('not found')
    return true
  }
  if (url.pathname === '/redirect') {
    response.statusCode = 302
    response.setHeader(
      'location',
      mode === 'vulnerable' ? url.searchParams.get('next') : '/login'
    )
    response.end()
    return true
  }
  if (url.pathname === '/error') {
    response.statusCode = 500
    response.end(
      mode === 'vulnerable'
        ? 'Error at /srv/app.js:10:20 DATABASE_URL=private'
        : 'Internal server error'
    )
    return true
  }
  return false
}

async function handleResourceRoute(request, response, url, mode, state) {
  const authorization = request.headers.authorization
  if (url.pathname === '/resources' && request.method === 'POST') {
    if (mode === 'auth-failed' || authorization !== `Bearer ${USER_A}`) {
      response.statusCode = 401
      response.end('unauthorized')
      return true
    }
    state.creates += 1
    const body = JSON.parse(await readBody(request))
    state.fixtureId = body.marker
    response.statusCode = 201
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({ id: 'fixture-resource-1', ownerEmail: 'a@example.com' })
    )
    return true
  }
  if (url.pathname !== '/resources/fixture-resource-1') return false
  if (request.method === 'DELETE') {
    state.deletes += 1
    response.statusCode = mode === 'cleanup-failed' ? 500 : 204
    response.end()
    return true
  }
  if (authorization === `Bearer ${USER_B}`) {
    response.statusCode = mode === 'vulnerable' ? 200 : 403
    response.end(mode === 'vulnerable' ? 'cross-tenant data' : 'forbidden')
    return true
  }
  return false
}

async function fixtureServer(mode = 'safe') {
  const state = { creates: 0, deletes: 0, fixtureId: null }
  const server = http.createServer(async (request, response) => {
    setFixtureHeaders(response)
    const url = new URL(request.url, 'http://localhost')
    if (handleSurfaceRoute(url, response, mode)) return
    if (await handleResourceRoute(request, response, url, mode, state)) return
    response.statusCode = 404
    response.end('not found')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

async function run(mode, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-preview-test-'))
  const server = await fixtureServer(mode)
  try {
    return {
      evidence: await runPreviewVerification({
        previewUrl: server.origin,
        configPath: writeConfig(root, options.configValue),
        expectedRevision: options.expectedRevision || REVISION,
        allowMutations: options.allowMutations ?? true,
        env: options.env || {
          PREVIEW_USER_A_TOKEN: USER_A,
          PREVIEW_USER_B_TOKEN: USER_B,
        },
      }),
      state: server.state,
    }
  } finally {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  console.log('\nPreview deployment assurance')

  await test('safe preview passes, binds revision, and cleans exact fixture', async () => {
    const { evidence, state } = await run('safe')
    assert.strictEqual(evidence.status, 'pass')
    assert.strictEqual(evidence.environment.revisionBinding, 'verified')
    assert.strictEqual(state.creates, 1)
    assert.strictEqual(state.deletes, 1)
    const auth = evidence.checks.find(
      item => item.id === 'two-user-authorization'
    )
    assert.strictEqual(auth.cleanup, 'complete')
  })

  await test('deliberately vulnerable cross-tenant endpoint blocks', async () => {
    const { evidence } = await run('vulnerable')
    assert.strictEqual(evidence.status, 'fail')
    assert.match(
      evidence.checks.find(item => item.id === 'two-user-authorization')
        .summary,
      /User B read was not rejected/
    )
    assert.ok(
      evidence.checks.some(
        item => item.id === 'private-routes' && item.status === 'fail'
      )
    )
  })

  await test('unavailable preview is incomplete, never pass', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-preview-test-'))
    try {
      const evidence = await runPreviewVerification({
        previewUrl: 'http://127.0.0.1:1',
        configPath: writeConfig(root),
        expectedRevision: REVISION,
        allowMutations: false,
      })
      assert.strictEqual(evidence.status, 'incomplete')
      assert.match(evidence.checks[0].summary, /network|timeout/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  await test('authentication failure is incomplete', async () => {
    const { evidence } = await run('auth-failed')
    assert.strictEqual(evidence.status, 'incomplete')
    assert.match(
      evidence.checks.find(item => item.id === 'two-user-authorization')
        .summary,
      /authentication failed/
    )
  })

  await test('cleanup failure is incomplete and visible', async () => {
    const { evidence, state } = await run('cleanup-failed')
    assert.strictEqual(evidence.status, 'incomplete')
    assert.strictEqual(state.deletes, 1)
    const auth = evidence.checks.find(
      item => item.id === 'two-user-authorization'
    )
    assert.strictEqual(auth.cleanup, 'failed')
    assert.match(auth.summary, /cleanup failed/)
  })

  await test('state changes require explicit CLI consent', async () => {
    const { evidence, state } = await run('safe', { allowMutations: false })
    assert.strictEqual(evidence.status, 'incomplete')
    assert.strictEqual(state.creates, 0)
    assert.match(
      evidence.checks.find(item => item.id === 'two-user-authorization')
        .summary,
      /--allow-preview-mutations/
    )
  })

  await test('state changes require a revision-bound deployment', async () => {
    const { evidence, state } = await run('safe', {
      expectedRevision: 'b'.repeat(40),
    })
    assert.strictEqual(evidence.status, 'incomplete')
    assert.strictEqual(evidence.environment.revisionBinding, 'unverified')
    assert.strictEqual(state.creates, 0)
    assert.match(
      evidence.checks.find(item => item.id === 'two-user-authorization')
        .summary,
      /verified deployment revision/
    )
  })

  await test('two-user probes require distinct credentials', async () => {
    const { evidence, state } = await run('safe', {
      env: {
        PREVIEW_USER_A_TOKEN: USER_A,
        PREVIEW_USER_B_TOKEN: USER_A,
      },
    })
    assert.strictEqual(evidence.status, 'incomplete')
    assert.strictEqual(state.creates, 0)
    assert.match(
      evidence.checks.find(item => item.id === 'two-user-authorization')
        .summary,
      /distinct credentials/
    )
  })

  await test('config rejects origin-escaping and non-resource-bound routes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-preview-test-'))
    try {
      const unsafeTarget = config()
      unsafeTarget.privatePaths[0].path = '/\\attacker.example/private'
      assert.strictEqual(
        loadPreviewConfig(writeConfig(root, unsafeTarget)).valid,
        false
      )

      const broadCleanup = config()
      broadCleanup.authorizationProbe.cleanup.path = '/resources'
      assert.strictEqual(
        loadPreviewConfig(writeConfig(root, broadCleanup)).valid,
        false
      )

      const sameIdentity = config()
      sameIdentity.authorizationProbe.userBTokenEnv =
        sameIdentity.authorizationProbe.userATokenEnv
      assert.strictEqual(
        loadPreviewConfig(writeConfig(root, sameIdentity)).valid,
        false
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  await test('production-like hosts are refused before any request', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-preview-test-'))
    try {
      for (const previewUrl of [
        'https://app.example.com',
        'https://api.example.dev',
        'https://dev.example.com',
        'https://test.example.com',
        'https://stage.example.com',
      ]) {
        let called = false
        const evidence = await runPreviewVerification({
          previewUrl,
          configPath: writeConfig(root),
          expectedRevision: REVISION,
          fetchImpl: async () => {
            called = true
            throw new Error('must not run')
          },
        })
        assert.strictEqual(evidence.status, 'incomplete')
        assert.strictEqual(evidence.environment.classification, 'production')
        assert.strictEqual(called, false)
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  await test('evidence excludes tokens, bodies, PII, and raw identifiers', async () => {
    const { evidence, state } = await run('safe')
    const serialized = JSON.stringify(evidence)
    for (const secret of [
      USER_A,
      USER_B,
      state.fixtureId,
      'fixture-resource-1',
      'person@example.com',
      'a@example.com',
      'deploy-private-123',
      'cross-tenant data',
    ]) {
      assert.ok(!serialized.includes(secret), `evidence leaked ${secret}`)
    }
    assert.match(evidence.environment.deploymentIdSha256, /^[a-f0-9]{64}$/)
  })

  await test('response evidence is capped without mislabeling exact-limit bodies', async () => {
    const exact = await run('large-exact')
    const over = await run('large-over')
    const rootObservation = result =>
      result.evidence.checks.find(item => item.id === 'preview-reachable')
        .observations[0].response
    assert.strictEqual(rootObservation(exact).bodyBytes, BODY_LIMIT)
    assert.strictEqual(rootObservation(exact).truncated, false)
    assert.strictEqual(rootObservation(over).bodyBytes, BODY_LIMIT)
    assert.strictEqual(rootObservation(over).truncated, true)
  })

  console.log(
    `\n${passed} passed, ${failed} failed (preview-assurance.test.js)`
  )
  if (failed > 0) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
