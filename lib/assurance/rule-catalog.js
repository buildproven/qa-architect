'use strict'

const fs = require('fs')
const path = require('path')

const RULE_PACK_VERSION = '1.0.0'
const RULE_FILES = Object.freeze([
  '.semgrep/defensive-patterns.yaml',
  '.semgrep/vibe-audit-rules.yaml',
  '.semgrep/vibe-moat-rules.yaml',
])

const SEVERITY_MAP = Object.freeze({
  ERROR: 'high',
  WARNING: 'medium',
  INFO: 'low',
})

const CRITICAL_CWE = new Set([
  'CWE-89',
  'CWE-78',
  'CWE-798',
  'CWE-639',
  'CWE-95',
])

function normalizeSemgrepSeverity(severity, cwe) {
  if (CRITICAL_CWE.has(cwe)) return 'critical'
  return SEVERITY_MAP[String(severity).toUpperCase()] || 'medium'
}

function stripYamlScalar(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseRuleFile(projectRoot, relativeFile) {
  const source = fs.readFileSync(path.join(projectRoot, relativeFile), 'utf8')
  const lines = source.split(/\r?\n/)
  const rules = []
  let current = null
  let collectingLanguages = false
  for (const line of lines) {
    const idMatch = line.match(/^ {2}- id: ([a-z0-9-]+)[ \t]*$/)
    if (idMatch) {
      if (current) rules.push(current)
      current = {
        id: idMatch[1],
        engineSeverity: '',
        severity: '',
        languages: [],
        cwe: '',
        owasp: '',
        sourceFile: relativeFile,
      }
      collectingLanguages = false
      continue
    }
    if (!current) continue
    const languageItem = collectingLanguages
      ? line.match(/^ {6}- ([a-z0-9-]+)[ \t]*$/)
      : null
    if (languageItem) {
      current.languages.push(languageItem[1])
      continue
    }
    if (collectingLanguages) collectingLanguages = false
    const severity = line.match(/^ {4}severity: ([A-Z]+)[ \t]*$/)
    if (severity) current.engineSeverity = severity[1]
    const languages = line.match(/^ {4}languages: \[([^\]]+)\][ \t]*$/)
    if (languages) {
      current.languages = languages[1]
        .split(',')
        .map(value => stripYamlScalar(value))
    }
    if (/^ {4}languages:[ \t]*$/.test(line)) collectingLanguages = true
    const cwe = line.match(/^ {6}cwe: (.+)$/)
    if (cwe) current.cwe = stripYamlScalar(cwe[1])
    const owasp = line.match(/^ {6}owasp: (.+)$/)
    if (owasp) current.owasp = stripYamlScalar(owasp[1])
  }
  if (current) rules.push(current)
  for (const rule of rules) {
    rule.severity = normalizeSemgrepSeverity(rule.engineSeverity, rule.cwe)
    delete rule.engineSeverity
  }
  return rules
}

function loadRuleCatalog(projectRoot) {
  const rules = RULE_FILES.flatMap(file => parseRuleFile(projectRoot, file))
  const ids = new Set()
  for (const rule of rules) {
    if (ids.has(rule.id))
      throw new Error(`Duplicate assurance rule: ${rule.id}`)
    if (!rule.severity) throw new Error(`Missing severity for rule: ${rule.id}`)
    if (rule.languages.length === 0) {
      throw new Error(`Missing languages for rule: ${rule.id}`)
    }
    ids.add(rule.id)
  }
  return {
    schemaVersion: '1.0.0',
    rulePackVersion: RULE_PACK_VERSION,
    engine: 'semgrep',
    assuranceMapping: 'sast',
    limitations: [
      'Rules detect only the documented static patterns in supported languages.',
      'A clean scan does not prove the absence of vulnerabilities.',
      'Authorization, runtime configuration, and data isolation may require runtime evidence or human review.',
    ],
    rules: rules.sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function renderRuleCatalogMarkdown(catalog) {
  const lines = [
    '# QA Architect assurance rule catalog',
    '',
    `Rule pack: \`${catalog.rulePackVersion}\``,
    '',
    'This catalog is generated from the shipped Semgrep rule files. It describes supported static checks, not a claim of complete application security.',
    '',
    '## Limitations',
    '',
    ...catalog.limitations.map(item => `- ${item}`),
    '',
    '## Rules',
    '',
    '| Rule ID | Severity | Languages | CWE | OWASP | Source |',
    '|---|---|---|---|---|---|',
  ]
  for (const rule of catalog.rules) {
    lines.push(
      `| \`${rule.id}\` | ${rule.severity} | ${rule.languages.join(', ') || 'See rule'} | ${rule.cwe || '—'} | ${rule.owasp || '—'} | \`${rule.sourceFile}\` |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

module.exports = {
  RULE_FILES,
  RULE_PACK_VERSION,
  loadRuleCatalog,
  normalizeSemgrepSeverity,
  renderRuleCatalogMarkdown,
}
