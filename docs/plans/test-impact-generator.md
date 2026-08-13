# Test-impact generator

## Requirement

Generate a repository-owned affected-test policy and a small GitHub Actions
adapter. Ordinary pull requests must run only tests with proven impact. Unknown
impact must stop with the exact unmapped paths. A complete suite must run only
for an explicit audit reason.

## Design

- Reuse the version 1 `claude-kit` test-impact policy. Do not fork its planner.
- Detect only commands declared by the target repository. Do not invent a test
  runner or use a shell fallback chain.
- Select Vitest or Jest related-test mode only when the dependency is declared.
  Select plain Node mode when the declared test script invokes Node and does
  not invoke one of those dependency-aware runners.
- Treat Python source, shell, workflow, configuration, and an unsupported
  JavaScript source or unsupported runner as unmapped until the repository
  supplies a mapping. Plain Node mode can run changed JavaScript test files.
- For plain Node suites, show same-name tests only as review suggestions. A file
  name is not dependency evidence. Keep source paths unmapped until the
  repository supplies mappings supported by imports, coverage, or architecture.
- Write `.buildproven/test-impact.json` in the target repository.
- Write `.github/workflows/test-impact.yml` only with an immutable
  `claude-kit` commit supplied by the operator. Pull requests run the affected
  plan. Schedule and manual events run the declared complete commands.
- Create the plan in a trusted job that does not install or run candidate code.
  Run candidate installation and tests in a separate read-only job. Install
  packages without lifecycle scripts. Pass the immutable plan through a job
  output. Do not place the protected policy or planner in the candidate job.
- Reject candidate package-script changes and runner-control changes until a
  reviewed protected policy update has merged. The protected control set
  includes local files imported by Jest or Vitest configuration. This prevents
  a script or runner configuration from turning an audit into a no-op.
- Permit an explicit update operation only when both existing targets have the
  QA Architect ownership marker and policy schema. Stage and back up both files.
  Restore the original pair if replacement fails. Bind the workflow to the
  exact policy digest so an interrupted update fails closed.
- Preserve existing workflows and status contexts. The generated workflow is a
  canary until gate parity and branch-protection migration are complete.
- Print a short result by default. JSON is explicit.

## Acceptance evidence

- JavaScript, Python, mixed, documentation-only, and unknown fixtures.
- The generator rejects mutable runtime references and missing test commands.
- Plain Node basename matches remain suggestions, not trusted mappings.
- Dry-run changes no file.
- Write mode creates valid policy and workflow files without changing existing
  workflows.
- The workflow uses read-only permissions, exact refs, no stored credentials,
  isolated trusted planning, lifecycle-free installation, and one stable result
  job.
- A controlled failing fixture makes the selected command fail, then pass after
  restoration.
