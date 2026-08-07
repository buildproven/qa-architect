# ADR: Versioned assurance contract

- Status: Accepted
- Date: 2026-08-05
- Tracking: [BUI-672](https://linear.app/buildproven/issue/BUI-672/define-stable-findings-baselines-waivers-and-honest-assurance-verdicts)
- Plan: [BUI-672 assurance contract](../plans/BUI-672-assurance-contract.md)
- Review: accepted after iterative high-effort Codex review, adversarial Draft-07 validation, and an independent Claude cross-review on 2026-08-05

## Context

QA Architect currently lets individual commands define their own finding shapes and verdict meanings. Audit output can say `SAFE TO SHIP` when supported scanners found no findings, while Ship Check can return `SHIP` even when checks were skipped. Findings have rule IDs but no location-stable identity suitable for baselines, waivers, PR annotations, or remediation evidence.

The PR gate, remediation loop, revision-bound Ship Check, stack packs, and preview verification all need one contract. Adding command-specific fixes would make the inconsistency permanent.

The concrete v1 contracts are [assurance-result-v1.schema.json](../../config/assurance-result-v1.schema.json) and [assurance-policy-v1.schema.json](../../config/assurance-policy-v1.schema.json). They ship in the npm package and are the implementation-independent structural oracle for field names, nullability, enums, verdict shape, required-observation presence, and registry coverage presence. The semantic validator and the prose below define cross-record policy and arithmetic invariants that Draft-07 cannot express.

## Decision

Introduce a versioned assurance module with one public evaluation seam:

```js
evaluateAssurance({
  projectRoot,
  revision,
  supportedChecks,
  requiredChecks,
  findings,
  checks,
  policy,
  now,
})
```

Scanner adapters normalize evidence before evaluation. The module will:

1. validate and normalize findings and check observations, including explicit `applicable`, `required`, and outcome fields;
2. calculate a stable fingerprint from a versioned canonical serialization of source, rule ID, a path validated relative to the explicit `projectRoot`, adapter-supplied evidence identity, and structural continuity identity, excluding line numbers;
3. validate and apply a versioned checked-in baseline and accountable waivers;
4. return active, baseline, waived, expired, and invalid evidence separately, along with the exact `evaluatedAt` instant derived from `now`, the immutable evaluated `revision`, and the command's independent `supportedChecks` and `requiredChecks` scopes;
5. return exactly `PASS`, `BLOCK`, or `INCOMPLETE` with machine-readable reasons;
6. expose schema and rule-pack versions plus engine identity/version on every finding and check observation.

Every normalized finding also carries evidence location, remediation guidance, and zero or more supported assurance mappings. An assurance mapping is a structured `{ standard, control, confidence, limitation }` claim (for example, an OWASP ASVS control); it describes what the rule supports and its limits rather than claiming certification. The rule descriptor is the source of truth for these fields, and JSON, Markdown, SARIF, terminal output where space permits, and the generated catalog project them without inventing stronger coverage.

Audit and Ship Check remain responsible for running their engines. They must pass results to the assurance module and render the returned evaluation without redefining verdict policy.

Every assurance result is revision-bound. Adapters pass the full commit object ID as `{ kind: 'git-commit', value }` only after proving that the complete eligible-file manifest and bytes used by every engine exactly match that commit. Ordinary `git status` cleanliness is insufficient because scanners may include ignored or untracked files (for example, Semgrep's `--no-git-ignore` mode). If any eligible input is absent from or differs from the commit, or for a non-Git project, adapters pass `{ kind: 'content-digest', algorithm: 'sha256', manifestVersion: 1, value }`.

Content-manifest version 1 hashes the UTF-8 bytes of compact `JSON.stringify(['qaa-content-manifest', 1, entries])`. Each eligible leaf is represented exactly once after project-root-relative path validation, `/` separator conversion, `.` removal, `..`/outside-root rejection, and Unicode NFC normalization. Entries sort by `Buffer.compare(Buffer.from(relativePath, 'utf8'))`. A regular file entry is `['file', relativePath, executableBoolean, sha256OfRawBytes]`; a symbolic-link entry is `['symlink', relativePath, base64OfRawLinkTargetBytes]`. Directories are not entries. Engines that descend into a submodule contribute the eligible leaf files and bytes they actually scan; otherwise the submodule contributes no source entry. A normalized-path collision, unreadable eligible leaf, unsupported leaf type, or manifest change during evaluation makes revision capture incomplete rather than dropping the input. The outer `value` is lowercase hexadecimal SHA-256 of the manifest serialization. Golden vectors cover empty manifests, binary bytes, executable-bit changes, Unicode and separator normalization, symlinks, ignored/untracked files, submodule traversal, and ambiguous concatenation cases. A timestamp, branch name, short commit, unversioned digest, or commit ID that omits an eligible input is not an immutable revision and cannot support `PASS`.

Command JSON nests the schema-valid evaluation at `assurance`. Existing top-level Audit `findings`/`summary` and Ship Check `results` members remain compatibility projections and may retain their legacy shapes during migration. New consumers use `assurance.findings`; the strict assurance-result schema does not validate or replace the legacy siblings.

The default policy blocks active critical/high findings. Medium/low findings remain visible advisories. Every finding serializes `blocksMerge`, calculated from its active disposition and the effective `blockingSeverities`, so consumers never have to reconstruct customized policy from raw severity. A required applicable non-scanner quality check that runs and fails produces a `failed` observation and block reason. Scanner observations separate completion from findings: a scanner that executes and parses successfully records `passed` even when it emits findings, and those findings alone determine severity blocks under `blockingSeverities`. Scanner nonzero statuses documented to mean “findings present” are not execution failures. Scanner execution, timeout, or parse failures use `unavailable` when no usable result exists or `partial` when some usable evidence survives; they never use the non-scanner `failed` outcome. The observation contributes an incomplete reason while any recovered findings independently contribute block reasons. An optional check failure or unavailable optional engine remains a visible advisory and cannot satisfy a required check. A required engine failure, malformed policy artifact, expired waiver, or skipped required applicable check produces an incomplete reason. An expired waiver no longer suppresses its finding: the finding is active, retains the original non-empty waiver reason, owner, creation date, and expiry in `policyEvaluation`, contributes its normal block reason when its severity is blocking, and separately contributes the incomplete policy reason. A non-applicable check is recorded but does not affect completeness.

Verdict precedence is `INCOMPLETE`, then `BLOCK`, then `PASS`. An `INCOMPLETE` result retains every known block reason so consumers do not lose confirmed failures merely because other required evidence is missing. By default `PASS` exits zero and both `BLOCK` and `INCOMPLETE` exit nonzero in Audit and Ship Check. `--no-fail` is the sole report-only override that may force a zero exit, and it must not change the verdict.

Commands declare both the complete supported-check scope and the required floor independently of the observations they happened to produce. `supportedChecks` states every canonical check the command considered, including checks found non-applicable; an entitled engine excluded from a command mode is absent from this scope. Every supported ID must have a matching observation, every observation ID must belong to the supported scope, and `requiredChecks` is a schema-enforced subset whose matching observation must also say `required: true`. The evaluator synthesizes `not-applicable` or `missing` observations for omitted supported IDs as appropriate and rejects observations outside scope, so a truncated or overclaimed observations array cannot become `PASS` or obscure what Free versus Pro actually assessed.

Until BUI-677 adds risk-derived requirements, adapters use this conservative default mapping:

- `--audit` always requires its Semgrep/SAST observation; absence, timeout, malformed output, or execution failure is incomplete;
- format, lint, tests, secrets, and every other execution observation use argument-array commands selected by an expanded `lib/project-profile.js`. JavaScript/TypeScript uses its package-manager scripts. Generated mixed Python projects map `python:format:check`, `python:lint`, `python:type-check`, and `python:test` to the canonical format, lint, typecheck, and tests observations; pure Python projects use the corresponding Black, Ruff, mypy, and pytest commands detected from their generated configuration. Shell projects map configured shfmt and ShellCheck commands to format and lint. Mixed-language commands for the same canonical observation run independently and aggregate fail closed: the observation passes only when every applicable member completes and passes, fails when a completed non-scanner member fails, and is incomplete when any required member is missing, unavailable, or partial. Its engine identity is the versioned QA Architect aggregate adapter, while the structured `members` array retains a stable member key, member engine and versions, `{ executable, args }` command, outcome, summary, and optional human details for each execution; non-aggregate executed checks contain one member, while a check with no executable member uses an empty array. A detected custom/undecomposable JavaScript lint script makes the generic `lint` observation applicable and required. A recognized ESLint/Stylelint composite instead transfers that JavaScript command-floor requiredness to each detected engine observation without executing the composite twice; a separate Python or Shell lint member can still participate in the generic aggregate;
- tests are applicable and required when `lib/project-profile.js` detects a test script, test files, or a supported test framework. If tests are detected without a runnable script, QA Architect does not invent a command: it records missing required execution evidence and returns `INCOMPLETE`. Explicitly skipping an otherwise required test has the same incomplete result;
- dependency audit is applicable and required when a supported package manifest exists. `lib/project-profile.js` remains the authority for package manager and version, but exposes a separate argument-array `assuranceAuditCommand` that requests machine-readable, all-severity, all-dependency evidence without the production/high filters used by the existing CI `auditCommand`. The adapter preserves execution/parse failures as observations and treats documented findings exit statuses as completed execution;
- the package-registry engine is applicable and required for `--audit` when a supported manifest declares direct production dependencies. Its Free current-tree analysis resolves npm aliases, classifies every dependency source, and records public-registry response facts. Workspace/file/link, VCS, remote-artifact, and non-public/custom-registry specs are visible exclusions rather than false missing-package findings. Registry 404 means only `registry-not-found`; it never establishes hallucination, typo-squatting, or maliciousness. Pro may add package-age and name-confusion review signals, but labels them low-confidence heuristics and keeps them separate from registry facts. Known vulnerability evidence remains owned by the dependency-audit observation. Every applicable registry observation requires explicit coverage counts over all direct production dependencies, and a passed observation requires `completed + excluded === eligible`; registry unavailability, timeout, rate limiting, authentication failure, malformed responses, unresolved registry configuration, missing coverage, or scanning fewer eligible packages than declared is partial required evidence and produces `INCOMPLETE`;
- secrets scanning is applicable and required when its script or configuration exists;
- coverage, bundle, Lighthouse, environment, and CI checks are applicable when their corresponding artifact/configuration exists and optional unless the Pro Ship Check execution configuration marks them required; configuration establishes applicability only, and a required check needs execution evidence or becomes incomplete;
- documentation is applicable but optional unless the Pro Ship Check execution configuration marks it required.

Each observation serializes why it was applicable and required. Adapters may not infer those states from display names or from `skip` alone.

Applicable engines execute independently. A SAST failure does not prevent dependency or registry observations, and a dependency failure does not discard SAST findings. The final evaluation combines every known finding, block reason, and incomplete reason.

Baseline entries record a fingerprint, fingerprint version, identity version, occurrence count, approved normalized severity, and rule semantic version. Waivers record the same matching constraints plus reason, owner, creation date, and optional expiry. When matching findings exceed the recorded count, current severity is more severe than approved severity, or the rule or identity semantic version differs at all, affected occurrences remain active. Any rule or identity version change therefore requires an explicit baseline/waiver refresh; no adapter-specific compatibility inference is allowed.

A fingerprint may appear in the baseline or in the waiver set, never both. Overlap is a malformed policy artifact, produces `INCOMPLETE` with reason code `policy.fingerprint-overlap`, and occurrences are never consumed twice or allocated by file order.

Baseline and waiver collections are fingerprint-keyed objects. The policy loader uses duplicate-key-aware JSON parsing and rejects repeated raw object keys before schema validation; ordinary `JSON.parse` is not sufficient. Before strict schema validation, it performs a compatibility inspection of the raw top-level and entry `fingerprintVersion` and `identityVersion` values. Unsupported values are retained as invalid policy evidence and produce `policy.fingerprint-version-mismatch` or `policy.identity-version-mismatch`; they are not discarded behind a generic schema error. The v1 schema correctly rejects those entries for application. The semantic validator also rejects a key present in both collections as malformed policy.

The semantic policy validator trims and rejects blank waiver reasons or owners, rejects a creation date later than the evaluation time, and requires an expiry (when present) to be later than creation. JSON Schema format validation alone is not treated as sufficient for these accountability rules.

Identical findings that share a fingerprint are evaluated as one ambiguity group. The assurance result records its total and active counts; baseline and waived counts remain zero. For every group, semantic result validation requires `totalCount === activeCount + baselineCount + waivedCount`. Active, expired, ambiguous, and invalid groups have zero baseline and waived counts; baseline and waived groups put all occurrences in their one matching suppressed count. Renderers, including SARIF, attach the group fingerprint, policy state, and counts to every occurrence. No partial suppression is allowed.

Policy suppression requires a unique, stable continuity identity. For source findings, adapters derive it from normalized AST ancestry and the nearest named enclosing declaration/module export, excluding line numbers and sibling indexes; for dependency findings it is the package/advisory identity. If an adapter cannot establish that identity, or more than one current occurrence has the same fingerprint, baseline and waiver entries are reported as ambiguous, suppression fails closed, and all affected occurrences remain active. V1 policy entries therefore require `count: 1`; another value is malformed and produces `INCOMPLETE`. The count is a validation guard, not a license to consume an indistinguishable replacement. Moving unrelated lines preserves continuity, moving identical vulnerable code to a different structural owner changes it, and ambiguous duplicate groups never apply suppression.

Finding fingerprinting and basic report projections remain Free. Loading, writing, or applying baselines, waivers, custom blocking policy, or assurance-specific required-check overrides is Pro-only. These live in a separate versioned, checked-in `.qa-architect-assurance.json` file. It is intentionally outside the ignored `.qa-architect/` license directory. Existing generated `.qualityrc.json` remains execution/maturity configuration and neither triggers the Free upgrade gate nor supplies audit suppressions. Pro Ship Check may consume its existing `checks.*.required` settings as execution requirements, because Ship Check itself is Pro. Command-required engines are a non-downgradable floor: `required: true` may elevate an optional applicable check, but neither `.qualityrc.json` nor assurance policy may use `required: false` to weaken a command-required check. This preserves compatibility with generated configurations that currently contain `required: false` defaults.

Every v1 assurance policy explicitly contains `blockingSeverities` and `requiredChecks`; generated policies write `['critical', 'high']` and `{}` respectively. Omitting either member is malformed rather than invoking an implementation-specific default. Policy entries, result observations, and non-null reason `checkId` values all use only the canonical observation IDs `sast`, `format`, `lint`, `eslint`, `stylelint`, `typecheck`, `tests`, `build`, `coverage`, `dependency-audit`, `package-registry`, `secrets`, `documentation`, `lighthouse`, `bundle`, `environment`, and `ci-cost`. Unknown IDs are rejected and produce `INCOMPLETE` rather than silently targeting no observation.

Ship Check maps execution configuration keys explicitly: `prettier` to format, `eslint` to ESLint, `stylelint` to Stylelint, `typecheck` to the detected type-check script, `tests` to tests, `build` to the detected build script, `coverage` to coverage, `security-audit` to dependency audit, `documentation` to documentation, `lighthouse` to Lighthouse execution, `bundle` to bundle size, `environment` to environment validation, and `ci-cost` to CI analysis. The type-check and build observations also participate when their project-profile scripts exist even if an older `.qualityrc.json` has no corresponding keys. ESLint and Stylelint adapters run each detected engine independently through the profile's package-manager executable command so their outcomes cannot be misattributed; the existing composite lint script remains a compatibility/legacy result only and is not executed twice or treated as proof of either individual observation. When the detected lint script uses Biome, another linter, or an undecomposable custom command, QA Architect preserves and runs that real script once as the canonical generic `lint` observation rather than attributing it to ESLint or Stylelint. If policy instead requires an individual engine that cannot be identified or executed, that observation is missing evidence and produces `INCOMPLETE`. A generated `prettier.required: true` causes `format:check` to run when present and becomes `INCOMPLETE` when the required observation cannot run. If `.qualityrc.json` exists but cannot be parsed or validated, Ship Check records malformed execution configuration and returns `INCOMPLETE`; it never falls back to defaults while claiming complete evidence. Unknown required keys are malformed required evidence and produce `INCOMPLETE`; they are never silently ignored. `enabled: false` can make an optional configured check non-applicable but cannot disable a command-required floor.

The CLI rejects use of `.qa-architect-assurance.json` with the existing upgrade path when the entitlement is absent; it never silently ignores the artifact. Free users retain terminal, JSON, Markdown, and SARIF audit output without suppression.

Terminal, JSON, Markdown, and SARIF are projections of the same assurance result. Each projection records `evaluatedAt`, the immutable `revision`, and the independent `supportedChecks` and `requiredChecks` scopes; timestamps are never fingerprint inputs. The SARIF projection also records fingerprint, group disposition/counts, and policy state for each result. GitHub annotations and PR integration remain BUI-675.

Check observations use `missing` when a known applicable required check has no executable observation. `not-applicable` is valid only when `applicable` and `required` are both false; a required check is always applicable, and an applicable check cannot report `not-applicable`. Before verdict calculation, the evaluator rejects duplicate observation IDs with reason code `evidence.duplicate-check` and semantically validates coverage counts for every observation: `completed <= attempted`, `attempted + excluded <= eligible`, all counts describe the same declared candidate set, and `completion: complete` is valid only when `completed + excluded === eligible`. A count or completion contradiction produces `INCOMPLETE` with `evidence.invalid-coverage`. Coverage includes the machine-readable completion state `complete`, `partial`, `capped`, or `abandoned`. A non-complete observation cannot claim `passed`, but it may retain `failed` when partial execution already proved a failure; verdict precedence then retains both its block and incomplete reasons. Any required observation is incomplete when `completed + excluded < eligible` or whenever its completion state says the engine capped or abandoned eligible work. Human-readable `limitations` explain scope but never determine the verdict, and a producer cannot turn partial evidence into `passed` by choosing self-consistent counts or benign wording.

Reason codes are part of the v1 machine contract. Producers use only the schema-enumerated codes, with the same meaning in Audit and Ship Check: `finding.active`, `check.failed`, `check.unavailable`, `check.partial`, `check.skipped`, `check.missing`, `policy.malformed`, `policy.fingerprint-overlap`, `policy.waiver-expired`, `policy.entry-invalid`, `policy.ambiguous-finding`, `policy.fingerprint-version-mismatch`, `policy.identity-version-mismatch`, `execution-config.malformed`, `execution-config.unknown-required-check`, `evidence.duplicate-check`, `evidence.unknown-check`, `evidence.invalid-coverage`, `advisory.check-failed`, `advisory.check-unavailable`, and `advisory.coverage-limitation`. An unknown supplied observation uses `evidence.unknown-check`, sets `checkId` to `null` because the raw ID is outside the canonical vocabulary, and names the rejected ID in the human-readable message. The schema requires a canonical `checkId` and null fingerprint for every known check-specific reason, and requires a non-null fingerprint and null `checkId` for `finding.active`; consumers never need display text to locate those causes. The schema binds block, incomplete, and advisory code families to their corresponding `kind`; a code cannot be relabeled to weaken its verdict effect. Adding a meaning requires a result-schema version change; display text is not an API.

Rule descriptors expose normalized QA Architect severity rather than raw engine severity. Scanner adapters and the generated catalog consume the same descriptor/normalization function, so a Semgrep `ERROR` escalated by CWE policy cannot disagree with the published catalog.

The fingerprint algorithm has its own `fingerprintVersion`, persisted in every finding and policy entry. Each rule descriptor also declares an `identityVersion` semantic version covering its source-specific evidence and structural-continuity canonicalizers; the same value is persisted in the finding and matched policy entry. Semgrep rules derive evidence from the descriptor-selected, normalized metavariable/matched-syntax fields and continuity from the nearest supported named structural owner. Dependency rules use normalized package plus advisory identity; registry rules use the normalized resolved public package name. Raw scanner messages are never identity inputs. Any canonicalizer change requires an `identityVersion` bump, makes older policy entries explicitly invalid with `policy.identity-version-mismatch`, and requires a deliberate migration rather than silent baseline churn.

Fingerprint version 1 is the lowercase hexadecimal SHA-256 digest of the UTF-8 bytes of one compact JSON array, serialized with JavaScript `JSON.stringify` and no insignificant whitespace, in this exact order:

```text
["qaa-fingerprint",1,source,identityVersion,ruleId,relativePath,evidenceDigest,continuityDigest]
```

Before serialization, every string is Unicode NFC. `source` is the normalized lowercase adapter source. `identityVersion` is the exact descriptor semantic version for both inner canonicalizers. `ruleId` is the rule descriptor's canonical ID, which adapters must supply already in lowercase ASCII kebab case matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`; it is hashed verbatim and no scanner-emitted prefix, namespace, or separator is inferred or stripped. The same canonical ID is emitted as the finding's `ruleId` and used by the generated rule catalog. `relativePath` is resolved against the explicit `projectRoot`, has `.` segments removed, rejects remaining `..` segments or paths outside the root, and uses `/` separators; Windows drive letters and absolute roots never enter the value. `evidenceDigest` is the lowercase hexadecimal SHA-256 digest of the UTF-8 bytes of the descriptor-canonicalized evidence identity. `continuityDigest` is the same encoding of its canonicalized stable structural-continuity identity. When continuity cannot be established, its digest input is the exact ASCII/UTF-8 sentinel `qaa-continuity-ambiguous-v1` and the finding's continuity state is `ambiguous`. Neither raw identity is serialized. JSON escaping is therefore the exact ECMAScript `JSON.stringify` string escaping, and the array supplies unambiguous framing without a second length-delimited encoding. Golden vectors cover each source canonicalizer, ASCII, composed/decomposed Unicode, JSON metacharacters, structural-owner changes, the ambiguous sentinel, ambiguous duplicates, and Windows/POSIX path parity. Policy entries with an unsupported or different fingerprint or identity version are visible and produce `INCOMPLETE`; migrations must explicitly regenerate or translate them.

## Alternatives considered

### Keep verdict and suppression logic inside each command

Rejected. Audit, Ship Check, PR Check, and later remediation would drift and produce evidence that cannot be composed.

### Use line numbers in the fingerprint

Rejected. Unrelated edits would invalidate findings and make baselines noisy.

### Use only rule ID and file path

Rejected. Multiple findings from the same rule in one file would collapse. Adapter-supplied evidence identity distinguishes matched code or package identity; occurrence counts handle true duplicates.

### Treat missing checks as warnings

Rejected. A warning is evidence that ran and found an advisory condition. Missing evidence is incomplete and cannot support a positive assurance claim.

### Replace existing config with a new global policy system now

Rejected. BUI-672 introduces only the evidence contract and narrow baseline/waiver files. Risk-derived requirements and broader policy ownership remain BUI-677 and BUI-349.

## Invariants

- Line movement alone does not change a fingerprint.
- A meaningful evidence change does change a fingerprint.
- No renderer can upgrade `BLOCK` or `INCOMPLETE` to `PASS`.
- Required missing evidence never yields `PASS`.
- Non-applicable evidence is distinguishable from missing required evidence.
- Malformed and expired policy entries are visible and actionable.
- Baseline and waiver files never conceal findings from output.
- Baseline and waiver entries cannot overlap for one fingerprint.
- Duplicate raw JSON keys are rejected before policy schema validation.
- Waivers cannot cover more matching occurrences than were explicitly approved.
- Ambiguous or duplicate continuity cannot be baselined or waived; affected findings remain active.
- Any rule-semantic version difference, or any severity escalation, reactivates baseline and waived findings.
- Absolute machine paths, secrets, and timestamps are excluded from evidence identity.
- Engine identity and version are present on every finding/check but are not silently folded into fingerprint identity.
- Scanner completion status never reclassifies a finding's severity; parsed findings and engine failures travel on separate channels.
- Fingerprint version and canonicalization are explicit and cross-platform deterministic.
- Existing report formats can add fields, but the new verdict meanings are identical across terminal, JSON, Markdown, and SARIF.
- Existing execution configuration can make an optional check required but cannot downgrade a command-required engine.

## Migration and compatibility

This is a deliberate public-contract correction:

- audit `SAFE TO SHIP` becomes `PASS` with explicit `supportedChecks` and `requiredChecks` scopes;
- Ship Check `SHIP`/`REVIEW` become `PASS`/`BLOCK`/`INCOMPLETE`;
- JSON gains schema, verdict, reasons, fingerprint, disposition, and version fields;
- existing consumers reading only `findings` continue to receive that array during the transition;
- existing Ship Check consumers reading only `results` continue to receive that array during the transition;
- baseline and waiver artifacts are opt-in and versioned from their first release.

The release notes must call out the verdict rename and stricter incomplete behavior.

## Rollback

The assurance module is additive and command adapters remain separate. A rollback can restore the prior command renderers and remove the new CLI options without migrating user source files. Versioned baseline/waiver files are ignored by older releases and remain user-owned.

## Verification

- Public CLI/report tests demonstrate line-movement fingerprint stability, evidence/structural-owner change invalidation, fail-closed ambiguous duplicate suppression, Windows/POSIX path parity, and explicit fingerprint-version mismatch behavior.
- Fixture files cover valid baseline, fail-closed ambiguous duplicate suppression, single-occurrence waiver, any rule-version change, severity escalation, active findings under expired waivers, malformed artifacts, applicable/non-applicable checks, failed and unavailable required/optional checks, missing required evidence, engine provenance, and mixed block/incomplete precedence.
- Audit and Ship Check terminal, JSON, Markdown, SARIF, and exit behavior agree where the format applies; `BLOCK` and `INCOMPLETE` are nonzero unless `--no-fail` is explicit.
- Golden fingerprint vectors lock the exact byte encoding across Unicode and Windows/POSIX path variants.
- Generated `required: false` defaults cannot downgrade command-required checks, while `required: true` elevates an optional check.
- Generated Prettier requirements map to an actual format observation, and unknown required config keys fail incomplete.
- Registry fixtures prove unavailable and partial/capped scans are `INCOMPLETE` when the engine applies, all direct production dependencies are classified without a count cap, npm aliases resolve, and local/private/custom-registry specs become visible exclusions rather than false missing-package findings. Pro fixtures keep package-age and name-confusion signals explicitly heuristic.
- Finding fixtures preserve remediation guidance and structured assurance mappings across report projections and the generated catalog.
- Existing command suites and the full repository quality workflow pass.
- A bounded high-effort adversarial review of this ADR has no unresolved blocking findings before implementation begins.

## Review record

The first high-effort architecture review found four blocking contract gaps: count-unbounded waivers, undefined required-check failures, missing SARIF acceptance, and catalog/CLI severity drift. A follow-up architecture review found no remaining actionable defect before implementation. The post-implementation cross-provider review found that block-style Semgrep language lists were absent from the generated catalog; the parser and regression coverage were corrected before delivery.
