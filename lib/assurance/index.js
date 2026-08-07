'use strict'

const { evaluateAssurance } = require('./evaluator')
const { createFingerprint } = require('./fingerprint')
const { loadAssurancePolicy } = require('./policy')
const { createSourceRevision } = require('./revision')
const {
  assuranceSummary,
  toJson,
  toMarkdown,
  toSarif,
  toTerminal,
} = require('./renderers')
const { loadRuleCatalog, renderRuleCatalogMarkdown } = require('./rule-catalog')

module.exports = {
  createFingerprint,
  createSourceRevision,
  evaluateAssurance,
  loadAssurancePolicy,
  loadRuleCatalog,
  renderRuleCatalogMarkdown,
  assuranceSummary,
  toJson,
  toMarkdown,
  toSarif,
  toTerminal,
}
