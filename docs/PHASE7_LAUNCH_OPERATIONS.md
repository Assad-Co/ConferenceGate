# Phase 7 — Production Launch & Marketplace Growth

Phase 7 moves ConferenceGate from a production-ready paid platform into live operating mode. The first two slices are production verification and a private executive growth dashboard.

## Phase 7.1 — Live Production Verification

The repository and CI release path can verify code, build, billing adapters, workspace inheritance, growth reporting, and the built server. The production Render process must additionally verify its own environment and persistent database.

### Repository release checks

Every release to `main` must pass:

- TypeScript validation;
- production build;
- signed billing webhook smoke test;
- sponsorship commercial-lifecycle smoke test;
- growth/revenue operations smoke test;
- private growth-dashboard security smoke test;
- paid workspace seat-inheritance smoke test;
- built-server smoke test.

### Live deployment evidence

The private operator dashboard reports evidence from the process that serves the page:

- release commit from `RENDER_GIT_COMMIT` / `GIT_COMMIT_SHA`;
- database connectivity;
- whether `TURSO_DATABASE_URL` is configured for persistent storage;
- whether `PUBLIC_BASE_URL` is configured;
- configured checkout-provider mode;
- Paddle API/webhook readiness as a boolean (never the secret values);
- FastSpring webhook readiness as a boolean;
- whether the growth-history schema is installed;
- the subscription-history instrumentation start timestamp when available.

A release should not be called production-verified only because GitHub Actions is green. The live Render process should show the expected release and readiness state.

The external browsing environment used during implementation could not directly reach `conferencegate.onrender.com/api/health`. This is treated as an unverified network path, not as evidence that the Render service is down. The dashboard and `/api/health` from a normal browser remain the production evidence sources.

## Phase 7.2 — Private Executive Growth Dashboard

The dashboard is served at:

```text
/growth.html
```

It is deliberately separate from Organizer Pro and Sponsor Pro customer dashboards so company-wide signups, conversion, platform revenue, refunds, fees, and payout obligations are never exposed to ordinary customer accounts.

### Access boundary

To load data, the operator must have both:

1. a valid signed-in ConferenceGate session; and
2. the existing `DISCOVERY_ADMIN_TOKEN`.

The page sends the token only in the `x-discovery-admin-token` request header to:

```text
GET /api/admin/discovery/growth-dashboard
```

The token is kept only in page memory for the open tab. It is not placed in source code, returned by the API, or saved in local storage. The **Lock dashboard** control clears the in-memory token.

### Dashboard sections

#### Production readiness

- live release identifier;
- persistent database readiness;
- public-base-URL configuration;
- growth-history schema readiness;
- Paddle readiness;
- FastSpring webhook readiness.

#### Paid account growth

For Organizer and Sponsor accounts separately:

- total signups;
- trailing 7-day signups;
- trailing 30-day signups;
- currently paid accounts;
- current paid conversion percentage;
- first-value activated accounts;
- activation percentage;
- trailing-30-day checkout starts and unique checkout-start accounts.

#### Signup movement

- current 7 days vs the preceding 7 days;
- current 30 days vs the preceding 30 days;
- Organizer and Sponsor accounts reported separately.

#### Paid workspace activity

- paid workspaces;
- operationally active workspaces over 7, 30 and 90 days;
- activity percentages.

These are operational-activity measures and are not described as subscription-renewal retention.

#### Acquisition

- explicit first-touch attribution coverage;
- attributed vs total paid-role signups;
- leading explicit sources by Organizer/Sponsor role.

No source is guessed for unattributed accounts.

#### Sponsorship marketplace

- Deal Rooms by current status;
- provider-confirmed settled sponsorship revenue by currency;
- refunds by currency;
- platform-fee revenue by currency;
- organizer payout obligations by status and currency.

Different currencies are never combined into a single financial total.

## Security validation

`scripts/smokeGrowthDashboard.mjs` verifies that:

- an admin token without a signed-in session is rejected;
- a signed-in account without the admin token is rejected;
- an invalid token is rejected;
- a valid session plus valid admin token can load the dashboard;
- live-style Organizer paid/activation metrics are read from the same isolated database;
- administrative secrets are not returned in the JSON response.

## Operating procedure

1. Deploy the latest green `main` commit to Render.
2. Sign in to ConferenceGate.
3. Open `/growth.html`.
4. Enter the `DISCOVERY_ADMIN_TOKEN` configured on the Render service.
5. Confirm the release identifier matches the intended `main` commit.
6. Confirm persistent Turso database = ready/configured.
7. Confirm the intended billing provider is configured.
8. Confirm growth history schema = ready.
9. Review paid conversion, activation, retention/activity, acquisition, Deal Rooms, revenue and payout state.
10. Use **Lock dashboard** before leaving the operator device.

## Next Phase 7 slices

After 7.1/7.2 are verified on the live Render process, continue in this order:

- **7.3 Organizer Acquisition Engine** — organizer landing/conversion flow, import-from-official-URL, wizard activation, sponsorship setup and professional discovery.
- **7.4 Sponsor Acquisition Engine** — company profile, preferences, relevant opportunities, watchlist and commercial activation.
- **7.5 Marketplace Matching** — sponsor/conference relevance matching using explicit business criteria and actual product data.
- **7.6 Notifications** — useful, rate-controlled marketplace alerts and action-required notifications.
- **7.7 Revenue Optimization** — featured inventory, premium matching, team-seat upgrades and transparent transaction/platform-fee experiments.
- **7.8 First Customer Launch** — onboard a small real cohort, measure the full visitor → signup → paid → activation → match → inquiry → deal → payment funnel, and iterate from observed behavior.
