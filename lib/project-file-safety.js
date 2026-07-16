'use strict'

const fs = require('fs')
const path = require('path')

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function assertSafeProjectFile(projectRoot, filePath) {
  const requestedRoot = path.resolve(projectRoot)
  const requestedTarget = path.resolve(filePath)
  if (!isWithin(requestedRoot, requestedTarget)) {
    throw new Error(`Refusing to access path outside project root: ${filePath}`)
  }
  const root = fs.realpathSync(requestedRoot)
  const target = path.join(root, path.relative(requestedRoot, requestedTarget))

  const relativeParts = path
    .relative(root, target)
    .split(path.sep)
    .filter(Boolean)
  let current = root
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index])
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Refusing to access symbolic link in project path: ${current}`
      )
    }
    const isTarget = index === relativeParts.length - 1
    if (isTarget && !stat.isFile()) {
      throw new Error(`Refusing to access non-regular project file: ${current}`)
    }
    if (!isTarget && !stat.isDirectory()) {
      throw new Error(
        `Refusing to traverse non-directory project path: ${current}`
      )
    }
  }
  return target
}

function openSafeProjectFile(projectRoot, filePath, flags) {
  const target = assertSafeProjectFile(projectRoot, filePath)
  return fs.openSync(target, flags | fs.constants.O_NOFOLLOW, 0o666)
}

function writeProjectFile(projectRoot, filePath, content) {
  const descriptor = openSafeProjectFile(
    projectRoot,
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC
  )
  try {
    fs.writeFileSync(descriptor, content)
  } finally {
    fs.closeSync(descriptor)
  }
}

function appendProjectFile(projectRoot, filePath, content) {
  const descriptor = openSafeProjectFile(
    projectRoot,
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_APPEND
  )
  try {
    fs.writeFileSync(descriptor, content)
  } finally {
    fs.closeSync(descriptor)
  }
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @param {BufferEncoding} [encoding]
 */
function readProjectFile(projectRoot, filePath, encoding = 'utf8') {
  const target = assertSafeProjectFile(projectRoot, filePath)
  return fs.readFileSync(target, encoding)
}

module.exports = {
  appendProjectFile,
  assertSafeProjectFile,
  readProjectFile,
  writeProjectFile,
}
