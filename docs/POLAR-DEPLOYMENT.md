# Polar.sh Deployment Guide

Deploy `webhook-handler.js` to process Polar.sh subscription events and issue signed Pro licenses automatically.

## Overview

The payment flow:

1. Customer purchases Pro at your landing page → Polar.sh hosted checkout
2. Polar fires a `subscription.created` (and shortly after, `subscription.active`) webhook to your server
3. `webhook-handler.js` verifies the signature, generates a signed license key, and saves it to Vercel Blob
4. Customer runs `npx create-qa-architect@latest --activate-license` and enters their key
5. CLI fetches the public signed registry from Vercel Blob, verifies the signature offline using the bundled `public-key.pem`, and unlocks Pro features

## Prerequisites

- A [Polar.sh](https://polar.sh) organization
- A [Vercel](https://vercel.com) account (for Blob storage and hosting the webhook)
- Node.js >= 20
- The Ed25519 private key used to sign licenses (paired with the `public-key.pem` bundled in the npm package)

---

## Step 1: Create Polar products

In the [Polar Dashboard](https://polar.sh/dashboard) → your org → Products → New Product:

- Name: **QA Architect Pro**
- Description: _(your marketing copy)_
- Type: Subscription
- Prices: add **two** recurring prices under the same product
  - $49.00 USD / month (recurring monthly)
  - $490.00 USD / year (recurring yearly)

Save the **product ID** — you'll need it for `POLAR_PRO_PRODUCT_ID` below. Single product, two prices means one tier mapping regardless of billing cadence.

## Step 2: Create the Polar webhook

In the Polar Dashboard → Settings → Webhooks → New Webhook:

- URL: `https://<your-vercel-domain>/webhook` (we'll deploy this next)
- Events to subscribe to:
  - `subscription.created`
  - `subscription.active`
  - `subscription.updated`
  - `subscription.canceled`
  - `subscription.revoked`
- Save the **signing secret** (starts with `whsec_`) — you'll need it for `POLAR_WEBHOOK_SECRET`.

## Step 3: Set up Vercel Blob storage

```bash
npm install -g vercel
vercel link
# Dashboard → Storage → Create → Blob → name it "qa-architect-licenses"
# Copy the BLOB_READ_WRITE_TOKEN
```

## Step 4: Deploy `webhook-handler.js` to Vercel

`webhook-handler.js` exports an Express app compatible with Vercel serverless.

Create `vercel.json` in the repo root:

```json
{
  "version": 2,
  "builds": [{ "src": "webhook-handler.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/webhook-handler.js" }]
}
```

Set environment variables in the Vercel dashboard (Project → Settings → Environment Variables):

| Variable                       | Value                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| `POLAR_WEBHOOK_SECRET`         | `whsec_...` from Step 2                                              |
| `POLAR_PRO_PRODUCT_ID`         | Pro product ID from Step 1                                           |
| `LICENSE_REGISTRY_PRIVATE_KEY` | Contents of `private-key.pem` (paired with bundled `public-key.pem`) |
| `LICENSE_REGISTRY_KEY_ID`      | An ID for this signing key (e.g., `prod-2026-05`)                    |
| `BLOB_READ_WRITE_TOKEN`        | From Step 3                                                          |
| `STATUS_API_TOKEN`             | _(optional)_ Bearer token for `/status` debug endpoint               |

Then deploy:

```bash
vercel --prod
```

Update the Polar webhook URL (Step 2) to point at the deployed Vercel URL.

## Step 5: Wire your landing page to Polar checkout

On `buildproven.ai/qa-architect`, replace any old Stripe checkout buttons with Polar checkout links:

- Monthly: `https://polar.sh/<org-slug>/<product-slug>?price=<price-id-monthly>`
- Annual: `https://polar.sh/<org-slug>/<product-slug>?price=<price-id-annual>`

Or use Polar's embeddable checkout component for an in-page experience.

## Step 6: Smoke test

```bash
# In the Polar dashboard, send a test webhook event for subscription.created
# (Settings → Webhooks → [your endpoint] → Send Test Event)

# Verify the license appeared:
curl https://<your-vercel-domain>/health
# → { "status": "ok", "database": "exists" }

curl https://<your-vercel-domain>/api/licenses/qa-architect.json
# → JSON with one signed license entry

# Activate locally:
npx create-qa-architect@latest --activate-license
# Enter the test license key. Should report PRO tier.
```

For a real end-to-end test, use Polar's test mode (every webhook can be replayed from the dashboard) before going live.

## Step 7: Verify revocation works

```bash
# Cancel a test subscription in Polar (or use "Send Test Event" with subscription.canceled, then subscription.revoked)

# Verify license moved out of public registry:
curl https://<your-vercel-domain>/api/licenses/qa-architect.json
# → revoked key should be absent

# CLI on next registry pull will refuse the key
```

## Rollback

If you need to roll back to Stripe-direct: restore the previous `webhook-handler.js` from git (it's the same Express app + Blob layout, just a different event source). Existing signed licenses in Vercel Blob keep working — they're product-agnostic.

## Common issues

**Signature verification fails** — the raw body parser must come _before_ `express.json()` for the `/webhook` route. `webhook-handler.js` does this on line ~125 (`app.use('/webhook', express.raw(...))`).

**`POLAR_PRO_PRODUCT_ID` mismatch** — log `event.data.product?.id || event.data.product_id` in the handler to confirm the exact ID Polar sends. Update the env var to match.

**License doesn't unlock Pro features** — check that `public-key.pem` bundled in your published npm package matches the private key in `LICENSE_REGISTRY_PRIVATE_KEY` on the server. They must be a pair.

**Customer canceled but key still works** — Polar fires `subscription.canceled` immediately, but the key stays valid until `subscription.revoked` fires (typically at `current_period_end`). This is intentional: the customer paid through the end of the period.
