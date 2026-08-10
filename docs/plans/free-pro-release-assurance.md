# Free/Pro Release Assurance Plan

> Status: COMPLETE | Owner: BuildProven | Date: 2026-08-10
> Branch: `feature/free-pro-release-assurance`

## Goal

Make QA Architect’s Free/Pro boundary credible around one job: Free finds
dangerous AI-generated code; Pro helps a developer decide whether a change is
safe to merge and ship, and provides an inspectable repair path when it is not.

The repository already contains the revision-bound assurance contract,
package provenance, PR assurance, verified remediation, ship manifests, and
the Web SaaS assurance pack. This slice hardens the remaining trust and
packaging gaps instead of adding another independent feature family.

## Scope

### In scope

1. Make the Free audit scan deterministic by explicitly excluding generated
   and dependency output directories even when Semgrep is run with
   `--no-git-ignore`.
2. Remove duplicate Semgrep observations at the same rule/location while
   preserving distinct sources and ranges.
3. Add regression assertions proving generated output is ignored and duplicate
   observations collapse.
4. Make pricing/help copy distinguish unlimited Free audit acquisition from
   capped Free quality automation, matching the actual usage enforcement seam.
5. Add a short product contract to the README and landing page that positions
   Pro as recurring PR-to-release assurance, not merely a fix prompt.

### Out of scope

- New payment providers, checkout changes, or subscription telemetry.
- New scanners, new language packs, or new assurance schemas.
- Provider execution changes for Codex/Claude remediation.
- Consumer-repository deployment or npm publishing.

## Behavioral contract

- `--audit` scans source files but never reports findings from
  `node_modules`, `coverage`, `dist`, `build`, `.next`, or minified/bundled
  output by default.
- A repeated Semgrep result with the same rule ID, source, file, start line,
  end line, and message is emitted once.
- Free audit remains runnable without a license. Free quality-automation caps
  are described as applying to repository/pre-push/dependency-monitoring
  operations only; the docs must not claim that audit runs are capped unless a
  cap is enforced in the audit command.
- Pro copy describes the observable outcome: revision-bound PR/release
  evidence and verified remediation packets.

## Acceptance criteria

- [x] `node tests/audit.test.js` passes and includes the exclusion/deduplication
      regression cases.
- [x] `node tests/audit-packaging.test.js` passes.
- [x] `node tests/tier-enforcement.test.js` passes after dependencies are
      installed from the lockfile.
- [x] `node tests/ship-check.test.js` passes with required skipped evidence
      producing `INCOMPLETE`.
- [x] `npm run lint` passes with zero errors.
- [x] `npm run format:check` passes.
- [x] README and landing pricing language no longer says that the Free audit
      itself is capped, and both describe Pro as PR-to-release assurance.
- [x] `git diff --check` passes.

## Verification and score gate

The implementation is considered a successful packaging/trust slice only if
the focused tests and lint/format gates pass. At that point the product target
score is: Free wedge 8.5/10, boundary clarity 8.5/10, paid coherence 8.5/10,
trust 8.5/10, and overall packaging 8/10. The recurring $29/month score stays
conditional on buyer validation; code alone cannot prove willingness to pay.
