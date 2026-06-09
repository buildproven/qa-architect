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

  try {
    return await response.json()
  } catch (error) {
    throw new Error(`Blob JSON parse failed for ${blobPath}: ${error.message}`)
  }
}

/**
 * Save JSON to a Vercel Blob path.
 * Throws on failure so callers know the write did not persist.
 */
async function saveBlob(blobPath, data) {
  const content = JSON.stringify(data, null, 2)
  return put(blobPath, content, {
    access: /** @type {const} */ ('public'),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

module.exports = { loadBlob, saveBlob, BLOB_PATHS }
