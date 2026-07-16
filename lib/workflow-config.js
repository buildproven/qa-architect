/**
 * Workflow configuration utilities
 * Handles workflow tier detection and mode injection
 */

'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Detect existing workflow mode from quality.yml
 * @param {string} projectPath - Path to project
 * @returns {string|null} Detected mode or null
 */
function detectExistingWorkflowMode(projectPath) {
  const workflowPath = path.join(
    projectPath,
    '.github',
    'workflows',
    'quality.yml'
  )

  if (!fs.existsSync(workflowPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(workflowPath, 'utf8')

    if (content.includes('# WORKFLOW_MODE: minimal')) {
      return 'minimal'
    }
    if (content.includes('# WORKFLOW_MODE: standard')) {
      return 'standard'
    }
    if (content.includes('# WORKFLOW_MODE: comprehensive')) {
      return 'comprehensive'
    }

    const hasSecurityJob = /jobs:\s*\n\s*security:/m.test(content)
    const hasMatrixInTests = /tests:[\s\S]*?strategy:[\s\S]*?matrix:/m.test(
      content
    )
    const hasScheduledSecurity = /on:\s*\n\s*schedule:[\s\S]*?- cron:/m.test(
      content
    )

    if (hasSecurityJob && hasMatrixInTests && !hasScheduledSecurity) {
      return 'comprehensive'
    }
    if (hasMatrixInTests && hasScheduledSecurity) {
      return 'standard'
    }
    if (!hasMatrixInTests) {
      return 'minimal'
    }

    return 'comprehensive'
  } catch (error) {
    console.warn(
      `⚠️  Could not detect existing workflow mode: ${error.message}`
    )
    return null
  }
}

/**
 * Detect whether matrix testing is enabled in an existing workflow.
 * @param {string} projectPath - Path to project
 * @returns {boolean} True when matrix testing is enabled
 */
function detectExistingMatrix(projectPath) {
  const workflowPath = path.join(
    projectPath,
    '.github',
    'workflows',
    'quality.yml'
  )

  if (!fs.existsSync(workflowPath)) {
    return false
  }

  try {
    const content = fs.readFileSync(workflowPath, 'utf8')
    return (
      content.includes('# MATRIX_ENABLED: true') ||
      content.includes('node-version: [20, 22]')
    )
  } catch (error) {
    console.warn(
      `⚠️  Could not detect existing matrix configuration: ${error.message}`
    )
    return false
  }
}

/**
 * Strip a named section from workflow content.
 * Removes everything between # {{NAME_BEGIN}} and # {{NAME_END}} markers (inclusive).
 * Leaves a single newline to avoid collapsing adjacent YAML blocks.
 * @param {string} content - Workflow content
 * @param {string} sectionName - Section name (e.g. 'QA_ARCHITECT_ONLY', 'FULL_DETECTION')
 * @returns {string} Content with section removed
 */
function stripSection(content, sectionName) {
  if (!/^[A-Z_]+$/.test(sectionName)) {
    throw new Error(`Invalid section name: ${sectionName}`)
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- sectionName validated above
  const pattern = new RegExp(
    `[^\\S\\n]*# \\{\\{${sectionName}_BEGIN\\}\\}[\\s\\S]*?# \\{\\{${sectionName}_END\\}\\}\\n?`,
    'g'
  )
  return content.replace(pattern, '')
}

/**
 * Remove a paths-ignore block from a top-level workflow trigger.
 * @param {string} content - Workflow content
 * @param {string} triggerName - Trigger key (e.g. push, pull_request)
 * @returns {string} Updated content
 */
function removeTriggerPathsIgnore(content, triggerName) {
  const lines = content.split('\n')
  const output = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    output.push(line)

    if (
      line !== `  ${triggerName}:` &&
      !line.startsWith(`  ${triggerName}: `)
    ) {
      continue
    }

    for (let scanIndex = index + 1; scanIndex < lines.length; scanIndex += 1) {
      const nextLine = lines[scanIndex]

      if (nextLine.startsWith('  ') && !nextLine.startsWith('    ')) {
        break
      }

      if (nextLine === '    paths-ignore:') {
        scanIndex += 1
        while (
          scanIndex < lines.length &&
          lines[scanIndex].startsWith('      - ')
        ) {
          scanIndex += 1
        }
        index = scanIndex - 1
        break
      }

      output.push(nextLine)
      index = scanIndex
    }
  }

  return output.join('\n')
}

/**
 * Restrict the tests job to main branch pushes in standard mode.
 * @param {string} content - Workflow content
 * @returns {string} Updated content
 */
function addStandardTestsBranchGate(content) {
  const lines = content.split('\n')
  const output = []
  let inTestsJob = false
  let branchGateInserted = false

  for (const line of lines) {
    if (line === '  tests:') {
      inTestsJob = true
    } else if (
      inTestsJob &&
      line.startsWith('  ') &&
      !line.startsWith('    ')
    ) {
      inTestsJob = false
    }

    output.push(line)

    if (inTestsJob && line === '    if: |' && !branchGateInserted) {
      output.push("      github.ref == 'refs/heads/main' &&")
      branchGateInserted = true
    }
  }

  return output.join('\n')
}

/**
 * Inject workflow mode-specific configuration into quality.yml
 * Uses section markers (# {{SECTION_BEGIN/END}}) for reliable content removal
 * instead of fragile structural regex patterns.
 * @param {string} workflowContent - Template content
 * @param {'minimal'|'standard'|'comprehensive'} mode - Selected mode
 * @returns {string} Modified workflow content
 */
function injectWorkflowMode(workflowContent, mode) {
  let updated = workflowContent

  // Set workflow mode marker
  const versionMarker = `# WORKFLOW_MODE: ${mode}`
  if (updated.includes('# WORKFLOW_MODE:')) {
    updated = updated.replace(
      /# WORKFLOW_MODE: (minimal|standard|comprehensive)/,
      versionMarker
    )
  } else {
    updated = updated.replace(/(\n\njobs:)/, `\n${versionMarker}\n$1`)
  }

  // All consumer workflows: strip qa-architect-only content
  updated = stripSection(updated, 'QA_ARCHITECT_ONLY')

  // Mode-specific transformations
  if (mode === 'standard') {
    // Standard: run tests on main only to keep CI costs bounded.
    if (
      updated.includes('  tests:') &&
      updated.includes('    if: |') &&
      !updated.includes("github.ref == 'refs/heads/main'")
    ) {
      updated = addStandardTestsBranchGate(updated)
    }
  } else if (mode === 'comprehensive') {
    // Comprehensive: Remove paths-ignore blocks
    updated = removeTriggerPathsIgnore(updated, 'push')
    updated = removeTriggerPathsIgnore(updated, 'pull_request')
    // Comprehensive: Remove schedule trigger (security runs inline)
    updated = updated.replace(/\s+schedule:\s+- cron:[^\n]+[^\n]*\n?/g, '\n')
    // Comprehensive: Remove schedule condition from security job
    updated = updated.replace(
      /if: \(github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'\) && /g,
      'if: '
    )
    updated = updated.replace(/node-version: \[22\]/g, 'node-version: [20, 22]')
  }

  // Minimal mode keeps real project detection. Hardcoding zero tests caused
  // consumer CI to silently skip repositories that already had test suites.
  if (mode === 'minimal') {
    updated = updated.replace(
      '📊 Project Detection Results',
      '📊 Project Detection Results (Minimal Mode)'
    )
  }

  // Strip any remaining section markers from output (belt-and-suspenders)
  // Use [ \t]* (horizontal whitespace only) — \s* would eat newlines and collapse YAML lines
  updated = updated.replace(/[ \t]*# \{\{[A-Z_]+_(BEGIN|END)\}\}\n?/g, '')

  return updated
}

function replaceNamedSteps(content, stepName, replacementFactory) {
  const maxStepLines = 1_000
  const lines = content.split('\n')
  const output = []
  let occurrence = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `      - name: ${stepName}`) {
      output.push(lines[index])
      continue
    }
    const block = [lines[index]]
    index += 1
    for (
      ;
      index < lines.length &&
      block.length < maxStepLines &&
      !lines[index].startsWith('      - name:') &&
      !/^[ ]{2}[a-zA-Z0-9_-]+:/.test(lines[index]);
      index += 1
    ) {
      block.push(lines[index])
    }
    if (block.length === maxStepLines) {
      throw new Error(
        `workflow step "${stepName}" exceeds ${maxStepLines} lines`
      )
    }
    index -= 1
    const replacement = replacementFactory(block.join('\n'), occurrence)
    occurrence += 1
    if (replacement) output.push(replacement.replace(/\n$/, ''))
  }
  return output.join('\n')
}

function insertStepsBeforeNodeSetup(content, steps) {
  let occurrence = 0
  return content
    .split('\n')
    .flatMap(line => {
      if (!line.startsWith('      - name: Setup Node.js')) return [line]
      const step = steps[occurrence]
      occurrence += 1
      return step ? [step.replace(/\n$/, ''), line] : [line]
    })
    .join('\n')
}

function insertStepsAfterNodeSetup(content, steps) {
  const lines = content.split('\n')
  const output = []
  let occurrence = 0
  for (let index = 0; index < lines.length; index += 1) {
    output.push(lines[index])
    if (!lines[index].startsWith('      - name: Setup Node.js')) continue
    index += 1
    while (
      index < lines.length &&
      !lines[index].startsWith('      - name:') &&
      !/^[ ]{2}[a-zA-Z0-9_-]+:/.test(lines[index])
    ) {
      output.push(lines[index])
      index += 1
    }
    index -= 1
    const step = steps[occurrence]
    occurrence += 1
    if (step) output.push(step.replace(/\n$/, ''))
  }
  return output.join('\n')
}

function injectProjectProfile(workflowContent, profile = {}) {
  let updated = workflowContent
  const scripts = profile.scripts || {}
  const gates = [
    ['Lint', scripts.lint],
    ['Format check', scripts.format],
    ['Type check', scripts.typecheck],
    ['Tests', scripts.test],
    ['Build', scripts.build],
  ].filter(([, script]) => script)

  const gateSteps = gates
    .map(
      ([label, script]) => `      - name: ${label}
        run: |
          echo "⏱️ ${label} must complete within 5 minutes"
          timeout 300 ${profile.runScript(script)}`
    )
    .join('\n\n')

  updated = replaceNamedSteps(updated, 'Run tests', () =>
    gateSteps ? `${gateSteps}\n` : ''
  )
  updated = updated.replace(
    / {6}fromJSON\(needs\.detect-maturity\.outputs\.test-count\) > 0 &&\n {6}\(github\.event\.pull_request\.draft != true \|\| github\.event_name != 'pull_request'\)/,
    gates.length > 0
      ? "      github.event.pull_request.draft != true || github.event_name != 'pull_request'"
      : '      false'
  )

  updated = replaceNamedSteps(
    updated,
    'Detect Package Manager',
    () => `      - name: Detect Package Manager
        id: detect-pm
        run: |
          echo "manager=${profile.packageManager}" >> $GITHUB_OUTPUT
          echo "install-cmd=${profile.installCommand}" >> $GITHUB_OUTPUT
          if [ -f turbo.json ]; then
            echo "is-turborepo=true" >> $GITHUB_OUTPUT
            echo "turbo-prefix=turbo run" >> $GITHUB_OUTPUT
          else
            echo "is-turborepo=false" >> $GITHUB_OUTPUT
            echo "turbo-prefix=" >> $GITHUB_OUTPUT
          fi
`
  )

  updated = replaceNamedSteps(
    updated,
    'Verify dependency integrity',
    () => `      - name: Verify dependency integrity
        run: |
          echo "🔐 Verifying dependency integrity with ${profile.packageManager}..."
          ${profile.installCommand}
`
  )
  updated = replaceNamedSteps(
    updated,
    'Production dependency CVE gate',
    () => `      - name: Production dependency CVE gate
        run: |
          echo "🔒 Auditing dependencies (high+) with ${profile.packageManager}..."
          ${profile.auditCommand}
`
  )
  updated = replaceNamedSteps(
    updated,
    'Advisory full-tree dependency audit (non-blocking)',
    () => `      - name: Advisory full-tree dependency audit (non-blocking)
        run: |
          echo "ℹ️ Advisory dependency audit (does not block)" >> "$GITHUB_STEP_SUMMARY"
          ${profile.auditCommand} >> "$GITHUB_STEP_SUMMARY" 2>&1 || true
`
  )

  if (profile.cacheManager) {
    updated = updated.replace(
      /cache: \$\{\{ needs\.detect-maturity\.outputs\.package-manager \}\}/g,
      `cache: '${profile.cacheManager}'`
    )
  } else {
    updated = updated.replace(
      /\n[ ]{10}cache: \$\{\{ needs\.detect-maturity\.outputs\.package-manager \}\}/g,
      ''
    )
  }

  // Never ship a hardcoded pnpm version. Corepack reads the exact declaration
  // from package.json; when a version is declared we activate it explicitly.
  const corepackCommand = profile.packageManagerVersion
    ? `corepack enable\n          corepack prepare pnpm@${profile.packageManagerVersion} --activate`
    : 'corepack enable'
  const pnpmSteps = []
  updated = replaceNamedSteps(updated, 'Setup pnpm', block => {
    const existingCondition =
      block
        .split('\n')
        .find(line => line.startsWith('        if: '))
        ?.slice('        if: '.length) ||
      "needs.detect-maturity.outputs.package-manager == 'pnpm'"
    const replacement = `      - name: Setup pnpm
        if: ${profile.packageManager === 'pnpm' ? 'always()' : existingCondition}
        run: |
          ${corepackCommand}
`
    if (profile.packageManager === 'pnpm') {
      pnpmSteps.push(replacement)
      return ''
    }
    return replacement
  })

  if (profile.packageManager === 'pnpm') {
    updated = insertStepsBeforeNodeSetup(updated, pnpmSteps)
  }

  if (profile.packageManager === 'yarn') {
    const yarnSetup = `      - name: Setup Yarn
        run: |
          corepack enable
          ${profile.packageManagerVersion ? `corepack prepare yarn@${profile.packageManagerVersion} --activate` : 'yarn --version'}
`
    const nodeSetupCount = (
      updated.match(/^ {6}- name: Setup Node\.js/gm) || []
    ).length
    updated = insertStepsBeforeNodeSetup(
      updated,
      Array(nodeSetupCount).fill(yarnSetup)
    )
  }

  if (profile.packageManager === 'bun') {
    updated = replaceNamedSteps(
      updated,
      'Setup Bun',
      () => `      - name: Setup Bun
        if: always()
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: '${profile.packageManagerVersion}'
`
    )
  } else {
    updated = replaceNamedSteps(updated, 'Setup Bun', block => {
      const existingCondition =
        block
          .split('\n')
          .find(line => line.startsWith('        if: '))
          ?.slice('        if: '.length) ||
        "needs.detect-maturity.outputs.package-manager == 'bun'"
      return `      - name: Setup Bun
        if: ${existingCondition}
        uses: oven-sh/setup-bun@v2
`
    })
  }

  if (profile.packageManager === 'npm' && profile.packageManagerVersion) {
    const npmSetup = `      - name: Setup declared npm
        run: npm install --global npm@${profile.packageManagerVersion}
`
    const nodeSetupCount = (
      updated.match(/^ {6}- name: Setup Node\.js/gm) || []
    ).length
    updated = insertStepsAfterNodeSetup(
      updated,
      Array(nodeSetupCount).fill(npmSetup)
    )
  }
  return updated
}

/**
 * Inject Node.js version matrix into workflow for library authors
 * By default, CI runs on Node 22 only. Use --matrix flag for multi-version testing.
 * @param {string} workflowContent - Workflow content
 * @param {boolean} enableMatrix - Whether to enable matrix testing
 * @returns {string} Modified workflow content
 */
function injectMatrix(workflowContent, enableMatrix) {
  if (!enableMatrix) {
    return workflowContent
  }

  // Add matrix marker
  let updated = workflowContent
  if (!updated.includes('# MATRIX_ENABLED')) {
    updated = updated.replace(
      /# WORKFLOW_MODE:/,
      '# MATRIX_ENABLED: true\n# WORKFLOW_MODE:'
    )
  }

  // Change node-version from [22] to [20, 22] for multi-version testing
  // This is useful for npm libraries that need to support multiple Node.js versions
  updated = updated.replace(/node-version: \[22\]/g, 'node-version: [20, 22]')

  console.log('📦 Matrix testing enabled (Node.js 20 + 22)')
  console.log(
    '   This is recommended for npm libraries/CLI tools that support multiple Node versions'
  )

  return updated
}

module.exports = {
  detectExistingWorkflowMode,
  detectExistingMatrix,
  injectWorkflowMode,
  injectMatrix,
  injectProjectProfile,
  stripSection,
}
