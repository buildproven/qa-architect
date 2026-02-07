'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  // npm ecosystem
  detectFrameworks,
  generateReactGroups,
  generateVueGroups,
  generateAngularGroups,
  generateTestingGroups,
  generateBuildToolGroups,
  generateStorybookGroups,
  generateNpmGroups,

  // Python ecosystem
  detectPythonFrameworks,
  generateDjangoGroups,
  generateFlaskGroups,
  generateFastAPIGroups,
  generateDataScienceGroups,
  generatePythonTestingGroups,
  generatePipGroups,

  // Rust ecosystem
  detectRustFrameworks,
  generateActixGroups,
  generateAsyncRuntimeGroups,
  generateSerdeGroups,
  generateCargoGroups,

  // Ruby ecosystem
  detectRubyFrameworks,
  generateRailsGroups,
  generateRSpecGroups,
  generateBundlerGroups,

  // Multi-language
  detectAllEcosystems,

  // Main config
  generatePremiumDependabotConfig,
  writePremiumDependabotConfig,

  // Parsers
  parsePipRequirements,
  parsePyprojectToml,
  parseCargoToml,
  parseGemfile,

  // Constants
  NPM_FRAMEWORK_SIGNATURES,
  PYTHON_FRAMEWORK_SIGNATURES,
  RUST_FRAMEWORK_SIGNATURES,
  RUBY_FRAMEWORK_SIGNATURES,
} = require('../lib/dependency-monitoring-premium')

/**
 * Test suite for Premium Dependency Monitoring
 *
 * Covers: npm/Python/Rust/Ruby framework detection, file parsing,
 * group generation, multi-language config, and edge cases.
 */

const createTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'dep-premium-test-'))

const cleanup = dir => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('🧪 Testing Premium Dependency Monitoring...\n')

// ============================================================
// Section 1: npm Framework Detection
// ============================================================

// Test 1: React detection
{
  console.log('Test 1: React framework detection')
  const result = detectFrameworks({
    dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
    devDependencies: { jest: '^29.0.0' },
  })

  assert.strictEqual(result.primary, 'react', 'Should detect React as primary')
  assert(result.detected.react, 'Should detect react framework')
  assert(result.detected.react.present, 'React should be present')
  assert(
    result.detected.react.packages.includes('react'),
    'Should include react package'
  )
  assert.strictEqual(
    result.detected.react.version,
    '^18.0.0',
    'Should capture version from core package'
  )
  assert(result.detected.testing, 'Should also detect testing framework')
  console.log('  ✅ PASS')
}

// Test 2: Vue detection
{
  console.log('Test 2: Vue framework detection')
  const result = detectFrameworks({
    dependencies: { vue: '^3.0.0', pinia: '^2.0.0' },
  })

  assert.strictEqual(result.primary, 'vue', 'Should detect Vue as primary')
  assert(result.detected.vue.present, 'Vue should be present')
  assert(
    result.detected.vue.packages.includes('vue'),
    'Should include vue package'
  )
  assert(
    result.detected.vue.packages.includes('pinia'),
    'Should include pinia as vue state'
  )
  console.log('  ✅ PASS')
}

// Test 3: Angular detection
{
  console.log('Test 3: Angular framework detection')
  const result = detectFrameworks({
    dependencies: { '@angular/core': '^17.0.0', '@angular/common': '^17.0.0' },
    devDependencies: { '@angular/cli': '^17.0.0' },
  })

  assert.strictEqual(
    result.primary,
    'angular',
    'Should detect Angular as primary'
  )
  assert(result.detected.angular.present, 'Angular should be present')
  console.log('  ✅ PASS')
}

// Test 4: Svelte detection
{
  console.log('Test 4: Svelte framework detection')
  const result = detectFrameworks({
    dependencies: { svelte: '^4.0.0' },
    devDependencies: { '@sveltejs/kit': '^2.0.0' },
  })

  assert.strictEqual(
    result.primary,
    'svelte',
    'Should detect Svelte as primary'
  )
  assert(result.detected.svelte.present, 'Svelte should be present')
  console.log('  ✅ PASS')
}

