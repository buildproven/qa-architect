'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const packageJson = require('../package.json')
const releaseWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/release.yml'),
  'utf8'
)
const semgrepRequirements = fs.readFileSync(
  path.join(repoRoot, '.github/semgrep-release-requirements.txt'),
  'utf8'
)

console.log('\nrelease workflow — publish safety gates')

assert.match(
  packageJson.scripts.prerelease,
  /npm run security:audit/,
  'prerelease must fail on high or critical dependency vulnerabilities'
)
assert.match(
  packageJson.scripts.prerelease,
  /npm run format:check && npm run lint && npm run type-check:all/,
  'prerelease must include formatting, linting, and type checks'
)
const tagVerificationStart = releaseWorkflow.indexOf(
  '      - name: Verify tag matches package version'
)
const tagVerificationEnd = releaseWorkflow.indexOf(
  '\n      - name:',
  tagVerificationStart + 1
)
assert.ok(
  tagVerificationStart >= 0 && tagVerificationEnd >= 0,
  'release workflow must define tag verification'
)

const tagVerificationBlock = releaseWorkflow.slice(
  tagVerificationStart,
  tagVerificationEnd
)
assert.ok(
  tagVerificationBlock.includes('TAG_NAME: ${{ github.ref_name }}') &&
    tagVerificationBlock.includes(
      `expected="v$(node -p 'require("./package.json").version')"`
    ),
  'release workflow must reject tags that do not match package.json'
)

const runMarker = '        run: |\n'
const scriptStart = tagVerificationBlock.indexOf(runMarker) + runMarker.length
const tagVerificationScript = tagVerificationBlock
  .slice(scriptStart)
  .replace(/^ {10}/gm, '')
const tagVerification = spawnSync('bash', ['-n'], {
  cwd: repoRoot,
  input: tagVerificationScript,
  encoding: 'utf8',
})
assert.strictEqual(
  tagVerification.status,
  0,
  `tag verification must be valid Bash: ${tagVerification.stderr}`
)

const matchingTag = spawnSync('bash', ['-c', tagVerificationScript], {
  cwd: repoRoot,
  env: { ...process.env, TAG_NAME: `v${packageJson.version}` },
  encoding: 'utf8',
})
assert.strictEqual(
  matchingTag.status,
  0,
  `matching tag must pass verification: ${matchingTag.stderr}`
)
assert.match(
  releaseWorkflow,
  /name: Run pre-release checks[\s\S]*run: \|[\s\S]*npm run prerelease/,
  'release workflow must run the complete prerelease script before publishing'
)
assert.match(
  releaseWorkflow,
  /name: Install Semgrep CLI for prerelease checks[\s\S]*--no-deps --require-hashes[\s\S]*\.github\/semgrep-release-requirements\.txt/,
  'release workflow must install the hash-locked Semgrep dependency set'
)
assert.doesNotMatch(
  semgrepRequirements,
  /^mcp==/m,
  'local-only Semgrep release checks must not install its vulnerable MCP server dependency'
)
const requirementLines = []
let requirementLine = ''
for (const rawLine of semgrepRequirements.split('\n')) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  requirementLine += `${requirementLine ? ' ' : ''}${line.replace(/ \\$/, '')}`
  if (!line.endsWith(' \\')) {
    requirementLines.push(requirementLine)
    requirementLine = ''
  }
}
assert.strictEqual(
  requirementLine,
  '',
  'Semgrep lockfile must not end mid-entry'
)
assert.ok(
  requirementLines.length > 0,
  'Semgrep lockfile must contain requirements'
)
for (const line of requirementLines) {
  const [requirement, ...hashes] = line.split(' ')
  assert.match(
    requirement,
    /^[A-Za-z0-9_.-]+==[^ ]+$/,
    `Semgrep lock entry must be exact and hash-locked: ${line}`
  )
  assert.ok(hashes.length > 0, `Semgrep lock entry must have a hash: ${line}`)
  for (const hash of hashes) {
    assert.match(
      hash,
      /^--hash=sha256:[0-9a-f]{64}$/,
      `Semgrep lock hash must be an exact SHA-256: ${hash}`
    )
  }
}
const semgrepLockVersion = requirementLines
  .find(line => line.startsWith('semgrep=='))
  ?.match(/^semgrep==([^ ]+)/)?.[1]
assert.ok(semgrepLockVersion, 'Semgrep lockfile must pin the Semgrep version')
const workflowSemgrepVersion = releaseWorkflow.match(
  /SEMGREP_VERSION:\s*'([^']+)'/
)?.[1]
assert.ok(
  workflowSemgrepVersion,
  'release workflow must define one Semgrep version variable'
)
const releaseSemgrepVersions = [
  ...releaseWorkflow.matchAll(/semgrep --version\)" = "\$SEMGREP_VERSION/g),
].map(() => workflowSemgrepVersion)
assert.ok(
  releaseSemgrepVersions.length > 0,
  'release workflow must verify the Semgrep version'
)
assert.ok(
  releaseSemgrepVersions.every(version => version === semgrepLockVersion),
  'release workflow Semgrep version checks must match the lockfile'
)
for (const match of releaseWorkflow.matchAll(
  /uses: (actions\/[\w-]+)@([^\s]+)/g
)) {
  assert.match(
    match[2],
    /^[0-9a-f]{40}$/,
    `trusted release action ${match[1]} must be pinned to a full commit SHA`
  )
}
assert.match(
  releaseWorkflow,
  /name: Install Semgrep CLI for prerelease checks[\s\S]*semgrep" --version\)" = "\$SEMGREP_VERSION"/,
  'release workflow must verify the installed Semgrep binary before exporting it'
)
assert.match(
  releaseWorkflow,
  /name: Run pre-release checks[\s\S]*command -v semgrep[\s\S]*RUNNER_TEMP\/semgrep-venv\/bin\/semgrep[\s\S]*semgrep --version[\s\S]*npm run prerelease/,
  'prerelease checks must assert the exported Semgrep binary before running'
)
assert.ok(
  releaseWorkflow.indexOf('name: Install Semgrep CLI for prerelease checks') <
    releaseWorkflow.indexOf('name: Run pre-release checks'),
  'release workflow must install Semgrep before running prerelease checks'
)

console.log('✅ Release workflow safety gates verified')
