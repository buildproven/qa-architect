'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const checkDocsScript = path.join(__dirname, '..', 'scripts', 'check-docs.sh')

/**
 * Test suite for scripts/check-docs.sh
 *
 * Tests documentation consistency validation:
 * - Version consistency between package.json and CHANGELOG.md
 * - File documentation in README.md
 * - Script documentation
 * - Exit codes
 */

const createTempProject = config => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-test-'))

  // Create package.json
  fs.writeFileSync(
    path.join(tempDir, 'package.json'),
    JSON.stringify(config.packageJson || { version: '1.0.0' }, null, 2)
  )

  // Create CHANGELOG.md
  if (config.changelog !== undefined) {
    fs.writeFileSync(path.join(tempDir, 'CHANGELOG.md'), config.changelog)
  }

  // Create README.md
  if (config.readme !== undefined) {
    fs.writeFileSync(path.join(tempDir, 'README.md'), config.readme)
  }

  // Create setup.js
  if (config.setupJs !== undefined) {
    fs.writeFileSync(path.join(tempDir, 'setup.js'), config.setupJs)
  }

  if (config.roadmap !== undefined) {
    fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), config.roadmap)
  }

  // Create .github directory (for any future checklist needs)
  const githubDir = path.join(tempDir, '.github')
  fs.mkdirSync(githubDir, { recursive: true })

  return tempDir
}

