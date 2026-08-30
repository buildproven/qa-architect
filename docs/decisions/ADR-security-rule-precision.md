# ADR: Preserve true positives while removing audit self-findings

- Status: Accepted
- Date: 2026-08-29
- Parent contract: [Versioned assurance contract](ADR-assurance-contract.md)
- Delivery: [QA Architect PR #260](https://github.com/buildproven/qa-architect/pull/260)

## Context

QA Architect's public `--audit` command reports five medium findings against its
own webhook handler. The handler already applies Helmet globally and returns
fixed generic text from both reported HTTP 500 paths. The findings therefore
measure two rule-precision defects rather than application vulnerabilities:

- `express-no-helmet` matches every `app.use(...)` after `express()` and does
  not test whether `app.use(helmet(...))` exists. One compliant application is
  reported three times.
- `verbose-error-to-client` binds its `$ERR` metavariable to string literals,
  so a fixed generic error message is classified as an error object.

These rules are packaged product behavior. A broad suppression would make the
report quieter but could hide the vulnerabilities that the rules promise to
detect.

## Decision

Keep both rule IDs, severities, messages, and remediation guidance stable. Make
only their match contracts more precise:

1. `express-no-helmet` will report each middleware or route registration when
   an Express application has no visible app-wide `app.use(helmet(...))` call.
   Each result is located on its unsafe registration, so changed-line PR
   Assurance retains a newly added exposed path when Helmet is absent. A
   path-scoped Helmet call does not satisfy the app-wide contract. Semgrep
   Community Edition can bind a late-Helmet finding to the first argument of
   each earlier registration, which keeps its changed-line range. It cannot
   reliably prove control-flow dominance, so conditional Helmet registration
   remains a documented static-analysis limitation.
2. `verbose-error-to-client` will retain direct syntactic detection for
   `.message` and `.stack` response sinks, including sinks inside helpers. Only
   the broad raw `{ error: $VALUE }` shape will use Semgrep data-flow tracking
   from explicit error sources. Sources include a `catch` binding,
   the error parameter of Express error middleware, a rejected-promise callback
   parameter, a callback parameter from an allowlisted Node core error-first
   API, and an `error` event-handler parameter. The error-first allowlist is
   explicit and versioned with the rule. Node `fs` sources must be bound to an
   `fs` or `node:fs` namespace, named import, or destructured require; receiver
   names alone are not trusted. Callback position alone is not proof that a
   value is an error. Event sources are constrained to callbacks
   registered for the literal `error` event. Semgrep's local propagation keeps
   direct aliases of raw error values tainted. Fixed string literals, generic
   message variables, ordinary first callback values, and generic message
   helper calls are not raw error sources and will not match that broad sink.
   Unknown userland error-first APIs are a documented raw-value limitation; a
   `.message` or `.stack` response remains detectable across helper boundaries.
3. Precision tests will exercise the rule pack through Semgrep and retain its
   raw result records. A vulnerable Express application must produce exactly
   one result per unsafe registration at that registration's range. Helmet
   before a registration makes that registration silent, while late Helmet
   retains earlier registrations. Changed-line regressions will prove that PR
   Assurance retains a newly inserted unsafe route when older unsafe routes
   exist. Path-scoped Helmet fixtures remain findings. Error
   tests cover catch bindings, Express
   error middleware, rejected-promise callbacks, allowlisted Node core
   error-first callbacks, `error` event handlers, and direct aliases. A
   non-error first callback value is a required false-positive fixture. Fixed
   literals, generic variables, and helper calls stay silent. Set-based rule-ID
   checks remain only as a convenience for older fixtures; they are not enough
   for these regression tests. Scanner absence is a test failure, not a skip,
   because this suite is the focused test-impact gate for matcher changes.
4. Change each rule's semantic version from `1.0.0` to `1.1.0` and the shipped
   rule-pack version from `2.0.0` to `2.1.0`. The catalog and both Audit and PR
   Assurance adapters will preserve the declared per-rule version. Existing
   baselines and waivers for these rules must be refreshed explicitly; they do
   not carry across the matcher change.
5. The public `node setup.js --audit --json --no-fail` command on this
   repository is the acceptance seam. Acceptance requires a successful Semgrep
   process with no scanner errors and zero raw results for these two rule IDs.
   It rejects report-layer filtering or an inline suppression in
   `webhook-handler.js` as proof of a matcher fix. Audit assurance-contract
   migration is separate work and is not required to correct these matchers.

## Alternatives

- Add `nosemgrep` comments to the webhook handler. Rejected because the
  application is compliant and the false-positive rule would remain broken for
  customers.
- Filter these file and line combinations in the audit adapter. Rejected
  because it couples product policy to one repository and hides rule defects.
- Remove the two rules. Rejected because missing security headers and verbose
  server errors remain useful audit signals.
- Apply identifier-name filters to the raw error alternative. Rejected because
  names do not prove that a value is an error and would miss common aliases.
- Treat every first callback parameter as an error. Rejected because callback
  position alone does not establish an error-first API contract.

## Invariants

- A real Express application without Helmet still produces
  `express-no-helmet` at every unsafe registration.
- A newly added route in an application with no Helmet still produces
  `express-no-helmet` at the route range in changed-line PR Assurance.
- A route registered before Helmet produces `express-no-helmet` at that route's
  line, while a later route is silent.
- A real raw error value, error message, or stack from a catch binding, Express
  error middleware, rejected promise, allowlisted Node core error-first
  callback, `error` event handler, or direct alias and returned with HTTP 500
  still produces `verbose-error-to-client`.
- A `.message` or `.stack` response inside a helper remains detectable even
  when Semgrep Community Edition cannot propagate taint across the call.
- A fixed generic message stored in a variable or returned by a helper does not
  produce `verbose-error-to-client` solely because it is an identifier or call.
- A Node `fs` namespace alias or named import remains an error source, while an
  unrelated object named `fs` does not become one.
- A compliant application produces no finding for these rules and needs no
  source suppression.
- One unsafe registration or error response produces one observation per rule
  and range. Report-layer deduplication does not compensate for a broad rule.
- Rule IDs and normalized severity do not change. Rule and pack semantic
  versions do change, so baseline and waiver consumers must refresh affected
  entries instead of silently applying old approvals to new matcher semantics.

## Rollback

Revert the two rule expressions, their semantic versions, the pack version, and
their precision fixtures together. A consumer that deliberately refreshed a
baseline or waiver for `1.1.0` must not apply it to the rolled-back `1.0.0`
matcher. No runtime deployment or durable-data migration is required. A
rollback will restore the known false positives and must not be described as a
security improvement.

## Verification

- `node tests/semgrep-rule-precision.test.js`
- `node setup.js --audit --json --out <temporary-file> --no-fail`, followed by
  assertions that Semgrep completed and the findings contain zero results for
  `express-no-helmet` and `verbose-error-to-client`
- `node tests/audit.test.js`
- `npm run check:assurance-catalog`
- `npm run prerelease`
- Protected exact-head review and CI through the quality campaign.

## Adversarial review

Seven bounded reviews challenged matcher versioning, late-Helmet ordering,
changed-line ranges, error-source precision, helper-boundary detection, and raw
acceptance evidence. Implementation tests then showed that Semgrep Community
Edition cannot reliably distinguish a top-level Helmet call from the same call
inside a conditional. The accepted design records that limitation instead of
claiming unsupported control-flow proof. Independent implementation review then
found that late Helmet and function-style callbacks needed explicit executable
coverage. The next review found that a literal `fs` receiver both lost import
aliases and trusted unrelated objects, and that focused matcher tests could
silently skip without Semgrep. Import-bound sources, alias fixtures, a false
source fixture, and fail-closed scanner preflight were added before delivery.
