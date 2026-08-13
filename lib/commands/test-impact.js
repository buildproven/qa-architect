'use strict'

const {
  hasFeature,
  showUpgradeMessage,
  ensureLicenseFresh,
} = require('../licensing')
const {
  buildPolicy,
  buildWorkflow,
  writeGeneratedFiles,
} = require('../test-impact-generator')

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
  const json = args.includes('--json')
  const plan = buildPolicy(projectPath)
  let files = []

  if (write && plan.blockers.length === 0) {
    try {
      const runtimeSha = optionValue(args, '--runtime-sha')
      const workflow = buildWorkflow(plan, runtimeSha)
      files = writeGeneratedFiles(projectPath, plan, workflow)
    } catch (error) {
      plan.blockers.push(error.message)
    }
  }

  const result = {
    status: plan.blockers.length === 0 ? 'ready' : 'mapping-required',
    mode: write ? 'write' : 'dry-run',
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