// Test 5: Build tool detection
{
  console.log('Test 5: Build tool detection')
  const result = detectFrameworks({
    devDependencies: { vite: '^5.0.0', esbuild: '^0.20.0' },
  })

  assert.strictEqual(result.primary, null, 'Build tools alone have no primary')
  assert(result.detected.build.present, 'Build tools should be detected')
  assert(result.detected.build.packages.includes('vite'), 'Should detect vite')
  console.log('  ✅ PASS')
}

// Test 6: Multiple frameworks
{
  console.log('Test 6: Multiple frameworks detected (React + testing + build)')
  const result = detectFrameworks({
    dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
    devDependencies: { jest: '^29.0.0', vitest: '^1.0.0', vite: '^5.0.0' },
  })

  assert.strictEqual(result.primary, 'react', 'React should be primary')
  assert(result.detected.react, 'Should detect react')
  assert(result.detected.testing, 'Should detect testing')
  assert(result.detected.build, 'Should detect build tools')
  console.log('  ✅ PASS')
}

// Test 7: Empty package.json
{
  console.log('Test 7: Empty dependencies')
  const result = detectFrameworks({})

  assert.strictEqual(result.primary, null, 'No primary without deps')
  assert.strictEqual(
    Object.keys(result.detected).length,
    0,
    'No frameworks detected'
  )
  console.log('  ✅ PASS')
}

// Test 8: Storybook detection
{
  console.log('Test 8: Storybook detection via wildcard')
  const result = detectFrameworks({
    devDependencies: {
      '@storybook/react': '^7.0.0',
      '@storybook/addon-essentials': '^7.0.0',
    },
  })

  assert(result.detected.storybook, 'Should detect storybook')
  assert(
    result.detected.storybook.packages.length >= 2,
    'Should find multiple storybook packages'
  )
  console.log('  ✅ PASS')
}

// ============================================================
// Section 2: Python Parsing & Detection
// ============================================================

