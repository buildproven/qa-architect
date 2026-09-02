# ADR: Make the Release Receipt the public assurance interface

**Status:** Accepted for implementation
**Date:** 2026-09-01
**Owner:** BuildProven

## Context

QA Architect already produces a revision-bound Ship Check manifest with a
`PASS`, `BLOCK`, or `INCOMPLETE` verdict, local freshness checking, required
check scope, finding identity, and optional deployed-preview evidence. The
current CLI and landing page lead with scanning and expose that artifact as a
secondary `--ship-check` feature. This makes the product appear to compete on
generic SAST, dependency scanning, and AI remediation, where established
platforms already have broader distribution and larger rule inventories.

The recurring customer decision is narrower: whether the evidence required for
one exact candidate revision is complete enough to support a release review.
The public interface needs a memorable artifact name without creating a second
assurance engine or weakening the existing evidence contract.

## Decision

QA Architect will name the existing Ship Check manifest a **Release Receipt**
at the public CLI and marketing boundaries.

The CLI will add these backward-compatible positional aliases:

```text
npx create-qa-architect@latest receipt create [ship-check options]
npx create-qa-architect@latest receipt check-freshness <manifest-path> [verification options]
```

A small argument-normalization module will translate the aliases to the
existing `--ship-check` and `--verify-ship-manifest` interface before command
detection. The Ship Check implementation, schema, verdict calculation, exit
codes, license gate, and verification algorithm remain the single source of
truth. Existing flags remain supported.

Receipt creation remains Pro. Local freshness checking will be available
without a Pro license and will not refresh entitlement before it reads the
artifact. It checks the artifact against the current local checkout and
configuration using the existing evidence-identity, revision, policy,
rule-pack, input, reference, and preview-configuration bindings. It does not
establish who created the receipt, whether its producer was trusted, whether
the reported checks ran in trusted infrastructure, or whether its contents
were changed and re-hashed by an untrusted producer.

An agency can share a receipt as a disclosure of what it says ran for an exact
candidate. A client that needs independent assurance must run the command in a
trusted checkout or require a future signed or CI-attested receipt. The product
and documentation will call the free operation a **freshness check**, never an
authenticity, signature, attestation, or independent-verification step.

Human and Markdown projections will use the Release Receipt name. The JSON
schema and stored fields will not be renamed in this change, so existing
automation remains compatible. When `--artifact-dir <path>` is supplied,
creation will write `release-receipt.json` and `release-receipt.md` from the
same in-memory result. Without it, existing stdout and `--out` behavior remains
unchanged. The landing page and README will lead with the receipt, present the
free audit as acquisition, and describe the existing two-user preview probe as
the **AI SaaS Authorization Pack** inside the receipt rather than as a separate
product.

The first buyer remains a small AI-development agency or product studio that
needs repeatable client-release evidence across several SaaS repositories. The
guided pilot is packaging for that buyer; it is not evidence of a validated
subscription.

## Invariants

- A Release Receipt is an assurance artifact, not a security certification or
  a promise that an application has no vulnerabilities.
- Missing, skipped, stale, partial, or unavailable required evidence cannot
  become `PASS`.
- Receipt creation uses the existing Ship Check Pro license. Local receipt
  freshness checking is free and must not refresh or require an entitlement.
- Creation and freshness checking use the existing Ship Check revision, policy,
  evidence-identity, and exit-code rules.
- `--artifact-dir` writes one JSON and one Markdown projection of the same
  result using fixed filenames; it must not overwrite unrelated files.
- The positional aliases must not change the behavior of unrelated setup,
  audit, PR Check, or history-scan commands.
- `receipt check-freshness` requires exactly one manifest path before optional flags and
  rejects missing or unsupported subcommands with an actionable error.
- Legacy `--ship-check` and `--verify-ship-manifest` callers remain supported.
- Runtime authorization probes remain explicit opt-in operations with the
  existing configuration consent, CLI consent, production-host refusal, and
  cleanup rules.
- Public copy must not describe the receipt as signed, attested, independently
  verified, tamper-proof, or proof of a trusted execution environment.
- Paid checkout remains closed until the existing commercial lifecycle gates
  are proven.

## Alternatives considered

### Rename Ship Check and its JSON schema

Rejected for this change. It would force a schema migration and needlessly
break automation when an additive public facade can establish the new product
language.

### Add a separate receipt generator

Rejected. A second generator would duplicate verdict and evidence policy,
allowing the marketing artifact to drift from the enforceable assurance
result.

### Promise independently verifiable receipts without a trust anchor

Rejected. The existing evidence identity is an unkeyed consistency hash. An
untrusted producer can change fields and recompute it. Authenticated receipts
need a separate signature or CI-attestation design with explicit signer and
key-lifecycle semantics.

### Add a new `qaa` npm package or replace the package name

Deferred. A short binary may improve installed use later, but package naming is
not required to validate the receipt workflow and would expand release and
consumer compatibility risk.

### Lead with runtime authorization testing

Rejected as the primary category. It is a strong evidence pack, but it requires
a configured deployed preview and explicit mutation consent. The Release
Receipt provides the broader recurring decision and can contain authorization
evidence when applicable.

## Rollout and rollback

The rollout is additive. Existing commands continue to work while the README,
help output, landing page, and launch-list copy introduce the new interface.
No durable data or hosted migration is required.

Rollback removes the argument normalizer and customer-facing aliases. Existing
Ship Check manifests and legacy commands remain readable because their schema
does not change.

## Verification

- Unit tests cover alias normalization, invalid syntax, and pass-through of
  unrelated arguments.
- CLI tests execute `receipt create` and `receipt check-freshness` through
  `setup.js` against a real temporary Git repository, including license-free
  local freshness checking.
- Artifact tests prove that `--artifact-dir` writes schema-valid JSON and
  matching Markdown without changing stdout or legacy `--out` behavior.
- Existing Ship Check tests prove unchanged verdict, identity, and stale-input
  behavior.
- Landing-page contract tests require receipt-led positioning, the
  authorization pack, the agency buyer, and the commercial prelaunch boundary.
- Browser captures at 320, 768, 1024, and 1440 pixels verify responsive
  hierarchy and working navigation.
- The complete prerelease suite and revision-bound quality campaign verify the
  exact candidate before delivery.

## Adversarial review

An independent pre-implementation review found that the original
`receipt verify` proposal overstated the existing unkeyed evidence identity. It
could detect local staleness but could not authenticate an untrusted producer.
The decision now names the operation `check-freshness`, limits it to the local
checkout and configuration, adds explicit non-claims, and defers signed or
CI-attested receipts to a separate design.
