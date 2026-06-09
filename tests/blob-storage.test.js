'use strict'

// @ts-nocheck — test mocks use internal Node APIs (Module._resolveFilename, require.cache)

/**
 * Unit tests for lib/blob-storage.js
 * Mocks @vercel/blob to test load/save logic without real Vercel infra.
 */

const assert = require('node:assert')
const Module = require('module')

// --- Mock @vercel/blob ---
const mockStore = new Map()
let putCallArgs = null
let putShouldThrow = false
let headOverride = null

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
  put: async (path, content, options = {}) => {
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
  head: async path => {
    if (headOverride) return headOverride(path)
    if (!mockStore.has(path)) {
      const err = new Error('Blob not found')
      err.code = 'blob_not_found'
      throw err
    }
    const entry = mockStore.get(path)
    return { url: entry.url, etag: entry.etag }
  },
}

// Intercept require('@vercel/blob')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@vercel/blob') {
    return '@vercel/blob'
  }
  return originalResolve.call(this, request, parent, ...args)
}

require.cache['@vercel/blob'] = {
  id: '@vercel/blob',
  filename: '@vercel/blob',
  loaded: true,
  exports: mockBlob,
}

// Mock global fetch for blob content retrieval
const originalFetch = global.fetch
global.fetch = async url => {
  for (const [, entry] of mockStore) {
    if (entry.url === url) {
      return {
        ok: true,
        json: async () => JSON.parse(entry.content),
      }
    }
  }
  return { ok: false, status: 404 }
}

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
  const result = await loadBlob('nonexistent/path.json')
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
    const result = await loadBlob('missing/variant.json')
    assert.strictEqual(
      result,
      null,
      `Should return null for not-found variant: ${variant.label}`
    )
  }
  headOverride = null
  console.log('  ✅ loadBlob returns null for all not-found error shapes')
}

async function testSaveBlobCallsPutCorrectly() {
  console.log('  Testing saveBlob calls put with correct options...')
  mockStore.clear()
  putCallArgs = null

  const data = { foo: 'bar', count: 42 }
  const result = await saveBlob('test/data.json', data)

  assert.ok(result, 'saveBlob should return truthy result')
  assert.strictEqual(putCallArgs.path, 'test/data.json')
  assert.strictEqual(putCallArgs.options.addRandomSuffix, false)
  assert.strictEqual(putCallArgs.options.allowOverwrite, true)
  assert.strictEqual(putCallArgs.options.access, 'public')
  assert.strictEqual(putCallArgs.options.contentType, 'application/json')

  const savedContent = JSON.parse(putCallArgs.content)
  assert.deepStrictEqual(savedContent, data)
  console.log('  ✅ saveBlob calls put with correct options')
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
  const prevFetch = global.fetch
  mockStore.set('bad/fetch.json', {
    url: 'https://blob.vercel-storage.com/bad/fetch.json',
  })
  global.fetch = async () => ({ ok: false, status: 503 })
  await assert.rejects(
    () => loadBlob('bad/fetch.json'),
    /Blob fetch failed.*HTTP 503/,
    'Should throw on non-ok fetch'
  )
  global.fetch = prevFetch
  console.log('  ✅ loadBlob throws on fetch failure')
}

async function testLoadBlobThrowsOnInfraError() {
  console.log('  Testing loadBlob throws on infrastructure errors...')
  headOverride = async () => {
    throw new Error('Network timeout')
  }
  await assert.rejects(
    () => loadBlob('any/path.json'),
    /Blob head failed.*Network timeout/,
    'Should throw on head() infra error'
  )
  headOverride = null
  console.log('  ✅ loadBlob throws on infrastructure error')
}

async function testLoadBlobThrowsOnCorruptJson() {
  console.log('  Testing loadBlob throws on corrupt JSON...')
  mockStore.set('corrupt/data.json', {
    url: 'https://blob.vercel-storage.com/corrupt/data.json',
    content: '<html>not json</html>',
  })
  // Need fetch to return this content
  const prevFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    json: async () => JSON.parse('<html>not json</html>'),
  })
  await assert.rejects(
    () => loadBlob('corrupt/data.json'),
    /Blob JSON parse failed/,
    'Should throw on corrupt JSON'
  )
  global.fetch = prevFetch
  console.log('  ✅ loadBlob throws on corrupt JSON')
}

async function testSaveBlobThrowsOnPutError() {
  console.log('  Testing saveBlob throws when put() fails...')
  putShouldThrow = true
  await assert.rejects(
    () => saveBlob('fail/path.json', { x: 1 }),
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
  await saveBlob('etag/data.json', data)

  const result = await loadBlobWithEtag('etag/data.json')
  assert.ok(result, 'Should return a result object')
  assert.deepStrictEqual(result.data, data, 'data should round-trip')
  assert.ok(result.etag, 'etag should be present')
  console.log('  ✅ loadBlobWithEtag returns data + etag')
}

async function testLoadBlobWithEtagNullOnMissing() {
  console.log('  Testing loadBlobWithEtag returns null when blob absent...')
  mockStore.clear()
  const result = await loadBlobWithEtag('etag/missing.json')
  assert.strictEqual(result, null, 'Should return null for missing blob')
  console.log('  ✅ loadBlobWithEtag returns null on first-run')
}

async function testIfMatchGuardRejectsStaleWrite() {
  console.log('  Testing ifMatch rejects a stale conditional write...')
  mockStore.clear()
  // Initial write establishes etag v1
  await saveBlob('guard/data.json', { v: 1 })
  const stale = await loadBlobWithEtag('guard/data.json')

  // A concurrent writer bumps the etag to v2
  await saveBlob('guard/data.json', { v: 2 })

  // Our write using the now-stale etag must be rejected
  await assert.rejects(
    () => saveBlob('guard/data.json', { v: 3 }, { ifMatch: stale.etag }),
    /precondition/i,
    'Stale ifMatch write should be rejected'
  )

  // Sanity: the store still holds v2, not v3
  const current = await loadBlob('guard/data.json')
  assert.deepStrictEqual(current, { v: 2 }, 'Store should retain v2')
  console.log('  ✅ ifMatch guard rejects stale write')
}

async function testIfMatchGuardAllowsFreshWrite() {
  console.log('  Testing ifMatch allows a write with the current etag...')
  mockStore.clear()
  await saveBlob('fresh/data.json', { v: 1 })
  const fresh = await loadBlobWithEtag('fresh/data.json')

  // Write with the matching etag should succeed
  await saveBlob('fresh/data.json', { v: 2 }, { ifMatch: fresh.etag })
  const current = await loadBlob('fresh/data.json')
  assert.deepStrictEqual(current, { v: 2 }, 'Fresh write should commit')
  console.log('  ✅ ifMatch guard allows fresh write')
}

async function runTests() {
  console.log('🧪 Testing blob-storage.js...\n')

  try {
    await testLoadBlobReturnsNullOnNotFound()
    await testLoadBlobReturnsNullOnNotFoundVariants()
    await testSaveBlobCallsPutCorrectly()
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
    Module._resolveFilename = originalResolve
    delete require.cache['@vercel/blob']
    global.fetch = originalFetch
  }
}

runTests().catch(err => {
  console.error('\n❌ Blob storage test failed:', err.message)
  process.exit(1)
})
