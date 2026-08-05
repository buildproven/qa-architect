'use strict'

const VERDICT_ICON = Object.freeze({
  PASS: '✅',
  BLOCK: '❌',
  INCOMPLETE: '⏳',
})

const SARIF_LEVEL = Object.freeze({
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
})

function assuranceSummary(result) {
  const active = result.findings.filter(item => item.disposition === 'active')
  return {
    verdict: result.verdict,
    revision: result.revision,
    supportedChecks: result.supportedChecks,
    requiredChecks: result.requiredChecks,
    totalFindings: result.findings.length,
    activeFindings: active.length,
    baselineFindings: result.findings.filter(
      item => item.disposition === 'baseline'
    ).length,
    waivedFindings: result.findings.filter(
      item => item.disposition === 'waived'
    ).length,
    blockingFindings: result.findings.filter(item => item.blocksMerge).length,
    incompleteReasons: result.reasons.filter(item => item.kind === 'incomplete')
      .length,
  }
}

function toJson(result) {
  return {
    summary: assuranceSummary(result),
    assurance: result,
  }
}

function terminalLines(result) {
  const summary = assuranceSummary(result)
  const lines = [
    `${VERDICT_ICON[result.verdict]} Assurance: ${result.verdict}`,
    `Revision: ${result.revision.kind}:${result.revision.value}`,
    `Evidence: ${summary.activeFindings} active, ${summary.baselineFindings} baseline, ${summary.waivedFindings} waived`,
  ]
  for (const item of result.reasons) {
    lines.push(`- ${item.kind.toUpperCase()} ${item.code}: ${item.message}`)
  }
  for (const finding of result.findings) {
    const line = finding.location.line ? `:${finding.location.line}` : ''
    lines.push(
      `- [${finding.disposition}] ${finding.severity} ${finding.ruleId} ${finding.location.path}${line}: ${finding.message}`
    )
  }
  if (result.verdict === 'PASS') {
    lines.push(
      'All required checks completed for this revision; no active blocking finding was detected within the supported scope.'
    )
  }
  return lines
}

function toTerminal(result) {
  return terminalLines(result).join('\n')
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function toMarkdown(result) {
  const summary = assuranceSummary(result)
  const lines = [
    '## QA Architect assurance',
    '',
    `**Verdict:** ${VERDICT_ICON[result.verdict]} **${result.verdict}**`,
    '',
    `**Revision:** \`${result.revision.kind}:${result.revision.value}\``,
    '',
    '| Evidence | Count |',
    '|---|---:|',
    `| Active findings | ${summary.activeFindings} |`,
    `| Baseline findings | ${summary.baselineFindings} |`,
    `| Waived findings | ${summary.waivedFindings} |`,
    `| Incomplete reasons | ${summary.incompleteReasons} |`,
    '',
  ]
  if (result.reasons.length > 0) {
    lines.push('### Decision reasons', '')
    for (const item of result.reasons) {
      lines.push(
        `- **${item.kind.toUpperCase()} ${item.code}:** ${item.message}`
      )
    }
    lines.push('')
  }
  if (result.findings.length > 0) {
    lines.push(
      '### Findings',
      '',
      '| State | Severity | Rule | Location | Message |',
      '|---|---|---|---|---|'
    )
    for (const item of result.findings) {
      const location = `${item.location.path}${item.location.line ? `:${item.location.line}` : ''}`
      lines.push(
        `| ${item.disposition} | ${item.severity} | ${item.ruleId} | \`${location}\` | ${markdownEscape(item.message)} |`
      )
    }
    lines.push('')
  }
  if (result.verdict === 'PASS') {
    lines.push(
      '> All required checks completed for this revision; no active blocking finding was detected within the supported scope.',
      ''
    )
  }
  return lines.join('\n')
}

function sarifRule(finding) {
  return {
    id: finding.ruleId,
    name: finding.ruleId,
    shortDescription: { text: finding.message },
    help: { text: finding.remediation.guidance },
    properties: {
      ruleVersion: finding.ruleVersion,
      identityVersion: finding.identityVersion,
      assuranceMappings: finding.assuranceMappings,
    },
  }
}

function sarifResult(finding) {
  const result = {
    ruleId: finding.ruleId,
    level: SARIF_LEVEL[finding.severity],
    message: { text: finding.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.location.path },
          region: {
            startLine: finding.location.line || 1,
            endLine: finding.location.endLine || finding.location.line || 1,
          },
        },
      },
    ],
    partialFingerprints: {
      'qaArchitect/v1': finding.fingerprint,
    },
    properties: {
      severity: finding.severity,
      disposition: finding.disposition,
      blocksMerge: finding.blocksMerge,
      policyEvaluation: finding.policyEvaluation,
    },
  }
  if (finding.disposition === 'waived') {
    result.suppressions = [
      {
        kind: 'external',
        status: 'accepted',
        justification: finding.policyEvaluation.reason,
      },
    ]
  }
  return result
}

function toSarif(result) {
  const rules = []
  const seen = new Set()
  for (const finding of result.findings) {
    if (!seen.has(finding.ruleId)) {
      rules.push(sarifRule(finding))
      seen.add(finding.ruleId)
    }
  }
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'QA Architect',
            semanticVersion: result.schemaVersion,
            informationUri: 'https://buildproven.ai/qa-architect',
            rules,
          },
        },
        automationDetails: {
          id: `${result.revision.kind}/${result.revision.value}`,
        },
        results: result.findings.map(sarifResult),
        properties: {
          assuranceVerdict: result.verdict,
          supportedChecks: result.supportedChecks,
          requiredChecks: result.requiredChecks,
          reasons: result.reasons,
        },
      },
    ],
  }
}

module.exports = {
  assuranceSummary,
  toJson,
  toMarkdown,
  toSarif,
  toTerminal,
}
