'use strict'

const fs = require('fs')
const path = require('path')
const { MANIFEST_VERSION } = require('./constants')
const { normalizeRelativePath, sha256 } = require('./fingerprint')

function createManifestEntry(projectRoot, relativePath) {
  const normalized = normalizeRelativePath(projectRoot, relativePath)
  const absolute = path.join(projectRoot, ...normalized.split('/'))
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(absolute, { encoding: 'buffer' })
    return ['symlink', normalized, target.toString('base64')]
  }
  if (!stat.isFile()) {
    throw new Error(`Unsupported eligible input type: ${normalized}`)
  }
  const bytes = fs.readFileSync(absolute)
  return ['file', normalized, (stat.mode & 0o111) !== 0, sha256(bytes)]
}

function createSourceRevision(projectRoot, eligiblePaths) {
  if (!Array.isArray(eligiblePaths)) {
    throw new Error('eligiblePaths must be an array')
  }
  const entries = eligiblePaths.map(candidate =>
    createManifestEntry(projectRoot, candidate)
  )
  entries.sort((left, right) =>
    Buffer.compare(
      Buffer.from(String(left[1]), 'utf8'),
      Buffer.from(String(right[1]), 'utf8')
    )
  )
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1][1] === entries[index][1]) {
      throw new Error(
        `Duplicate normalized eligible path: ${entries[index][1]}`
      )
    }
  }
  const manifest = ['qaa-content-manifest', MANIFEST_VERSION, entries]
  return {
    kind: 'content-digest',
    algorithm: 'sha256',
    manifestVersion: MANIFEST_VERSION,
    value: sha256(Buffer.from(JSON.stringify(manifest), 'utf8')),
  }
}

module.exports = { createSourceRevision }
