'use strict'

/**
 * Unit tests for lib/blob-storage.js
 * Mocks @vercel/blob to test load/save logic without real Vercel infra.
 */

const assert = require('node:assert')
const Module = require('module')

// --- Mock @vercel/blob ---
const mockStore = new Map()
let putCallArgs = null

const mockBlob = {
  put: async (path, content, options) => {
    putCallArgs = { path, content, options }
    const url = `https://blob.vercel-storage.com/${path}`
    mockStore.set(path, { url, content })
    return { url, pathname: path }
  },
  head: async path => {
    if (!mockStore.has(path)) {
      const err = new Error('Blob not found')
      err.code = 'blob_not_found'
      throw err
    }
    return { url: mockStore.get(path).url }
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
const { loadBlob, saveBlob, BLOB_PATHS } = require('../lib/blob-storage')

async function testLoadBlobReturnsNullOnNotFound() {
  console.log('  Testing loadBlob returns null when blob not found...')
  mockStore.clear()
  const result = await loadBlob('nonexistent/path.json')
  assert.strictEqual(result, null, 'Should return null for missing blob')
  console.log('  ✅ loadBlob returns null on BlobNotFoundError')
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

async function testLoadBlobHandlesFetchFailure() {
  console.log('  Testing loadBlob handles fetch failure gracefully...')

  // Put a blob with valid head but make fetch fail
  mockStore.set('bad/fetch.json', { url: 'https://will-not-match.com/x' })
  const result = await loadBlob('bad/fetch.json')
  assert.strictEqual(result, null, 'Should return null on fetch failure')
  console.log('  ✅ loadBlob returns null on fetch failure')
}

async function runTests() {
  console.log('🧪 Testing blob-storage.js...\n')

  try {
    await testLoadBlobReturnsNullOnNotFound()
    await testSaveBlobCallsPutCorrectly()
    await testRoundTrip()
    await testBlobPathsExist()
    await testLoadBlobHandlesFetchFailure()

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
