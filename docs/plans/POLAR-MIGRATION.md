# Polar.sh Migration Plan

**Status:** in progress
**Date:** 2026-05-17
**Replaces:** Stripe-direct billing

## Why

We're migrating billing from **Stripe-direct** to **Polar.sh** (Merchant-of-Record).

|                                          | Stripe direct                                                             | Polar.sh (MoR)          |
| ---------------------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| Effective fee on $49/mo                  | ~3.5%                                                                     | ~4.8% (~1.3% premium)   |
| Global sales tax / VAT / GST             | **We owe it** (~$200-400/mo for Anrok at scale, plus state registrations) | Polar collects + remits |
| Customer portal (cancel/update/invoices) | Build it                                                                  | Built-in                |
| Dunning / failed payment retries         | Build it                                                                  | Built-in                |
| Effort to ship v1                        | High (tax, portal, dunning)                                               | Low (webhook swap only) |

Crossover where Stripe-direct wins: ~$50K MRR. Until then, Polar is **cheaper in total cost** and ships faster.

## Architecture: what stays, what changes

### Stays (the moat)

- `lib/license-signing.js` — Ed25519 signing primitives (re-exports `@buildproven/license-core`)
- `lib/license-validator.js` — offline signature verification
- `lib/licensing.js` — tier definitions, feature gates, activation flow
- `public-key.pem` bundled in the npm package — CLI verifies signed payloads offline
- `lib/blob-storage.js` — Vercel Blob layout for private DB + public signed registry
- `--activate-license` CLI flow — fetches public registry, falls back to cached offline data
- License key format `QAA-XXXX-XXXX-XXXX-XXXX`, deterministic from customer ID

### Changes

- `webhook-handler.js` — event source swap: Stripe `checkout.session.completed` → Polar `subscription.created/active/canceled/revoked`. Same Vercel Blob writes, same signing.
- `docs/STRIPE-LIVE-MODE-DEPLOYMENT.md` → archived. Replaced by `docs/POLAR-DEPLOYMENT.md`.
- `lib/billing-dashboard.html` → archived. Polar's hosted customer portal replaces it.
- Buy URLs (`buildproven.ai/qa-architect`) → Polar checkout URL.
- `admin-license.js` → kept, comments updated to clarify it's a manual fallback only.

### New

- `subscription.canceled` / `subscription.revoked` → revocation list. Signed JSON at known URL, cached by CLI with grace period so offline CI doesn't break. Closes the "cancel but keep Pro forever" loophole.
- `COMMERCIAL.md` — paid-tier terms gated by the license-key check at runtime.
- `LICENSE` swap: custom EULA → standard **Apache-2.0**.

## Why we don't use Polar's built-in license keys

Polar's built-in license-key benefit requires online validation against `/v1/customer-portal/license-keys/validate`. Our CLI is designed for **offline verification** — `npx create-qa-architect` must work in CI sandboxes with no outbound HTTP. We use Polar only for billing/MoR/checkout/portal/dunning. Our existing Ed25519 signing + Vercel Blob + offline-verifying CLI stays as-is.

## Polar webhook events we handle

| Event                   | Action                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `subscription.created`  | Generate license key, sign payload, write to private DB + public signed registry                                        |
| `subscription.active`   | Idempotent re-issue (covers renewal + late activations)                                                                 |
| `subscription.updated`  | If `product_id` changed (plan switch), update tier in DB                                                                |
| `subscription.canceled` | Mark as `pending_cancel` in private DB. Subscription is still active until `current_period_end`. **Do not** revoke yet. |
| `subscription.revoked`  | Move license key to revocation list. CLI will refuse it after next registry pull (with cache + grace period).           |

## Polar product setup (manual, user does this)

1. Create Polar org at https://polar.sh
2. Create product **"QA Architect Pro"** with two prices:
   - $49/mo (recurring monthly)
   - $490/yr (recurring yearly)
3. Save the `product_id` — single product, two prices.
4. Configure webhook endpoint: `https://<your-vercel-domain>/webhook`
5. Webhook secret → env var `POLAR_WEBHOOK_SECRET`
6. API token (for any server-side Polar API calls) → env var `POLAR_ACCESS_TOKEN`

## Env vars (replaces Stripe vars)

| Old (Stripe)                   | New (Polar)                               |
| ------------------------------ | ----------------------------------------- |
| `STRIPE_SECRET_KEY`            | `POLAR_ACCESS_TOKEN`                      |
| `STRIPE_WEBHOOK_SECRET`        | `POLAR_WEBHOOK_SECRET`                    |
| `LICENSE_REGISTRY_PRIVATE_KEY` | (unchanged)                               |
| `LICENSE_REGISTRY_KEY_ID`      | (unchanged)                               |
| `BLOB_READ_WRITE_TOKEN`        | (unchanged)                               |
| (none)                         | `POLAR_PRO_PRODUCT_ID` — maps to PRO tier |

## Verification

Before declaring done:

1. `npm test` — full suite passes
2. `npm run lint` — clean
3. Manual smoke test: simulate a `subscription.created` event with Polar's CLI / Postman → verify license appears in Blob → run `npx . --activate-license` with the issued key → confirm Pro feature unlocks.
4. Manual revocation test: simulate `subscription.revoked` → confirm license appears in revocation list → confirm CLI rejects key after registry pull.

## Replicate to claude-kit-pro

Same migration, same architecture. Differences:

- License key prefix differs (`CKP-` instead of `QAA-`)
- Webhook URL differs (deploy under claude-kit-pro's Vercel project)
- `POLAR_PRO_PRODUCT_ID` env var points at claude-kit-pro's Polar product

Follow this doc step-by-step in `../claude-kit-pro/`.

## Rollback

If Polar fails for any reason, the migration is reversible in ~half a day:

1. Restore `webhook-handler.js` from git (it was just an event-source swap)
2. Restore `docs/STRIPE-LIVE-MODE-DEPLOYMENT.md`
3. Repoint Vercel webhook to Stripe events
4. Existing signed licenses in Vercel Blob keep working — they're product-agnostic.

The signing/verification layer never depended on the billing provider. That's why this swap is cheap.
