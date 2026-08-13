'use strict'

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { detectProjectProfile } = require('./project-profile')

const POLICY_PATH = '.buildproven/test-impact.json'
const WORKFLOW_PATH = '.github/workflows/test-impact.yml'
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'
const SETUP_NODE_SHA = '820762786026740c76f36085b0efc47a31fe5020'
const SHA_PATTERN = /^[0-9a-f]{40}$/
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

function selectJsRunner(testCommand, declaredRunners) {
  const invoked = declaredRunners.filter(runner =>
    RUNNER_PATTERNS[runner].test(testCommand)
  )
  if (invoked.length === 1) return invoked[0]
  if (invoked.length === 0 && RUNNER_PATTERNS.node.test(testCommand))
    return 'node'
  if (declaredRunners.length === 1) return declaredRunners[0]
  return 'none'
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function declaredDependencies(projectPath) {
  const packagePath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(packagePath)) return {}
  const pkg = readJson(packagePath)
  return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
}

function declaredTestCommand(projectPath, scriptName) {
  const packagePath = path.join(projectPath, 'package.json')
  if (!scriptName || !fs.existsSync(packagePath)) return ''
  return readJson(packagePath).scripts?.[scriptName] || ''
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
  if (fs.existsSync(path.join(projectPath, 'pytest.ini'))) return true
  if (fileContains(projectPath, 'pyproject.toml', /\[tool\.pytest\b/))
    return true
  if (fileContains(projectPath, 'setup.cfg', /\[tool:pytest\]/)) return true
  if (fileContains(projectPath, 'tox.ini', /\bpytest\b/)) return true
  const requirements = fs
    .readdirSync(projectPath)
    .filter(file => /^requirements.*\.txt$/.test(file))
  return requirements.some(file =>
    fileContains(projectPath, file, /^pytest(?:\b|[<=>])/m)
  )
}

function installCommands(projectPath, profile, python) {
  const commands = []
  if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    commands.push(profile.installCommand)
  }
  if (python) {
    if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
      commands.push('python -m pip install -r requirements.txt')
    } else {
      commands.push(null)
    }
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
  return null
}

function workflowInventory(projectPath) {
  const directory = path.join(projectPath, '.github', 'workflows')
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory)
    .filter(file => /\.ya?ml$/.test(file))
    .sort()
    .map(file => {
      const relativePath = `.github/workflows/${file}`
      const content = fs.readFileSync(path.join(directory, file), 'utf8')
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
    if (entry.isDirectory()) {
      if (!SCAN_IGNORES.has(entry.name)) {
        files.push(...walkFiles(projectPath, child))
      }
    } else if (entry.isFile()) {
      files.push(child)
    }
  }
  return files
}

function testStem(file) {
  return path.basename(file).replace(/\.(?:test|spec)?\.[cm]?js$/, '')
}

function sourceStem(file) {
  return path.basename(file).replace(/\.[cm]?js$/, '')
}

function plainNodeMappings(projectPath) {
  const files = walkFiles(projectPath).filter(file => NODE_FILE.test(file))
  const tests = files.filter(file => NODE_TEST.test(file)).sort()
  const sources = files.filter(file => !NODE_TEST.test(file)).sort()
  return sources.flatMap(source => {
    const matchingTests = tests.filter(
      test => testStem(test) === sourceStem(source)
    )
    if (matchingTests.length === 0) return []
    return [
      {
        paths: [source],
        commands: matchingTests.map(test => ({
          executable: 'node',
          args: [test],
        })),
      },
    ]
  })
}

function buildPolicy(projectPath) {
  const profile = detectProjectProfile(projectPath)
  const dependencies = declaredDependencies(projectPath)
  const python = hasPythonTests(projectPath)
  const installs = installCommands(projectPath, profile, python)
  const managerSetup = packageManagerSetup(profile)
  const completeCommands = []
  const testCommand = commandForScript(profile, profile.scripts.test)
  if (testCommand) completeCommands.push(testCommand)
  if (python) {
    completeCommands.push({ executable: 'pytest', args: [] })
  }

  const declaredJsRunners = ['vitest', 'jest'].filter(
    runner => dependencies[runner]
  )
  const testCommandText = declaredTestCommand(projectPath, profile.scripts.test)
  const jsRunner = selectJsRunner(testCommandText, declaredJsRunners)

  const auditPaths = [
    POLICY_PATH,
    WORKFLOW_PATH,
    'package.json',
    'package-lock.json',
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
  ]
  const policy = {
    version: 1,
    jsRunner,
    mappings: jsRunner === 'node' ? plainNodeMappings(projectPath) : [],
    audits:
      completeCommands.length === 0
        ? []
        : [
            {
              paths: auditPaths,
              reason:
                'test dependency, runner, workflow, or selector policy changed',
              commands: completeCommands,
            },
          ],
  }

  const blockers = []
  if (completeCommands.length === 0) {
    blockers.push('No declared complete test command was found.')
  }
  if (profile.hasTests && jsRunner === 'none' && profile.scripts.test) {
    blockers.push(
      declaredJsRunners.length > 1
        ? 'JavaScript tests declare both Jest and Vitest. Select one runner or add repository-owned path mappings.'
        : 'JavaScript tests have no supported runner. Add repository-owned path mappings.'
    )
  }
  if (installs.includes(null)) {
    blockers.push(
      'Python tests have no supported install command. Add requirements.txt or a repository adapter.'
    )
  }
  if (managerSetup === null) {
    blockers.push(
      `The ${profile.packageManager} package manager needs a repository-owned setup adapter.`
    )
  }
  const workflows = workflowInventory(projectPath)
  if (
    workflows.some(
      workflow =>
        workflow.path !== WORKFLOW_PATH &&
        workflow.jobs.some(job => job.name === 'quality / required')
    )
  ) {
    blockers.push(
      'The quality / required status already exists. Choose a migration-safe context before generation.'
    )
  }

  return {
    schemaVersion: 1,
    policy,
    inventory: {
      packageManager: profile.packageManager,
      testScript: profile.scripts.test,
      jsRunner,
      python,
      packageManagerSetup: managerSetup || [],
      installCommands: installs.filter(Boolean),
      workflows,
    },
    blockers,
  }
}

