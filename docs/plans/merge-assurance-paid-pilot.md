# BuildProven Merge Assurance paid pilot

## Outcome

Prove that agent-written code is ready to merge at an exact revision, with less
CI and review waste. `claude-kit` remains the free public runtime. Customers pay
for QA Architect generation, policy updates, fleet reporting, onboarding, and
support—not for a closed copy of the open-source skills.

## Ideal customer

A 5–50 person software team shipping AI-generated changes through GitHub, using
Claude Code, Codex, or both, with rising CI spend or unreliable review loops and
an owner accountable for engineering quality.

## Four-week pilot

- Baseline CI minutes, candidate lead time, duplicate full-suite count, review
  convergence, fallback rate, and escaped defects for up to five repositories.
- Install a provider-neutral exact-revision assurance policy in a canary repo.
- Expand only after the canary proves no lost required check or test coverage.
- Weekly evidence report and one operator session.
- Excludes production deployment, security certification, and a guarantee that
  AI review finds every defect.

Success means at least 30% fewer duplicate full-suite executions, no weakened
required gate, p95 assurance latency no worse than baseline, bounded review
termination on every campaign, and an evidence envelope for every candidate.

## Pricing hypothesis

Charge $2,500 for the four-week pilot for up to five repositories. Credit the
pilot fee against an annual fleet subscription if converted. This is a testable
hypothesis, not validated demand.

## Discovery questions

1. How many agent-authored PRs and GitHub Actions minutes do you run monthly?
2. Where does a change most often wait: tests, review, rebases, or approval?
3. How often do local and remote pipelines rerun the same complete suite?
4. What evidence does an engineering owner need before accepting agent code?
5. What would make a four-week canary unsafe or not worth paying for?

## Evidence and conversion

Record each conversation and pilot in the private ledger validated by
`scripts/validate-pilot-ledger.js`. Five distinct prospects with completed discovery conversations plus a
paid or declined pilot set `offerTested`; only five conversations plus a paid
pilot set `marketValidated`. A decline must never be presented as validated
demand. At pilot close, offer annual fleet management only if the measured
outcome clears the success thresholds.
