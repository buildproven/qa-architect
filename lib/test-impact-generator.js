'use strict'

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { detectProjectProfile } = require('./project-profile')

const POLICY_PATH = '.buildproven/test-impact.json'
const NODE_FILE = /\.(?:[cm]?js)$/
const NODE_TEST =
  /(?:^|\/)(?:tests?|spec|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?js$/
const SCAN_IGNORES = new Set([
  '.buildproven',
  '.git',
  '.github',
  'build',
  'coverage',
  'dist',
  'node_modules',
])
const RUNNER_PATTERNS = {
  jest: /(^|[^A-Za-z0-9_-])jest([^A-Za-z0-9_-]|$)/,
  node: /(^|[\s;&|()])node(?:\s|$)/,
  vitest: /(^|[^A-Za-z0-9_-])vitest([^A-Za-z0-9_-]|$)/,
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function selectJsRunner(testCommand) {
  const invoked = ['vitest', 'jest'].filter(runner =>
    RUNNER_PATTERNS[runner].test(testCommand)
  )
  if (invoked.length === 1) return invoked[0]
  if (invoked.length === 0 && RUNNER_PATTERNS.node.test(testCommand)) {
    return 'node'
  }
  return 'none'
}

function declaredTestCommand(projectPath, scriptName) {
  const packagePath = path.join(projectPath, 'package.json')
  if (!scriptName || !fs.existsSync(packagePath)) return ''
  const scripts = readJson(packagePath).scripts || {}
  const commands = []
  const visited = new Set()

  function visit(name) {
    if (visited.has(name) || typeof scripts[name] !== 'string') return
    visited.add(name)
    const command = scripts[name]
    commands.push(command)
    const tokens = command
      .replaceAll('&&', ' ')
      .replaceAll('||', ' ')
      .replaceAll(';', ' ')
      .split(/\s+/)
    for (let index = 0; index < tokens.length; index += 1) {
      const manager = tokens[index]
      if (!['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) continue
      const usesRun = tokens[index + 1] === 'run'
      if (manager === 'npm' && !usesRun) continue
      if (manager === 'bun' && !usesRun) continue
      visit(tokens[index + (usesRun ? 2 : 1)])
    }
  }

  visit(scriptName)
  return commands.join('\n')
}

function commandForScript(profile, script) {
  if (!script) return null
  if (profile.packageManager === 'npm') {
    return { executable: 'npm', args: ['run', script] }
  }
  if (profile.packageManager === 'pnpm') {
    return { executable: 'pnpm', args: ['run', script] }
  }
  if (profile.packageManager === 'yarn') {
    return { executable: 'yarn', args: [script] }
  }
  if (profile.packageManager === 'bun') {
    return { executable: 'bun', args: ['run', script] }
  }
  return null
}

function fileContains(projectPath, file, pattern) {
  const target = path.join(projectPath, file)
  return fs.existsSync(target) && pattern.test(fs.readFileSync(target, 'utf8'))
}

function hasPythonTests(projectPath) {
  const hasDiscoverableTest = walkFiles(projectPath).some(file =>
    /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/.test(file)
  )
  if (!hasDiscoverableTest) return false

  if (fs.existsSync(path.join(projectPath, 'pytest.ini'))) return true
  if (fileContains(projectPath, 'pyproject.toml', /\[tool\.pytest\b/)) {
    return true
  }
  if (fileContains(projectPath, 'setup.cfg', /\[tool:pytest\]/)) return true
  if (fileContains(projectPath, 'tox.ini', /\bpytest\b/)) return true
  const requirements = fs
    .readdirSync(projectPath)
    .filter(file => /^requirements.*\.txt$/.test(file))
  return requirements.some(file =>
    fileContains(projectPath, file, /^pytest(?:\b|[<=>])/m)
  )
}

function immutableInstall(projectPath, profile) {
  if (!fs.existsSync(path.join(projectPath, 'package.json'))) return null
  if (profile.packageManager === 'npm') {
    const hasLock = ['package-lock.json', 'npm-shrinkwrap.json'].some(file =>
      fs.existsSync(path.join(projectPath, file))
    )
    return hasLock ? 'npm ci --ignore-scripts' : null
  }
  if (profile.packageManager === 'pnpm') {
    return 'pnpm install --frozen-lockfile --ignore-scripts'
  }
  if (profile.packageManager === 'yarn') {
    return 'yarn install --immutable --mode=skip-build'
  }
  if (profile.packageManager === 'bun') {
    return 'bun install --frozen-lockfile --ignore-scripts'
  }
  return null
}

function installCommands(projectPath, profile, python) {
  const commands = []
  if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    commands.push(immutableInstall(projectPath, profile))
  }
  if (python) {
    commands.push(
      fs.existsSync(path.join(projectPath, 'requirements.txt'))
        ? 'python -m pip install -r requirements.txt'
        : null
    )
  }
  return commands
}

function packageManagerSetup(profile) {
  if (profile.packageManager === 'npm') {
    return profile.packageManagerVersion
      ? [`npm install --global npm@${profile.packageManagerVersion}`]
      : []
  }
  if (profile.packageManager === 'pnpm' || profile.packageManager === 'yarn') {
    return [
      'corepack enable',
      `corepack prepare ${profile.packageManager}@${profile.packageManagerVersion} --activate`,
    ]
  }
  return profile.packageManager === 'bun' ? null : []
}

function workflowInventory(projectPath) {
  const githubDirectory = path.join(projectPath, '.github')
  const directory = path.join(projectPath, '.github', 'workflows')
  if (!fs.existsSync(directory)) return []
  if (
    fs.lstatSync(githubDirectory).isSymbolicLink() ||
    fs.lstatSync(directory).isSymbolicLink()
  ) {
    throw new Error('.github and .github/workflows must not be symbolic links')
  }
  return fs
    .readdirSync(directory)
    .filter(file => /\.ya?ml$/.test(file))
    .sort()
    .map(file => {
      const relativePath = `.github/workflows/${file}`
      const target = path.join(directory, file)
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${relativePath} must be a regular, non-symbolic file`)
      }
      const resolved = fs.realpathSync(target)
      if (!resolved.startsWith(`${fs.realpathSync(directory)}${path.sep}`)) {
        throw new Error(`${relativePath} must resolve inside .github/workflows`)
      }
      const noFollow = fs.constants.O_NOFOLLOW || 0
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow)
      let content
      try {
        if (!fs.fstatSync(descriptor).isFile()) {
          throw new Error(`${relativePath} must be a regular file`)
        }
        content = fs.readFileSync(descriptor, 'utf8')
      } finally {
        fs.closeSync(descriptor)
      }
      const parsed = yaml.load(content) || {}
      const jobs = Object.entries(parsed.jobs || {}).map(([id, job]) => ({
        id,
        name: job && typeof job === 'object' ? job.name || id : id,
      }))
      return { path: relativePath, jobs }
    })
}

function walkFiles(projectPath, relative = '') {
  const directory = path.join(projectPath, relative)
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory() && !SCAN_IGNORES.has(entry.name)) {
      files.push(...walkFiles(projectPath, child))
    } else if (entry.isFile()) {
      files.push(child)
    }
  }
  return files
}

function plainNodeSuggestions(projectPath) {
  const files = walkFiles(projectPath).filter(file => NODE_FILE.test(file))
  const tests = files.filter(file => NODE_TEST.test(file)).sort()
  return files
    .filter(file => !NODE_TEST.test(file))
    .sort()
    .flatMap(source => {
      const stem = path.basename(source).replace(/\.[cm]?js$/, '')
      const matches = tests.filter(test => {
        return (
          path.basename(test).replace(/\.(?:test|spec)?\.[cm]?js$/, '') === stem
        )
      })
      if (matches.length === 0) return []
      return [
        {
          paths: [source],
          commands: matches.map(test => ({ executable: 'node', args: [test] })),
        },
      ]
    })
}

function validateMappings(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  for (const [index, mapping] of value.entries()) {
    const valid =
      mapping &&
      Array.isArray(mapping.paths) &&
      mapping.paths.length > 0 &&
      mapping.paths.every(item => typeof item === 'string' && item) &&
      Array.isArray(mapping.commands) &&
      mapping.commands.length > 0 &&
      mapping.commands.every(command => {
        return (
          command &&
          typeof command.executable === 'string' &&
          command.executable &&
          Array.isArray(command.args) &&
          command.args.every(argument => typeof argument === 'string')
        )
      })
    if (!valid) throw new Error(`${label}[${index}] is invalid`)
  }
  return JSON.parse(JSON.stringify(value))
}

function mappingSource(projectPath, mappingFile) {
  const root = fs.realpathSync(projectPath)
  const source = mappingFile
    ? path.resolve(root, mappingFile)
    : path.join(root, POLICY_PATH)
  if (source !== root && !source.startsWith(`${root}${path.sep}`)) {
    throw new Error('Mapping file must be inside the project')
  }
  if (fs.existsSync(source)) {
    if (fs.lstatSync(source).isSymbolicLink()) {
      throw new Error('Mapping file must not be a symbolic link')
    }
    const resolved = fs.realpathSync(source)
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('Mapping file must resolve inside the project')
    }
  }
  return source
}

function repositoryMappings(projectPath, mappingFile) {
  const source = mappingSource(projectPath, mappingFile)
  if (!fs.existsSync(source)) return []
  const parsed = readJson(source)
  return validateMappings(
    mappingFile ? parsed : parsed.mappings || [],
    mappingFile || `${POLICY_PATH} mappings`
  )
}

function mergeMappings(existing, supplied) {
  const merged = new Map(
    existing.map(mapping => [JSON.stringify(mapping.paths), mapping])
  )
  for (const mapping of supplied) {
    const key = JSON.stringify(mapping.paths)
    const prior = merged.get(key)
    if (
      prior &&
      JSON.stringify(prior.commands) !== JSON.stringify(mapping.commands)
    ) {
      throw new Error(`Mapping conflict for paths ${mapping.paths.join(', ')}`)
    }
    merged.set(key, mapping)
  }
  return [...merged.values()]
}

function selectedMappings(projectPath, mappingFile, update) {
  const existing = repositoryMappings(projectPath, null)
  if (!mappingFile) return existing
  const supplied = repositoryMappings(projectPath, mappingFile)
  return update ? mergeMappings(existing, supplied) : supplied
}

function completeCommands(projectPath, profile, python) {
  const commands = []
  const script = commandForScript(profile, profile.scripts.test)
  if (script) commands.push(script)
  if (python) commands.push({ executable: 'pytest', args: [] })
  return commands
}

function runnerBlocker(profile, jsRunner) {
  if (!profile.hasTests || jsRunner !== 'none' || !profile.scripts.test) {
    return null
  }
  return 'JavaScript tests need a supported runner or repository-owned mappings.'
}

function installBlockers(projectPath, profile, python, installs) {
  const blockers = []
  let index = 0
  if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    if (installs[index] === null) {
      blockers.push(
        profile.packageManager === 'npm'
          ? 'npm ci requires package-lock.json or npm-shrinkwrap.json.'
          : 'JavaScript tests need an immutable install command or repository adapter.'
      )
    }
    index += 1
  }
  if (python && installs[index] === null) {
    blockers.push(
      'Python tests need requirements.txt or a repository-owned install adapter.'
    )
  }
  return blockers
}

function buildPolicy(projectPath, options = {}) {
  const profile = detectProjectProfile(projectPath)
  const python = hasPythonTests(projectPath)
  const installs = installCommands(projectPath, profile, python)
  const managerSetup = packageManagerSetup(profile)
  const commands = completeCommands(projectPath, profile, python)
  const testCommand = declaredTestCommand(projectPath, profile.scripts.test)
  const jsRunner = selectJsRunner(testCommand)
  const blockers = []
  let mappings = []
  try {
    mappings = selectedMappings(
      projectPath,
      options.mappingFile,
      options.update
    )
  } catch (error) {
    blockers.push(error.message)
  }
  const mappingSuggestions =
    jsRunner === 'node' ? plainNodeSuggestions(projectPath) : []
  if (mappingSuggestions.length > 0 && mappings.length === 0) {
    blockers.push(
      'Plain Node source mappings need repository-owned dependency or coverage evidence. Review inventory.mappingSuggestions and pass --mapping-file.'
    )
  }
  if (commands.length === 0)
    blockers.push('No declared complete test command was found.')
  const unsupportedRunner = runnerBlocker(profile, jsRunner)
  if (unsupportedRunner) blockers.push(unsupportedRunner)
  blockers.push(...installBlockers(projectPath, profile, python, installs))
  if (managerSetup === null) {
    blockers.push(
      `${profile.packageManager} needs a repository-owned setup adapter.`
    )
  }
  let workflows = []
  try {
    workflows = workflowInventory(projectPath)
  } catch (error) {
    blockers.push(error.message)
  }
  return {
    schemaVersion: 1,
    policy: {
      version: 1,
      jsRunner,
      mappings,
      audits:
        commands.length === 0
          ? []
          : [
              {
                paths: [
                  POLICY_PATH,
                  '.github/workflows/**/*.yml',
                  '.github/workflows/**/*.yaml',
                  '.husky/**',
                  'scripts/**',
                  'Dockerfile*',
                  '**/*.sh',
                  '**/*.sql',
                  'package.json',
                  'package-lock.json',
                  'npm-shrinkwrap.json',
                  'pnpm-lock.yaml',
                  'yarn.lock',
                  'bun.lock',
                  'bun.lockb',
                  'pyproject.toml',
                  'pytest.ini',
                  'setup.cfg',
                  'tox.ini',
                  'requirements*.txt',
                  'vitest.config.*',
                  'jest.config.*',
                ],
                reason:
                  'test dependency, runner, workflow, or selector policy changed',
                commands,
              },
            ],
      fallback: commands,
    },
    inventory: {
      packageManager: profile.packageManager,
      testScript: profile.scripts.test,
      jsRunner,
      python,
      packageManagerSetup: managerSetup || [],
      installCommands: installs.filter(Boolean),
      mappingSuggestions,
      workflows,
    },
    blockers,
  }
}

function safePolicyTarget(projectPath) {
  const root = fs.realpathSync(projectPath)
  const parent = path.join(root, '.buildproven')
  const target = path.join(parent, 'test-impact.json')
  for (const entry of [parent, target]) {
    if (fs.existsSync(entry) && fs.lstatSync(entry).isSymbolicLink()) {
      throw new Error(
        `${path.relative(root, entry)} must not be a symbolic link`
      )
    }
  }
  fs.mkdirSync(parent, { recursive: true })
  const resolvedParent = fs.realpathSync(parent)
  if (
    resolvedParent !== root &&
    !resolvedParent.startsWith(`${root}${path.sep}`)
  ) {
    throw new Error('Policy target must stay inside the project')
  }
  return target
}

function writeGeneratedFiles(projectPath, plan, options = {}) {
  const target = safePolicyTarget(projectPath)
  const content = `${JSON.stringify(plan.policy, null, 2)}\n`
  if (
    fs.existsSync(target) &&
    fs.readFileSync(target, 'utf8') !== content &&
    options.update !== true
  ) {
    throw new Error(`Refusing to overwrite existing policy: ${target}`)
  }
  const temporary = `${target}.qa-architect-${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' })
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return [POLICY_PATH]
}

module.exports = {
  POLICY_PATH,
  buildPolicy,
  writeGeneratedFiles,
  workflowInventory,
}