function yamlCommand(command) {
  return [command.executable, ...command.args]
    .map(part => `'${String(part).replaceAll("'", "''")}'`)
    .join(' ')
}

function buildWorkflow(plan, runtimeSha) {
  if (!SHA_PATTERN.test(runtimeSha || '')) {
    throw new Error('runtimeSha must be an immutable 40-character commit SHA')
  }
  const auditCommands = plan.policy.audits[0]?.commands || []
  if (auditCommands.length === 0) {
    throw new Error('A declared complete test command is required')
  }
  if (plan.blockers.length > 0) {
    throw new Error(
      `Test-impact mappings are incomplete: ${plan.blockers.join(' ')}`
    )
  }
  const auditRun = auditCommands.map(yamlCommand).join('\n          ')
  const managerRun = plan.inventory.packageManagerSetup.join('\n          ')
  const installRun = plan.inventory.installCommands.join('\n          ')
  return `# Generated by QA Architect. Preserve existing workflows during canary use.
name: Test impact

on:
  pull_request_target:
  schedule:
    - cron: '23 7 1 * *'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: test-impact-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  quality-required:
    name: quality / required
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Check out candidate
        uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1
        with:
          repository: \${{ github.event.pull_request.head.repo.full_name || github.repository }}
          ref: \${{ github.event.pull_request.head.sha || github.sha }}
          path: candidate
          fetch-depth: 0
          persist-credentials: false
      - name: Check out protected policy
        uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1
        with:
          repository: \${{ github.repository }}
          ref: \${{ github.event.pull_request.base.sha || github.sha }}
          path: protected
          persist-credentials: false
      - name: Set up Node.js
        uses: actions/setup-node@${SETUP_NODE_SHA} # v7.0.0
        with:
          node-version: '24'
      - name: Set up the declared package manager
        if: \${{ hashFiles('candidate/package.json') != '' }}
        working-directory: candidate
        run: |
          ${managerRun || 'true'}
      - name: Check out the pinned planner
        uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1
        with:
          repository: buildproven/claude-kit
          ref: ${runtimeSha}
          path: runtime
          persist-credentials: false
      - name: Install declared dependencies
        working-directory: candidate
        run: |
          ${installRun}
      - name: Run affected tests
        if: github.event_name == 'pull_request_target'
        working-directory: candidate
        env:
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: |
          if ! git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null; then
            git fetch --no-tags --depth=1 "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git" "$BASE_SHA"
          fi
          mapfile -d '' changed < <(git diff --name-only -z "$BASE_SHA" "$HEAD_SHA")
          node ../runtime/scripts/test-impact.js --execute --policy-root ../protected -- "\${changed[@]}"
      - name: Run complete selector audit
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        working-directory: candidate
        run: |
          ${auditRun}
`
}

function writeGeneratedFiles(projectPath, plan, workflow) {
  const policyFile = path.join(projectPath, POLICY_PATH)
  const workflowFile = path.join(projectPath, WORKFLOW_PATH)
  const policyContent = `${JSON.stringify(plan.policy, null, 2)}\n`
  const outputs = [
    [policyFile, policyContent],
    [workflowFile, workflow],
  ]
  for (const [file, content] of outputs) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== content) {
      throw new Error(
        `Refusing to overwrite existing generated target: ${file}`
      )
    }
  }
  for (const [file, content] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return [POLICY_PATH, WORKFLOW_PATH]
}

module.exports = {
  POLICY_PATH,
  WORKFLOW_PATH,
  buildPolicy,
  buildWorkflow,
  writeGeneratedFiles,
  workflowInventory,
}
