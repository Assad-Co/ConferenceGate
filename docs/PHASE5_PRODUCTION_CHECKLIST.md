# Phase 5 — Production Configuration & Release Checklist

This checklist closes the ConferenceGate paid Organizer/Sponsor workspace and sponsorship-commerce release path. Do not place real secret values in this file or in Git.

## 1. Render web service

- Runtime: Node.js 22.
- Branch: `main`.
- Build command: `npm ci --no-audit --no-fund && npm run build`.
- Start command: `npm start`.
- Health check path: `/api/health`.
- Let Render provide `PORT`; do not hard-code it.
- Keep the web service and discovery worker on the same persistent SQLite file.

After deployment, `GET /api/health` must return HTTP 200 with:

- `status: "ok"`
- `database: "ready"`
- a `release` value matching the deployed Git commit prefix

## 2. Required production environment

These must be configured in the Render web service:

- `DATABASE_PATH=/var/data/conferencegate.db`
- a Render persistent disk mounted at `/var/data`
- Turso is not part of the production runtime; remove `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` after any one-time recovery is complete
- `BILLING_SYNC_SECRET`
- `PUBLIC_BASE_URL=https://conferencegate.onrender.com`
- `APP_BASE_URL=https://conferencegate.onrender.com`

For server-created Paddle checkout:

- `BILLING_CHECKOUT_PROVIDER=paddle`
- `PADDLE_API_KEY`
- `PADDLE_ENV=live` for production or `sandbox` for test
- `PADDLE_ORGANIZER_PRICE_ID`
- `PADDLE_SPONSOR_PRICE_ID`
- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_WEBHOOK_TOLERANCE_SECONDS=5` unless there is a documented reason to change it

For hosted checkout instead:

- `BILLING_CHECKOUT_PROVIDER=hosted`
- `ORGANIZER_CHECKOUT_URL`
- `SPONSOR_CHECKOUT_URL`
- at least one signed subscription webhook provider must still be configured

Optional but recommended/feature-dependent:

- `JWT_SECRET`
- `FASTSPRING_WEBHOOK_SECRET`
- `SPONSORSHIP_PLATFORM_FEE_BPS`
- `WORKSPACE_SEAT_LIMIT`
- `BRAVE_SEARCH_API_KEY` and/or `SERPER_API_KEY`
- `GEMINI_API_KEY`
- `JINA_API_KEY`
- `FIRECRAWL_API_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `APIFY_TOKEN`
- `DISCOVERY_ADMIN_TOKEN`

## 3. Billing provider setup

### Paddle

Webhook destination:

`https://conferencegate.onrender.com/api/billing/webhooks/paddle`

Enable the subscription lifecycle events documented in `docs/BILLING_SETUP.md`, plus `transaction.completed` for Deal Room settlement.

The first subscription checkout must carry `conferencegate_user_id` in Paddle custom data. Deal Room transactions must carry `conferencegate_deal_id`.

### FastSpring

Webhook destination:

`https://conferencegate.onrender.com/api/billing/webhooks/fastspring`

Enable account/contact expansion for first-time account linking so ConferenceGate can match the purchaser email and store the durable FastSpring account reference.

## 4. Paid workspace acceptance

The release is not complete until the automated workspace smoke test confirms all of these:

- paid workspace owner can create/load the workspace;
- owner can add another account as a paid team seat;
- member inherits the owner's paid access;
- member-created organizer data is stored under the shared owner account;
- changing the seat to `viewer` blocks write operations;
- removing the seat revokes inherited paid access.

CI executes this through:

`node scripts/smokeWorkspaceSeats.mjs`

## 5. Commercial lifecycle acceptance

CI must pass all of the following after the production build:

- signed FastSpring/Paddle billing webhook smoke test;
- sponsorship commercial lifecycle smoke test;
- paid workspace seat inheritance/permission smoke test;
- built-server smoke test.

No browser redirect or success page may activate a paid subscription or mark a Deal Room paid. Provider signatures or the protected server-to-server normalization routes remain the source of truth.

## 6. Production readiness command

Run in the Render shell with the real service environment:

`npm run production:readiness:strict`

The command must exit successfully and report `ready: true`.

It validates:

- persistent SQLite path configuration;
- checkout-provider requirements;
- at least one signed subscription webhook provider;
- valid HTTPS checkout/base URLs;
- Paddle environment values;
- workspace seat limit;
- Paddle webhook tolerance;
- sponsorship platform fee range.

It prints configuration state only and never secret values.

## 7. Final release verification

Before calling Phase 5 complete:

- GitHub Application Validation workflow is green on the release commit.
- Render deployment is built from that same commit.
- `/api/health` is HTTP 200 and reports `database: "ready"`.
- `npm run production:readiness:strict` reports `ready: true` in Render.
- Test one Organizer Pro checkout and one Sponsor Pro checkout with the intended provider environment.
- Confirm signed webhook delivery activates the correct account.
- Confirm a paid owner can add a member, viewer restrictions apply, and removing the member revokes inherited access.
- Confirm a Deal Room can become paid only after a verified payment event.
- Confirm refund and organizer payout states remain distinct in the ledger.
- Confirm no real credentials or webhook secrets are committed to Git.

## Phase 5 completion rule

Repository implementation is complete when CI passes the release commit. Production release is complete only after the Render-specific checks above pass against the deployed environment.
