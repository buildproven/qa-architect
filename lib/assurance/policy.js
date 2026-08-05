'use strict'

const fs = require('fs')
const path = require('path')
const AjvImport = require('ajv')
const addFormatsImport = require('ajv-formats')

const Ajv = /** @type {any} */ (AjvImport.default || AjvImport)
const addFormats = /** @type {(ajv: any) => void} */ (
  addFormatsImport.default || addFormatsImport
)

const schemaPath = path.join(
  __dirname,
  '..',
  '..',
  'config',
  'assurance-policy-v1.schema.json'
)
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)
const validateSchema = ajv.compile(schema)

function duplicateJsonKeys(source) {
  const duplicates = []
  let cursor = 0

  function whitespace() {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++
  }

  function string() {
    const start = cursor
    cursor++
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2
      } else if (source[cursor] === '"') {
        cursor++
        return JSON.parse(source.slice(start, cursor))
      } else {
        cursor++
      }
    }
    throw new SyntaxError('Unterminated JSON string')
  }

  function scalar() {
    const start = cursor
    while (cursor < source.length && !/[\s,\]}]/.test(source[cursor])) cursor++
    JSON.parse(source.slice(start, cursor))
  }

  function array() {
    cursor++
    whitespace()
    if (source[cursor] === ']') {
      cursor++
      return
    }
    while (cursor < source.length) {
      value()
      whitespace()
      if (source[cursor] === ']') {
        cursor++
        return
      }
      if (source[cursor] !== ',') throw new SyntaxError('Expected array comma')
      cursor++
      whitespace()
    }
    throw new SyntaxError('Unterminated JSON array')
  }

  function object() {
    const keys = new Set()
    cursor++
    whitespace()
    if (source[cursor] === '}') {
      cursor++
      return
    }
    while (cursor < source.length) {
      if (source[cursor] !== '"') throw new SyntaxError('Expected object key')
      const key = string()
      if (keys.has(key)) duplicates.push(key)
      keys.add(key)
      whitespace()
      if (source[cursor] !== ':') throw new SyntaxError('Expected object colon')
      cursor++
      value()
      whitespace()
      if (source[cursor] === '}') {
        cursor++
        return
      }
      if (source[cursor] !== ',') throw new SyntaxError('Expected object comma')
      cursor++
      whitespace()
    }
    throw new SyntaxError('Unterminated JSON object')
  }

  function value() {
    whitespace()
    if (source[cursor] === '{') object()
    else if (source[cursor] === '[') array()
    else if (source[cursor] === '"') string()
    else scalar()
  }

  value()
  whitespace()
  if (cursor !== source.length) throw new SyntaxError('Trailing JSON content')
  return duplicates
}

function semanticErrors(policy, now) {
  const errors = []
  const baseline = policy.baseline || {}
  const waivers = policy.waivers || {}
  for (const fingerprint of Object.keys(baseline)) {
    if (Object.hasOwn(waivers, fingerprint)) {
      errors.push(`Fingerprint appears in baseline and waivers: ${fingerprint}`)
    }
  }
  for (const [fingerprint, waiver] of Object.entries(waivers)) {
    if (waiver.reason.trim().length === 0) {
      errors.push(`Waiver reason is blank: ${fingerprint}`)
    }
    if (waiver.owner.trim().length === 0) {
      errors.push(`Waiver owner is blank: ${fingerprint}`)
    }
    const created = new Date(waiver.createdAt)
    if (created > now)
      errors.push(`Waiver creation is in the future: ${fingerprint}`)
    if (waiver.expiresAt && new Date(waiver.expiresAt) <= created) {
      errors.push(`Waiver expiry is not after creation: ${fingerprint}`)
    }
  }
  return errors
}

function validateAssurancePolicy(policy, now = new Date()) {
  const errors = []
  if (!validateSchema(policy)) {
    errors.push(
      ...validateSchema.errors.map(
        error => `${error.instancePath} ${error.message}`
      )
    )
  } else {
    errors.push(...semanticErrors(policy, now))
  }
  return errors
}

function loadAssurancePolicy(policyPath, now = new Date()) {
  let source
  try {
    source = fs.readFileSync(policyPath, 'utf8')
  } catch (error) {
    return { valid: false, policy: null, errors: [error.message] }
  }

  let duplicates
  let policy
  try {
    duplicates = duplicateJsonKeys(source)
    policy = JSON.parse(source)
  } catch (error) {
    return { valid: false, policy: null, errors: [error.message] }
  }
  if (duplicates.length > 0) {
    return {
      valid: false,
      policy: null,
      errors: [...new Set(duplicates)].map(key => `Duplicate JSON key: ${key}`),
    }
  }

  const errors = validateAssurancePolicy(policy, now)
  return { valid: errors.length === 0, policy, errors }
}

module.exports = {
  duplicateJsonKeys,
  loadAssurancePolicy,
  semanticErrors,
  validateAssurancePolicy,
}
