# QA Architect launch readiness and paid-tier tasks

Status: local prelaunch remediation in progress

Delivery claim: local product readiness for a truthful launch-list prelaunch.
This plan does not authorize checkout, deployment, publishing, entitlement
migration, customer notices, or a production payment-provider change.

## Local product delivery

- [x] Replace circular Pro purchase links with a clear launch-list action.
- [x] State that paid checkout is not open.
- [x] Align subscription terms with the Apache-2.0 source license.
- [x] Label fixture-backed purchase coverage as simulated evidence.
- [x] Keep license activation fail-closed for unissued or invalid keys.
- [x] Add tests that reject circular or placeholder Pro calls to action.
- [x] Document the commercial launch boundary and rollback conditions.
- [x] Remove the public audit's false findings on the compliant webhook without
      source suppressions or report filtering.
- [x] Preserve true-positive fixtures and rule-version evidence for the changed
      security matchers.
- [x] Define the evidence inputs for protected exact-head review and delivery.

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
