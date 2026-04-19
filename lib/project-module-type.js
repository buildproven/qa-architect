'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Detect the target project's module system.
 *
 * Returns 'esm' if package.json has `"type": "module"`, otherwise 'cjs'.
 * Missing or unreadable package.json falls back to 'cjs' (Node's default).
 *
 * @param {string} projectPath - Path to project root
 * @returns {'esm'|'cjs'}
 */
function detectModuleType(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    return 'cjs'
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    return pkg.type === 'module' ? 'esm' : 'cjs'
  } catch {
    return 'cjs'
  }
}

/**
 * Convenience: true when the target project is ESM.
 * @param {string} projectPath
 * @returns {boolean}
 */
function isESMProject(projectPath) {
  return detectModuleType(projectPath) === 'esm'
}

/**
 * Detect the major version of an installed dep in the target project's
 * package.json (checks dependencies + devDependencies). Returns null if
 * not present or unparseable.
 *
 * @param {string} projectPath
 * @param {string} depName
 * @returns {number|null}
 */
function detectDepMajor(projectPath, depName) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return null
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const range =
      (pkg.dependencies && pkg.dependencies[depName]) ||
      (pkg.devDependencies && pkg.devDependencies[depName])
    if (!range) return null
    const match = String(range).match(/(\d+)\./)
    return match ? parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

module.exports = {
  detectModuleType,
  isESMProject,
  detectDepMajor,
}
