# QA Architect launch readiness and paid-tier tasks

Status: local prelaunch remediation in progress

Delivery claim: local product readiness for a truthful launch-list prelaunch.
This plan does not authorize checkout, deployment, publishing, entitlement
migration, customer notices, or a production payment-provider change.

## Delivery tasks

- [x] 1.0 Define the truthful commercial boundary
  - Phase: contract
  - Delivers: Accepted launch-boundary and matcher-precision decisions.
  - Evidence: `docs/decisions/ADR-launch-commercial-boundary.md` and `docs/decisions/ADR-security-rule-precision.md`.
- [x] 2.0 Deliver the launch-list prelaunch product
  - Phase: implementation
  - Delivers: Clear launch-list actions, compatible commercial terms, simulated purchase labels, fail-closed activation, and landing contract tests.
  - Verification: `npm run prerelease` and `node tests/landing-page.test.js`.
- [x] 3.0 Restore trustworthy public audit results
  - Phase: implementation
  - Delivers: Precise missing-Helmet and verbose-error matchers, visible scanner failures, semantic rule versions, and exact-range regression tests.
  - Verification: `node tests/semgrep-rule-precision.test.js` and `node setup.js --audit --json --out <temporary-file> --no-fail`.
- [ ] 4.0 Verify the canonical hosted prelaunch page
  - Phase: hosted
  - Delivers: The reviewed launch-list action on the canonical hosted page after an approved deployment.
  - Evidence: Deployment receipt and hosted browser journey bound to the deployed revision.
- [ ] 5.0 Validate paid-tier demand and lifecycle
  - Phase: validation
  - Delivers: Real design-partner use, paid or declined decisions, and an approved complete billing and entitlement lifecycle transaction.
  - Evidence: Design-partner records plus payment, webhook, entitlement, activation, cancellation, refund, and revocation receipts.

## Paid-tier value assessment

Free is the acquisition and diagnosis layer: it finds supported current-tree
security and dependency risks. Pro is the recurring decision layer: it binds
checks and findings to a revision, selects affected tests from evidence, scans
full history, produces verified remediation artifacts, and carries assurance
from PR to release. That is a coherent paid boundary because the recurring
workflow reduces release decision risk instead of charging for the initial
problem report.

The repository proves feature existence and local behavior. It does not prove
willingness to pay, retention, or the proposed price. Paid-tier value therefore
remains commercially unverified until design partners use the complete workflow
on real changes and make a purchase decision.

## External paid-launch gates

These gates require provider evidence, real users, approval, or production
authority and are outside the local delivery claim:

- Select and verify one billing and fulfillment authority.
- Verify the hosted checkout URL and production webhook configuration.
- Reconcile legacy registry entries against billing evidence.
- Run one approved bounded lifecycle transaction: payment, webhook, signed
  entitlement, CLI activation, cancellation, refund, and revocation.
- Verify the reviewed call to action on the canonical hosted page after an
  approved deployment.
- Complete at least five design-partner conversations, observe use on real PRs,
  and record paid or declined decisions against the proposed price.
- Verify protected exact-head CI and release controls before publishing.

Until these gates pass, the correct commercial state is launch-list prelaunch,
not paid launch.