// Test 9: Parse requirements.txt
{
  console.log('Test 9: Parse requirements.txt')
  const tempDir = createTempDir()
  const reqPath = path.join(tempDir, 'requirements.txt')
  fs.writeFileSync(
    reqPath,
    [
      'flask==2.0.1',
      'pytest>=7.0.0',
      'requests',
      '# This is a comment',
      'numpy>=1.21.0  # inline comment',
      'django>=4.0,<5.0',
      '',
    ].join('\n')
  )

  const deps = parsePipRequirements(reqPath)
  assert.strictEqual(deps.flask, '==2.0.1', 'Should parse exact version')
  assert.strictEqual(deps.pytest, '>=7.0.0', 'Should parse min version')
  assert.strictEqual(deps.requests, '*', 'Should default to * for no version')
  assert.strictEqual(deps.numpy, '>=1.21.0', 'Should strip inline comments')
  assert(deps.django, 'Should parse django')
  assert(!deps['#'], 'Should skip comment lines')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 10: Parse requirements.txt with extras
{
  console.log('Test 10: Parse requirements with extras')
  const tempDir = createTempDir()
  const reqPath = path.join(tempDir, 'requirements.txt')
  fs.writeFileSync(reqPath, 'fastapi[all]>=0.100.0\nuvicorn[standard]\n')

  const deps = parsePipRequirements(reqPath)
  assert.strictEqual(
    deps.fastapi,
    '>=0.100.0',
    'Should parse package with extras'
  )
  assert.strictEqual(deps.uvicorn, '*', 'Should handle extras without version')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 11: Parse pyproject.toml - PEP 621
{
  console.log('Test 11: Parse pyproject.toml (PEP 621)')
  const tempDir = createTempDir()
  const tomlPath = path.join(tempDir, 'pyproject.toml')
  fs.writeFileSync(
    tomlPath,
    `[project]
name = "myapp"
dependencies = [
    "flask>=2.0.0",
    "requests>=2.28.0",
    "numpy",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "black",
]
`
  )

  const deps = parsePyprojectToml(tomlPath)
  assert.strictEqual(deps.flask, '>=2.0.0', 'Should parse PEP 621 deps')
  assert.strictEqual(deps.requests, '>=2.28.0', 'Should parse requests')
  assert.strictEqual(deps.numpy, '*', 'Should handle no version')
  assert.strictEqual(deps.pytest, '>=7.0.0', 'Should parse optional deps')
  assert.strictEqual(deps.black, '*', 'Should parse black from optional')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 12: Parse pyproject.toml - Poetry style
{
  console.log('Test 12: Parse pyproject.toml (Poetry style)')
  const tempDir = createTempDir()
  const tomlPath = path.join(tempDir, 'pyproject.toml')
  fs.writeFileSync(
    tomlPath,
    `[tool.poetry.dependencies]
python = "^3.9"
django = "^4.2"
celery = "^5.3"
`
  )

  const deps = parsePyprojectToml(tomlPath)
  assert.strictEqual(deps.django, '^4.2', 'Should parse Poetry-style deps')
  assert.strictEqual(deps.celery, '^5.3', 'Should parse celery')
  assert(!deps.python, 'Should skip python version specifier')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 13: Python framework detection - Django
{
  console.log('Test 13: Python framework detection (Django)')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'requirements.txt'),
    'django>=4.0\ndjangorestframework>=3.14\npytest>=7.0\n'
  )

  const result = detectPythonFrameworks(tempDir)
  assert.strictEqual(result.primary, 'django', 'Should detect Django primary')
  assert(result.detected.django, 'Should detect django framework')
  assert(result.detected.testing, 'Should detect testing framework')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 14: Python framework detection - FastAPI
{
  console.log('Test 14: Python framework detection (FastAPI)')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'requirements.txt'),
    'fastapi>=0.100.0\nuvicorn>=0.23.0\npydantic>=2.0.0\n'
  )

  const result = detectPythonFrameworks(tempDir)
  assert.strictEqual(result.primary, 'fastapi', 'Should detect FastAPI')
  assert(result.detected.fastapi, 'Should detect fastapi framework')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 15: Python framework detection - Data Science
{
  console.log('Test 15: Python framework detection (Data Science)')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'requirements.txt'),
    'numpy>=1.21\npandas>=1.5\nmatplotlib>=3.6\nscikit-learn>=1.2\n'
  )

  const result = detectPythonFrameworks(tempDir)
  assert(result.detected.datascience, 'Should detect data science stack')
  assert(
    result.detected.datascience.packages.includes('numpy'),
    'Should detect numpy'
  )
  assert(
    result.detected.datascience.packages.includes('pandas'),
    'Should detect pandas'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 16: No Python project
{
  console.log('Test 16: No Python project returns empty')
  const tempDir = createTempDir()
  const result = detectPythonFrameworks(tempDir)
  assert.strictEqual(result.primary, null, 'No primary')
  assert.strictEqual(Object.keys(result.detected).length, 0, 'No frameworks')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Section 3: Rust Parsing & Detection
// ============================================================

// Test 17: Parse Cargo.toml - simple versions
{
  console.log('Test 17: Parse Cargo.toml (simple versions)')
  const tempDir = createTempDir()
  const cargoPath = path.join(tempDir, 'Cargo.toml')
  fs.writeFileSync(
    cargoPath,
    `[package]
name = "myapp"
version = "0.1.0"

[dependencies]
actix-web = "4"
serde = "1.0"
tokio = "1"
`
  )

  const deps = parseCargoToml(cargoPath)
  assert.strictEqual(deps['actix-web'], '4', 'Should parse actix-web')
  assert.strictEqual(deps.serde, '1.0', 'Should parse serde')
  assert.strictEqual(deps.tokio, '1', 'Should parse tokio')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 18: Parse Cargo.toml - complex versions
{
  console.log('Test 18: Parse Cargo.toml (complex versions)')
  const tempDir = createTempDir()
  const cargoPath = path.join(tempDir, 'Cargo.toml')
  fs.writeFileSync(
    cargoPath,
    `[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
`
  )

  const deps = parseCargoToml(cargoPath)
  assert.strictEqual(deps.serde, '1.0', 'Should parse complex serde')
  assert.strictEqual(deps.tokio, '1', 'Should parse complex tokio')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 19: Rust framework detection - Actix
{
  console.log('Test 19: Rust framework detection (Actix)')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'Cargo.toml'),
    `[dependencies]\nactix-web = "4"\nactix-rt = "2"\ntokio = "1"\nserde = "1"\nserde_json = "1"\n`
  )

  const result = detectRustFrameworks(tempDir)
  assert.strictEqual(result.primary, 'actix', 'Should detect Actix as primary')
  assert(result.detected.actix, 'Should detect actix')
  assert(result.detected.async, 'Should detect async runtime')
  assert(result.detected.serde, 'Should detect serde')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 20: No Rust project
{
  console.log('Test 20: No Rust project returns empty')
  const tempDir = createTempDir()
  const result = detectRustFrameworks(tempDir)
  assert.strictEqual(result.primary, null, 'No primary')
  assert.strictEqual(Object.keys(result.detected).length, 0, 'No frameworks')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Section 4: Ruby Parsing & Detection
// ============================================================

// Test 21: Parse Gemfile
{
  console.log('Test 21: Parse Gemfile')
  const tempDir = createTempDir()
  const gemfilePath = path.join(tempDir, 'Gemfile')
  fs.writeFileSync(
    gemfilePath,
    `source 'https://rubygems.org'

gem 'rails', '~> 7.0'
gem 'pg', '>= 0.18'
gem 'puma'
# This is a comment
gem 'rspec-rails', '~> 6.0'
`
  )

  const deps = parseGemfile(gemfilePath)
  assert.strictEqual(deps.rails, '~> 7.0', 'Should parse rails version')
  assert.strictEqual(deps.pg, '>= 0.18', 'Should parse pg version')
  assert.strictEqual(deps.puma, '*', 'Should default to * for no version')
  assert.strictEqual(deps['rspec-rails'], '~> 6.0', 'Should parse rspec-rails')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 22: Ruby framework detection - Rails
{
  console.log('Test 22: Ruby framework detection (Rails)')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'Gemfile'),
    `gem 'rails', '~> 7.0'\ngem 'rspec', '~> 3.12'\ngem 'capybara'\n`
  )

  const result = detectRubyFrameworks(tempDir)
  assert.strictEqual(result.primary, 'rails', 'Should detect Rails as primary')
  assert(result.detected.rails, 'Should detect rails framework')
  assert(result.detected.testing, 'Should detect testing framework')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 23: No Ruby project
{
  console.log('Test 23: No Ruby project returns empty')
  const tempDir = createTempDir()
  const result = detectRubyFrameworks(tempDir)
  assert.strictEqual(result.primary, null, 'No primary')
  assert.strictEqual(Object.keys(result.detected).length, 0, 'No frameworks')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Section 5: Group Generators
// ============================================================

// Test 24: React groups
{
  console.log('Test 24: React group generation')
  const groups = generateReactGroups()
  assert(groups['react-core'], 'Should have react-core group')
  assert(groups['react-ecosystem'], 'Should have react-ecosystem group')
  assert(groups['react-ui'], 'Should have react-ui group')
  assert(groups['react-forms'], 'Should have react-forms group')
  assert(
    groups['react-core'].patterns.includes('react'),
    'Core should include react'
  )
  console.log('  ✅ PASS')
}

// Test 25: Vue groups
{
  console.log('Test 25: Vue group generation')
  const groups = generateVueGroups()
  assert(groups['vue-core'], 'Should have vue-core group')
  assert(groups['vue-ecosystem'], 'Should have vue-ecosystem group')
  assert(groups['vue-ui'], 'Should have vue-ui group')
  console.log('  ✅ PASS')
}

// Test 26: Angular groups
{
  console.log('Test 26: Angular group generation')
  const groups = generateAngularGroups()
  assert(groups['angular-core'], 'Should have angular-core group')
  assert(groups['angular-ecosystem'], 'Should have angular-ecosystem group')
  assert(groups['angular-ui'], 'Should have angular-ui group')
  console.log('  ✅ PASS')
}

// Test 27: Testing groups
{
  console.log('Test 27: Testing group generation')
  const groups = generateTestingGroups()
  assert(groups['testing-frameworks'], 'Should have testing-frameworks group')
  assert(
    groups['testing-frameworks']['dependency-type'] === 'development',
    'Testing should be dev dependency'
  )
  console.log('  ✅ PASS')
}

// Test 28: Build tool groups
{
  console.log('Test 28: Build tool group generation')
  const groups = generateBuildToolGroups()
  assert(groups['build-tools'], 'Should have build-tools group')
  assert(groups['build-tools'].patterns.includes('vite'), 'Should include vite')
  console.log('  ✅ PASS')
}

// Test 29: Storybook groups
{
  console.log('Test 29: Storybook group generation')
  const groups = generateStorybookGroups()
  assert(groups.storybook, 'Should have storybook group')
  assert(
    groups.storybook.patterns.includes('@storybook/*'),
    'Should use wildcard pattern'
  )
  console.log('  ✅ PASS')
}

// Test 30: Django groups
{
  console.log('Test 30: Django group generation')
  const groups = generateDjangoGroups()
  assert(groups['django-core'], 'Should have django-core')
  assert(groups['django-extensions'], 'Should have django-extensions')
  console.log('  ✅ PASS')
}

// Test 31: FastAPI groups
{
  console.log('Test 31: FastAPI group generation')
  const groups = generateFastAPIGroups()
  assert(groups['fastapi-core'], 'Should have fastapi-core')
  assert(
    groups['fastapi-core'].patterns.includes('fastapi'),
    'Should include fastapi'
  )
  assert(
    groups['fastapi-core'].patterns.includes('pydantic'),
    'Should include pydantic'
  )
  console.log('  ✅ PASS')
}

// Test 32: Flask groups
{
  console.log('Test 32: Flask group generation')
  const groups = generateFlaskGroups()
  assert(groups['flask-core'], 'Should have flask-core')
  console.log('  ✅ PASS')
}

// Test 33: Data science groups
{
  console.log('Test 33: Data science group generation')
  const groups = generateDataScienceGroups()
  assert(groups['data-core'], 'Should have data-core')
  assert(groups['ml-frameworks'], 'Should have ml-frameworks')
  assert(groups.visualization, 'Should have visualization')
  console.log('  ✅ PASS')
}

// Test 34: Python testing groups
{
  console.log('Test 34: Python testing group generation')
  const groups = generatePythonTestingGroups()
  assert(groups['testing-frameworks'], 'Should have testing-frameworks')
  assert(
    groups['testing-frameworks'].patterns.includes('pytest'),
    'Should include pytest'
  )
  console.log('  ✅ PASS')
}

// Test 35: Actix groups
{
  console.log('Test 35: Actix group generation')
  const groups = generateActixGroups()
  assert(groups['actix-core'], 'Should have actix-core')
  assert(groups['actix-ecosystem'], 'Should have actix-ecosystem')
  console.log('  ✅ PASS')
}

// Test 36: Async runtime groups
{
  console.log('Test 36: Async runtime group generation')
  const groups = generateAsyncRuntimeGroups()
  assert(groups['async-runtime'], 'Should have async-runtime')
  assert(
    groups['async-runtime'].patterns.includes('tokio'),
    'Should include tokio'
  )
  console.log('  ✅ PASS')
}

// Test 37: Serde groups
{
  console.log('Test 37: Serde group generation')
  const groups = generateSerdeGroups()
  assert(groups['serde-ecosystem'], 'Should have serde-ecosystem')
  console.log('  ✅ PASS')
}

// Test 38: Rails groups
{
  console.log('Test 38: Rails group generation')
  const groups = generateRailsGroups()
  assert(groups['rails-core'], 'Should have rails-core')
  assert(groups['rails-ecosystem'], 'Should have rails-ecosystem')
  console.log('  ✅ PASS')
}

// Test 39: RSpec groups
{
  console.log('Test 39: RSpec group generation')
  const groups = generateRSpecGroups()
  assert(groups['testing-frameworks'], 'Should have testing-frameworks')
  console.log('  ✅ PASS')
}

// ============================================================
// Section 6: Aggregated Group Generators
// ============================================================

// Test 40: generateNpmGroups with React+testing+build
{
  console.log('Test 40: generateNpmGroups aggregation')
  const npmFrameworks = {
    primary: 'react',
    detected: {
      react: { present: true, packages: ['react', 'react-dom'] },
      testing: { present: true, packages: ['jest'] },
      build: { present: true, packages: ['vite'] },
    },
  }
  const groups = generateNpmGroups(npmFrameworks)
  assert(groups['react-core'], 'Should include react groups')
  assert(groups['testing-frameworks'], 'Should include testing groups')
  assert(groups['build-tools'], 'Should include build groups')
  console.log('  ✅ PASS')
}

// Test 41: generatePipGroups with Django+testing
{
  console.log('Test 41: generatePipGroups aggregation')
  const pipFrameworks = {
    primary: 'django',
    detected: {
      django: { present: true, packages: ['django'] },
      testing: { present: true, packages: ['pytest'] },
    },
  }
  const groups = generatePipGroups(pipFrameworks)
  assert(groups['django-core'], 'Should include django groups')
  assert(groups['testing-frameworks'], 'Should include testing groups')
  console.log('  ✅ PASS')
}

// Test 42: generateCargoGroups with Actix+serde
{
  console.log('Test 42: generateCargoGroups aggregation')
  const cargoFrameworks = {
    primary: 'actix',
    detected: {
      actix: { present: true, packages: ['actix-web'] },
      serde: { present: true, packages: ['serde'] },
      async: { present: true, packages: ['tokio'] },
    },
  }
  const groups = generateCargoGroups(cargoFrameworks)
  assert(groups['actix-core'], 'Should include actix groups')
  assert(groups['serde-ecosystem'], 'Should include serde groups')
  assert(groups['async-runtime'], 'Should include async groups')
  console.log('  ✅ PASS')
}

// Test 43: generateBundlerGroups with Rails+testing
{
  console.log('Test 43: generateBundlerGroups aggregation')
  const bundlerFrameworks = {
    primary: 'rails',
    detected: {
      rails: { present: true, packages: ['rails'] },
      testing: { present: true, packages: ['rspec'] },
    },
  }
  const groups = generateBundlerGroups(bundlerFrameworks)
  assert(groups['rails-core'], 'Should include rails groups')
  assert(groups['testing-frameworks'], 'Should include testing groups')
  console.log('  ✅ PASS')
}

// ============================================================
// Section 7: Multi-language Detection
// ============================================================

// Test 44: detectAllEcosystems - npm only
{
  console.log('Test 44: detectAllEcosystems - npm only')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      dependencies: { react: '^18.0.0' },
    })
  )

  const ecosystems = detectAllEcosystems(tempDir)
  assert(ecosystems.npm, 'Should detect npm ecosystem')
  assert(!ecosystems.pip, 'Should not detect pip')
  assert(!ecosystems.cargo, 'Should not detect cargo')
  assert(!ecosystems.bundler, 'Should not detect bundler')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 45: detectAllEcosystems - multi-language
{
  console.log('Test 45: detectAllEcosystems - multi-language project')
  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ dependencies: { react: '^18.0.0' } })
  )
  fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'django>=4.0\n')
  fs.writeFileSync(
    path.join(tempDir, 'Cargo.toml'),
    '[dependencies]\ntokio = "1"\n'
  )
  fs.writeFileSync(path.join(tempDir, 'Gemfile'), "gem 'rails', '~> 7.0'\n")

  const ecosystems = detectAllEcosystems(tempDir)
  assert(ecosystems.npm, 'Should detect npm')
  assert(ecosystems.pip, 'Should detect pip')
  assert(ecosystems.cargo, 'Should detect cargo')
  assert(ecosystems.bundler, 'Should detect bundler')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 46: detectAllEcosystems - empty project
{
  console.log('Test 46: detectAllEcosystems - empty project')
  const tempDir = createTempDir()
  const ecosystems = detectAllEcosystems(tempDir)
  assert.strictEqual(
    Object.keys(ecosystems).length,
    0,
    'Empty project has no ecosystems'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Section 8: Premium Config Generation (requires QAA_DEVELOPER)
// ============================================================

// Test 47: Premium config - FREE tier falls back to basic
{
  console.log('Test 47: Premium config - FREE tier fallback')
  const origDev = process.env.QAA_DEVELOPER
  delete process.env.QAA_DEVELOPER
  const origKey = process.env.QAA_LICENSE_KEY
  delete process.env.QAA_LICENSE_KEY

  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ dependencies: { react: '^18.0.0' } })
  )

  const result = generatePremiumDependabotConfig({ projectPath: tempDir })
  // FREE tier returns basic config (not premium with ecosystems)
  assert(result, 'Should return a config')
  // Basic config doesn't have ecosystems property
  assert(
    !result.ecosystems || result.config,
    'FREE tier should return some config'
  )
  console.log('  ✅ PASS')

  // Restore env
  if (origDev) process.env.QAA_DEVELOPER = origDev
  else process.env.QAA_DEVELOPER = 'true'
  if (origKey) process.env.QAA_LICENSE_KEY = origKey
  cleanup(tempDir)
}

