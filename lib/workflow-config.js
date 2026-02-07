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
    // Standard: Add main branch condition to tests job
    if (
      updated.includes('tests:') &&
      updated.includes('fromJSON(needs.detect-maturity.outputs.test-count)')
    ) {
      updated = updated.replace(
        /(tests:\s+runs-on:[^\n]+\s+needs:[^\n]+\s+if: \|\s*\n\s+)fromJSON\(needs\.detect-maturity\.outputs\.test-count\)/,
        "$1github.ref == 'refs/heads/main' &&\n      fromJSON(needs.detect-maturity.outputs.test-count)"
      )
      updated = updated.replace(
        /(\s+tests:\s+runs-on:[^\n]+\s+needs:[^\n]+\s+)if: fromJSON\(needs\.detect-maturity\.outputs\.test-count\) > 0/,
        "$1if: github.ref == 'refs/heads/main' && fromJSON(needs.detect-maturity.outputs.test-count) > 0"
      )
    }
  } else if (mode === 'comprehensive') {
    // Comprehensive: Remove paths-ignore blocks
    updated = updated.replace(
      /(\s+push:\s+branches:[^\n]+)\s+paths-ignore:\s+- '\*\*\.md'\s+- 'docs\/\*\*'\s+- 'LICENSE'\s+- '\.gitignore'\s+- '\.editorconfig'/g,
      '$1'
    )
    updated = updated.replace(
      /(\s+pull_request:\s+branches:[^\n]+)\s+paths-ignore:\s+- '\*\*\.md'\s+- 'docs\/\*\*'\s+- 'LICENSE'\s+- '\.gitignore'\s+- '\.editorconfig'/g,
      '$1'
    )
    // Comprehensive: Remove schedule trigger (security runs inline)
    updated = updated.replace(/\s+schedule:\s+- cron:[^\n]+[^\n]*\n?/g, '\n')
    // Comprehensive: Remove schedule condition from security job
    updated = updated.replace(
      /if: \(github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'\) && /g,
      'if: '
    )
    updated = updated.replace(/node-version: \[22\]/g, 'node-version: [20, 22]')
  }

  // Minimal mode: use section markers to strip detection, hardcode outputs
  if (mode === 'minimal') {
    // Strip full detection and report sections via markers
    updated = stripSection(updated, 'FULL_DETECTION')
    updated = stripSection(updated, 'FULL_REPORT')

    // Hardcode maturity outputs (since we skip detection)
    updated = updated.replace(
      /maturity: \$\{\{ steps\.detect\.outputs\.maturity \}\}/,
      "maturity: 'minimal'"
    )
    updated = updated.replace(
      /source-count: \$\{\{ steps\.detect\.outputs\.source-count \}\}/,
      "source-count: '10'"
    )
    updated = updated.replace(
      /test-count: \$\{\{ steps\.detect\.outputs\.test-count \}\}/,
      "test-count: '1'"
    )
    updated = updated.replace(
      /has-deps: \$\{\{ steps\.detect\.outputs\.has-deps \}\}/,
      "has-deps: 'true'"
    )
    updated = updated.replace(
      /has-docs: \$\{\{ steps\.detect\.outputs\.has-docs \}\}/,
      "has-docs: 'false'"
    )
    updated = updated.replace(
      /has-css: \$\{\{ steps\.detect\.outputs\.has-css \}\}/,
      "has-css: 'false'"
    )

    // Insert simplified detection report after the last setup step
    const minimalReport = `      - name: Display Detection Report
        run: |
          echo "📊 Project Detection Results (Minimal Mode)"
          echo "Package Manager: \${{ steps.detect-pm.outputs.manager }}"
          echo "Install Command: \${{ steps.detect-pm.outputs.install-cmd }}"
          echo "Turborepo: \${{ steps.detect-pm.outputs.is-turborepo }}"
          echo "Note: Maturity detection skipped in minimal mode for faster CI"`

    // Insert report before the "Note: Lint/format" comment that follows detect-maturity job
    if (!updated.includes('Display Detection Report')) {
      updated = updated.replace(
        /(\n {2}# Note: Lint\/format jobs REMOVED)/,
        `\n${minimalReport}\n$1`
      )
    }
  }

  // Strip any remaining section markers from output (belt-and-suspenders)
  // Use [ \t]* (horizontal whitespace only) — \s* would eat newlines and collapse YAML lines
  updated = updated.replace(/[ \t]*# \{\{[A-Z_]+_(BEGIN|END)\}\}\n?/g, '')

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
  injectWorkflowMode,
  injectMatrix,
  stripSection,
}
