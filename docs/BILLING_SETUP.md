# ConferenceGate Billing Setup

ConferenceGate keeps **workspace subscriptions** and **sponsorship-deal settlement** separate:

1. Organizer Pro and Sponsor Pro subscriptions control access to the paid workspaces.
2. Sponsorship Deal Rooms track commercial agreements between a sponsor and an organizer.
3. A Deal Room can only become `paid` after a verified provider settlement event or the protected internal settlement adapter.

No browser success page can grant paid access or mark a sponsorship deal paid.

## Required production environment

Set these in the Render service environment. Never commit their values.

| Variable | Purpose |
| --- | --- |
| `BILLING_CHECKOUT_PROVIDER` | Set to `paddle` for server-created Paddle checkouts; otherwise hosted checkout URLs are used |
| `ORGANIZER_CHECKOUT_URL` | Hosted Organizer Pro checkout URL when not using server-created Paddle checkout |
| `SPONSOR_CHECKOUT_URL` | Hosted Sponsor Pro checkout URL when not using server-created Paddle checkout |
| `PADDLE_API_KEY` | Server-side Paddle API key used only when `BILLING_CHECKOUT_PROVIDER=paddle` |
| `PADDLE_ENV` | `sandbox` or `live`; defaults to live |
| `PADDLE_ORGANIZER_PRICE_ID` | Recurring Paddle price ID for Organizer Pro |
| `PADDLE_SPONSOR_PRICE_ID` | Recurring Paddle price ID for Sponsor Pro |
| `BILLING_SYNC_SECRET` | Secret for the protected server-to-server normalization and payout-confirmation endpoints |
| `SPONSORSHIP_PLATFORM_FEE_BPS` | Optional platform fee in basis points applied when a sponsor payment creates an organizer payout obligation; defaults to 0 |
| `FASTSPRING_WEBHOOK_SECRET` | FastSpring HMAC SHA-256 webhook secret, if FastSpring is used |
| `PADDLE_WEBHOOK_SECRET` | Paddle notification-destination secret, if Paddle is used |
| `PADDLE_WEBHOOK_TOLERANCE_SECONDS` | Optional signature timestamp tolerance; defaults to 5 seconds |
| `TURSO_DATABASE_URL` | Persistent production database |
| `TURSO_AUTH_TOKEN` | Persistent production database credential |

You only need the provider-specific webhook secret for providers you actually enable.

## FastSpring

Webhook destination:

```text
https://<conferencegate-domain>/api/billing/webhooks/fastspring
```

ConferenceGate verifies the `X-FS-Signature` HMAC against the exact raw request body before processing any event.

Recommended subscription events:

- `subscription.activated`
- `subscription.updated`
- `subscription.canceled`
- `subscription.uncanceled`
- `subscription.deactivated`
- `subscription.paused`
- `subscription.resumed`
- `subscription.payment.overdue`
- `subscription.charge.failed`

For first-time account linking, the FastSpring account contact email should match the Organizer/Sponsor ConferenceGate account email. Once linked, ConferenceGate stores the FastSpring account ID as the billing customer reference.

Webhook events are idempotent: the same FastSpring event ID is processed only once.

## Paddle

For reliable first-purchase account linking, set:

```text
BILLING_CHECKOUT_PROVIDER=paddle
PADDLE_API_KEY=<server-side Paddle API key>
PADDLE_ENV=sandbox|live
PADDLE_ORGANIZER_PRICE_ID=pri_...
PADDLE_SPONSOR_PRICE_ID=pri_...
```

ConferenceGate then creates the checkout transaction server-side and stores `conferencegate_user_id` and the account role in Paddle `custom_data`. Paddle carries transaction custom data onto the resulting subscription, allowing verified subscription webhooks to activate the correct ConferenceGate account without relying on browser state.

Webhook destination:

```text
https://<conferencegate-domain>/api/billing/webhooks/paddle
```

ConferenceGate verifies `Paddle-Signature` using the exact raw request body, HMAC-SHA256, and timestamp replay protection.

Recommended subscription events:

- `subscription.created`
- `subscription.updated`
- `subscription.activated`
- `subscription.trialing`
- `subscription.past_due`
- `subscription.paused`
- `subscription.resumed`
- `subscription.canceled`

For the first subscription checkout, include this Paddle custom data:

```json
{
  "conferencegate_user_id": "<signed-in ConferenceGate user id>"
}
```

ConferenceGate then stores Paddle's `customer_id` as the billing customer reference for later lifecycle events.

### Sponsorship Deal Room payments with Paddle

When creating a Paddle transaction for an agreed sponsorship deal, include:

```json
{
  "conferencegate_deal_id": "<ConferenceGate sponsorship deal id>"
}
```

Subscribe the webhook destination to:

```text
transaction.completed
```

A verified `transaction.completed` event will:

- record a provider payment ledger entry,
- set the corresponding Deal Room to `paid`,
- store the Paddle transaction ID as the payment reference,
- record a payment funnel event,
- append an auditable Deal Room payment update.

ConferenceGate deliberately uses the agreed Deal Room amount as the local commercial amount unless a future reconciliation adapter explicitly validates provider totals and currency.

## Protected normalization endpoints

The following routes remain available for a trusted server-side adapter and require `BILLING_SYNC_SECRET`:

```text
POST /api/billing/provider-sync
POST /api/billing/deal-payment-sync
```

They must never be called directly from browser code.

## Organizer payout obligations

ConferenceGate treats sponsor collection and organizer payout as two different financial events.

When a sponsorship Deal Room payment is verified, ConferenceGate creates a payout obligation for the organizer. The obligation stores the gross sponsor payment, optional platform fee, payout amount, currency, and payout status. It starts as `pending`.

A collected sponsor payment **does not** mark the organizer payout as paid.

### Refund reconciliation

A verified refund must use the protected normalization route:

```text
POST /api/billing/deal-refund-sync
x-billing-sync-secret: <BILLING_SYNC_SECRET>
```

The adapter supplies the provider event ID, Deal Room ID, refund reference, and `refunded=true`.

If the organizer payout is still pending, ConferenceGate marks the payout obligation `refunded`. If the organizer has already been paid, the obligation moves to `held` so finance can reconcile the already-sent payout. Refunded sponsor payments are excluded from sponsorship revenue analytics.

A trusted payout adapter confirms an organizer payout through:

```text
POST /api/billing/payout-sync
x-billing-sync-secret: <BILLING_SYNC_SECRET>
```

with a provider event ID, Deal Room ID, payout reference, and `paid=true`. That is the only path that changes a payout obligation to `paid`.

The Organizer Payment Ledger displays Sponsor-Paid Amount, Payout Pending, and Organizer Paid Out separately and never combines different currencies into one total.

## Production readiness check

From the Render shell:

```text
npm run production:readiness
```

For a strict pass/fail check:

```text
npm run production:readiness:strict
```

The script prints only booleans/configuration status; it never prints secret values.

## Deployment validation

Every push to `main` now runs:

```text
npm ci --ignore-scripts --no-audit --no-fund
npx tsc -p tsconfig.check.json --noEmit
npm run build
```

This is intentionally aligned with the production deployment path so a legacy patch script or dependency-lock mismatch cannot silently pass CI and fail only on Render.