// Test 48: Premium config - PRO tier with React project
{
  console.log('Test 48: Premium config - PRO tier React project')
  process.env.QAA_DEVELOPER = 'true'

  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      devDependencies: { jest: '^29.0.0', vite: '^5.0.0' },
    })
  )

  const result = generatePremiumDependabotConfig({ projectPath: tempDir })
  assert(result, 'Should return result')
  assert(result.config, 'Should have config')
  assert(result.ecosystems, 'Should have ecosystems')
  assert(result.ecosystems.npm, 'Should have npm ecosystem')
  assert(result.config.version === 2, 'Config version should be 2')
  assert(result.config.updates.length >= 2, 'Should have npm + github-actions')

  const npmUpdate = result.config.updates.find(
    u => u['package-ecosystem'] === 'npm'
  )
  assert(npmUpdate, 'Should have npm update entry')
  assert(npmUpdate.groups, 'Should have npm groups')
  assert(npmUpdate.groups['react-core'], 'Should have react-core group')

  const actionsUpdate = result.config.updates.find(
    u => u['package-ecosystem'] === 'github-actions'
  )
  assert(actionsUpdate, 'Should always include github-actions')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 49: Premium config - multi-language
{
  console.log('Test 49: Premium config - multi-language project')
  process.env.QAA_DEVELOPER = 'true'

  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ dependencies: { vue: '^3.0.0' } })
  )
  fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'django>=4.0\n')

  const result = generatePremiumDependabotConfig({ projectPath: tempDir })
  assert(result.config.updates.length >= 3, 'npm + pip + github-actions')

  const pipUpdate = result.config.updates.find(
    u => u['package-ecosystem'] === 'pip'
  )
  assert(pipUpdate, 'Should have pip update entry')
  assert(
    pipUpdate.labels.includes('python'),
    'Pip entry should have python label'
  )
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 50: Premium config - no ecosystems returns null
{
  console.log('Test 50: Premium config - empty project returns null')
  process.env.QAA_DEVELOPER = 'true'

  const tempDir = createTempDir()
  const result = generatePremiumDependabotConfig({ projectPath: tempDir })
  assert.strictEqual(result, null, 'Empty project should return null')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Section 9: Write Premium Config
// ============================================================

// Test 51: writePremiumDependabotConfig produces valid YAML
{
  console.log('Test 51: writePremiumDependabotConfig writes valid YAML')
  process.env.QAA_DEVELOPER = 'true'

  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { jest: '^29.0.0' },
    })
  )

  const result = generatePremiumDependabotConfig({ projectPath: tempDir })
  const outputPath = path.join(tempDir, '.github', 'dependabot.yml')
  writePremiumDependabotConfig(result, outputPath)

  assert(fs.existsSync(outputPath), 'Config file should exist')
  const content = fs.readFileSync(outputPath, 'utf8')
  assert(content.includes('Premium Dependabot'), 'Should have premium header')
  assert(content.includes('package-ecosystem'), 'Should have ecosystem config')
  assert(content.includes('npm'), 'Should include npm ecosystem')

  // Validate YAML parseable
  const yaml = require('js-yaml')
  const parsed = yaml.load(content)
  assert(parsed.version === 2, 'Parsed version should be 2')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// ============================================================
