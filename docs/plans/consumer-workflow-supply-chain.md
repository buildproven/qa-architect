# Consumer workflow supply-chain repair

## Requirements

- Generated workflows must use the official Semgrep image at an immutable digest.
- A Semgrep finding must fail the blocking security job.
- Generated workflows must execute an exact QA Architect package version, never `@latest`.
- The generated version must follow `package.json` when a release changes it.
- Consumer integration tests must reject the deprecated action and mutable package execution.
- The change must preserve the existing free and Pro workflow boundaries.

## Rollout

1. Repair the QA Architect template and its contract tests.
2. Validate generated free and Pro workflows.
3. Release QA Architect through trusted publishing.
4. Generate consumer changes from each remote default branch in an isolated
   temporary clone. Never write to a developer checkout or default branch.
5. Limit each rollout PR to `.github/workflows/quality.yml` and
   `.buildproven/test-impact.json`; discard unrelated setup output.
6. Require an explicit generated consumer as the canary. Never change a staged
   rollout into a skip-canary rollout implicitly.
7. Merge the green canary through its normal protection before opening the
   remaining consumer PRs.
