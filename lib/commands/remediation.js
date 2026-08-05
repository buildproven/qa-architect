'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { createFingerprint } = require('../assurance/fingerprint')
const { RULE_PACK_VERSION } = require('../assurance/rule-catalog')

const PACKET_VERSION = '1.0.0'
const EVIDENCE_VERSION = '1.0.0'
const BLOCKING_SEVERITIES = new Set(['critical', 'high'])
const TEST_PATH =
  /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/
const SOURCE_PATH = /\.(?:[cm]?js|jsx|ts|tsx|py|rb|go|java|kt|rs|c|cc|cpp)$/
const SECRET_ASSIGNMENT =
  /\b(?:api[_-]?key|secret|token|password|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*['"`][^'"`]+['"`]/gi
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout || 120_000,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    shell: false,
    env: options.env || process.env,
    input: options.input,
  })
  return {
    executable,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout: (result.stdout || '').slice(-40_000),
    stderr: (result.stderr || '').slice(-40_000),
  }
}

function git(projectPath, args, options = {}) {
  return run('git', ['-C', projectPath, ...args], options)
}

function requireSuccess(result, label) {
  if (result.error || result.status !== 0) {
    const detail = result.error || result.stderr.trim() || result.stdout.trim()
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout.trim()
}

function canonicalRuleId(value) {
  const normalized = String(value || 'unknown-rule')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'unknown-rule'
}

function redactContext(source) {
  if (PRIVATE_KEY.test(source)) return '[REDACTED PRIVATE KEY MATERIAL]'
  return source.replace(SECRET_ASSIGNMENT, match => {
    const separator = match.includes(':') ? ':' : '='
    return `${match.split(separator)[0].trim()}${separator} "[REDACTED]"`
  })
}

function readContext(projectPath, finding, radius = 3) {
  if (!finding.file || finding.line <= 0) return null
  const root = path.resolve(projectPath)
  const absolute = path.resolve(root, finding.file)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('finding path escapes the project root')
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null
  const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/)
  const start = Math.max(1, finding.line - radius)
  const end = Math.min(
    lines.length,
    Math.max(finding.endLine || finding.line, finding.line) + radius
  )
  return {
    path: finding.file.replaceAll('\\', '/'),
    startLine: start,
    endLine: end,
    redacted: true,
    text: redactContext(lines.slice(start - 1, end).join('\n')),
  }
}

function findingIdentity(projectPath, finding) {
  const context = readContext(projectPath, finding, 0)
  const evidenceIdentity = [
    finding.message || '',
    finding.cwe || '',
    context ? context.text.trim() : '',
  ].join('\n')
  return createFingerprint(projectPath, {
    source: finding.source || 'audit',
    ruleId: canonicalRuleId(finding.id),
    identityVersion: '1.0.0',
    location: { path: finding.file || 'package.json' },
    evidenceIdentity,
    continuityIdentity: context ? context.text.trim() : undefined,
  })
}

function revision(projectPath) {
  const head = requireSuccess(
    git(projectPath, ['rev-parse', 'HEAD']),
    'resolve HEAD'
  )
  return { kind: 'git-commit', value: head }
}

function verificationPolicy(projectPath, finding) {
  const hasPackage = fs.existsSync(path.join(projectPath, 'package.json'))
  return {
    exactFinding: {
      source: finding.source,
      ruleId: finding.id,
      path: finding.file,
    },
    regressionTest: {
      required: SOURCE_PATH.test(finding.file || ''),
      reason: SOURCE_PATH.test(finding.file || '')
        ? 'Executable behavior changed and must be guarded by a test delta.'
        : 'The finding is not in executable source.',
    },
    focusedCommands: hasPackage
      ? [{ executable: 'npm', args: ['test'], timeoutMs: 600_000 }]
      : [],
    adjacentScan: { blockingSeverities: [...BLOCKING_SEVERITIES] },
  }
}

function createRemediationPacket({ projectPath, finding }) {
  const root = path.resolve(projectPath)
  const identity = findingIdentity(root, finding)
  const packet = {
    schemaVersion: PACKET_VERSION,
    packetId: `qaa-remediation-${identity.fingerprint.slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    revision: revision(root),
    rulePackVersion: RULE_PACK_VERSION,
    finding: {
      fingerprintVersion: identity.fingerprintVersion,
      fingerprint: identity.fingerprint,
      source: finding.source,
      ruleId: finding.id,
      severity: finding.severity,
      message: finding.message,
      location: {
        path: identity.relativePath,
        startLine: finding.line || 0,
        endLine: finding.endLine || finding.line || 0,
      },
      cwe: finding.cwe || null,
      owasp: finding.owasp || null,
      guidance: finding.fix || null,
    },
    context: readContext(root, finding),
    constraints: [
      'Change only files needed to repair this finding and its regression test.',
      'Do not expose, copy, or invent credentials or private data.',
      'Do not commit, merge, push, publish, or modify another worktree.',
      'Do not suppress or disable the rule unless the packet evidence proves a false positive.',
    ],
    verification: verificationPolicy(root, finding),
  }
  return { ...packet, packetSha256: sha256(JSON.stringify(packet)) }
}

function renderAgentInstructions(packet) {
  return [
    'Repair the finding described by the attached QA Architect remediation packet.',
    'Work only in the current isolated worktree.',
    'Follow every packet constraint. Add or update a regression test when required.',
    'Do not commit, merge, push, or claim success. The caller will verify the result.',
    'Return a concise summary of files changed and tests added.',
    '',
    JSON.stringify(packet, null, 2),
  ].join('\n')
}

function adapterFor(name, worktreePath, prompt) {
  if (name === 'codex') {
    return {
      name,
      executable: 'codex',
      args: [
        'exec',
        '--cd',
        worktreePath,
        '--sandbox',
        'workspace-write',
        '--ephemeral',
        '--color',
        'never',
        prompt,
      ],
    }
  }
  if (name === 'claude') {
    return {
      name,
      executable: 'claude',
      args: [
        '--print',
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read,Edit,Write',
        '--no-session-persistence',
        prompt,
      ],
    }
  }
  throw new Error(`unsupported remediation adapter: ${name}`)
}

function exportRemediationPackets(projectPath, findings, outputDirectory) {
  const selected = findings.filter(f => BLOCKING_SEVERITIES.has(f.severity))
  const resolved = path.resolve(outputDirectory)
  fs.mkdirSync(resolved, { recursive: true })
  const exports = selected.map(finding => {
    const packet = createRemediationPacket({ projectPath, finding })
    const filename = `${packet.packetId}.json`
    const target = path.join(resolved, filename)
    fs.writeFileSync(target, `${JSON.stringify(packet, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return { finding, packet, path: target }
  })
  return exports
}

function parseSemgrep(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed.results))
      throw new Error('results is not an array')
    return parsed.results
  } catch (error) {
    throw new Error(
      `Semgrep returned malformed verification evidence: ${error.message}`
    )
  }
}

function scanWorktree(worktreePath, ruleFiles) {
  const args = ['--json', '--quiet', '--no-git-ignore']
  for (const ruleFile of ruleFiles) args.push('--config', ruleFile)
  args.push('.')
  const result = run('semgrep', args, { cwd: worktreePath, timeout: 120_000 })
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(
      `Semgrep verification failed: ${result.error || result.stderr}`
    )
  }
  return { command: result, findings: parseSemgrep(result.stdout) }
}

function rawFindingMatches(raw, packet, worktreePath) {
  const ruleMatches =
    raw.check_id === packet.finding.ruleId ||
    String(raw.check_id || '').endsWith(`.${packet.finding.ruleId}`)
  const rawPath = String(raw.path || '').replaceAll('\\', '/')
  const relativePath = path.isAbsolute(rawPath)
    ? path.relative(worktreePath, rawPath).replaceAll('\\', '/')
    : rawPath.replace(/^\.\//, '')
  return ruleMatches && relativePath === packet.finding.location.path
}

function changedPaths(worktreePath) {
  const result = git(worktreePath, ['status', '--porcelain=v1', '-z'])
  requireSuccess(result, 'inspect remediation changes')
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(entry => entry.slice(3).split(' -> ').at(-1))
}

function incompleteEvidence(packet, adapter, baseHead, reason, details = {}) {
  const evidence = {
    schemaVersion: EVIDENCE_VERSION,
    status: 'INCOMPLETE',
    reason,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    adapter,
    baseHead,
    resultHead: null,
    rulePackVersion: packet.rulePackVersion,
    commands: [],
    ...details,
  }
  if (Array.isArray(details.commands)) {
    evidence.commands = details.commands.map(commandEvidence)
  }
  return evidence
}

function commandEvidence(result) {
  return {
    executable: result.executable,
    args: result.args.map(argument =>
      argument.length > 1_000
        ? `<redacted-input sha256:${sha256(argument)}>`
        : argument
    ),
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdoutSha256: sha256(result.stdout || ''),
    stderrSha256: sha256(result.stderr || ''),
  }
}

function preparation({
  projectPath,
  packet,
  adapterName,
  ruleFiles,
  worktreeRoot,
  allowedDirtyPaths,
}) {
  const root = path.resolve(projectPath)
  const current = revision(root).value
  if (current !== packet.revision.value) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'packet-revision-stale'
      ),
    }
  }
  const statusResult = git(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ])
  requireSuccess(statusResult, 'inspect source worktree')
  const dirtyPaths = statusResult.stdout
    .split('\0')
    .filter(Boolean)
    .map(entry => entry.slice(3).split(' -> ').at(-1))
  const allowed = new Set(allowedDirtyPaths || [])
  if (dirtyPaths.some(candidate => !allowed.has(candidate))) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'source-worktree-dirty'
      ),
    }
  }
  const branch = requireSuccess(
    git(root, ['branch', '--show-current']),
    'resolve source branch'
  )
  if (!branch || ['main', 'master'].includes(branch)) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'source-branch-not-feature'
      ),
    }
  }
  const before = scanWorktree(root, ruleFiles)
  if (!before.findings.some(raw => rawFindingMatches(raw, packet, root))) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'finding-not-reproduced',
        {
          commands: [before.command],
        }
      ),
    }
  }
  const container =
    worktreeRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'qaa-remediation-'))
  fs.mkdirSync(container, { recursive: true })
  const isolated = path.join(container, packet.packetId)
  const repairBranch = `qaa/remediate-${packet.finding.fingerprint.slice(0, 12)}-${crypto.randomUUID().slice(0, 8)}`
  const add = git(root, [
    'worktree',
    'add',
    '-b',
    repairBranch,
    isolated,
    current,
  ])
  if (add.error || add.status !== 0) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'isolated-worktree-create-failed',
        {
          commands: [before.command, add],
        }
      ),
    }
  }
  return {
    root,
    current,
    before,
    isolated,
    repairBranch,
    commands: [before.command],
  }
}

function executeAdapter(context, packet, adapterName, commandRunner) {
  const { isolated, repairBranch, current, commands } = context
  const prompt = renderAgentInstructions(packet)
  const adapter = adapterFor(adapterName, isolated, prompt)
  const agent = commandRunner(adapter.executable, adapter.args, {
    cwd: isolated,
    timeout: 600_000,
  })
  commands.push(agent)
  if (agent.error || agent.status !== 0) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'agent-failed',
        {
          worktree: isolated,
          branch: repairBranch,
          commands,
        }
      ),
    }
  }
  const paths = changedPaths(isolated)
  if (paths.length === 0) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'agent-made-no-changes',
        {
          worktree: isolated,
          branch: repairBranch,
          commands,
        }
      ),
    }
  }
  if (
    packet.verification.regressionTest.required &&
    !paths.some(p => TEST_PATH.test(p))
  ) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'regression-test-missing',
        {
          worktree: isolated,
          branch: repairBranch,
          changedPaths: paths,
          commands,
        }
      ),
    }
  }
  return { ...context, paths }
}

function blockingIdentity(raw, worktreePath) {
  const rawPath = String(raw.path || '').replaceAll('\\', '/')
  const relativePath = path.isAbsolute(rawPath)
    ? path.relative(worktreePath, rawPath).replaceAll('\\', '/')
    : rawPath.replace(/^\.\//, '')
  return `${raw.check_id}:${relativePath}`
}

function proveRegressionTestRed(context, packet, commandRunner) {
  if (!packet.verification.regressionTest.required) return context
  const { isolated, current, commands, paths, root } = context
  const testPaths = paths.filter(candidate => TEST_PATH.test(candidate))
  requireSuccess(
    git(isolated, ['add', '--intent-to-add', '--', ...testPaths]),
    'prepare regression-test proof'
  )
  const diffResult = git(isolated, ['diff', '--binary', '--', ...testPaths])
  requireSuccess(diffResult, 'capture regression-test delta')
  const patch = diffResult.stdout
  const proofPath = `${isolated}-fail-before`
  const add = git(root, ['worktree', 'add', '--detach', proofPath, current])
  commands.push(add)
  if (add.error || add.status !== 0) {
    return { regressionProofFailed: 'regression-proof-worktree-failed' }
  }
  const apply = run('git', ['-C', proofPath, 'apply', '--binary', '-'], {
    input: patch,
  })
  commands.push(apply)
  if (apply.error || apply.status !== 0) {
    commands.push(git(root, ['worktree', 'remove', '--force', proofPath]))
    return { regressionProofFailed: 'regression-test-delta-apply-failed' }
  }
  let failureObserved = false
  for (const focused of packet.verification.focusedCommands) {
    const result = commandRunner(focused.executable, focused.args, {
      cwd: proofPath,
      timeout: focused.timeoutMs,
    })
    commands.push(result)
    if (result.error || result.status !== 0) failureObserved = true
  }
  const remove = git(root, ['worktree', 'remove', '--force', proofPath])
  commands.push(remove)
  if (remove.error || remove.status !== 0) {
    return { regressionProofFailed: 'regression-proof-worktree-cleanup-failed' }
  }
  return failureObserved
    ? context
    : { regressionProofFailed: 'regression-test-did-not-fail-before' }
}

function verifyRepair(context, packet, adapterName, ruleFiles, commandRunner) {
  const { isolated, repairBranch, current, commands, paths, before } = context
  const after = scanWorktree(isolated, ruleFiles)
  commands.push(after.command)
  if (after.findings.some(raw => rawFindingMatches(raw, packet, isolated))) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'exact-finding-remains',
        {
          worktree: isolated,
          branch: repairBranch,
          changedPaths: paths,
          commands,
        }
      ),
    }
  }
  const previousBlocking = new Set(
    before.findings
      .filter(raw => raw.extra?.severity === 'ERROR')
      .map(raw => blockingIdentity(raw, context.root))
  )
  const newBlocking = after.findings.filter(
    raw =>
      raw.extra?.severity === 'ERROR' &&
      !previousBlocking.has(blockingIdentity(raw, isolated))
  )
  if (newBlocking.length > 0) {
    return {
      evidence: incompleteEvidence(
        packet,
        adapterName,
        current,
        'adjacent-blocking-findings',
        {
          worktree: isolated,
          branch: repairBranch,
          changedPaths: paths,
          commands,
          newBlockingFindings: newBlocking.map(raw => ({
            ruleId: raw.check_id,
            path: raw.path,
            line: raw.start?.line || 0,
          })),
        }
      ),
    }
  }
  for (const focused of packet.verification.focusedCommands) {
    const result = commandRunner(focused.executable, focused.args, {
      cwd: isolated,
      timeout: focused.timeoutMs,
    })
    commands.push(result)
    if (result.error || result.status !== 0) {
      return {
        evidence: incompleteEvidence(
          packet,
          adapterName,
          current,
          'focused-verification-failed',
          {
            worktree: isolated,
            branch: repairBranch,
            changedPaths: paths,
            commands,
          }
        ),
      }
    }
  }
  return context
}

function commitRepair(context, packet, adapterName) {
  const { isolated, repairBranch, current, commands, paths } = context
  commands.push(git(isolated, ['add', '--all']))
  const commit = git(
    isolated,
    [
      'commit',
      '-m',
      `fix: remediate ${canonicalRuleId(packet.finding.ruleId)}`,
    ],
    { timeout: 600_000 }
  )
  commands.push(commit)
  if (commit.error || commit.status !== 0) {
    return incompleteEvidence(
      packet,
      adapterName,
      current,
      'verified-commit-failed',
      {
        worktree: isolated,
        branch: repairBranch,
        changedPaths: paths,
        commands,
      }
    )
  }
  const resultHead = revision(isolated).value
  const diff = requireSuccess(
    git(isolated, ['diff', '--binary', `${current}..${resultHead}`]),
    'capture remediation diff'
  )
  return {
    schemaVersion: EVIDENCE_VERSION,
    status: 'VERIFIED',
    reason: null,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    adapter: adapterName,
    baseHead: current,
    resultHead,
    branch: repairBranch,
    worktree: isolated,
    rulePackVersion: packet.rulePackVersion,
    changedPaths: paths,
    diffSha256: sha256(diff),
    commands,
  }
}

function orchestrateRemediation({
  projectPath,
  packet,
  adapterName,
  ruleFiles,
  commandRunner = run,
  worktreeRoot = null,
  allowedDirtyPaths = [],
}) {
  const prepared = preparation({
    projectPath,
    packet,
    adapterName,
    ruleFiles,
    worktreeRoot,
    allowedDirtyPaths,
  })
  if (prepared.evidence) return prepared.evidence
  const executed = executeAdapter(prepared, packet, adapterName, commandRunner)
  if (executed.evidence) return executed.evidence
  const regressionProof = proveRegressionTestRed(
    executed,
    packet,
    commandRunner
  )
  if (regressionProof.regressionProofFailed) {
    return incompleteEvidence(
      packet,
      adapterName,
      executed.current,
      regressionProof.regressionProofFailed,
      {
        worktree: executed.isolated,
        branch: executed.repairBranch,
        changedPaths: executed.paths,
        commands: executed.commands,
      }
    )
  }
  const verified = verifyRepair(
    regressionProof,
    packet,
    adapterName,
    ruleFiles,
    commandRunner
  )
  if (verified.evidence) return verified.evidence
  const evidence = commitRepair(verified, packet, adapterName)
  if (evidence.status === 'VERIFIED' && Array.isArray(evidence.commands)) {
    evidence.commands = evidence.commands.map(commandEvidence)
  }
  return evidence
}

function evidenceFresh(projectPath, evidence) {
  if (!evidence || evidence.status !== 'VERIFIED' || !evidence.resultHead)
    return false
  return revision(projectPath).value === evidence.resultHead
}

module.exports = {
  PACKET_VERSION,
  adapterFor,
  canonicalRuleId,
  createRemediationPacket,
  evidenceFresh,
  exportRemediationPackets,
  findingIdentity,
  orchestrateRemediation,
  redactContext,
  renderAgentInstructions,
}
