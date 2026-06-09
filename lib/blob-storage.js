'use strict'

const { put, head } = require('@vercel/blob')

const BLOB_PREFIX = 'licenses/'

const BLOB_PATHS = {
  private: `${BLOB_PREFIX}legitimate-licenses.json`,
  public: `${BLOB_PREFIX}legitimate-licenses.public.json`,
}

/**
 * Load JSON from a Vercel Blob path.
 * Returns null ONLY if the blob does not exist (first-run).
 * Throws on infrastructure errors so callers can distinguish
 * "empty" from "broken".
 */
async function loadBlob(blobPath) {
  const result = await loadBlobWithEtag(blobPath)
  return result ? result.data : null
}

/**
 * Load JSON plus the blob's current ETag for optimistic-concurrency writes.
 * Returns null ONLY if the blob does not exist (first-run).
 * Returns { data, etag } otherwise — etag may be undefined if the store
 * does not surface one, in which case conditional writes degrade to
 * unconditional (callers should treat a missing etag as "cannot guard").
 */
async function loadBlobWithEtag(blobPath) {
  let metadata
  try {
    metadata = await head(blobPath)
  } catch (error) {
    if (
      error.code === 'blob_not_found' ||
      error.name === 'BlobNotFoundError' ||
      error.constructor?.name === 'BlobNotFoundError' ||
      error.message?.includes('does not exist')
    ) {
      return null
    }
    throw new Error(`Blob head failed for ${blobPath}: ${error.message}`)
  }

  const response = await fetch(metadata.url)
  if (!response.ok) {
    throw new Error(
      `Blob fetch failed for ${blobPath}: HTTP ${response.status}`
    )
  }

  let data
  try {
    data = await response.json()
  } catch (error) {
    throw new Error(`Blob JSON parse failed for ${blobPath}: ${error.message}`)
  }
  return { data, etag: metadata.etag }
}

/**
 * Save JSON to a Vercel Blob path.
 * Throws on failure so callers know the write did not persist.
 *
 * @param {string} blobPath
 * @param {unknown} data
 * @param {{ ifMatch?: string }} [options] When `ifMatch` is set, the write
 *   only succeeds if the blob's current ETag matches — otherwise the store
 *   throws BlobPreconditionFailedError. Used for cross-instance optimistic
 *   concurrency (Vercel functions don't share an in-process write queue).
 */
async function saveBlob(blobPath, data, options = {}) {
  const content = JSON.stringify(data, null, 2)
  return put(blobPath, content, {
    access: /** @type {const} */ ('public'),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  })
}

module.exports = { loadBlob, loadBlobWithEtag, saveBlob, BLOB_PATHS }
