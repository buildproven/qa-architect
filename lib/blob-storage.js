'use strict'

const { get, put, head } = require('@vercel/blob')

const BLOB_PREFIX = 'licenses/'

const BLOB_PATHS = {
  private: `${BLOB_PREFIX}legitimate-licenses.json`,
  public: `${BLOB_PREFIX}legitimate-licenses.public.json`,
}

function getBlobOptions(blobPath) {
  if (blobPath === BLOB_PATHS.private) {
    const token = process.env.LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN
    if (!token) {
      throw new Error(
        'LICENSE_PRIVATE_BLOB_READ_WRITE_TOKEN is required for the private license database'
      )
    }
    return { access: /** @type {const} */ ('private'), token }
  }

  if (blobPath === BLOB_PATHS.public) {
    return { access: /** @type {const} */ ('public') }
  }

  throw new Error(`Unsupported license blob path: ${blobPath}`)
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
  const blobOptions = getBlobOptions(blobPath)
  let metadata
  try {
    metadata = await head(blobPath, blobOptions)
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

  const result = await get(blobPath, blobOptions)
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(
      `Blob fetch failed for ${blobPath}: HTTP ${result?.statusCode || 404}`
    )
  }

  let data
  try {
    data = await new Response(result.stream).json()
  } catch (error) {
    throw new Error(`Blob JSON parse failed for ${blobPath}: ${error.message}`)
  }
  return { data, etag: result.blob?.etag || metadata.etag }
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
  const blobOptions = getBlobOptions(blobPath)
  return put(blobPath, content, {
    ...blobOptions,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  })
}

module.exports = { loadBlob, loadBlobWithEtag, saveBlob, BLOB_PATHS }
