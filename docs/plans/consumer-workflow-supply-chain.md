# Consumer workflow supply-chain repair

## Requirements

- Generated workflows must use the maintained Semgrep CLI with a pinned engine version.
- A Semgrep finding must fail the blocking security job.
- Generated workflows must execute an exact QA Architect package version, never `@latest`.
- The generated version must follow `package.json` when a release changes it.
- Consumer integration tests must reject the deprecated action and mutable package execution.
- The change must preserve the existing free and Pro workflow boundaries.

## Rollout

1. Repair the QA Architect template and its contract tests.
2. Validate generated free and Pro workflows.
3. Release QA Architect through trusted publishing.
4. Resume the affected-test fleet rollout only from the fixed release.
