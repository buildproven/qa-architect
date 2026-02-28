#!/usr/bin/env node

/**
 * Consumer Workflow Integration Tests (R-2)
 *
 * Generates workflows for each tier and validates that:
 * - No qa-architect-only content appears in consumer output
 * - No section markers leak into output
 * - YAML structure is valid
 * - Mode-specific features are correct
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const yaml = require(path.join(__dirname, '../node_modules/js-yaml'))

console.log('🧪 Testing consumer workflow integration...\n')

function createTempGitRepo() {
  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cqa-consumer-workflow-')
  )
  execSync('git init', { cwd: testDir, stdio: 'ignore' })
  execSync('git config user.email "test@example.com"', {
    cwd: testDir,
    stdio: 'ignore',
  })
  execSync('git config user.name "Test User"', {
    cwd: testDir,
    stdio: 'ignore',
  })
  fs.writeFileSync(
    path.join(testDir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2)
  )
  fs.mkdirSync(path.join(testDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(testDir, 'src', 'index.js'), 'console.log("test")')
  fs.mkdirSync(path.join(testDir, 'tests'), { recursive: true })
  fs.writeFileSync(
    path.join(testDir, 'tests', 'test.js'),
    'const assert = require("assert")'
  )
  return testDir
}

const QA_ARCHITECT_ONLY_CONTENT = [
  'Cache gitleaks binary for real download test',
  'Run real gitleaks binary verification test',
  'gitleaks-real-binary-test.js',
  'gitleaks-8.28.0-linux-x64-a65b5253',
]

const CONSUMER_FORBIDDEN_CONTENT = [
  ...QA_ARCHITECT_ONLY_CONTENT,
  'node_modules/create-qa-architect',
]

const SECTION_MARKERS = [
  '{{QA_ARCHITECT_ONLY_BEGIN}}',
  '{{QA_ARCHITECT_ONLY_END}}',
  '{{FULL_DETECTION_BEGIN}}',
  '{{FULL_DETECTION_END}}',
  '{{FULL_REPORT_BEGIN}}',
  '{{FULL_REPORT_END}}',
]

function assertNoConsumerForbiddenContent(content, tier) {
  for (const forbidden of CONSUMER_FORBIDDEN_CONTENT) {
    assert(
      !content.includes(forbidden),
      `${tier} workflow must NOT contain consumer-forbidden content: "${forbidden}"`
    )
  }
}

function assertNoSectionMarkers(content, tier) {
  for (const marker of SECTION_MARKERS) {
    assert(
      !content.includes(marker),
      `${tier} workflow must NOT contain section marker: "${marker}"`
    )
  }
}

function assertValidYamlStructure(content, tier) {
  // Validate YAML is parseable (catches indentation/structure corruption)
  assert.doesNotThrow(
    () => yaml.load(content),
    `${tier} workflow must be valid YAML`
  )

  assert(content.includes('name:'), `${tier} workflow must have name:`)
  assert(content.includes('on:'), `${tier} workflow must have on:`)
  assert(content.includes('jobs:'), `${tier} workflow must have jobs:`)
  assert(
    content.includes('detect-maturity:'),
    `${tier} workflow must have detect-maturity job`
  )
  assert(content.includes('tests:'), `${tier} workflow must have tests job`)
  assert(
    content.includes('security:'),
    `${tier} workflow must have security job`
  )
}

// Use child_process.execSync for legitimate test CLI invocation (not user input)
const setupPath = path.join(__dirname, '../setup.js')

// Test 1: Minimal tier - no qa-architect content, hardcoded outputs
;(() => {
  console.log('Test 1: Minimal tier consumer workflow validation')
  const testDir = createTempGitRepo()
  try {
    execSync(`QAA_DEVELOPER=true node ${setupPath} --workflow-minimal`, {
      cwd: testDir,
      stdio: 'pipe',
    })
    const content = fs.readFileSync(
      path.join(testDir, '.github', 'workflows', 'quality.yml'),
      'utf8'
    )

    assertNoConsumerForbiddenContent(content, 'Minimal')
    assertNoSectionMarkers(content, 'Minimal')
    assertValidYamlStructure(content, 'Minimal')

    // Minimal-specific: hardcoded maturity outputs
    assert(
      content.includes("maturity: 'minimal'"),
      'Minimal must have hardcoded maturity'
    )
    assert(
      content.includes("source-count: '0'"),
      'Minimal must have hardcoded source-count'
    )
    assert(
      content.includes("test-count: '0'"),
      'Minimal must have hardcoded test-count'
    )
    assert(
      content.includes("has-deps: 'false'"),
      'Minimal must have hardcoded has-deps'
    )

    // Minimal-specific: no full detection steps
    assert(
      !content.includes('Install dependencies for maturity detection'),
      'Minimal must NOT have dep install step'
    )
    assert(
      !content.includes('Detect Project Maturity'),
      'Minimal must NOT have maturity detection step'
    )

    // Minimal-specific: single node version, path filters, schedule
    assert(
      content.includes('node-version: [22]'),
      'Minimal must have single Node 22'
    )
    assert(content.includes('paths-ignore:'), 'Minimal must have path filters')
    assert(
      /pull_request:[\s\S]*?paths-ignore:/m.test(content),
      'Minimal must apply path filters to pull_request events'
    )
    assert(content.includes('schedule:'), 'Minimal must have schedule trigger')
    assert(
      content.includes('# WORKFLOW_MODE: minimal'),
      'Minimal must have mode marker'
    )

    // Minimal-specific: simplified detection report
    assert(
      content.includes('Minimal Mode'),
      'Minimal must have simplified report'
    )

    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 2: Standard tier - full detection, matrix, no qa-architect content
;(() => {
  console.log('Test 2: Standard tier consumer workflow validation')
  const testDir = createTempGitRepo()
  try {
    execSync(`QAA_DEVELOPER=true node ${setupPath} --workflow-standard`, {
      cwd: testDir,
      stdio: 'pipe',
    })
    const content = fs.readFileSync(
      path.join(testDir, '.github', 'workflows', 'quality.yml'),
      'utf8'
    )

    assertNoConsumerForbiddenContent(content, 'Standard')
    assertNoSectionMarkers(content, 'Standard')
    assertValidYamlStructure(content, 'Standard')

    // Standard-specific: full detection retained
    assert(
      content.includes('Detect Project Maturity'),
      'Standard must have maturity detection step'
    )

    // Standard-specific: dynamic outputs (not hardcoded)
    assert(
      content.includes('${{ steps.detect.outputs.maturity }}'),
      'Standard must have dynamic maturity output'
    )

    // Standard-specific: single Node 22 (matrix is comprehensive-only or --matrix flag)
    assert(
      content.includes('node-version: [22]'),
      'Standard must have single Node 22'
    )
    assert(
      content.includes('# WORKFLOW_MODE: standard'),
      'Standard must have mode marker'
    )

    // Standard-specific: full detection report
    assert(
      content.includes('Has CSS files:'),
      'Standard must have full detection report'
    )

    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 3: Comprehensive tier - no path filters, no schedule, no qa-architect content
;(() => {
  console.log('Test 3: Comprehensive tier consumer workflow validation')
  const testDir = createTempGitRepo()
  try {
    execSync(`QAA_DEVELOPER=true node ${setupPath} --workflow-comprehensive`, {
      cwd: testDir,
      stdio: 'pipe',
    })
    const content = fs.readFileSync(
      path.join(testDir, '.github', 'workflows', 'quality.yml'),
      'utf8'
    )

    assertNoConsumerForbiddenContent(content, 'Comprehensive')
    assertNoSectionMarkers(content, 'Comprehensive')
    assertValidYamlStructure(content, 'Comprehensive')

    // Comprehensive-specific: full detection retained
    assert(
      content.includes('Detect Project Maturity'),
      'Comprehensive must have maturity detection step'
    )

    // Comprehensive-specific: no path filters, no schedule
    assert(
      !content.includes('paths-ignore:'),
      'Comprehensive must NOT have path filters'
    )
    assert(
      !content.includes('schedule:'),
      'Comprehensive must NOT have schedule trigger'
    )

    // Comprehensive-specific: matrix [20, 22]
    assert(
      content.includes('node-version: [20, 22]'),
      'Comprehensive must have multi-version matrix'
    )
    assert(
      content.includes('# WORKFLOW_MODE: comprehensive'),
      'Comprehensive must have mode marker'
    )

    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 4: stripSection unit test
;(() => {
  console.log('Test 4: stripSection helper function unit tests')
  const { stripSection } = require('../lib/workflow-config')

  // Basic section stripping
  const input1 = `before
      # {{TEST_BEGIN}}
      content to remove
      # {{TEST_END}}
after`
  const result1 = stripSection(input1, 'TEST')
  assert(!result1.includes('content to remove'), 'Should strip section content')
  assert(!result1.includes('TEST_BEGIN'), 'Should strip begin marker')
  assert(!result1.includes('TEST_END'), 'Should strip end marker')
  assert(result1.includes('before'), 'Should keep content before')
  assert(result1.includes('after'), 'Should keep content after')

  // Multiple sections of same name
  const input2 = `a
      # {{FOO_BEGIN}}
      remove1
      # {{FOO_END}}
b
      # {{FOO_BEGIN}}
      remove2
      # {{FOO_END}}
c`
  const result2 = stripSection(input2, 'FOO')
  assert(!result2.includes('remove1'), 'Should strip first section')
  assert(!result2.includes('remove2'), 'Should strip second section')
  assert(result2.includes('a'), 'Should keep surrounding content')
  assert(result2.includes('b'), 'Should keep middle content')
  assert(result2.includes('c'), 'Should keep ending content')

  // Non-existent section (no-op)
  const input3 = 'unchanged content'
  const result3 = stripSection(input3, 'NONEXISTENT')
  assert.strictEqual(
    result3,
    input3,
    'Should not modify content without markers'
  )

  console.log('✅ PASS\n')
})()

// Test 5: Cross-tier consistency - all tiers have required base structure
;(() => {
  console.log('Test 5: Cross-tier consistency validation')
  const testDir = createTempGitRepo()
  const tiers = ['minimal', 'standard', 'comprehensive']
  const workflows = {}

  try {
    for (const tier of tiers) {
      // Clean previous workflow
      const wfDir = path.join(testDir, '.github', 'workflows')
      if (fs.existsSync(path.join(wfDir, 'quality.yml'))) {
        fs.unlinkSync(path.join(wfDir, 'quality.yml'))
      }

      execSync(`QAA_DEVELOPER=true node ${setupPath} --workflow-${tier}`, {
        cwd: testDir,
        stdio: 'pipe',
      })
      workflows[tier] = fs.readFileSync(path.join(wfDir, 'quality.yml'), 'utf8')
    }

    // All tiers must have these common elements
    for (const tier of tiers) {
      const content = workflows[tier]
      assert(
        content.includes('Detect Package Manager'),
        `${tier} must have package manager detection`
      )
      assert(
        content.includes('concurrency:'),
        `${tier} must have concurrency group`
      )
      assert(
        content.includes('cancel-in-progress: true'),
        `${tier} must have cancel-in-progress`
      )
      assert(
        content.includes('dependabot[bot]'),
        `${tier} must have dependabot skip`
      )
      assert(
        content.includes('Display Detection Report'),
        `${tier} must have detection report`
      )
    }

    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 6: stripSection edge cases
;(() => {
  console.log('Test 6: stripSection edge case coverage')
  const { stripSection } = require('../lib/workflow-config')

  // Invalid section names should throw
  assert.throws(
    () => stripSection('content', 'lowercase'),
    /Invalid section name/,
    'Should reject lowercase'
  )
  assert.throws(
    () => stripSection('content', 'HAS-HYPHEN'),
    /Invalid section name/,
    'Should reject hyphens'
  )
  assert.throws(
    () => stripSection('content', ''),
    /Invalid section name/,
    'Should reject empty string'
  )

  // Empty section (BEGIN immediately followed by END)
  const inputEmpty = `before
      # {{EMPTY_BEGIN}}
      # {{EMPTY_END}}
after`
  const resultEmpty = stripSection(inputEmpty, 'EMPTY')
  assert(
    resultEmpty.includes('before'),
    'Should keep content before empty section'
  )
  assert(
    resultEmpty.includes('after'),
    'Should keep content after empty section'
  )
  assert(
    !resultEmpty.includes('EMPTY_BEGIN'),
    'Should strip empty section markers'
  )

  // Unmatched BEGIN (no END) — silent no-op, content preserved
  const inputNoEnd = `before
      # {{ORPHAN_BEGIN}}
      orphan content
after`
  const resultNoEnd = stripSection(inputNoEnd, 'ORPHAN')
  assert(
    resultNoEnd.includes('orphan content'),
    'Unmatched BEGIN should preserve content (regex wont match)'
  )

  // Marker at start of content
  const inputStart = `# {{START_BEGIN}}
remove this
# {{START_END}}
keep this`
  const resultStart = stripSection(inputStart, 'START')
  assert(!resultStart.includes('remove this'), 'Should strip section at start')
  assert(resultStart.includes('keep this'), 'Should keep content after')

  // Marker at end of content
  const inputEnd = `keep this
# {{END_BEGIN}}
remove this
# {{END_END}}`
  const resultEnd = stripSection(inputEnd, 'END')
  assert(resultEnd.includes('keep this'), 'Should keep content before')
  assert(!resultEnd.includes('remove this'), 'Should strip section at end')

  // Interleaved sections — strip one, keep other
  const inputInterleaved = `# {{AAA_BEGIN}}
aaa
# {{AAA_END}}
middle
# {{BBB_BEGIN}}
bbb
# {{BBB_END}}`
  const resultA = stripSection(inputInterleaved, 'AAA')
  assert(!resultA.includes('aaa'), 'Should strip AAA content')
  assert(resultA.includes('bbb'), 'Should keep BBB content')
  assert(resultA.includes('middle'), 'Should keep middle content')

  console.log('✅ PASS\n')
})()

// Test 7: Generated workflows produce valid YAML (regression for belt-and-suspenders bug)
;(() => {
  console.log('Test 7: All tiers produce valid parseable YAML')
  const testDir = createTempGitRepo()
  const tiers = ['minimal', 'standard', 'comprehensive']

  try {
    for (const tier of tiers) {
      const wfDir = path.join(testDir, '.github', 'workflows')
      if (fs.existsSync(path.join(wfDir, 'quality.yml'))) {
        fs.unlinkSync(path.join(wfDir, 'quality.yml'))
      }

      execSync(`QAA_DEVELOPER=true node ${setupPath} --workflow-${tier}`, {
        cwd: testDir,
        stdio: 'pipe',
      })
      const content = fs.readFileSync(path.join(wfDir, 'quality.yml'), 'utf8')

      // This catches the \s* belt-and-suspenders bug that collapsed YAML lines
      assert.doesNotThrow(
        () => yaml.load(content),
        `${tier} workflow must produce valid parseable YAML`
      )
    }

    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

console.log('✅ All consumer workflow integration tests passed!')
