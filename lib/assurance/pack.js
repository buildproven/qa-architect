'use strict'

const fs = require('fs')
const path = require('path')
const Ajv = require('ajv/dist/2020').default
const addFormats = require('ajv-formats').default

const PACK = require('../../config/assurance-packs/web-saas-v1.json')
const PACK_SCHEMA = require('../../config/assurance-pack-v1.schema.json')

const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)
const validatePack = ajv.compile(PACK_SCHEMA)

function assertValidPack(pack) {
  if (!validatePack(pack)) {
    const details = (validatePack.errors || [])
      .map(error => `${error.instancePath || '/'} ${error.message}`)
      .join('; ')
    throw new Error(`Invalid assurance pack: ${details}`)
  }
  if (pack === null || typeof pack !== 'object') {
    throw new Error('Invalid assurance pack: expected an object')
  }
  const checks = Reflect.get(pack, 'checks')
  if (!Array.isArray(checks)) {
    throw new Error('Invalid assurance pack: checks must be an array')
  }
  const ids = new Set()
  const ruleIds = new Set()
  for (const check of checks) {
    if (ids.has(check.id)) throw new Error(`Duplicate pack check: ${check.id}`)
    ids.add(check.id)
    if (check.semgrepRuleId) {
      if (ruleIds.has(check.semgrepRuleId)) {
        throw new Error(`Duplicate pack Semgrep rule: ${check.semgrepRuleId}`)
      }
      ruleIds.add(check.semgrepRuleId)
    }
  }
  return pack
}

assertValidPack(PACK)

function packageManifest(projectPath) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    )
  } catch {
    return {}
  }
}

function dependencyMap(pkg) {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
  }
}

function detectAssuranceStacks(projectPath, pack = PACK) {
  const dependencies = dependencyMap(packageManifest(projectPath))
  return pack.stacks.flatMap(stack => {
    const packageName = stack.packages.find(name => dependencies[name])
    const marker = stack.markers.find(relative =>
      fs.existsSync(path.join(projectPath, relative))
    )
    if (!packageName && !marker) return []
    return [
      {
        id: stack.id,
        version: packageName ? dependencies[packageName] : null,
        reason: packageName
          ? `package.json declares ${packageName}@${dependencies[packageName]}`
          : `repository contains ${marker}`,
        versionVariants: stack.versionVariants,
      },
    ]
  })
}

function selectAssurancePack(projectPath, pack = PACK) {
  assertValidPack(pack)
  const detectedStacks = detectAssuranceStacks(projectPath, pack)
  const detected = new Set(detectedStacks.map(stack => stack.id))
  const checks = pack.checks.filter(check =>
    check.stackMatch === 'all'
      ? check.stacks.every(stack => detected.has(stack))
      : check.stacks.some(stack => detected.has(stack))
  )
  return {
    schemaVersion: pack.schemaVersion,
    id: pack.id,
    version: pack.version,
    detectedStacks,
    checks,
    staticRuleIds: checks
      .filter(check => check.semgrepRuleId)
      .map(check => check.semgrepRuleId)
      .sort(),
    runtimeEvidence: checks
      .filter(check => check.evidenceClass === 'runtime')
      .map(check => ({
        checkId: check.id,
        verification: check.verification,
        limitation: check.limitations.join(' '),
      })),
    limitations: pack.limitations,
  }
}

function checkForRule(ruleId, pack = PACK) {
  return pack.checks.find(check => check.semgrepRuleId === ruleId) || null
}

function semverParts(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/)
  return match ? match.slice(1).map(Number) : null
}

function compareSemver(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function assertCompatibleCheckUpdate(oldCheck, newCheck, context) {
  if (!newCheck) throw new Error(`Pack update removed check: ${oldCheck.id}`)
  if (
    oldCheck.version === newCheck.version &&
    JSON.stringify(oldCheck) !== JSON.stringify(newCheck)
  ) {
    throw new Error(`Pack check changed without a version bump: ${oldCheck.id}`)
  }
  if (oldCheck.version === newCheck.version) return
  if (
    compareSemver(
      semverParts(newCheck.version),
      semverParts(oldCheck.version)
    ) < 0
  ) {
    throw new Error(`Pack rule version moved backward: ${oldCheck.id}`)
  }
  if (context.packVersionChange === 0) {
    throw new Error(
      `Pack check changed without a pack version bump: ${oldCheck.id}`
    )
  }
  const migration = `${oldCheck.id}:${oldCheck.version}->${newCheck.version}`
  if (!context.migrations.has(migration)) {
    throw new Error(`Pack update lacks rule migration: ${oldCheck.id}`)
  }
}

function assertCompatiblePackUpdate(previous, next) {
  assertValidPack(previous)
  assertValidPack(next)
  if (previous.id !== next.id) throw new Error('Pack identity cannot change')
  const previousVersion = semverParts(previous.version)
  const nextVersion = semverParts(next.version)
  if (
    !previousVersion ||
    !nextVersion ||
    nextVersion[0] !== previousVersion[0]
  ) {
    throw new Error('Pack major-version changes require a new pack contract')
  }
  const packVersionChange = compareSemver(nextVersion, previousVersion)
  if (packVersionChange < 0) {
    throw new Error('Pack version cannot move backward')
  }
  const migrations = new Set(
    next.migrations.map(item => `${item.checkId}:${item.from}->${item.to}`)
  )
  const nextChecks = new Map(next.checks.map(check => [check.id, check]))
  for (const oldCheck of previous.checks) {
    assertCompatibleCheckUpdate(oldCheck, nextChecks.get(oldCheck.id), {
      migrations,
      packVersionChange,
    })
  }
  return true
}

function selectionSummary(selection) {
  if (selection.detectedStacks.length === 0) {
    return 'Web SaaS pack not applicable: no supported stack dependency or marker detected'
  }
  const stacks = selection.detectedStacks
    .map(stack => `${stack.id} (${stack.reason})`)
    .join(', ')
  const runtime = selection.runtimeEvidence.length
    ? ` Runtime evidence still required: ${selection.runtimeEvidence
        .map(item => item.checkId)
        .join(', ')}.`
    : ''
  return `${selection.id}@${selection.version} selected for ${stacks}; ${selection.staticRuleIds.length} static rule(s).${runtime}`
}

module.exports = {
  PACK,
  assertCompatiblePackUpdate,
  assertValidPack,
  checkForRule,
  detectAssuranceStacks,
  selectAssurancePack,
  selectionSummary,
}
