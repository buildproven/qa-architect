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
 * Inject workflow mode-specific configuration into quality.yml
 * @param {string} workflowContent - Template content
 * @param {'minimal'|'standard'|'comprehensive'} mode - Selected mode
 * @returns {string} Modified workflow content
 */
function injectWorkflowMode(workflowContent, mode) {
  let updated = workflowContent

  const versionMarker = `# WORKFLOW_MODE: ${mode}`
  if (updated.includes('# WORKFLOW_MODE:')) {
    // Replace existing marker with new mode
    updated = updated.replace(
      /# WORKFLOW_MODE: (minimal|standard|comprehensive)/,
      versionMarker
    )
  } else {
    // Add marker before jobs:
    updated = updated.replace(/(\n\njobs:)/, `\n${versionMarker}\n$1`)
  }

  // Controlled regexes for YAML workflow template matching - these patterns match static
  // template content, not user input. Safe from ReDoS as they match known structure.

  // Handle mode-specific transformations
  if (mode === 'standard') {
    // Standard: Add main branch condition to tests job
    // Handle both single-line and multi-line if: formats

    // First try multi-line format (if: | block)
    if (
      updated.includes('tests:') &&
      updated.includes('fromJSON(needs.detect-maturity.outputs.test-count)')
    ) {
      // Multi-line if: | block - add main branch check at the start
      updated = updated.replace(
        /(tests:\s+runs-on:[^\n]+\s+needs:[^\n]+\s+if: \|\s*\n\s+)fromJSON\(needs\.detect-maturity\.outputs\.test-count\)/,
        "$1github.ref == 'refs/heads/main' &&\n      fromJSON(needs.detect-maturity.outputs.test-count)"
      )

      // Also try single-line format as fallback
      updated = updated.replace(
        /(\s+tests:\s+runs-on:[^\n]+\s+needs:[^\n]+\s+)if: fromJSON\(needs\.detect-maturity\.outputs\.test-count\) > 0/,
        "$1if: github.ref == 'refs/heads/main' && fromJSON(needs.detect-maturity.outputs.test-count) > 0"
      )
    }

    // Standard: Change matrix to [20, 22]
    updated = updated.replace(/node-version: \[22\]/g, 'node-version: [20, 22]')
  } else if (mode === 'comprehensive') {
    // Comprehensive: Remove paths-ignore blocks from push and pull_request
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

    // Comprehensive: Change matrix to [20, 22]
    updated = updated.replace(/node-version: \[22\]/g, 'node-version: [20, 22]')
  }
  // Minimal mode: Remove expensive dependency install and maturity detection steps
  // Keep only: checkout, setup-node, detect-pm, setup-pnpm/bun, simplified report
  if (mode === 'minimal') {
    // 1. Remove "Install dependencies for maturity detection" step
    updated = updated.replace(
      /\s+- name: Install dependencies for maturity detection\s+run: \$\{\{ steps\.detect-pm\.outputs\.install-cmd \}\}\s*\n/,
      '\n'
    )

    // 2. Remove "Detect Project Maturity" step (multiline)
    updated = updated.replace(
      /\s+- name: Detect Project Maturity\s+id: detect\s+run: \|[\s\S]*?fi\s*\n/,
      '\n'
    )

    // 3. Hardcode maturity outputs (since we skip detection)
    // These sensible defaults allow basic checks to run without expensive detection
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

    // 4. Remove dev-only gitleaks binary test steps (only relevant for qa-architect itself)
    // The restore-keys block has 3 lines after `|`, match all of them to avoid stray lines
    updated = updated.replace(
      /\s+- name: Cache gitleaks binary for real download test[\s\S]*?restore-keys: \|[^\n]*\n[^\n]*\n[^\n]*\n/,
      '\n'
    )
    updated = updated.replace(
      /\s+- name: Run real gitleaks binary verification test[\s\S]*?node tests\/gitleaks-real-binary-test\.js\n/,
      '\n'
    )

    // 5. Simplify "Display Detection Report" to show only package manager info
    updated = updated.replace(
      /- name: Display Detection Report\s+run: \|[\s\S]*?echo "Has CSS files:[^"]*"/,
      `- name: Display Detection Report
        run: |
          echo "📊 Project Detection Results (Minimal Mode)"
          echo "Package Manager: \${{ steps.detect-pm.outputs.manager }}"
          echo "Install Command: \${{ steps.detect-pm.outputs.install-cmd }}"
          echo "Turborepo: \${{ steps.detect-pm.outputs.is-turborepo }}"
          echo "Note: Maturity detection skipped in minimal mode for faster CI"`
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
  injectWorkflowMode,
  injectMatrix,
}
