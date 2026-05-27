# Plan: Vibe-Code Auditor

**Created:** 2026-05-27
**Status:** Active
**Branch:** feat/vibe-code-auditor (new from feat/polar-migration)

---

## Problem

QA Architect currently covers 2/7 security audit categories (secrets via Gitleaks Pro, and CVEs via npm audit free). The product is positioned as a quality bootstrap tool, but the 2026 market opportunity is "vibe-code security auditor" — a self-serve CLI that catches OWASP Top-10 patterns, injection vectors, auth gaps, production misconfigs, and hallucinated packages in AI-generated code. No CLI tool in the market does this for solo/indie developers. New web-based competitors (VibeDoctor, Vibe App Scanner) are filling the web-SaaS gap but not the CLI gap. The current product needs a new `audit` subcommand powered by semgrep, covering 5/7 categories in free tier, repositioned to match the buyer persona: "worried vibe coder about to ship."

Additionally the pricing needs a drop from $49/mo to $29/mo to match market expectations, and the README/help text needs a full repositioning.

---

## Options Considered

### Option A: Add `audit` subcommand via semgrep (chosen)

Add `lib/commands/audit.js` that runs semgrep with an extended security ruleset covering SQL injection, XSS, command injection, auth bypass, production misconfigs, hardcoded secrets, and hallucinated package checks. Integrate as free-tier feature (basic 5 categories) with Pro extension (hallucination check + full OWASP pack + `--fix` prompt generation).

**Pros:**

- Semgrep rules already exist in `.semgrep/defensive-patterns.yaml` — extend rather than build from scratch
- Consistent with existing spawnSync/arg-array security pattern
- CLI-native = key differentiator vs web-based competitors
- Adds credible "auditor" positioning without changing existing ship-check/pr-check Pro features

**Cons:**

- Semgrep must be installed on user machine (document in README, add detection+guidance)
- Semgrep rules won't catch everything — must be honest about coverage

### Option B: Use eslint-plugin-security only

Run eslint with security plugin, no new dependency.

**Pros:** No semgrep required

**Cons:** Much weaker coverage — misses SQL injection, auth bypass, command injection patterns. eslint-plugin-security already part of existing setup flow so no net new value for "audit" use case.

### Option C: Bundle semgrep binary (like gitleaks)

Pin and cache semgrep binary like gitleaks v8.28.0.

**Cons:** Semgrep binary is 50-100MB — not viable for npm package. Document as prerequisite instead.

---

## Decision

**Approach:** Option A — semgrep-powered `audit` subcommand + pricing update + README repositioning

**Rationale:** Semgrep is the de-facto OSS SAST engine with a large rule library and a simple CLI. The existing `.semgrep/defensive-patterns.yaml` gives a head start. The CLI gap in the market is real — web SaaS competitors all require uploading code to their service; this runs entirely locally, which is a trust advantage for security-conscious builders. Pricing drop from $49 to $29 reduces conversion friction without undermining value.

---

## Implementation Plan

### New Files to Create

- `lib/commands/audit.js` — main audit command handler
- `.semgrep/vibe-audit-rules.yaml` — extended security ruleset (SQL, XSS, command injection, auth, CORS, debug mode, hardcoded secrets, missing validation, hallucinated packages)
- `tests/audit.test.js` — unit tests for audit command

### Files to Modify

- `setup.js` — add `--audit` flag parsing + routing to `handleAudit()`, add to help text
- `lib/licensing.js` — add `auditBasic` (free) and `auditPro` (Pro) feature flags; update pricing from $49→$29
- `README.md` — full repositioning: vibe-code security auditor, lead with `audit` command, update pricing table
- `package.json` — update description, add `audit` to scripts if helpful

### Execution Order

1. **Create branch** `feat/vibe-code-auditor` from `feat/polar-migration`
2. **Create `.semgrep/vibe-audit-rules.yaml`** — the audit categories (SQL/XSS/cmd injection, auth bypass, CORS/debug misconfigs, hardcoded creds, missing rate limits). Build on existing defensive-patterns.yaml, add new categories.
3. **Create `lib/commands/audit.js`** — the audit command:
   - Detect if semgrep is installed, provide install guidance if not
   - Run semgrep with both defensive-patterns.yaml and vibe-audit-rules.yaml
   - Run npm audit (CVEs, free)
   - Check for hallucinated packages (Pro: verify package names against npm registry)
   - Produce structured output: Critical/High/Medium/Low findings with file:line, what's wrong, why it matters, suggested fix
   - Pro: `--fix` flag generates Claude Code prompts for each finding
   - Support `--json` output flag
   - Support `--out <path>` to write markdown report to file
4. **Update `setup.js`** — add `--audit` and `--audit-fix` flags, routing, and help text
5. **Update `lib/licensing.js`** — add feature flags, change Pro price from 4900 to 2900 (cents)
6. **Create `tests/audit.test.js`** — tests for: semgrep not installed handling, result parsing, severity mapping, json output, markdown output
7. **Update `README.md`** — full rewrite of positioning sections: new tagline, lead with `audit`, update pricing table ($29/mo), update command reference
8. **Run full test suite** — `npm test`, `npm run lint`
9. **Version bump** to 5.14.0 (new feature, not patch)
10. **Commit + PR** with `/bs:quality --merge`

### Out of Scope

- Supabase RLS gap detection (requires DB schema access — defer to v2)
- GDPR/soft-delete/audit-log checks (high false-positive risk — defer)
- Python audit rules (defer — focus on JS/TS/Next.js stack for v1)
- IDE plugin (CLI only)
- Web dashboard
- Auto-fix (only generates Claude Code prompts, doesn't apply them)
- Agentic workflow scanning (LangGraph/CrewAI — different product)
- Renaming the product (not worth it at this stage)

---

## Verification Steps

1. `node setup.js --audit` on this repo — should detect 0 critical findings (or real ones in test fixtures)
2. `node setup.js --audit --json` — valid JSON output
3. `node setup.js --audit --out /tmp/report.md` — file written
4. Test with semgrep not installed — should show clear install guidance, not crash
5. `node tests/audit.test.js` — all pass
6. `npm test` — all 50+ tests still pass
7. `npm run lint` — clean
8. `node setup.js --license-status` — confirms Pro price shows $29/mo

---

## Notes / Gotchas

- Semgrep detection: use `which semgrep` or `semgrep --version` via spawnSync, handle ENOENT gracefully
- Semgrep output is JSON (`semgrep --json`), parse `results[].path`, `.start.line`, `.check_id`, `.message`, `.severity`, `.extra.message`
- Semgrep severity levels: `ERROR` → Critical, `WARNING` → High/Medium depending on rule metadata
- The existing `.semgrep/defensive-patterns.yaml` rules are already good for SQL injection, command injection, auth bypass, CORS, hardcoded secrets — extend rather than duplicate
- Hallucinated package check (Pro): hit `https://registry.npmjs.org/<package>` for each dep in package.json, flag 404s. Cache results to avoid rate limits.
- Pricing: `lib/licensing.js` stores price in cents. Change from `4900` to `2900`. Also update any string references to "$49" → "$29".
- The `quality.yml` template-as-product invariant: if audit is added to the project's own CI, ensure it uses `npx @latest` pattern and not `node_modules/` references.
- `--fix` flag for Pro: format as "Copy this prompt into Claude Code:" followed by a structured prompt that includes the file path, line number, issue, and the recommended fix pattern.
