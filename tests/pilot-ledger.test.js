'use strict'

const assert = require('assert')
const { evaluate } = require('../scripts/validate-pilot-ledger')

const record = (
  reference,
  kind = 'discovery',
  outcome = 'completed',
  prospect = reference
) => ({
  reference,
  prospect,
  kind,
  date: '2026-08-12',
  outcome,
  objections: [],
  nextStep: 'follow up',
})

assert.deepStrictEqual(evaluate({ schemaVersion: 1, records: [] }), {
  valid: true,
  marketValidated: false,
  discoveries: 0,
  offerTested: false,
  paidPilot: false,
  errors: [],
})
assert.strictEqual(
  evaluate({ schemaVersion: 1, records: [record('x'), record('x')] }).valid,
  false
)
assert.deepStrictEqual(
  evaluate({
    schemaVersion: 1,
    records: [
      record('1'),
      record('2'),
      record('3'),
      record('4'),
      record('5'),
      record('p', 'pilot', 'declined'),
    ],
  }),
  {
    valid: true,
    marketValidated: false,
    discoveries: 5,
    offerTested: true,
    paidPilot: false,
    errors: [],
  }
)

assert.strictEqual(
  evaluate({
    schemaVersion: 1,
    records: [
      record('1'),
      record('2'),
      record('3'),
      record('4'),
      record('5'),
      record('p', 'pilot', 'paid'),
    ],
  }).marketValidated,
  true
)

assert.strictEqual(
  evaluate({
    schemaVersion: 1,
    records: [
      record('call-1', 'discovery', 'completed', 'acme'),
      record('call-2', 'discovery', 'completed', 'acme'),
      record('call-3', 'discovery', 'completed', 'acme'),
      record('call-4', 'discovery', 'completed', 'acme'),
      record('call-5', 'discovery', 'completed', 'acme'),
      record('pilot', 'pilot', 'paid', 'acme'),
    ],
  }).marketValidated,
  false
)

console.log('pilot ledger tests passed')
