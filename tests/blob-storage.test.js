'use strict'

/**
 * Unit tests for lib/blob-storage.js
 * Mocks @vercel/blob to test load/save logic without real Vercel infra.
 */

const assert = require('node:assert')
const Module = require('module')

/**
 * @typedef {{path: string, content: string, options: {ifMatch?: string, addRandomSuffix?: boolean, allowOverwrite?: boolean, access?: string, contentType?: string, token?: string}}} PutCall
 * @typedef {{url: string, content?: string, etag?: string}} MockBlobEntry
 */

// --- Mock @vercel/blob ---
/** @type {Map<string, MockBlobEntry>} */
const mockStore = new Map()
/** @type {PutCall|null} */
let putCallArgs = null
let putShouldThrow = false
/** @type {((path: string) => Promise<{url: string, etag: string}>)|null} */
let headOverride = null
/** @type {((path: string) => Promise<unknown>)|null} */
let getOverride = null

// Monotonic etag generator so each write produces a distinct version tag,
// mirroring how a real object store changes the ETag on every mutation.
let etagCounter = 0

class BlobPreconditionFailedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlobPreconditionFailedError'
  }
}

const mockBlob = {
  BlobPreconditionFailedError,
  put: async (
    /** @type {string} */ path,
    /** @type {string} */ content,
    /** @type {PutCall['options']} */ options = {}
  ) => {
    if (putShouldThrow) {
      throw new Error('Blob store unavailable')
    }
    // Honor ifMatch optimistic-concurrency guard: reject if the stored
    // etag has moved on since the caller read it.
    if (options.ifMatch) {
      const current = mockStore.get(path)
      if (!current || current.etag !== options.ifMatch) {
        throw new BlobPreconditionFailedError(
          'Blob precondition failed: ETag does not match'
        )
      }
    }
    putCallArgs = { path, content, options }
    const url = `https://blob.vercel-storage.com/${path}`
    const etag = `etag-${++etagCounter}`
    mockStore.set(path, { url, content, etag })
    return { url, pathname: path }
  },
  head: async (/** @type {string} */ path) => {
    if (headOverride) return headOverride(path)
    if (!mockStore.has(path)) {
      const err = Object.assign(new Error('Blob not found'), {
        code: 'blob_not_found',
      })
      throw err
    }
    const entry = mockStore.get(path)
    return { url: entry.url, etag: entry.etag || '' }
  },
  get: async (/** @type {string} */ path) => {
    if (getOverride) return getOverride(path)
    const entry = mockStore.get(path)
    if (!entry) return null
    return {
      statusCode: 200,
      blob: { etag: entry.etag || '' },
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.content || ''))
          controller.close()
        },
      }),
    }
  },
}

// Intercept require('@vercel/blob')
const originalResolve = Reflect.get(Module, '_resolveFilename')
Reflect.set(Module, '_resolveFilename', function (request, parent, ...args) {
  if (request === '@vercel/blob') {
    return '@vercel/blob'
  }
  return originalResolve.call(this, request, parent, ...args)
})

const mockBlobModule = new Module('@vercel/blob')
mockBlobModule.filename = '@vercel/blob'
mockBlobModule.loaded = true
mockBlobModule.exports = mockBlob
require.cache['@vercel/blob'] = mockBlobModule

// Mock global fetch for blob content retrieval
const originalFetch = global.fetch
const originalPrivateBlobToken =
  process.env.LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN
process.env.LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN = 'test-private-blob-token'

// Now require the module under test
const {
  loadBlob,
  loadBlobWithEtag,
  saveBlob,
  BLOB_PATHS,
} = require('../lib/blob-storage')

async function testLoadBlobReturnsNullOnNotFound() {
  console.log('  Testing loadBlob returns null when blob not found...')
  mockStore.clear()
  const result = await loadBlob(BLOB_PATHS.public)
  assert.strictEqual(result, null, 'Should return null for missing blob')
  console.log('  ✅ loadBlob returns null on BlobNotFoundError')
}

async function testLoadBlobReturnsNullOnNotFoundVariants() {
  console.log(
    '  Testing loadBlob treats all "not found" error shapes as null...'
  )
  // Vercel's SDK has surfaced "not found" under several shapes across versions.
  // loadBlob must map every one of them to null (first-run), not throw.
  const variants = [
    {
      label: 'error.name',
      makeError: () => {
        const e = new Error('generic')
        e.name = 'BlobNotFoundError'
        return e
      },
    },
    {
      label: 'error.constructor.name',
      makeError: () => {
        class BlobNotFoundError extends Error {}
        return new BlobNotFoundError('boom')
      },
    },
    {
      label: 'error.message includes "does not exist"',
      makeError: () => new Error('The requested blob does not exist'),
    },
  ]

  for (const variant of variants) {
    headOverride = async () => {
      throw variant.makeError()
    }
    const result = await loadBlob(BLOB_PATHS.public)
    assert.strictEqual(
      result,
      null,
      `Should return null for not-found variant: ${variant.label}`
    )
  }
  headOverride = null
  console.log('  ✅ loadBlob returns null for all not-found error shapes')
}

