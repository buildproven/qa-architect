# ADR: QA Architect commercial launch boundary

**Status:** Accepted

**Date:** 2026-08-26

## Context

QA Architect's packaged CLI and prerelease suite pass locally. The maintained
landing source does not have a working self-serve purchase path: its Pro call to
action links back to the same product page. The default signed registry at
`licenses.buildproven.ai` is healthy but contains no QA Architect licenses,
while the legacy `qa-architect.vercel.app` registry contains older entries.
The repository also describes Polar as the billing authority while the current
shared fulfillment producer uses Stripe.

The repository is distributed under Apache-2.0. That license grants a
perpetual, no-charge right to use and modify the published work. Commercial
terms must not say that Apache-licensed source cannot be run without payment.

## Decision

QA Architect is not ready for a paid launch. It can collect launch interest
until one fulfillment authority is verified end to end.

- The Pro call to action will open a pre-addressed launch-list request to
  `support@buildproven.ai`. It will not offer to take payment or issue a key.
- Customer-facing terms will be payment-provider neutral. They will govern the
  subscription, issued license key, updates, and support, while Apache-2.0 will
  continue to govern the published source code.
- Tests will reject circular or placeholder Pro calls to action.
- Fixture-backed purchase tests will call themselves simulated. They will not
  claim production purchase proof.
- The current shared signed registry will remain the CLI default. The five
  entries in the legacy registry are not proof of five customers because the
  former production test tool inserted synthetic entries. No legacy entry will
  be migrated or treated as an entitlement until billing evidence identifies it.
- Signature verification and the seven-day revalidation rule will not change.

## Alternatives

1. Keep the current self-link until checkout exists. Rejected because it makes
   the paid offer impossible to buy and lets a test certify the broken path.
2. Guess or embed a Stripe or Polar checkout URL. Rejected because no verified
   checkout authority or URL is available in this repository.
3. Offer an assisted purchase by email. Rejected because there is no verified
   payment-to-registry lifecycle that support can execute safely.
4. Change the source license. Rejected for this change because relicensing is a
   separate legal and contributor-provenance decision.

## Invariants

- No repository test can present synthetic fulfillment as a live purchase.
- No paid call to action can link to its own page or imply that payment is open
  before the fulfillment path is verified.
- No documentation can name a payment provider as current production authority
  without verified provider configuration and a successful test purchase.
- Activation stays fail-closed for invalid registry signatures, invalid entry
  signatures, and unissued keys. Periodic revalidation keeps the current
  fail-open offline behavior: an unavailable or unverifiable fresh registry
  cannot revoke a previously activated key.
- Production checkout, deployment, customer notices, registry migration, and
  payment-provider changes require explicit approval.

## Rollback and migration

The launch-list call to action is reversible. Replace it only after both the
exact live checkout URL and live fulfillment configuration have provider
evidence and an approved bounded live transaction proves payment, webhook
delivery, signed registry publication, CLI activation, cancellation, refund,
and revocation. Update the landing contract test in the same change.

Before paid launch, reconcile every legacy QA Architect entry against billing
records. Re-sign and migrate only verified active entitlements; remove synthetic
entries from the legacy service and document and notify each intentional
customer exclusion. The migration must prove that each verified existing key
remains active across a forced revalidation. The shared registry stays
authoritative throughout this work.

## Verification

- `node tests/landing-page.test.js`
- `NODE_ENV=test QAA_DEVELOPER=true node tests/simulated-purchase-flow.test.js`
- `npm run prerelease`
- Read-only production checks: temporary-authority registry signature and
  license count.
- After an approved deployment, verify that the canonical hosted page exposes
  the exact reviewed call to action.
- Before paid launch, verify the exact live checkout and fulfillment evidence
  listed in the rollback and migration section.

## Adversarial review

A high-reasoning independent review challenged the legacy entitlement
assumption, revalidation wording, lifecycle gate, and simulated-test name. The
decision now keeps the shared registry authoritative, requires billing evidence
before migration, documents fail-open periodic revalidation, requires both
provider proof and a bounded live lifecycle test, and names fixture evidence as
simulated. A final review reported no findings.
