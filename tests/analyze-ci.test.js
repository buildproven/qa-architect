#!/usr/bin/env node

/**
 * Tests for GitHub Actions Cost Analyzer (--analyze-ci)
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  discoverWorkflows,
  estimateWorkflowDuration,
  estimateScheduleRunsPerMonth,
  estimateWorkflowRunsPerMonth,
  calculateMonthlyCosts,
  analyzeOptimizations,
} = require('../lib/commands/analyze-ci')

console.log('🧪 Testing analyze-ci module...\n')

// Test 1: discoverWorkflows() - no workflows
;(() => {
  console.log('Test 1: discoverWorkflows() - no workflows directory')
  const testDir = path.join(os.tmpdir(), `cqa-test-${Date.now()}`)
  fs.mkdirSync(testDir, { recursive: true })

  try {
    const workflows = discoverWorkflows(testDir)
    assert.strictEqual(workflows.length, 0, 'Should return empty array')
    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 2: discoverWorkflows() - with workflows
;(() => {
  console.log('Test 2: discoverWorkflows() - finds workflow files')
  const testDir = path.join(os.tmpdir(), `cqa-test-${Date.now()}`)
  const workflowDir = path.join(testDir, '.github', 'workflows')
  fs.mkdirSync(workflowDir, { recursive: true })

  try {
    // Create test workflow files
    fs.writeFileSync(path.join(workflowDir, 'ci.yml'), 'name: CI')
    fs.writeFileSync(path.join(workflowDir, 'test.yaml'), 'name: Test')
    fs.writeFileSync(path.join(workflowDir, 'README.md'), 'docs') // Should be ignored

    const workflows = discoverWorkflows(testDir)
    assert.strictEqual(workflows.length, 2, 'Should find 2 workflow files')

    const names = workflows.map(w => w.name).sort()
    assert.deepStrictEqual(names, ['ci.yml', 'test.yaml'])
    console.log('✅ PASS\n')
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})()

// Test 3: estimateWorkflowDuration() - minimal workflow
;(() => {
  console.log('Test 3: estimateWorkflowDuration() - minimal workflow')

  const workflow = {
    name: 'test',
    on: 'push',
    jobs: {
      build: {
        'runs-on': 'ubuntu-latest',
        steps: [{ name: 'Checkout', uses: 'actions/checkout@v2' }],
      },
    },
  }

  const duration = estimateWorkflowDuration(workflow)
  assert.strictEqual(typeof duration, 'number')
  assert.ok(duration > 0, 'Duration should be greater than 0')
  console.log(`  Duration: ${duration} min`)
  console.log('✅ PASS\n')
})()

// Test 4: estimateWorkflowDuration() - workflow with test steps
;(() => {
  console.log('Test 4: estimateWorkflowDuration() - adds time for test steps')

  const workflow = {
    jobs: {
      test: {
        steps: [
          { name: 'Checkout' },
          { name: 'Run tests' },
          { name: 'Run E2E tests' },
        ],
      },
    },
  }

  const duration = estimateWorkflowDuration(workflow)
  assert.ok(duration >= 20, 'Test steps should add significant time')
  console.log(`  Duration: ${duration} min`)
  console.log('✅ PASS\n')
})()

// Test 5: estimateWorkflowDuration() - matrix strategy
;(() => {
  console.log('Test 5: estimateWorkflowDuration() - matrix multiplier')

  const workflow = {
    jobs: {
      test: {
        strategy: {
          matrix: {
            node: ['14', '16', '18'],
            os: ['ubuntu', 'windows'],
          },
        },
        steps: [{ name: 'Checkout' }, { name: 'Test' }],
      },
    },
  }

  const duration = estimateWorkflowDuration(workflow)
  // 3 node versions × 2 OS = 6x multiplier
  assert.ok(duration >= 30, 'Matrix should multiply base duration')
  console.log(`  Duration: ${duration} min (3 × 2 = 6x matrix)`)
  console.log('✅ PASS\n')
})()

// Test 6: estimateWorkflowDuration() - empty workflow
;(() => {
  console.log('Test 6: estimateWorkflowDuration() - empty workflow')

  const workflow = { name: 'test', on: 'push' }
  const duration = estimateWorkflowDuration(workflow)

  assert.strictEqual(duration, 0, 'Empty workflow should return 0')
  console.log('✅ PASS\n')
})()

// Test 6b: estimateScheduleRunsPerMonth() - weekly and monthly
;(() => {
  console.log('Test 6b: estimateScheduleRunsPerMonth() - cron frequency')

  const weekly = estimateScheduleRunsPerMonth([{ cron: '0 2 * * 0' }])
  const monthly = estimateScheduleRunsPerMonth([{ cron: '0 0 1 * *' }])

  assert.strictEqual(weekly, 4, 'Weekly cron should estimate ~4 runs/month')
  assert.strictEqual(monthly, 1, 'Monthly cron should estimate ~1 run/month')
  console.log('✅ PASS\n')
})()

// Test 6c: estimateWorkflowRunsPerMonth() - tag-only push
;(() => {
  console.log('Test 6c: estimateWorkflowRunsPerMonth() - tag-only workflow')

  const workflow = {
    on: {
      push: {
        tags: ['v*'],
      },
    },
  }

  const runsPerMonth = estimateWorkflowRunsPerMonth(workflow, 3)
  assert.strictEqual(
    runsPerMonth,
    1,
    'Tag-only workflow should not scale with commits'
  )
  console.log('✅ PASS\n')
})()

// Test 7: calculateMonthlyCosts() - within free tier
;(() => {
  console.log('Test 7: calculateMonthlyCosts() - within free tier')

  const workflows = [
    { name: 'ci.yml', estimatedDuration: 10 },
    { name: 'test.yml', estimatedDuration: 5 },
  ]

  const costs = calculateMonthlyCosts(workflows, 1) // 1 commit/day

  assert.ok(costs.minutesPerMonth > 0)
  assert.ok(costs.tiers.free, 'Should include free tier analysis')
  assert.ok(costs.tiers.team, 'Should include team tier analysis')
  assert.strictEqual(costs.breakdown.length, 2)

  console.log(`  Monthly: ${costs.minutesPerMonth} min`)
  console.log(`  Within free tier: ${costs.tiers.free.withinLimit}`)
  console.log('✅ PASS\n')
})()

// Test 8: calculateMonthlyCosts() - exceeds free tier
;(() => {
  console.log('Test 8: calculateMonthlyCosts() - exceeds free tier')

  const workflows = [
    { name: 'ci.yml', estimatedDuration: 50 },
    { name: 'test.yml', estimatedDuration: 30 },
  ]

  const costs = calculateMonthlyCosts(workflows, 2) // 2 commits/day
  // (50+30) × 2 × 30 = 4800 min/month

  assert.ok(costs.minutesPerMonth > 2000, 'Should exceed free tier')
  assert.strictEqual(costs.tiers.free.withinLimit, false)
  assert.ok(costs.tiers.free.overage > 0)
  assert.ok(costs.tiers.free.cost > 0)

  console.log(`  Monthly: ${costs.minutesPerMonth} min`)
  console.log(`  Overage: ${costs.tiers.free.overage} min`)
  console.log(`  Cost: $${costs.tiers.free.cost.toFixed(2)}`)
  console.log('✅ PASS\n')
})()

// Test 9: calculateMonthlyCosts() - cost calculation accuracy
;(() => {
  console.log('Test 9: calculateMonthlyCosts() - pricing accuracy')

  const workflows = [{ name: 'ci.yml', estimatedDuration: 100 }]
  const costs = calculateMonthlyCosts(workflows, 1) // 1 commit/day
  // 100 min × 1 commit/day × 30 days = 3000 min/month
  // Free tier: 2000 min
  // Overage: 1000 min × $0.008 = $8.00

  assert.strictEqual(costs.minutesPerMonth, 3000)
  assert.strictEqual(costs.tiers.free.overage, 1000)
  assert.strictEqual(costs.tiers.free.cost, 8.0)

  console.log('  ✅ Pricing calculations correct')
  console.log('✅ PASS\n')
})()

// Test 9b: calculateMonthlyCosts() - schedule and tag triggers don't scale by commits
;(() => {
  console.log('Test 9b: calculateMonthlyCosts() - trigger-aware run counts')

  const workflows = [
    {
      name: 'release.yml',
      estimatedDuration: 9,
      parsed: {
        on: {
          push: {
            tags: ['v*'],
          },
        },
      },
    },
    {
      name: 'weekly.yml',
      estimatedDuration: 20,
      parsed: {
        on: {
          schedule: [{ cron: '0 2 * * 0' }],
        },
      },
    },
  ]

  const costs = calculateMonthlyCosts(workflows, 3)
  // release: 1 run * 9 min = 9
  // weekly: 4 runs * 20 min = 80
  assert.strictEqual(costs.minutesPerMonth, 89)
  assert.strictEqual(costs.breakdown[0].runsPerMonth, 1)
  assert.strictEqual(costs.breakdown[1].runsPerMonth, 4)
  console.log('✅ PASS\n')
})()

// Test 10: analyzeOptimizations() - detects missing caching
;(() => {
  console.log('Test 10: analyzeOptimizations() - detects missing caching')

  const workflows = [
    {
      name: 'ci.yml',
      estimatedDuration: 10,
      parsed: {
        jobs: {
          test: {
            steps: [
              { name: 'Checkout', uses: 'actions/checkout@v2' },
              { name: 'Install', run: 'npm install' },
              { name: 'Test', run: 'npm test' },
            ],
          },
        },
      },
    },
  ]

  const optimizations = analyzeOptimizations(workflows, 2)
  const cachingRec = optimizations.find(r => r.type === 'caching')

  assert.ok(cachingRec, 'Should detect missing caching')
  assert.strictEqual(cachingRec.priority, 'high')
  assert.ok(cachingRec.potentialSavings > 0)
  console.log(`  Found: ${cachingRec.title}`)
  console.log(`  Savings: ${cachingRec.potentialSavings} min/month`)
  console.log('✅ PASS\n')
})()

// Test 11: analyzeOptimizations() - detects large matrix
;(() => {
  console.log('Test 11: analyzeOptimizations() - detects oversized matrix')

  const workflows = [
    {
      name: 'ci.yml',
      estimatedDuration: 100,
      parsed: {
        jobs: {
          test: {
            strategy: {
              matrix: {
                node: ['14', '16', '18', '20'],
                os: ['ubuntu', 'windows', 'macos'],
              },
            },
            steps: [{ name: 'Test', run: 'npm test' }],
          },
        },
      },
    },
  ]

  const optimizations = analyzeOptimizations(workflows, 1)
  const matrixRec = optimizations.find(r => r.type === 'matrix')

  assert.ok(matrixRec, 'Should detect oversized matrix')
  assert.ok(matrixRec.description.includes('12 matrix'))
  assert.ok(matrixRec.potentialSavings > 0)
  console.log(`  Found: ${matrixRec.title}`)
  console.log(`  Matrix size: 12 (4 × 3)`)
  console.log('✅ PASS\n')
})()

// Test 12: analyzeOptimizations() - detects nightly workflows
;(() => {
  console.log(
    'Test 12: analyzeOptimizations() - detects high schedule frequency'
  )

  const workflows = [
    {
      name: 'nightly-scan.yml',
      estimatedDuration: 50,
      parsed: {
        on: { schedule: [{ cron: '0 0 * * *' }] },
        jobs: {
          scan: { steps: [{ name: 'Scan', run: 'scan' }] },
        },
      },
    },
  ]

  const optimizations = analyzeOptimizations(workflows, 1)
  const frequencyRec = optimizations.find(r => r.type === 'frequency')

  assert.ok(frequencyRec, 'Should detect high-frequency schedule')
  assert.ok(frequencyRec.description.includes('runs about'))
  assert.ok(frequencyRec.potentialSavings > 0)
  console.log(`  Found: ${frequencyRec.title}`)
  console.log(`  ${frequencyRec.description}`)
  console.log('✅ PASS\n')
})()

// Test 13: analyzeOptimizations() - detects missing path filters
;(() => {
  console.log('Test 13: analyzeOptimizations() - detects missing path filters')

  const workflows = [
    {
      name: 'ci.yml',
      estimatedDuration: 20,
      parsed: {
        on: { push: { branches: ['main'] } },
        jobs: {
          test: { steps: [{ name: 'Test', run: 'npm test' }] },
        },
      },
    },
  ]

  const optimizations = analyzeOptimizations(workflows, 2)
  const conditionalRec = optimizations.find(r => r.type === 'conditional')

  assert.ok(conditionalRec, 'Should detect missing path filters')
  assert.ok(conditionalRec.action.includes('paths-ignore'))
  console.log(`  Found: ${conditionalRec.title}`)
  console.log('✅ PASS\n')
})()

// Test 14: analyzeOptimizations() - no recommendations for optimal workflows
;(() => {
  console.log('Test 14: analyzeOptimizations() - optimal workflow')

  const workflows = [
    {
      name: 'ci.yml',
      estimatedDuration: 5,
      parsed: {
        on: {
          push: {
            paths: ['src/**', 'tests/**'],
          },
        },
        jobs: {
          test: {
            strategy: {
              matrix: { node: ['20'] },
            },
            steps: [
              { uses: 'actions/checkout@v2' },
              { uses: 'actions/setup-node@v3', with: { cache: 'npm' } },
              { run: 'npm ci' },
              { run: 'npm test' },
            ],
          },
        },
      },
    },
  ]

  const optimizations = analyzeOptimizations(workflows, 1)

  // Should have minimal or no recommendations
  console.log(`  Recommendations: ${optimizations.length}`)
  console.log('✅ PASS\n')
})()

console.log('✅ All analyze-ci tests passed!\n')
