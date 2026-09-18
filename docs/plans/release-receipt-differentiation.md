# Release Receipt differentiation plan

## Objective

Make QA Architect recognizably different from generic AI-code scanners by
turning its existing revision-bound assurance manifest into a first-class
Release Receipt, with runtime authorization evidence as the flagship SaaS pack
and agency assurance as the initial paid delivery model.

## Acceptance criteria

- [x] `receipt create` delegates to Ship Check without changing its evidence
      contract or legacy command behavior.
- [x] `receipt check-freshness <path>` checks the existing manifest against the
      local checkout and preserves verdict exit codes without requiring or
      refreshing a Pro entitlement.
- [x] Invalid receipt syntax fails with an actionable message and does not fall
      through to setup mode.
- [x] Human and Markdown output use the Release Receipt name while JSON remains
      backward compatible.
- [x] `--artifact-dir` writes `release-receipt.json` and
      `release-receipt.md` from the same result without changing legacy stdout
      or `--out` behavior.
- [x] README and CLI help teach the receipt workflow before the legacy flags.
- [x] The landing-page hero demonstrates an exact-revision receipt rather than
      a generic finding list.
- [x] The free audit remains a clear acquisition path below the receipt-led
      promise.
- [x] The AI SaaS Authorization Pack describes only the existing bounded
      preview and two-user probe behavior.
- [x] The guided offer names small AI-development agencies and product studios
      without claiming validated customers or open checkout.
- [x] Public copy states that freshness checking does not authenticate the
      receipt producer or prove trusted execution.
- [x] Focused behavioral tests, responsive browser checks, and the complete
      prerelease gate pass on the final candidate.

## Non-goals

- A new manifest schema or migration.
- Custom receipt cryptography or hosted attestation infrastructure.
- Independent authenticity claims for self-hashed receipts.
- Opening checkout, issuing a real subscription, or claiming customer demand.
- Adding new scanners, languages, dashboards, or autonomous production probes.
- Removing the legacy `--ship-check` interface.

## Public seam and test oracle

The public seam is the packaged CLI. Expected aliases and errors come from the
accepted ADR, while receipt verdicts and freshness behavior come from the
existing Ship Check schema and test fixtures. Tests must exercise the CLI or the
argument-normalization module; they must not duplicate the Ship Check verdict
implementation.
