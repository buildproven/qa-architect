#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const Ajv2020 = require('ajv/dist/2020').default

const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '..', 'config', 'pilot-ledger-v1.schema.json'),
    'utf8'
  )
)

/**
 * @typedef {{
 *   records: Array<{
 *     reference: string,
 *     prospect: string,
 *     kind: 'discovery'|'pilot',
 *     outcome: 'completed'|'paid'|'declined'
 *   }>
 * }} PilotLedger
 */

/** @param {unknown} ledger */
function evaluate(ledger) {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema
  )
  if (!validate(ledger))
    return { valid: false, marketValidated: false, errors: validate.errors }
  const typedLedger = /** @type {PilotLedger} */ (ledger)
  const references = typedLedger.records.map(record => record.reference)
  if (new Set(references).size !== references.length)
    return {
      valid: false,
      marketValidated: false,
      errors: [{ message: 'record references must be unique' }],
    }
  const discoveryProspects = new Set(
    typedLedger.records
      .filter(
        record => record.kind === 'discovery' && record.outcome === 'completed'
      )
      .map(record => record.prospect)
  )
  const discoveries = discoveryProspects.size
  const offerTested = typedLedger.records.some(
    record =>
      record.kind === 'pilot' && ['paid', 'declined'].includes(record.outcome)
  )
  const paidPilot = typedLedger.records.some(
    record => record.kind === 'pilot' && record.outcome === 'paid'
  )
  return {
    valid: true,
    marketValidated: discoveries >= 5 && paidPilot,
    discoveries,
    offerTested,
    paidPilot,
    errors: [],
  }
}

if (require.main === module) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: validate-pilot-ledger.js <private-ledger.json>')
    process.exitCode = 2
  } else {
    const result = evaluate(JSON.parse(fs.readFileSync(file, 'utf8')))
    console.log(JSON.stringify(result, null, 2))
    if (!result.valid) process.exitCode = 1
  }
}

module.exports = { evaluate }
