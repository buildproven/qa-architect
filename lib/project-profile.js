'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { StringDecoder } = require('string_decoder')
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
  format: ['format:check'],
  typecheck: ['type-check', 'typecheck', 'check-types'],
  build: ['build'],
}

const PACKAGE_MANAGER_LOCKFILES = {
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  bun: ['bun.lock', 'bun.lockb'],
  npm: ['package-lock.json'],
}

const FALLBACK_PACKAGE_MANAGER_VERSIONS = {
  pnpm: '10.34.5',
  yarnClassic: '1.22.22',
  yarnModern: '4.9.2',
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

function isModernYarnProject(projectPath) {
  if (
    fs.existsSync(path.join(projectPath, '.yarnrc.yml')) ||
    fs.existsSync(path.join(projectPath, '.yarn', 'releases'))
  ) {
    return true
  }
  const lockfile = path.join(projectPath, 'yarn.lock')
  if (!fs.existsSync(lockfile)) return false
  return /^__metadata:[ \t]*$/m.test(fs.readFileSync(lockfile, 'utf8'))
}

function resolvePackageManagerVersion(projectPath, packageJson, manager) {
  const declared = parsePackageManagerVersion(packageJson, manager)
  if (declared) return declared
  if (manager === 'pnpm') {
    return FALLBACK_PACKAGE_MANAGER_VERSIONS.pnpm
  }
  if (manager === 'yarn') {
    return isModernYarnProject(projectPath)
      ? FALLBACK_PACKAGE_MANAGER_VERSIONS.yarnModern
      : FALLBACK_PACKAGE_MANAGER_VERSIONS.yarnClassic
  }
  return null
}

function findScript(scripts, candidates) {
  return candidates.find(name => typeof scripts[name] === 'string') || null
}

function readGitlinksFromIndexOutput(outputPath) {
  const gitlinks = new Set()
  const inputDescriptor = fs.openSync(outputPath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let bytesRead
    do {
      bytesRead = fs.readSync(inputDescriptor, buffer, 0, buffer.length, null)
      pending += decoder.write(buffer.subarray(0, bytesRead))
      let delimiter = pending.indexOf('\0')
      while (delimiter !== -1) {
        const record = pending.slice(0, delimiter)
        if (record.startsWith('160000 ')) {
          gitlinks.add(record.slice(record.indexOf('\t') + 1))
        }
        pending = pending.slice(delimiter + 1)
        delimiter = pending.indexOf('\0')
      }
    } while (bytesRead > 0)
    pending += decoder.end()
    if (pending) {
      throw new Error('git ls-files returned an unterminated index record')
    }
  } finally {
    fs.closeSync(inputDescriptor)
  }
  return gitlinks
}

function gitlinkPaths(projectPath) {
  // Git exports repository-local variables to hooks. If QA Architect is
  // launched from a hook while inspecting a different project, inheriting
  // any GIT_* repository context can make `git ls-files` read the caller's
  // repository or fail to discover the target repository.
  const gitEnvironment = { ...process.env }
  for (const key of Object.keys(gitEnvironment)) {
    if (key.startsWith('GIT_')) delete gitEnvironment[key]
  }
  const outputDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qaa-gitlinks-')
  )
  const outputPath = path.join(outputDirectory, 'ls-files.bin')
  let outputDescriptor
  try {
    outputDescriptor = fs.openSync(outputPath, 'wx')
    const result = spawnSync('git', ['ls-files', '--stage', '-z'], {
      cwd: projectPath,
      env: gitEnvironment,
      encoding: 'utf8',
      stdio: ['ignore', outputDescriptor, 'pipe'],
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      const detail = String(result.stderr || '').trim()
      if (result.status === 128 && /not a git repository/i.test(detail)) {
        return null
      }
      throw new Error(
        `git ls-files failed${detail ? `: ${detail}` : ` with status ${result.status}`}`
      )
    }
    fs.closeSync(outputDescriptor)
    outputDescriptor = undefined
    return readGitlinksFromIndexOutput(outputPath)
  } finally {
    if (outputDescriptor !== undefined) fs.closeSync(outputDescriptor)
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    fs.rmdirSync(outputDirectory)
  }
}

function validateSubmodulePath(submodulePath) {
  const normalized = path.posix.normalize(submodulePath)
  const hasControlCharacter = [...normalized].some(character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  const hasGlobSyntax = /[*?[\]{}!]/.test(normalized)
  const hasAmbiguousWhitespace = normalized
    .split('/')
    .some(component => component !== component.trim())
  if (
    submodulePath.includes('\\') ||
    submodulePath !== normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith('#') ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    hasControlCharacter ||
    hasGlobSyntax ||
    hasAmbiguousWhitespace
  ) {
    throw new Error(`Unsafe submodule path: ${submodulePath}`)
  }
  return normalized
}

function detectSubmodulePaths(projectPath) {
  const gitmodulesPath = path.join(projectPath, '.gitmodules')
  const actualGitlinks = gitlinkPaths(projectPath)
  if (actualGitlinks === null) {
    if (fs.existsSync(gitmodulesPath)) {
      throw new Error('Cannot validate .gitmodules outside a Git worktree')
    }
    return []
  }
  if (!fs.existsSync(gitmodulesPath)) {
    if (actualGitlinks.size > 0) {
      throw new Error('Gitlink entries require a regular .gitmodules file')
    }
    return []
  }
  const gitmodulesStat = fs.lstatSync(gitmodulesPath)
  if (!gitmodulesStat.isFile() || gitmodulesStat.isSymbolicLink()) {
    throw new Error('.gitmodules must be a regular file')
  }
  const output = execFileSync(
    'git',
    ['config', '-f', gitmodulesPath, '--get-regexp', '^[^.]+\\..*\\.path$'],
    { cwd: projectPath, encoding: 'utf8' }
  ).trim()
  const configuredPaths = output
    ? output.split('\n').map(line => {
        const submodulePath = line.replace(/^[^ \t]+[ \t]+/, '')
        return validateSubmodulePath(submodulePath)
      })
    : []
  const configuredSet = new Set(configuredPaths)
  const missingGitlinks = configuredPaths.filter(
    submodulePath => !actualGitlinks.has(submodulePath)
  )
  const undeclaredGitlinks = [...actualGitlinks].filter(
    submodulePath => !configuredSet.has(submodulePath)
  )
  if (missingGitlinks.length > 0 || undeclaredGitlinks.length > 0) {
    throw new Error(
      `Submodule config/gitlink mismatch: missing gitlinks [${missingGitlinks.join(', ')}], undeclared gitlinks [${undeclaredGitlinks.join(', ')}]`
    )
  }
  return [...configuredSet]
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
  const packageManagerVersion = resolvePackageManagerVersion(
    projectPath,
    packageJson,
    packageManager
  )
  if (packageManager === 'bun' && !packageManagerVersion) {
    throw new Error(
      'Bun projects must declare an exact packageManager version (for example, "bun@1.2.20"); refusing a mutable latest setup.'
    )
  }
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
  const eslintDependencies = {
    eslint: Boolean(dependencies.eslint),
    typescriptPlugin: Boolean(dependencies['@typescript-eslint/eslint-plugin']),
    typescriptParser: Boolean(dependencies['@typescript-eslint/parser']),
  }
  const prettierDependency = Boolean(dependencies.prettier)
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
    eslintDependencies,
    prettierDependency,
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