async function testSaveBlobUsesPublicAccessForDerivedRegistry() {
  console.log('  Testing public registry uses public Blob access...')
  mockStore.clear()
  putCallArgs = null

  const data = { foo: 'bar', count: 42 }
  const result = await saveBlob(BLOB_PATHS.public, data)

  assert.ok(result, 'saveBlob should return truthy result')
  const call = putCallArgs
  assert.ok(call, 'put should capture its arguments')
  assert.strictEqual(call.path, BLOB_PATHS.public)
  assert.strictEqual(call.options.addRandomSuffix, false)
  assert.strictEqual(call.options.allowOverwrite, true)
  assert.strictEqual(call.options.access, 'public')
  assert.strictEqual(call.options.contentType, 'application/json')

  const savedContent = JSON.parse(call.content)
  assert.deepStrictEqual(savedContent, data)
  console.log('  ✅ public registry uses public access')
}

async function testSaveBlobUsesPrivateAccessForCustomerDatabase() {
  console.log('  Testing private database uses private Blob access...')
  mockStore.clear()
  putCallArgs = null

  await saveBlob(BLOB_PATHS.private, { email: 'customer@example.com' })

  const call = putCallArgs
  assert.ok(call, 'put should capture its arguments')
  assert.strictEqual(call.path, BLOB_PATHS.private)
  assert.strictEqual(call.options.access, 'private')
  assert.strictEqual(
    call.options.token,
    process.env.LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN,
    'private database must use the dedicated private-store token'
  )
  console.log('  ✅ private database uses private access and token')
}

async function testRoundTrip() {
  console.log('  Testing save then load round-trip...')
  mockStore.clear()

  const original = {
    _metadata: { version: '1.0' },
    'QAA-AAAA-BBBB-CCCC-DDDD': {
      tier: 'PRO',
      email: 'test@example.com',
    },
  }

  await saveBlob(BLOB_PATHS.private, original)
  const loaded = await loadBlob(BLOB_PATHS.private)

  assert.deepStrictEqual(loaded, original)
  console.log('  ✅ Round-trip: save then load returns same data')
}

async function testBlobPathsExist() {
  console.log('  Testing BLOB_PATHS constants...')
  assert.ok(BLOB_PATHS.private, 'private path should exist')
  assert.ok(BLOB_PATHS.public, 'public path should exist')
  assert.ok(
    BLOB_PATHS.private.includes('licenses/'),
    'private path should be under licenses/'
  )
  assert.ok(
    BLOB_PATHS.public.includes('licenses/'),
    'public path should be under licenses/'
  )
  console.log('  ✅ BLOB_PATHS constants are correct')
}

async function testLoadBlobThrowsOnFetchFailure() {
  console.log('  Testing loadBlob throws on non-ok fetch response...')
  // Override fetch to return non-ok for this specific test
  mockStore.set(BLOB_PATHS.public, {
    url: `https://blob.vercel-storage.com/${BLOB_PATHS.public}`,
  })
  getOverride = async () => ({ statusCode: 503 })
  await assert.rejects(
    () => loadBlob(BLOB_PATHS.public),
    /Blob fetch failed.*HTTP 503/,
    'Should throw on non-ok fetch'
  )
  getOverride = null
  console.log('  ✅ loadBlob throws on fetch failure')
}

async function testLoadBlobThrowsOnInfraError() {
  console.log('  Testing loadBlob throws on infrastructure errors...')
  headOverride = async () => {
    throw new Error('Network timeout')
  }
  await assert.rejects(
    () => loadBlob(BLOB_PATHS.public),
    /Blob head failed.*Network timeout/,
    'Should throw on head() infra error'
  )
  headOverride = null
  console.log('  ✅ loadBlob throws on infrastructure error')
}

async function testLoadBlobThrowsOnCorruptJson() {
  console.log('  Testing loadBlob throws on corrupt JSON...')
  mockStore.set(BLOB_PATHS.public, {
    url: `https://blob.vercel-storage.com/${BLOB_PATHS.public}`,
    content: '<html>not json</html>',
  })
  await assert.rejects(
    () => loadBlob(BLOB_PATHS.public),
    /Blob JSON parse failed/,
    'Should throw on corrupt JSON'
  )
  console.log('  ✅ loadBlob throws on corrupt JSON')
}

