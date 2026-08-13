'use strict'

const {
  hasFeature,
  showUpgradeMessage,
  ensureLicenseFresh,
} = require('../licensing')
const { buildPolicy, writeGeneratedFiles } = require('../test-impact-generator')

function optionValue(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1] || null
}

async function handleTestImpact(args, projectPath = process.cwd()) {
  await ensureLicenseFresh()
  if (!hasFeature('smartTestStrategy')) {
    showUpgradeMessage('Evidence-backed test-impact generation')
    return 1
  }

  const write = args.includes('--write-test-impact')
  const update = args.includes('--update-test-impact')
  const json = args.includes('--json')
  const mappingFile = optionValue(args, '--mapping-file')
  const plan = buildPolicy(projectPath, { mappingFile, update })
  let files = []

  if (write && update) {
    plan.blockers.push('Select write or update mode, not both.')
  }

  if ((write || update) && plan.blockers.length === 0) {
    try {
      files = writeGeneratedFiles(projectPath, plan, { update })
    } catch (error) {
      plan.blockers.push(error.message)
    }
  }

  const result = {
    status: plan.blockers.length === 0 ? 'ready' : 'mapping-required',
    mode: update ? 'update' : write ? 'write' : 'dry-run',
    files,
    inventory: plan.inventory,
    blockers: plan.blockers,
    policy: plan.policy,
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(
      `Test impact: ${result.status}. ${files.length} file(s) written. ${plan.blockers.length} blocker(s).`
    )
    for (const blocker of plan.blockers) console.log(`- ${blocker}`)
  }
  return plan.blockers.length === 0 ? 0 : 2
}

module.exports = { handleTestImpact, optionValue }
