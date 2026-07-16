'use strict'

const fs = require('fs')
const path = require('path')
const { detectPackageManager } = require('./package-utils')

const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.mjs',
  'eslint.config.ts',
  'eslint.config.cts',
  'eslint.config.mts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
]

const PRETTIER_CONFIGS = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
]

const SCRIPT_CANDIDATES = {
  test: ['test', 'test:unit', 'test:ci'],
  lint: ['lint', 'lint:check'],
  format: ['format:check', 'format'],
  typecheck: ['type-check', 'typecheck', 'check-types'],
  build: ['build'],
}

const PACKAGE_MANAGER_LOCKFILES = {
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  bun: 'bun.lockb',
  npm: 'package-lock.json',
}

function firstExistingFile(projectPath, candidates) {
  return candidates.find(candidate =>
    fs.existsSync(path.join(projectPath, candidate))
  )
}

function parsePackageManagerVersion(packageJson, packageManager) {
  const declaration = packageJson.packageManager
  if (typeof declaration !== 'string') return null
  const separator = declaration.lastIndexOf('@')
  if (separator <= 0 || declaration.slice(0, separator) !== packageManager) {
    return null
  }
  return declaration.slice(separator + 1) || null
}

function declaredPackageManager(packageJson) {
  if (typeof packageJson.packageManager !== 'string') return null
  const separator = packageJson.packageManager.lastIndexOf('@')
  const name =
    separator > 0
      ? packageJson.packageManager.slice(0, separator)
      : packageJson.packageManager
  if (!Object.hasOwn(PACKAGE_MANAGER_LOCKFILES, name)) {
    throw new Error(
      `Unsupported packageManager declaration: ${packageJson.packageManager}`
    )
  }
  return name
}

function resolvePackageManager(projectPath, packageJson) {
  const declared = declaredPackageManager(packageJson)
  const lockfileManagers = Object.entries(PACKAGE_MANAGER_LOCKFILES)
    .filter(([, lockfile]) => fs.existsSync(path.join(projectPath, lockfile)))
    .map(([manager]) => manager)
  if (lockfileManagers.length > 1) {
    throw new Error(
      `Conflicting package-manager lockfiles: ${lockfileManagers.join(', ')}`
    )
  }
  if (
    declared &&
    lockfileManagers.length === 1 &&
    lockfileManagers[0] !== declared
  ) {
    throw new Error(
      `packageManager declares ${declared}, but ${PACKAGE_MANAGER_LOCKFILES[lockfileManagers[0]]} belongs to ${lockfileManagers[0]}`
    )
  }
  return declared || lockfileManagers[0] || detectPackageManager(projectPath)
}

function findScript(scripts, candidates) {
  return candidates.find(name => typeof scripts[name] === 'string') || null
}

function detectSubmodulePaths(projectPath) {
  const gitmodulesPath = path.join(projectPath, '.gitmodules')
  if (!fs.existsSync(gitmodulesPath)) return []
  const content = fs.readFileSync(gitmodulesPath, 'utf8')
  return [...content.matchAll(/^[ \t]*path[ \t]*=[ \t]*(.+?)[ \t]*$/gm)]
    .map(match => match[1])
    .filter(Boolean)
}

function hasTestFiles(projectPath, excludedDirectories) {
  const testPattern =
    /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/
  const queue = [{ directory: projectPath, depth: 0 }]
  while (queue.length > 0) {
    const { directory, depth } = queue.shift()
    if (depth > 4) continue
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const relative = path.relative(
        projectPath,
        path.join(directory, entry.name)
      )
      if (entry.isDirectory()) {
        if (
          !excludedDirectories.has(relative) &&
          !excludedDirectories.has(entry.name)
        ) {
          queue.push({
            directory: path.join(directory, entry.name),
            depth: depth + 1,
          })
        }
      } else if (testPattern.test(relative)) {
        return true
      }
    }
  }
  return false
}

function readPackageJson(projectPath, packageJsonInput) {
  if (packageJsonInput) return packageJsonInput
  const packageJsonPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return {}
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
}

function detectFrameworks(dependencies) {
  return ['next', 'react', 'vite'].filter(framework =>
    Boolean(dependencies[framework])
  )
}

function detectBuildOutputs(frameworks) {
  const outputs = new Set(['dist', 'build', 'coverage'])
  if (frameworks.includes('next')) {
    outputs.add('.next')
    outputs.add('out')
  }
  return [...outputs]
}

function createCommands(packageManager) {
  const runScript = name => {
    if (packageManager === 'yarn') return `yarn ${name}`
    if (packageManager === 'npm') return `npm run ${name}`
    return `${packageManager} run ${name}`
  }
  const exec = command =>
    packageManager === 'npm'
      ? `npx --no -- ${command}`
      : `${packageManager} exec ${command}`
  return { runScript, exec }
}

function detectProjectProfile(projectPath = process.cwd(), packageJsonInput) {
  const packageJson = readPackageJson(projectPath, packageJsonInput)
  const scripts = packageJson.scripts || {}
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  }
  const packageManager = resolvePackageManager(projectPath, packageJson)
  const packageManagerVersion = parsePackageManagerVersion(
    packageJson,
    packageManager
  )
  const submodulePaths = detectSubmodulePaths(projectPath)
  const frameworks = detectFrameworks(dependencies)
  const buildOutputs = detectBuildOutputs(frameworks)

  const selectedScripts = Object.fromEntries(
    Object.entries(SCRIPT_CANDIDATES).map(([capability, candidates]) => [
      capability,
      findScript(scripts, candidates),
    ])
  )
  const excludedDirectories = new Set([
    'node_modules',
    '.git',
    ...buildOutputs,
    ...submodulePaths,
  ])
  const eslintConfig =
    firstExistingFile(projectPath, ESLINT_CONFIGS) ||
    (packageJson.eslintConfig ? 'package.json#eslintConfig' : null)
  const prettierConfig =
    firstExistingFile(projectPath, PRETTIER_CONFIGS) ||
    (packageJson.prettier ? 'package.json#prettier' : null)
  const hasTests =
    Boolean(selectedScripts.test) ||
    hasTestFiles(projectPath, excludedDirectories) ||
    Boolean(dependencies.jest || dependencies.vitest || dependencies.mocha)

  const commands = createCommands(packageManager)

  return {
    packageManager,
    packageManagerVersion,
    frameworks,
    scripts: selectedScripts,
    hasTests,
    eslintConfig,
    prettierConfig,
    submodulePaths,
    buildOutputs,
    ...commands,
  }
}

module.exports = {
  ESLINT_CONFIGS,
  PRETTIER_CONFIGS,
  detectProjectProfile,
}
