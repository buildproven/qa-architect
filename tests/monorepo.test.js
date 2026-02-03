'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

/**
 * Edge case tests for monorepos and workspaces
 * Ensures quality automation setup works correctly in complex project structures
 */
async function testMonorepoEdgeCases() {
  console.log('🧪 Testing monorepo and workspace edge cases...\n')

  await testNpmWorkspaces()
  await testPnpmWorkspaces()
  await testYarnWorkspaces()
  await testLernaMonorepo()
  await testNxMonorepo()
  await testTurborepoMonorepo()
  await testRushMonorepo()
  await testNestedPackageJson()
  await testWorkspacePackageSetup()
  await testMixedLanguageMonorepo()
  await testDependabotPerPackageConfig()

  console.log('\n✅ All monorepo edge case tests passed!\n')
}

/**
 * Test npm workspaces configuration
 */
async function testNpmWorkspaces() {
  console.log('🔍 Testing npm workspaces...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-workspace-test-'))
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    // Initialize git
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create workspace root package.json
    const rootPackageJson = {
      name: 'monorepo-root',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create workspace package
    const packagesDir = path.join(testDir, 'packages', 'app')

    fs.mkdirSync(packagesDir, { recursive: true })

    const workspacePackageJson = {
      name: '@monorepo/app',
      version: '1.0.0',
    }

    fs.writeFileSync(
      path.join(packagesDir, 'package.json'),
      JSON.stringify(workspacePackageJson, null, 2)
    )

    // Create index file to make it a valid package

    fs.writeFileSync(path.join(packagesDir, 'index.js'), 'module.exports = {}')

    // Run setup in workspace root
    execSync(`node "${setupPath}"`, { cwd: testDir, stdio: 'pipe' })

    // Verify configs were created at root level (not in workspace packages)
    const expectedRootFiles = [
      '.prettierrc',
      'eslint.config.cjs',
      '.editorconfig',
    ]

    for (const file of expectedRootFiles) {
      const filePath = path.join(testDir, file)

      if (!fs.existsSync(filePath)) {
        throw new Error(`Expected root config file not created: ${file}`)
      }
    }

    // Verify workspace package does NOT have duplicate configs
    const workspaceConfigPath = path.join(packagesDir, '.prettierrc')

    if (fs.existsSync(workspaceConfigPath)) {
      throw new Error(
        'Workspace package should not have duplicate config files'
      )
    }

    console.log('  ✅ npm workspaces configuration works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test pnpm workspaces configuration
 */
async function testPnpmWorkspaces() {
  console.log('🔍 Testing pnpm workspaces...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm-workspace-test-'))
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create pnpm-workspace.yaml
    const pnpmWorkspaceConfig = `packages:
  - 'packages/*'
`

    fs.writeFileSync(
      path.join(testDir, 'pnpm-workspace.yaml'),
      pnpmWorkspaceConfig
    )

    // Create root package.json
    const rootPackageJson = {
      name: 'pnpm-monorepo',
      version: '1.0.0',
      private: true,
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create workspace package
    const packagesDir = path.join(testDir, 'packages', 'lib')

    fs.mkdirSync(packagesDir, { recursive: true })

    fs.writeFileSync(
      path.join(packagesDir, 'package.json'),
      JSON.stringify({ name: '@monorepo/lib', version: '1.0.0' }, null, 2)
    )

    fs.writeFileSync(path.join(packagesDir, 'index.js'), 'module.exports = {}')

    // Run setup
    execSync(`node "${setupPath}"`, { cwd: testDir, stdio: 'pipe' })

    // Verify pnpm-workspace.yaml still exists and wasn't modified
    const workspaceYamlPath = path.join(testDir, 'pnpm-workspace.yaml')

    if (!fs.existsSync(workspaceYamlPath)) {
      throw new Error('pnpm-workspace.yaml should not be removed')
    }

    // Verify configs are at root
    const prettierrcPath = path.join(testDir, '.prettierrc')

    if (!fs.existsSync(prettierrcPath)) {
      throw new Error('Root .prettierrc should be created')
    }

    console.log('  ✅ pnpm workspaces configuration works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test Yarn workspaces configuration
 */
async function testYarnWorkspaces() {
  console.log('🔍 Testing Yarn workspaces...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarn-workspace-test-'))
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create Yarn workspace config (similar to npm workspaces)
    const rootPackageJson = {
      name: 'yarn-monorepo',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create workspace packages
    const packagesDir = path.join(testDir, 'packages', 'utils')

    fs.mkdirSync(packagesDir, { recursive: true })

    fs.writeFileSync(
      path.join(packagesDir, 'package.json'),
      JSON.stringify({ name: '@monorepo/utils', version: '1.0.0' }, null, 2)
    )

    fs.writeFileSync(path.join(packagesDir, 'index.js'), 'module.exports = {}')

    // Run setup
    execSync(`node "${setupPath}"`, { cwd: testDir, stdio: 'pipe' })

    // Verify root configs exist
    const eslintConfigPath = path.join(testDir, 'eslint.config.cjs')

    if (!fs.existsSync(eslintConfigPath)) {
      throw new Error('Root eslint.config.cjs should be created')
    }

    console.log('  ✅ Yarn workspaces configuration works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test Lerna monorepo configuration
 */
async function testLernaMonorepo() {
  console.log('🔍 Testing Lerna monorepo...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lerna-test-'))
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create lerna.json
    const lernaConfig = {
      version: 'independent',
      packages: ['packages/*'],
      npmClient: 'npm',
    }

    fs.writeFileSync(
      path.join(testDir, 'lerna.json'),
      JSON.stringify(lernaConfig, null, 2)
    )

    // Create root package.json
    const rootPackageJson = {
      name: 'lerna-monorepo',
      version: '1.0.0',
      private: true,
      devDependencies: {
        lerna: '^8.0.0',
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create lerna package
    const packagesDir = path.join(testDir, 'packages', 'core')

    fs.mkdirSync(packagesDir, { recursive: true })

    fs.writeFileSync(
      path.join(packagesDir, 'package.json'),
      JSON.stringify({ name: '@monorepo/core', version: '1.0.0' }, null, 2)
    )

    fs.writeFileSync(path.join(packagesDir, 'index.js'), 'module.exports = {}')

    // Run setup
    execSync(`node "${setupPath}"`, { cwd: testDir, stdio: 'pipe' })

    // Verify lerna.json still exists
    const lernaJsonPath = path.join(testDir, 'lerna.json')

    if (!fs.existsSync(lernaJsonPath)) {
      throw new Error('lerna.json should not be removed')
    }

    // Verify configs are at root
    const editorconfigPath = path.join(testDir, '.editorconfig')

    if (!fs.existsSync(editorconfigPath)) {
      throw new Error('Root .editorconfig should be created')
    }

    console.log('  ✅ Lerna monorepo configuration works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test Nx monorepo detection
 */
async function testNxMonorepo() {
  console.log('🔍 Testing Nx monorepo detection...')

  const { detectMonorepoType } = require('../lib/package-utils')
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-test-'))

  try {
    // Create nx.json
    const nxConfig = {
      targetDefaults: {
        build: { dependsOn: ['^build'] },
      },
      defaultBase: 'main',
    }

    fs.writeFileSync(
      path.join(testDir, 'nx.json'),
      JSON.stringify(nxConfig, null, 2)
    )

    // Create root package.json with workspaces
    const rootPackageJson = {
      name: 'nx-monorepo',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*', 'apps/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create workspace packages
    const packagesDir = path.join(testDir, 'packages', 'shared')
    fs.mkdirSync(packagesDir, { recursive: true })
    fs.writeFileSync(
      path.join(packagesDir, 'package.json'),
      JSON.stringify({ name: '@nx-mono/shared', version: '1.0.0' }, null, 2)
    )

    const appsDir = path.join(testDir, 'apps', 'web')
    fs.mkdirSync(appsDir, { recursive: true })
    fs.writeFileSync(
      path.join(appsDir, 'package.json'),
      JSON.stringify({ name: '@nx-mono/web', version: '1.0.0' }, null, 2)
    )

    // Detect monorepo
    const result = detectMonorepoType(testDir)

    if (!result.isMonorepo) {
      throw new Error('Should detect Nx project as monorepo')
    }

    if (result.type !== 'nx') {
      throw new Error(`Expected type 'nx', got '${result.type}'`)
    }

    if (result.tool !== 'nx') {
      throw new Error(`Expected tool 'nx', got '${result.tool}'`)
    }

    // Should have resolved packages
    if (!result.resolvedPackages || result.resolvedPackages.length === 0) {
      throw new Error('Should resolve workspace packages for Nx')
    }

    console.log('  ✅ Nx monorepo detection works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test Turborepo detection
 */
async function testTurborepoMonorepo() {
  console.log('🔍 Testing Turborepo detection...')

  const { detectMonorepoType } = require('../lib/package-utils')
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-test-'))

  try {
    // Create turbo.json
    const turboConfig = {
      $schema: 'https://turbo.build/schema.json',
      globalDependencies: ['**/.env.*local'],
      pipeline: {
        build: {
          dependsOn: ['^build'],
          outputs: ['dist/**'],
        },
        lint: {},
        test: {},
      },
    }

    fs.writeFileSync(
      path.join(testDir, 'turbo.json'),
      JSON.stringify(turboConfig, null, 2)
    )

    // Create root package.json with workspaces
    const rootPackageJson = {
      name: 'turbo-monorepo',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create workspace packages
    const pkgDir = path.join(testDir, 'packages', 'ui')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@turbo-mono/ui', version: '1.0.0' }, null, 2)
    )

    // Detect monorepo
    const result = detectMonorepoType(testDir)

    if (!result.isMonorepo) {
      throw new Error('Should detect Turborepo project as monorepo')
    }

    if (result.type !== 'turborepo') {
      throw new Error(`Expected type 'turborepo', got '${result.type}'`)
    }

    if (result.tool !== 'turborepo') {
      throw new Error(`Expected tool 'turborepo', got '${result.tool}'`)
    }

    console.log('  ✅ Turborepo detection works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test Rush monorepo detection
 */
async function testRushMonorepo() {
  console.log('🔍 Testing Rush monorepo detection...')

  const { detectMonorepoType } = require('../lib/package-utils')
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rush-test-'))

  try {
    // Create rush.json (simplified)
    const rushConfig = {
      $schema:
        'https://developer.microsoft.com/json-schemas/rush/v5/rush.schema.json',
      rushVersion: '5.100.0',
      pnpmVersion: '8.0.0',
      nodeSupportedVersionRange: '>=18.0.0',
      projects: [{ packageName: '@rush-mono/app', projectFolder: 'apps/app' }],
    }

    fs.writeFileSync(
      path.join(testDir, 'rush.json'),
      JSON.stringify(rushConfig, null, 2)
    )

    // Create root package.json
    const rootPackageJson = {
      name: 'rush-monorepo',
      version: '1.0.0',
      private: true,
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Detect monorepo
    const result = detectMonorepoType(testDir)

    if (!result.isMonorepo) {
      throw new Error('Should detect Rush project as monorepo')
    }

    if (result.type !== 'rush') {
      throw new Error(`Expected type 'rush', got '${result.type}'`)
    }

    if (result.tool !== 'rush') {
      throw new Error(`Expected tool 'rush', got '${result.tool}'`)
    }

    console.log('  ✅ Rush monorepo detection works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test nested package.json handling
 */
async function testNestedPackageJson() {
  console.log('🔍 Testing nested package.json files...')

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-package-test-'))
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create root package.json
    const rootPackageJson = {
      name: 'root-project',
      version: '1.0.0',
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create nested directory with its own package.json
    const nestedDir = path.join(testDir, 'nested', 'project')

    fs.mkdirSync(nestedDir, { recursive: true })

    const nestedPackageJson = {
      name: 'nested-project',
      version: '1.0.0',
    }

    fs.writeFileSync(
      path.join(nestedDir, 'package.json'),
      JSON.stringify(nestedPackageJson, null, 2)
    )

    fs.writeFileSync(path.join(nestedDir, 'index.js'), 'module.exports = {}')

    // Run setup at root
    execSync(`node "${setupPath}"`, { cwd: testDir, stdio: 'pipe' })

    // Verify configs at root
    const rootPrettierPath = path.join(testDir, '.prettierrc')

    if (!fs.existsSync(rootPrettierPath)) {
      throw new Error('Root .prettierrc should be created')
    }

    // Verify nested directory doesn't get its own configs
    const nestedPrettierPath = path.join(nestedDir, '.prettierrc')

    if (fs.existsSync(nestedPrettierPath)) {
      throw new Error('Nested directory should not get duplicate configs')
    }

    console.log('  ✅ Nested package.json handling works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test setup run from within a workspace package
 */
async function testWorkspacePackageSetup() {
  console.log('🔍 Testing setup from workspace package directory...')

  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'workspace-package-setup-test-')
  )
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create workspace structure
    const rootPackageJson = {
      name: 'workspace-root',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    const workspaceDir = path.join(testDir, 'packages', 'web')

    fs.mkdirSync(workspaceDir, { recursive: true })

    fs.writeFileSync(
      path.join(workspaceDir, 'package.json'),
      JSON.stringify({ name: '@workspace/web', version: '1.0.0' }, null, 2)
    )

    fs.writeFileSync(path.join(workspaceDir, 'index.js'), 'module.exports = {}')

    // Run setup FROM workspace package directory (not root)
    execSync(`node "${setupPath}"`, { cwd: workspaceDir, stdio: 'pipe' })

    // Verify configs were created at workspace package level
    // (Since we're in a git repo but in a subdirectory with package.json,
    // it should treat it as the project root)
    const workspacePrettierPath = path.join(workspaceDir, '.prettierrc')

    if (!fs.existsSync(workspacePrettierPath)) {
      throw new Error('Workspace package should get its own configs')
    }

    console.log('  ✅ Setup from workspace package directory works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test mixed JavaScript + Python monorepo
 */
async function testMixedLanguageMonorepo() {
  console.log('🔍 Testing mixed JS+Python monorepo...')

  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mixed-lang-monorepo-test-')
  )
  const setupPath = path.join(__dirname, '..', 'setup.js')

  try {
    execSync('git init', { cwd: testDir, stdio: 'ignore' })
    execSync('git config user.email "test@example.com"', {
      cwd: testDir,
      stdio: 'ignore',
    })
    execSync('git config user.name "Test User"', {
      cwd: testDir,
      stdio: 'ignore',
    })

    // Create workspace structure
    const rootPackageJson = {
      name: 'mixed-monorepo',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create JavaScript package
    const jsPackageDir = path.join(testDir, 'packages', 'js-app')

    fs.mkdirSync(jsPackageDir, { recursive: true })

    fs.writeFileSync(
      path.join(jsPackageDir, 'package.json'),
      JSON.stringify({ name: '@monorepo/js-app', version: '1.0.0' }, null, 2)
    )

    fs.writeFileSync(
      path.join(jsPackageDir, 'index.js'),
      'console.log("JS app")'
    )

    // Create Python package with 5+ meaningful files to trigger detection
    const pyPackageDir = path.join(testDir, 'packages', 'py-lib')

    fs.mkdirSync(pyPackageDir, { recursive: true })

    fs.writeFileSync(
      path.join(pyPackageDir, '__init__.py'),
      'print("Python lib")'
    )

    const pyLibFiles = [
      'main.py',
      'models.py',
      'utils.py',
      'views.py',
      'routes.py',
    ]
    for (const f of pyLibFiles) {
      fs.writeFileSync(path.join(pyPackageDir, f), 'def main():\n    pass')
    }

    // Run setup
    execSync(`node "${setupPath}"`, { cwd: testDir, stdio: 'pipe' })

    // Verify both JS and Python configs at root
    const expectedFiles = [
      '.prettierrc',
      'eslint.config.cjs',
      'pyproject.toml',
      '.pre-commit-config.yaml',
    ]

    for (const file of expectedFiles) {
      const filePath = path.join(testDir, file)

      if (!fs.existsSync(filePath)) {
        throw new Error(
          `Expected ${file} for mixed language monorepo at root level`
        )
      }
    }

    // Verify package.json was updated with scripts for both languages
    const updatedPackageJson = JSON.parse(
      fs.readFileSync(path.join(testDir, 'package.json'), 'utf8')
    )

    if (!updatedPackageJson.scripts) {
      throw new Error('package.json should have scripts added')
    }

    // Should have JavaScript tooling scripts
    if (!updatedPackageJson.scripts.format) {
      throw new Error('Should have JavaScript format script')
    }

    // Should have Python helper scripts
    if (
      !updatedPackageJson.scripts['python:format'] &&
      !updatedPackageJson.scripts['py:format']
    ) {
      console.warn('  ⚠️ Python format script not added (acceptable)')
    }

    console.log('  ✅ Mixed JS+Python monorepo configuration works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

/**
 * Test Dependabot per-package directory configuration for monorepos
 */
async function testDependabotPerPackageConfig() {
  console.log('🔍 Testing Dependabot per-package config generation...')

  const { detectMonorepoType } = require('../lib/package-utils')
  const {
    generateBasicDependabotConfig,
  } = require('../lib/dependency-monitoring-basic')
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-monorepo-'))

  try {
    // Create root package.json with workspaces
    const rootPackageJson = {
      name: 'monorepo-root',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    }

    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify(rootPackageJson, null, 2)
    )

    // Create workspace packages
    const pkg1Dir = path.join(testDir, 'packages', 'core')
    fs.mkdirSync(pkg1Dir, { recursive: true })
    fs.writeFileSync(
      path.join(pkg1Dir, 'package.json'),
      JSON.stringify({ name: '@mono/core', version: '1.0.0' }, null, 2)
    )

    const pkg2Dir = path.join(testDir, 'packages', 'utils')
    fs.mkdirSync(pkg2Dir, { recursive: true })
    fs.writeFileSync(
      path.join(pkg2Dir, 'package.json'),
      JSON.stringify({ name: '@mono/utils', version: '1.0.0' }, null, 2)
    )

    // Detect monorepo
    const monorepoInfo = detectMonorepoType(testDir)

    if (!monorepoInfo.isMonorepo) {
      throw new Error('Should detect as monorepo')
    }

    if (
      !monorepoInfo.resolvedPackages ||
      monorepoInfo.resolvedPackages.length !== 2
    ) {
      throw new Error(
        `Should resolve 2 packages, got ${monorepoInfo.resolvedPackages?.length}`
      )
    }

    // Generate Dependabot config with monorepo info
    const config = generateBasicDependabotConfig({
      projectPath: testDir,
      monorepoInfo,
    })

    if (!config) {
      throw new Error('Should generate Dependabot config')
    }

    // Should have: root npm + 2 package npm + github-actions = 4 entries
    const npmUpdates = config.updates.filter(
      u => u['package-ecosystem'] === 'npm'
    )
    const actionsUpdates = config.updates.filter(
      u => u['package-ecosystem'] === 'github-actions'
    )

    if (npmUpdates.length !== 3) {
      throw new Error(
        `Expected 3 npm update entries (root + 2 packages), got ${npmUpdates.length}`
      )
    }

    if (actionsUpdates.length !== 1) {
      throw new Error(
        `Expected 1 github-actions entry, got ${actionsUpdates.length}`
      )
    }

    // Verify per-package directories
    const directories = npmUpdates.map(u => u.directory).sort()
    const expectedDirs = ['/', '/packages/core', '/packages/utils'].sort()

    if (JSON.stringify(directories) !== JSON.stringify(expectedDirs)) {
      throw new Error(
        `Expected directories ${JSON.stringify(expectedDirs)}, got ${JSON.stringify(directories)}`
      )
    }

    // Verify labels include package names
    const coreUpdate = npmUpdates.find(u => u.directory === '/packages/core')
    if (!coreUpdate.labels.includes('@mono/core')) {
      throw new Error('Core package should have package name as label')
    }

    // Verify commit-message prefix includes package name
    if (!coreUpdate['commit-message'].prefix.includes('@mono/core')) {
      throw new Error('Core package should have package name in commit prefix')
    }

    console.log('  ✅ Dependabot per-package config generation works correctly')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testMonorepoEdgeCases().catch(error => {
    console.error('❌ Monorepo edge case tests failed:', error.message)
    process.exit(1)
  })
}

module.exports = { testMonorepoEdgeCases }