async function testSaveBlobThrowsOnPutError() {
  console.log('  Testing saveBlob throws when put() fails...')
  putShouldThrow = true
  await assert.rejects(
    () => saveBlob(BLOB_PATHS.public, { x: 1 }),
    /Blob store unavailable/,
    'Should throw on put() failure'
  )
  putShouldThrow = false
  console.log('  ✅ saveBlob throws on put() error')
}

async function testLoadBlobWithEtagReturnsEtag() {
  console.log('  Testing loadBlobWithEtag returns data + etag...')
  mockStore.clear()
  const data = { _metadata: { version: '1.0' }, a: 1 }
  await saveBlob(BLOB_PATHS.public, data)

  const result = await loadBlobWithEtag(BLOB_PATHS.public)
  assert.ok(result, 'Should return a result object')
  assert.deepStrictEqual(result.data, data, 'data should round-trip')
  assert.ok(result.etag, 'etag should be present')
  console.log('  ✅ loadBlobWithEtag returns data + etag')
}

async function testLoadBlobWithEtagNullOnMissing() {
  console.log('  Testing loadBlobWithEtag returns null when blob absent...')
  mockStore.clear()
  const result = await loadBlobWithEtag(BLOB_PATHS.public)
  assert.strictEqual(result, null, 'Should return null for missing blob')
  console.log('  ✅ loadBlobWithEtag returns null on first-run')
}

async function testIfMatchGuardRejectsStaleWrite() {
  console.log('  Testing ifMatch rejects a stale conditional write...')
  mockStore.clear()
  // Initial write establishes etag v1
  await saveBlob(BLOB_PATHS.public, { v: 1 })
  const stale = await loadBlobWithEtag(BLOB_PATHS.public)

  // A concurrent writer bumps the etag to v2
  await saveBlob(BLOB_PATHS.public, { v: 2 })

  // Our write using the now-stale etag must be rejected
  await assert.rejects(
    () => saveBlob(BLOB_PATHS.public, { v: 3 }, { ifMatch: stale.etag }),
    /precondition/i,
    'Stale ifMatch write should be rejected'
  )

  // Sanity: the store still holds v2, not v3
  const current = await loadBlob(BLOB_PATHS.public)
  assert.deepStrictEqual(current, { v: 2 }, 'Store should retain v2')
  console.log('  ✅ ifMatch guard rejects stale write')
}

async function testIfMatchGuardAllowsFreshWrite() {
  console.log('  Testing ifMatch allows a write with the current etag...')
  mockStore.clear()
  await saveBlob(BLOB_PATHS.public, { v: 1 })
  const fresh = await loadBlobWithEtag(BLOB_PATHS.public)

  // Write with the matching etag should succeed
  await saveBlob(BLOB_PATHS.public, { v: 2 }, { ifMatch: fresh.etag })
  const current = await loadBlob(BLOB_PATHS.public)
  assert.deepStrictEqual(current, { v: 2 }, 'Fresh write should commit')
  console.log('  ✅ ifMatch guard allows fresh write')
}

async function runTests() {
  console.log('🧪 Testing blob-storage.js...\n')

  try {
    await testLoadBlobReturnsNullOnNotFound()
    await testLoadBlobReturnsNullOnNotFoundVariants()
    await testSaveBlobUsesPublicAccessForDerivedRegistry()
    await testSaveBlobUsesPrivateAccessForCustomerDatabase()
    await testRoundTrip()
    await testBlobPathsExist()
    await testLoadBlobThrowsOnFetchFailure()
    await testLoadBlobThrowsOnInfraError()
    await testLoadBlobThrowsOnCorruptJson()
    await testSaveBlobThrowsOnPutError()
    await testLoadBlobWithEtagReturnsEtag()
    await testLoadBlobWithEtagNullOnMissing()
    await testIfMatchGuardRejectsStaleWrite()
    await testIfMatchGuardAllowsFreshWrite()

    console.log('\n✅ All blob-storage tests passed!\n')
  } finally {
    // Restore mocks
    Reflect.set(Module, '_resolveFilename', originalResolve)
    delete require.cache['@vercel/blob']
    global.fetch = originalFetch
    getOverride = null
    if (originalPrivateBlobToken === undefined) {
      delete process.env.LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN
    } else {
      process.env.LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN =
        originalPrivateBlobToken
    }
  }
}

runTests().catch(err => {
  console.error('\n❌ Blob storage test failed:', err.message)
  process.exit(1)
})
