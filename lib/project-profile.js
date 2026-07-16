'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
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
  '.prettierrc.json5',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.toml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.ts',
  '.prettierrc.cts',
  '.prettierrc.mts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
  'prettier.config.cts',
  'prettier.config.mts',
]

const SCRIPT_CANDIDATES = {
  test: ['test', 'test:unit', 'test:ci'],
  lint: ['lint', 'lint:check'],
  format: ['format:check', 'format'],
  typecheck: ['type-check', 'typecheck', 'check-types'],
  build: ['build'],
}

const PACKAGE_MANAGER_LOCKFILES = {
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  bun: ['bun.lock', 'bun.lockb'],
  npm: ['package-lock.json'],
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
  const version = declaration.slice(separator + 1)
  const integrityIndex = version.indexOf('+sha')
  const semanticVersion =
    integrityIndex === -1 ? version : version.slice(0, integrityIndex)
  const integrity =
    integrityIndex === -1 ? '' : version.slice(integrityIndex + 1)
  const validIntegrity =
    integrity === '' ||
    /^sha(224|256|384|512)\.[0-9A-Za-z+/=_-]+$/.test(integrity)
  const [coreVersion, ...prereleaseParts] = semanticVersion.split('-')
  const numericParts = coreVersion.split('.')
  const validCore =
    numericParts.length === 3 &&
    numericParts.every(
      part =>
        part.length > 0 &&
        [...part].every(character => character >= '0' && character <= '9')
    )
  const prerelease = prereleaseParts.join('-')
  const validPrerelease =
    prereleaseParts.length === 0 ||
    (prerelease.length > 0 &&
      [...prerelease].every(character =>
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-'.includes(
          character
        )
      ))
  if (!validCore || !validPrerelease || !validIntegrity) {
    throw new Error(
      `packageManager must pin an exact ${packageManager} version: ${declaration}`
    )
  }
  return version
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
    .filter(([, lockfiles]) =>
      lockfiles.some(lockfile =>
        fs.existsSync(path.join(projectPath, lockfile))
      )
    )
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
      `packageManager declares ${declared}, but ${PACKAGE_MANAGER_LOCKFILES[lockfileManagers[0]].join('/')} belongs to ${lockfileManagers[0]}`
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
  const output = execFileSync(
    'git',
    ['config', '-f', gitmodulesPath, '--get-regexp', '^[^.]+\\..*\\.path$'],
    { cwd: projectPath, encoding: 'utf8' }
  ).trim()
  if (!output) return []
  return output.split('\n').map(line => {
    const submodulePath = line.replace(/^[^ \t]+[ \t]+/, '')
    const normalized = path.posix.normalize(submodulePath.replaceAll('\\', '/'))
    const hasControlCharacter = [...normalized].some(character => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
    if (
      path.posix.isAbsolute(normalized) ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      hasControlCharacter
    ) {
      throw new Error(`Unsafe submodule path: ${submodulePath}`)
    }
    return normalized
  })
}

function enqueueDirectory(queue, directory, depth, limit) {
  queue.push({ directory, depth })
  if (queue.length > limit) {
    throw new Error(`test discovery exceeded ${limit} directories`)
  }
}

function hasTestFiles(projectPath, excludedDirectories) {
  const maxDiscoveredEntries = 10_000
  const testPattern =
    /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/
  const queue = [{ directory: projectPath, depth: 0 }]
  let queueIndex = 0
  while (queueIndex < queue.length && queue.length <= maxDiscoveredEntries) {
    const { directory, depth } = queue[queueIndex]
    queueIndex += 1
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
          enqueueDirectory(
            queue,
            path.join(directory, entry.name),
            depth + 1,
            maxDiscoveredEntries
          )
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
      : packageManager === 'bun'
        ? `bun x ${command}`
        : `${packageManager} exec ${command}`
  return { runScript, exec }
}

function packageManagerMajor(version) {
  if (!version) return null
  const match = version.match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

function packageManagerCommands(packageManager, version, projectPath) {
  const hasLockfile = PACKAGE_MANAGER_LOCKFILES[packageManager].some(lockfile =>
    fs.existsSync(path.join(projectPath, lockfile))
  )
  if (packageManager === 'pnpm') {
    return {
      installCommand: hasLockfile
        ? 'pnpm install --frozen-lockfile'
        : 'pnpm install',
      auditCommand: 'pnpm audit --audit-level high',
      cacheManager: 'pnpm',
    }
  }
  if (packageManager === 'yarn') {
    const modernYarn = (packageManagerMajor(version) || 1) >= 2
    return {
      installCommand: modernYarn
        ? 'yarn install --immutable'
        : 'yarn install --frozen-lockfile',
      auditCommand: modernYarn
        ? 'yarn npm audit --severity high --all --recursive'
        : 'yarn audit --level high',
      cacheManager: 'yarn',
    }
  }
  if (packageManager === 'bun') {
    return {
      installCommand: hasLockfile
        ? 'bun install --frozen-lockfile'
        : 'bun install',
      auditCommand: 'bun audit --audit-level=high',
      cacheManager: null,
    }
  }
  return {
    installCommand: hasLockfile ? 'npm ci' : 'npm install',
    auditCommand: 'npm audit --audit-level high',
    cacheManager: 'npm',
  }
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
  const managerCommands = packageManagerCommands(
    packageManager,
    packageManagerVersion,
    projectPath
  )

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
    ...managerCommands,
  }
}

module.exports = {
  ESLINT_CONFIGS,
  PRETTIER_CONFIGS,
  detectProjectProfile,
}
