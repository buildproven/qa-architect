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
- For plain Node suites, generate exact source-to-test mappings when source and
  test base names match. Leave all other source paths unmapped.
- Write `.buildproven/test-impact.json` in the target repository.
- Write `.github/workflows/test-impact.yml` only with an immutable
  `claude-kit` commit supplied by the operator. Pull requests run the affected
  plan. Schedule and manual events run the declared complete commands.
- Load the pull-request controller from the protected base. Check out the exact
  candidate and protected policy into separate directories with read-only
  permissions and no stored credentials. Plan with the protected policy and run
  selected commands in the candidate directory. Do not expose secrets or use
  caches in this job.
- Preserve existing workflows and status contexts. The generated workflow is a
  canary until gate parity and branch-protection migration are complete.
- Print a short result by default. JSON is explicit.

## Acceptance evidence

- JavaScript, Python, mixed, documentation-only, and unknown fixtures.
- The generator rejects mutable runtime references and missing test commands.
- Dry-run changes no file.
- Write mode creates valid policy and workflow files without changing existing
  workflows.
- The workflow uses read-only permissions, exact refs, no stored credentials,
  a protected-base controller, and one stable result job.
- A controlled failing fixture makes the selected command fail, then pass after
  restoration.