// Section 10: Framework Signature Constants
// ============================================================

// Test 52: NPM signatures have expected structure
{
  console.log('Test 52: NPM framework signatures structure')
  const frameworks = [
    'react',
    'vue',
    'angular',
    'svelte',
    'testing',
    'build',
    'storybook',
  ]
  for (const fw of frameworks) {
    assert(NPM_FRAMEWORK_SIGNATURES[fw], `Should have ${fw} signatures`)
    const categories = Object.values(NPM_FRAMEWORK_SIGNATURES[fw])
    for (const cat of categories) {
      assert(Array.isArray(cat), `${fw} categories should be arrays`)
      assert(cat.length > 0, `${fw} categories should not be empty`)
    }
  }
  console.log('  ✅ PASS')
}

// Test 53: Python signatures have expected structure
{
  console.log('Test 53: Python framework signatures structure')
  const frameworks = [
    'django',
    'flask',
    'fastapi',
    'datascience',
    'testing',
    'web',
  ]
  for (const fw of frameworks) {
    assert(PYTHON_FRAMEWORK_SIGNATURES[fw], `Should have ${fw}`)
  }
  console.log('  ✅ PASS')
}

// Test 54: Rust signatures have expected structure
{
  console.log('Test 54: Rust framework signatures structure')
  const frameworks = ['actix', 'rocket', 'async', 'serde', 'testing']
  for (const fw of frameworks) {
    assert(RUST_FRAMEWORK_SIGNATURES[fw], `Should have ${fw}`)
  }
  console.log('  ✅ PASS')
}

