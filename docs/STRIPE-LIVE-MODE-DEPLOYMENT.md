# Stripe Live Mode Deployment Guide

Deploy the `webhook-handler.js` server to process real Stripe payments and issue signed Pro licenses automatically.

## Overview

The payment flow:

1. Customer purchases Pro at `buildproven.ai/qa-architect`
2. Stripe fires a `checkout.session.completed` webhook to your server
3. `webhook-handler.js` validates the event, generates a signed license key, and saves it to Vercel Blob
4. Customer runs `npx create-qa-architect@latest --activate-license` and enters their key

---

## Prerequisites

- A [Stripe](https://stripe.com) account with live mode enabled
- A [Vercel](https://vercel.com) account (for Blob storage and hosting)
- Node.js >=20
- The ED25519 private key used to sign licenses (in `public-key.pem` + your private key)

---

## Step 1: Create Stripe Products and Prices

In the [Stripe Dashboard](https://dashboard.stripe.com/products) → Products → Add product:

| Product          | Price   | Billing | Price ID (example)               |
| ---------------- | ------- | ------- | -------------------------------- |
| QA Architect Pro | $49.00  | Monthly | `price_1St9K2Gv7Su9XNJbdYoH3K32` |
| QA Architect Pro | $490.00 | Yearly  | `price_1St9KGGv7Su9XNJbrwKMsh1R` |

The price IDs above are already mapped in `webhook-handler.js:315-318`. If your actual Stripe price IDs differ, update `mapPriceToTier()` in `webhook-handler.js`.

---

## Step 2: Set Up Vercel Blob Storage

```bash
# Install Vercel CLI
npm install -g vercel

# Link your project
vercel link

# Create a Blob store in the Vercel dashboard
# Dashboard → Storage → Create → Blob → name it "qa-architect-licenses"
# Copy the BLOB_READ_WRITE_TOKEN
```

---

## Step 3: Deploy to Vercel

`webhook-handler.js` exports an Express app compatible with Vercel serverless.

Create `vercel.json` in the project root (do not commit secrets):

```json
{
  "version": 2,
  "builds": [{ "src": "webhook-handler.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "/webhook-handler.js" }]
}
```

Deploy:

```bash
vercel --prod
```

Your webhook URL will be: `https://your-project.vercel.app/webhook`

---

## Step 4: Set Environment Variables

In the Vercel dashboard → Project → Settings → Environment Variables, add:

| Variable                       | Value                              | Notes                                         |
| ------------------------------ | ---------------------------------- | --------------------------------------------- |
| `STRIPE_SECRET_KEY`            | `sk_live_...`                      | From Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET`        | `whsec_...`                        | Generated in Step 5 below                     |
| `LICENSE_REGISTRY_PRIVATE_KEY` | Base64-encoded ED25519 private key | See note below                                |
| `LICENSE_REGISTRY_KEY_ID`      | `default`                          | Or a versioned ID like `v1`                   |
| `BLOB_READ_WRITE_TOKEN`        | `vercel_blob_...`                  | From Vercel Blob store settings               |
| `STATUS_API_TOKEN`             | A strong random string             | Protects the `/status` endpoint               |
| `NODE_ENV`                     | `production`                       | Enables HSTS and production error handling    |

**Private key format:** The key must be a PEM-encoded ED25519 private key, base64-encoded as a single line (no newlines):

```bash
# Encode your private key for the env var
base64 -w 0 < your-private-key.pem
```

The `loadKeyFromEnv()` function in `lib/license-signing.js` decodes it automatically.

---

## Step 5: Register the Stripe Webhook

In the [Stripe Dashboard](https://dashboard.stripe.com/webhooks) → Webhooks → Add endpoint:

- **URL:** `https://your-project.vercel.app/webhook`
- **Events to listen for:**
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.deleted`

Copy the **Signing secret** (`whsec_...`) and add it as `STRIPE_WEBHOOK_SECRET` in Vercel.

---

## Step 6: Verify the Deployment

```bash
# Health check
curl https://your-project.vercel.app/health

# Expected response:
# {"status":"ok","timestamp":"...","database":"missing"}
# (missing is fine before any licenses are issued)

# Test license database endpoint (used by CLI)
curl https://your-project.vercel.app/legitimate-licenses.json

# Test status endpoint (replace TOKEN with your STATUS_API_TOKEN)
curl -H "Authorization: Bearer TOKEN" https://your-project.vercel.app/status
```

---

## Step 7: Test with Stripe Test Mode First

Before going live, test the full flow:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/webhook

# Trigger a test checkout event
stripe trigger checkout.session.completed

# Verify a license was created
curl http://localhost:3000/legitimate-licenses.json
```

Switch to live mode keys once the test flow works end-to-end.

---

## Step 8: Connect Your Checkout Page

Your Stripe Checkout session must:

- Use one of the two price IDs mapped in `mapPriceToTier()`
- Be a **subscription** mode checkout (not one-time payment)
- Collect a customer email

Example Stripe Checkout session creation (server-side):

```javascript
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  payment_method_types: ['card'],
  line_items: [{ price: 'price_1St9K2Gv7Su9XNJbdYoH3K32', quantity: 1 }],
  success_url:
    'https://buildproven.ai/qa-architect/success?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://buildproven.ai/qa-architect',
})
```

---

## License Key Delivery

After a successful checkout, the license key is stored in Vercel Blob. The customer retrieves it by running:

```bash
npx create-qa-architect@latest --activate-license
```

They enter their email and the license key format `QAA-XXXX-XXXX-XXXX-XXXX`.

The key is deterministic from the Stripe customer ID — you can regenerate it at any time using `admin-license.js` or `scripts/generate-license-keys.js`.

> **Note:** The current flow requires customers to manually enter their key. Consider adding an email delivery step in `handleCheckoutCompleted()` in `webhook-handler.js` (the comment at line 511 marks where to add this).

---

## Cancellation Handling

When a subscription is canceled in Stripe, the `customer.subscription.deleted` event fires and `handleSubscriptionCanceled()` marks the license as `status: "canceled"` in the database. The CLI checks this status during `getLicenseInfo()` and downgrades the user to FREE tier automatically.

---

## Troubleshooting

| Symptom                           | Likely cause                  | Fix                                                                        |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Webhook returns 400               | Wrong `STRIPE_WEBHOOK_SECRET` | Re-copy the signing secret from Stripe Dashboard                           |
| License not created after payment | Unknown price ID              | Update `mapPriceToTier()` with your actual Stripe price IDs                |
| CLI can't find license            | Wrong blob URL                | Check `BLOB_PATHS` in `lib/blob-storage.js` matches your Vercel Blob store |
| `sk_test_` warning in logs        | Test key in production        | Replace with `sk_live_...` key                                             |
| `/status` returns 503             | `STATUS_API_TOKEN` not set    | Add the env var in Vercel settings                                         |
