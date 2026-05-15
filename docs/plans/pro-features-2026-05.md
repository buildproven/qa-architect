# Pro Feature Expansion — May 2026

Spec for 4 new Pro-tier commands. Positioning: "quality gate for AI-assisted small teams."

## 1. `--ship-check` (unified release readiness)

**CLI**: `npx create-qa-architect --ship-check [--json] [--out <path>]`

**Module**: `lib/commands/ship-check.js`

**Gating**: requires Pro tier (proxy: `hasFeature('coverageThresholds')`).

**Behavior**: orchestrates existing Pro checks, never re-implements them. For each check:

- run the existing command/validator in a child process or via direct import
- capture pass/fail + summary
- never fail-fast; collect all results

Checks (in order):

1. Lint (`npm run lint` if script exists)
2. Tests (`npm test` if script exists — short timeout, allow opt-out via `--skip-tests`)
3. Security scan (gitleaks current-files, plus `npm audit --omit=dev` if package.json)
4. Coverage thresholds (read `coverage/coverage-summary.json` if present, compare to `.qualityrc.json` thresholds)
5. Bundle size (run `size-limit` if configured)
6. Lighthouse thresholds (skip if not configured — info only)
7. Env validation (check `.env.example` vs documented env vars)
8. CI cost summary (call existing `analyze-ci` module functions in `--summary` mode)
9. Docs validation (existing docs validator)

**Output**:

- Default: human-readable terminal report with section headers + final verdict.
- `--json`: machine-readable JSON (for CI consumption).
- `--out report.md`: write markdown suitable for PR comments.

**Verdict logic**:

- `SHIP`: zero failures, zero critical warnings.
- `REVIEW`: warnings but no failures.
- `BLOCK`: any failure.

**Exit code**: 0 on SHIP/REVIEW, 1 on BLOCK.

---

## 2. `--pr-check` (diff-aware risk classifier)

**CLI**: `npx create-qa-architect --pr-check [--base <branch>] [--json] [--out <path>]`

**Module**: `lib/commands/pr-check.js`

**Gating**: requires Pro tier.

**Behavior**:

1. Determine base branch (default: `main`, fallback `master`).
2. Get diff: `git diff --name-status <base>...HEAD`.
3. Classify each changed file by path patterns + content sniff:
   - **HIGH risk**: auth, crypto, payments, env files, db migrations, GitHub workflows, security headers, license logic, anything matching `/auth|crypto|payment|stripe|webhook|migration|secret|token|key/i`.
   - **MEDIUM risk**: config (package.json, tsconfig, eslint), public API surface (`index.ts`, `lib/**` exports), dependency changes (`package*.json`, `requirements.txt`).
   - **LOW risk**: docs (`*.md`), tests (`*.test.*`, `tests/**`), comments-only.
4. For each non-test source file changed, check if a matching test file changed too. Flag missing tests.
5. For HIGH-risk files: check if covered by CODEOWNERS (if file exists).
6. Emit risk summary + per-file table.

**Output**: markdown report (PR-comment-ready) with:

- Risk summary (counts per tier)
- Missing tests warning
- High-risk file list with reasons
- Verdict: SHIP / REVIEW / BLOCK (BLOCK only if HIGH + no tests + no codeowner)

**Exit code**: 0 on SHIP/REVIEW, 1 on BLOCK (configurable via `--no-fail`).

---

## 3. CI Doctor (expand `--analyze-ci`)

**CLI**: existing `--analyze-ci` adds new `--doctor` flag for the extra checks. Default still shows cost analysis.

**Module**: extend `lib/commands/analyze-ci.js` — add a `runDoctor(workflows)` function.

**New findings** (each with concrete fix suggestion):

1. **Duplicated jobs**: detect jobs with identical `runs-on` + steps signature → suggest reusable workflow.
2. **Missing path filters**: workflows triggered on every push without `paths:` or `paths-ignore:` → suggest path filters for monorepos / docs-only changes.
3. **Expensive matrix**: matrix with >10 combinations → suggest pruning or `include`/`exclude`.
4. **Cache mistakes**: `actions/setup-node` without `cache:` parameter → suggest enabling.
5. **Unnecessary scheduled runs**: cron more frequent than weekly with no obvious need → suggest reducing.
6. **Flaky test detection**: parse `gh run list --json` if `gh` CLI available, look for jobs with success rate <90% over last 30 runs. Skip gracefully if `gh` not authenticated.

**Output**: appended section to existing report. Each finding shows: title, affected workflow/job, fix suggestion (1-2 lines), estimated savings if applicable.

---

## 4. `--history-scan` (historical secrets)

**CLI**: `npx create-qa-architect --history-scan [--depth <N>] [--json]`

**Module**: `lib/commands/history-scan.js`

**Gating**: requires `hasFeature('securityScanning')`.

**Behavior**:

1. Reuse `resolveGitleaksBinary()` from `lib/validation/config-security.js`.
2. Run: `<gitleaks> detect --no-banner --redact --report-format=json --report-path=<tmp> --log-opts="--all"` (or `HEAD~<depth>` if `--depth` given).
3. Parse JSON output, deduplicate by `{secret, file, commit}`.
4. Group findings by commit SHA, list files, secret types.
5. Report counts per secret type + top 10 oldest exposures.

**Output**: terminal report + optional JSON. Markdown export for PR.

**Exit code**: 0 if zero findings, 1 if any.

**Safety**: pass `--all` only when explicitly requested; default `HEAD~1000` to bound cost on huge repos.

---

## Licensing changes

Add flags to `lib/licensing.js` FEATURES map:

- `shipCheck`: PRO only
- `prCheck`: PRO only
- `ciDoctor`: PRO only (expansion of existing `ciCostAnalysis`)
- `historicalSecretsScan`: PRO only (under existing `securityScanning` umbrella)

Update PRO roadmap array. Add FREE roadmap line: "❌ No release readiness gate (--ship-check), risk-aware PR review, CI doctor, or historical secrets scan".

---

## Testing

One test file per command:

- `tests/ship-check.test.js`
- `tests/pr-check.test.js`
- `tests/ci-doctor.test.js`
- `tests/history-scan.test.js`

Each covers:

- Free tier blocked (proper upgrade message)
- Pro tier runs (via `QAA_DEVELOPER=true` or stub license)
- Output format validates (markdown structure / JSON shape)
- Edge cases: empty diff (pr-check), no workflows (ci-doctor), no .git history (history-scan), no coverage report (ship-check)

Goal: keep coverage ≥75% lines / 70% functions per project standard.

---

## Out of scope (deferred)

- LLM-powered fix suggestions (depends on API key, adds cost dimension)
- Monorepo selective CI (deeper architecture change)
- Team dashboard (needs hosted component)
- PR inline annotations via Checks API (depends on GH App / token model; document for v6)