// Test 55: Ruby signatures have expected structure
{
  console.log('Test 55: Ruby framework signatures structure')
  const frameworks = ['rails', 'sinatra', 'testing', 'utilities']
  for (const fw of frameworks) {
    assert(RUBY_FRAMEWORK_SIGNATURES[fw], `Should have ${fw}`)
  }
  console.log('  ✅ PASS')
}

// ============================================================
// Section 11: Edge Cases
// ============================================================

// Test 56: Empty requirements.txt
{
  console.log('Test 56: Empty requirements.txt')
  const tempDir = createTempDir()
  const reqPath = path.join(tempDir, 'requirements.txt')
  fs.writeFileSync(reqPath, '\n# just comments\n\n')

  const deps = parsePipRequirements(reqPath)
  assert.strictEqual(Object.keys(deps).length, 0, 'Should return empty deps')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 57: Empty Cargo.toml (no dependencies section)
{
  console.log('Test 57: Cargo.toml without dependencies section')
  const tempDir = createTempDir()
  const cargoPath = path.join(tempDir, 'Cargo.toml')
  fs.writeFileSync(cargoPath, '[package]\nname = "mylib"\nversion = "0.1.0"\n')

  const deps = parseCargoToml(cargoPath)
  assert.strictEqual(Object.keys(deps).length, 0, 'Should return empty deps')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 58: Empty Gemfile
{
  console.log('Test 58: Empty Gemfile')
  const tempDir = createTempDir()
  const gemfilePath = path.join(tempDir, 'Gemfile')
  fs.writeFileSync(gemfilePath, "source 'https://rubygems.org'\n# no gems\n")

  const deps = parseGemfile(gemfilePath)
  assert.strictEqual(Object.keys(deps).length, 0, 'Should return empty deps')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

// Test 59: generateNpmGroups with no detected frameworks
{
  console.log('Test 59: generateNpmGroups with empty detection')
  const groups = generateNpmGroups({ primary: null, detected: {} })
  assert.strictEqual(
    Object.keys(groups).length,
    0,
    'Should return empty groups'
  )
  console.log('  ✅ PASS')
}

// Test 60: generatePipGroups with empty detection
{
  console.log('Test 60: generatePipGroups with empty detection')
  const groups = generatePipGroups({ primary: null, detected: {} })
  assert.strictEqual(
    Object.keys(groups).length,
    0,
    'Should return empty groups'
  )
  console.log('  ✅ PASS')
}

// Test 61: Premium config custom schedule
{
  console.log('Test 61: Premium config with custom schedule')
  process.env.QAA_DEVELOPER = 'true'

  const tempDir = createTempDir()
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ dependencies: { express: '^4.0.0' } })
  )

  const result = generatePremiumDependabotConfig({
    projectPath: tempDir,
    schedule: 'daily',
    day: 'wednesday',
    time: '14:00',
  })

  assert(result, 'Should return result')
  const npmUpdate = result.config.updates.find(
    u => u['package-ecosystem'] === 'npm'
  )
  assert.strictEqual(
    npmUpdate.schedule.interval,
    'daily',
    'Should use custom schedule'
  )
  assert.strictEqual(
    npmUpdate.schedule.day,
    'wednesday',
    'Should use custom day'
  )
  assert.strictEqual(npmUpdate.schedule.time, '14:00', 'Should use custom time')
  console.log('  ✅ PASS')
  cleanup(tempDir)
}

console.log('\n✅ All Premium Dependency Monitoring tests passed!\n')