const cleanupTempDir = tempDir => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const runCheckDocs = (cwd, shouldSucceed = true) => {
  try {
    const result = execSync(`bash "${checkDocsScript}" 2>&1`, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    if (!shouldSucceed) {
      throw new Error(
        `Expected check-docs.sh to fail but it succeeded with output: ${result}`
      )
    }
    return { success: true, output: result, exitCode: 0 }
  } catch (error) {
    if (shouldSucceed) {
      throw new Error(
        `Expected check-docs.sh to succeed but it failed: ${error.message}\nOutput: ${error.stdout}\nError: ${error.stderr}`
      )
    }
    return {
      success: false,
      output: (error.stdout || '') + (error.stderr || ''),
      error: error.stderr || '',
      exitCode: error.status || 1,
    }
  }
}

// Test 1: Version consistency - matching version
console.log('Test 1: Version consistency check - matching versions')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n\n### Added\n- Initial release\n`,
    readme: '# Test Project\n\nThis is a test.',
    setupJs: "console.log('test')",
  })

  try {
    const result = runCheckDocs(tempDir, true)
    assert.strictEqual(
      result.success,
      true,
      'Should succeed with matching versions'
    )
    assert.ok(
      result.output.includes('Documentation consistency checks passed'),
      'Should show success message'
    )
    console.log('✓ Test 1 passed: Matching versions succeed')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 2: Version consistency - missing changelog entry
console.log('Test 2: Version consistency check - missing CHANGELOG entry')
{
  const tempDir = createTempProject({
    packageJson: { version: '2.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n\n### Added\n- Initial release\n`,
    readme: '# Test Project',
    setupJs: "console.log('test')",
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail with missing version'
    )
    assert.strictEqual(result.exitCode, 1, 'Should exit with code 1')
    assert.ok(
      result.output.includes('CHANGELOG.md missing entry for version 2.0.0') ||
        result.error.includes('CHANGELOG.md missing entry for version 2.0.0'),
      'Should show missing version error'
    )
    console.log('✓ Test 2 passed: Missing CHANGELOG entry detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 3: File inventory - .nvmrc documentation check
console.log('Test 3: File inventory - .nvmrc documentation')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme:
      '# Test Project\n\nThis is a basic project with no special files mentioned.',
    setupJs: `
      const fs = require('fs');
      fs.writeFileSync('.nvmrc', '20.11.1');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail when .nvmrc not documented'
    )
    assert.ok(
      result.output.includes('.nvmrc'),
      'Should mention .nvmrc in error'
    )
    console.log('✓ Test 3 passed: Missing .nvmrc documentation detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 4: File inventory - .nvmrc documented correctly
console.log('Test 4: File inventory - .nvmrc documented correctly')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme:
      '# Test Project\n\nThis project uses .nvmrc for Node version management.',
    setupJs: `
      const fs = require('fs');
      fs.writeFileSync('.nvmrc', '20.11.1');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, true)
    assert.strictEqual(
      result.success,
      true,
      'Should succeed when .nvmrc documented'
    )
    console.log('✓ Test 4 passed: Documented .nvmrc accepted')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 5: File inventory - .npmrc documentation check
console.log('Test 5: File inventory - .npmrc documentation')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project\n\nThis is a basic project.',
    setupJs: `
      const fs = require('fs');
      fs.writeFileSync('.npmrc', 'package-lock=false');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail when .npmrc not documented'
    )
    assert.ok(
      result.output.includes('.npmrc'),
      'Should mention .npmrc in error'
    )
    console.log('✓ Test 5 passed: Missing .npmrc documentation detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 6: File inventory - stylelintrc documentation check
console.log('Test 6: File inventory - stylelintrc documentation')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project\n\nThis is a basic project.',
    setupJs: `
      const fs = require('fs');
      fs.writeFileSync('.stylelintrc.json', '{}');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail when stylelintrc not documented'
    )
    assert.ok(
      result.output.includes('stylelintrc'),
      'Should mention stylelintrc in error'
    )
    console.log('✓ Test 6 passed: Missing stylelintrc documentation detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 7: File inventory - lighthouserc documentation check
console.log('Test 7: File inventory - lighthouserc documentation')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project\n\nThis is a basic project.',
    setupJs: `
      const fs = require('fs');
      fs.writeFileSync('.lighthouserc.js', 'module.exports = {}');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail when lighthouserc not documented'
    )
    assert.ok(
      result.output.includes('lighthouserc'),
      'Should mention lighthouserc in error'
    )
    console.log('✓ Test 7 passed: Missing lighthouserc documentation detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 8: Python feature documentation
console.log('Test 8: Python feature documentation')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project\n\nThis is a basic project.',
    setupJs: `
      // Python support added
      console.log('Python configuration');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail when Python not documented'
    )
    assert.ok(
      result.output.includes('Python'),
      'Should mention Python in error'
    )
    console.log('✓ Test 8 passed: Missing Python documentation detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 9: Python feature documented correctly
console.log('Test 9: Python feature documented correctly')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme:
      '# Test Project\n\nSupports Python development with Black, Ruff, and mypy.',
    setupJs: `
      // Python support added
      console.log('Python configuration');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, true)
    assert.strictEqual(
      result.success,
      true,
      'Should succeed when Python documented'
    )
    console.log('✓ Test 9 passed: Python documentation accepted')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 10: Multiple missing files documented
console.log('Test 10: Multiple missing files reported')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project\n\nBasic project.',
    setupJs: `
      const fs = require('fs');
      fs.writeFileSync('.nvmrc', '20.11.1');
      fs.writeFileSync('.npmrc', 'package-lock=false');
      fs.writeFileSync('.stylelintrc.json', '{}');
    `,
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(
      result.success,
      false,
      'Should fail with multiple missing files'
    )
    assert.ok(
      result.output.includes('README.md missing documentation for files') ||
        result.error.includes('README.md missing documentation for files'),
      'Should show error about missing files'
    )
    console.log('✓ Test 10 passed: Multiple missing files detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 11: Exit code validation - success
console.log('Test 11: Exit code validation - success scenario')
{
  const tempDir = createTempProject({
    packageJson: { version: '1.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project',
    setupJs: "console.log('test')",
  })

  try {
    const result = runCheckDocs(tempDir, true)
    assert.strictEqual(result.exitCode, 0, 'Should exit with code 0 on success')
    console.log('✓ Test 11 passed: Exit code 0 on success')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 12: Exit code validation - failure
console.log('Test 12: Exit code validation - failure scenario')
{
  const tempDir = createTempProject({
    packageJson: { version: '2.0.0' },
    changelog: `# Changelog\n\n## [1.0.0] - 2024-01-01\n`,
    readme: '# Test Project',
    setupJs: "console.log('test')",
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.strictEqual(result.exitCode, 1, 'Should exit with code 1 on failure')
    console.log('✓ Test 12 passed: Exit code 1 on failure')
  } finally {
    cleanupTempDir(tempDir)
  }
}

// Test 13: Roadmap version consistency - mismatch
console.log('Test 13: Roadmap version consistency - mismatch')
{
  const tempDir = createTempProject({
    packageJson: { version: '2.0.0' },
    changelog: `# Changelog\n\n## [2.0.0] - 2024-01-01\n`,
    roadmap: '## Current Version: 1.0.0\n',
    readme: '# Test Project',
    setupJs: "console.log('test')",
  })

  try {
    const result = runCheckDocs(tempDir, false)
    assert.ok(
      result.output.includes('ROADMAP.md current version does not match') ||
        result.error.includes('ROADMAP.md current version does not match'),
      'Should report a stale roadmap version'
    )
    console.log('✓ Test 13 passed: Stale roadmap version detected')
  } finally {
    cleanupTempDir(tempDir)
  }
}

console.log('\n✅ All check-docs.sh tests passed! (13 tests)')
