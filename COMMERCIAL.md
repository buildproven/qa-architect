# Commercial Terms — QA Architect Pro

**Effective:** 2026-05-17
**Applies to:** Use of features gated by a paid license key in `create-qa-architect`.

The source code in this repository is licensed under **Apache-2.0** (see `LICENSE`). The terms below apply _in addition_ to Apache-2.0 when you use the **Pro tier features** at runtime — that is, any feature unlocked only when a valid signed license key is present.

## What's covered by which terms

|                                                                                                                    | Apache-2.0 (`LICENSE`) | Commercial (this file) |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------- |
| The source code in this repo                                                                                       | ✅                     | —                      |
| Free CLI features (linting, formatting, basic CI setup)                                                            | ✅                     | —                      |
| Pro features unlocked by a signed license key (security scanning, Smart Test Strategy, ship-check, pr-check, etc.) | ✅ for the code        | ✅ for the runtime use |

Apache-2.0 lets you read, modify, and redistribute the source. It does **not** grant you the right to run the Pro features without a valid license key.

## Tiers and pricing

- **Free** — $0. Works without a license key. Includes the free CLI features above.
- **Pro** — $29/month or $290/year. Unlocks Pro features via a signed license key issued at purchase.

Purchase at the URL printed by `create-qa-architect --activate-license` (currently Polar.sh checkout).

## Your license-key grant

When you purchase Pro and receive a license key, BuildProven grants you a non-exclusive, non-transferable, non-sublicensable right to:

- Use Pro features in any number of your own personal or commercial projects, for as long as the subscription is active.
- Use the key on your own development machines and CI environments.

## What you may not do with the Pro tier

- Resell, sublicense, or redistribute Pro features or the license key itself.
- Share your license key with parties outside your own organization.
- Bypass, circumvent, or remove the license verification logic.
- Use the key after the subscription is canceled or revoked. Revocation is
  enforced when the CLI can complete a signature-verified registry check;
  offline use remains available until that check succeeds, and no fixed timing
  is guaranteed.

## Subscription lifecycle

- **Activation** — license key is issued automatically on successful checkout. Activate locally with `npx create-qa-architect --activate-license`.
- **Renewal** — handled by Polar; key remains valid as long as the subscription is active.
- **Cancellation** — you keep Pro until the end of the billing period you've paid for, then the key is revoked.
- **Refunds** — handled by Polar.sh per their refund policy (typically 30 days). Contact `support@buildproven.ai` if Polar can't resolve it.
- **Failed payment** — Polar handles dunning; if all retries fail, the key is moved to the revocation list.

## Modifications and derivative works

Apache-2.0 lets you fork the repo, modify it, and ship your own derivative. If your derivative ships the Pro feature _gates removed or bypassed_, that's a violation of these terms and BuildProven may revoke any license keys associated with your account.

If your derivative ships only Apache-2.0 code (free features), you're free to redistribute it as long as you comply with Apache-2.0's notice requirements.

## Trademarks

"BuildProven", "QA Architect", and "QA Architect Pro" are trademarks of BuildProven. Apache-2.0's Section 6 reserves trademark rights — you can't use these names to brand your fork or competing product.

## Warranty and liability

The Pro features are provided **as-is**, without warranty of any kind. BuildProven's total liability is limited to the amount you paid in the 12 months preceding any claim. This matches the standard Apache-2.0 disclaimer for the underlying code.

## Changes

We may update these commercial terms. Material changes will be published in this file and announced via your purchase email. Continued use after a material change constitutes acceptance.

## Contact

Licensing questions: `support@buildproven.ai`
