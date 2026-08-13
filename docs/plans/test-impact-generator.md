# Test-impact policy generator

## Requirement

Generate the repository-owned version 1 `claude-kit` test-impact policy. Do not
fork the selector or install CI. Unknown impact must remain visible and run the
declared complete test command as an explicit safe fallback.

## Design

- Detect declared Vitest, Jest, plain Node, and Pytest suites.
- Use immutable package installs only. Stop when an npm project has no lockfile.
- Use dependency-aware selection for Vitest and Jest.
- Show plain Node same-name tests only as suggestions. A file name is not
  dependency evidence.
- Accept reviewed mappings from `--mapping-file <path>` inside the repository.
- Preserve repository mappings during an explicit update.
- Merge an update mapping file with existing reviewed mappings. Reject a
  conflicting definition for the same paths.
- Write only `.buildproven/test-impact.json`.
- Emit the declared complete gate as `fallback`. The shared selector uses it
  only when uncovered paths remain.
- Reject symbolic-link output paths and paths outside the repository.
- Leave CI installation and execution to the shared `claude-setup` adapter and
  the single `claude-kit` selector.
- Keep the generated pre-push hook fast. It does not run the complete suite.
- Print a short result by default. JSON output is explicit.

## Acceptance evidence

- Vitest, plain Node, Pytest, missing-lockfile, and unknown fixtures.
- Dry-run changes no file.
- Plain Node generation stops without reviewed mappings.
- Mapping input and runtime updates preserve repository mappings.
- Write mode creates one policy and does not create or replace a workflow.
- Symbolic-link output paths fail before any external file changes.
