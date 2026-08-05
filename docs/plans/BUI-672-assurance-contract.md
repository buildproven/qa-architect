# BUI-672: Assurance contract delivery plan

## Goal

Replace command-specific safety claims with one versioned finding, policy, and verdict contract that later BUI-671 work can reuse.

Architecture: [ADR-assurance-contract](../decisions/ADR-assurance-contract.md)

## Public seam and behavioral oracle

- Behavior: users receive stable finding identities and the same `PASS`, `BLOCK`, or `INCOMPLETE` result in every output format.
- Public interface: `--audit`, `--ship-check`, their JSON/Markdown/SARIF outputs where applicable, and checked-in baseline/waiver artifacts.
- Test seam: the existing command modules plus CLI argument parsing; filesystem fixtures exercise policy artifacts without mocks.
- Oracle: the BUI-672 acceptance contract and versioned schemas documented in the ADR, independent of implementation details.

## Delivery slices

1. Add red-capable tests for current false-positive assurance, fingerprint instability, and policy validation.
2. Add the deep assurance module with explicit project-root input, immutable revision identity, supported and command-required check scopes independent of emitted observations, versioned source-specific identity canonicalizers, unique structural continuity, fail-closed ambiguous duplicate suppression, explicit check applicability/requiredness, remediation and assurance-mapping fields, shared severity normalization, and the linked concrete v1 schemas.
3. Normalize audit findings, make SAST a command-scoped required engine, make the applicable Pro registry scan required and fail incomplete on unavailable/partial/capped evidence, add full-fidelity machine-readable assurance audit commands to `lib/project-profile.js` without reusing filtered CI gate commands, preserve execution/parse/registry partial outcomes separately from findings, continue all applicable engines after sibling failure, add the Pro entitlement and checked-in `.qa-architect-assurance.json` namespace for baselines/waivers/policy, and render scoped verdicts consistently for Free and Pro. Audit fixtures must prove a SAST failure does not hide dependency findings, medium-only findings remain advisory, documented findings exit statuses count as completed scans, and incomplete registry evidence cannot yield `PASS`.
4. Split format, lint, secrets, and dependency security engines into explicit observations, map every supported `.qualityrc.json` check key plus generated JavaScript/TypeScript, Python, and Shell execution commands, aggregate mixed-language members fail closed, make required missing/skipped evidence `INCOMPLETE`, and align output/exit behavior. Fixtures must prove generated Prettier and Python requirements execute, both security engines execute when both apply, unknown required keys fail incomplete, and Lighthouse configuration without execution evidence cannot satisfy a required check.
5. Generate a versioned rule catalog through the same normalized rule descriptors used by scanner adapters and document limitations.
6. Add a SARIF projection that distinguishes active, baseline, and waived findings without implementing PR annotations.
7. Update CLI help, README, product claims, and `CHANGELOG.md` release notes for the verdict rename and stricter incomplete behavior.
8. Run focused tests, full test/lint/type/docs gates, protected review, PR, and merge.

## Compatibility constraints

- Preserve the existing `findings` array in JSON while adding the assurance envelope.
- Preserve the existing Ship Check `results` array while adding the assurance envelope.
- Preserve `--no-fail` as an exit-code override only.
- Treat command-required checks as a non-downgradable floor; existing generated `required: false` values cannot weaken them.
- Preserve Free report formats and fingerprinting; require Pro for loading, writing, or applying baseline, waiver, or custom policy artifacts.
- Keep generated `.qualityrc.json` as execution/maturity configuration; it is not an audit suppression artifact and must not trigger a Free entitlement failure.
- Do not implement PR annotations, remediation execution, risk-derived requirements, or preview checks in this ticket. SARIF is a pure report projection only.
- Do not edit consumer workflow templates unless the new contract requires it.

## Architecture classification

ADR required: this changes a public JSON/report contract and creates versioned durable baseline/waiver artifacts.
