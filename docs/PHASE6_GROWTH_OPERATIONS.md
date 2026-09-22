# Phase 6 — Launch Conversion & Revenue Operations

Phase 6 starts after the paid Organizer/Sponsor foundation is production-ready. Its purpose is to measure whether real customers move from account creation to paid access, first value, commercial engagement, retention activity, and realized sponsorship revenue.

This phase deliberately reuses product data ConferenceGate already stores. It does not add hidden browser tracking, fingerprinting, or a second analytics database.

## Operating command

Run against the production service environment:

```text
npm run growth:report
```

The report is read-only. With `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` configured, it reads the production Turso database. Without Turso it reads the local development database. Tests are forced onto an explicit isolated `TEST_DATABASE_PATH` and refuse production Turso credentials.

## Organizer funnel

The report measures:

1. Organizer account signups, including trailing 7-day and 30-day counts.
2. Current direct paid subscriptions (`active` or `trialing`).
3. First-value activation: the paid account owner has created at least one conference.
4. Commercial inventory: at least one sponsorship need has been published.
5. Sponsor interest received: an inquiry exists against the organizer's sponsorship inventory.
6. Deal Room reached.
7. Provider-confirmed sponsorship payment realized.

It calculates conversion percentages between each meaningful stage where a denominator exists.

## Sponsor funnel

The report measures:

1. Sponsor account signups, including trailing 7-day and 30-day counts.
2. Current direct paid subscriptions (`active` or `trialing`).
3. First-value activation: the paid sponsor account has configured preferences, saved an opportunity, or sent an inquiry.
4. Preference-profile adoption.
5. Watchlist adoption.
6. Sponsorship inquiry sent.
7. Deal Room reached.
8. Provider-confirmed sponsorship payment realized.

## Phase 6.2 — Checkout conversion

ConferenceGate records a checkout start only after the billing API has successfully returned a usable provider checkout URL and immediately before the browser navigates away. The event is stored in the existing first-party billing event ledger.

The checkout event stores the account ID already required by ConferenceGate, the provider name, the account role, and a hash of the small operational payload. It does **not** store browser fingerprints, checkout URLs, IP-derived identity, or third-party analytics identifiers.

The growth report now includes, separately for Organizer and Sponsor accounts:

- checkout starts in the trailing 30 days;
- unique accounts that started checkout;
- checkout-start accounts that are currently paid;
- checkout-to-current-paid conversion percentage;
- an abandonment proxy: accounts whose checkout start is at least 24 hours old and whose current subscription is not `active` or `trialing`;
- checkout starts and unique accounts grouped by provider.

The abandonment number is deliberately labeled a proxy because a later cancellation can make a previously converted account appear currently unpaid. It is an operational warning signal, not a historical attribution claim.

Checkout tracking is best-effort. Failure to record the analytics event never prevents the customer from reaching the payment provider.

## Phase 6.2 — Paid workspace activation checklist

The Team & Access area in both Organizer Pro and Sponsor Pro displays a shared activation card. Progress is derived from real server records and is shared across workspace seats.

### Organizer Pro core steps

1. Create the first conference.
2. Publish a sponsorship need.
3. Receive sponsor interest.
4. Open a Deal Room.
5. Complete a provider-confirmed sponsorship payment.

### Sponsor Pro core steps

1. Configure sponsorship preferences.
2. Save a sponsorship opportunity.
3. Send a sponsorship inquiry.
4. Reach a Deal Room.
5. Complete a provider-confirmed sponsorship payment.

Adding a teammate is shown as an optional milestone and is excluded from the activation percentage, so a successful solo customer is not penalized.

Team seats inherit the owner workspace's activation state because the commercial records belong to the paid account workspace, not to the individual seat that happens to view them.

## Phase 6.3 — Retention activity

The growth report now calculates paid-workspace operational activity for Organizer Pro and Sponsor Pro over trailing 7-day, 30-day, and 90-day windows.

For each account role it reports:

- currently paid workspaces;
- workspaces with operational activity in the last 7 days and the percentage of paid workspaces;
- workspaces with operational activity in the last 30 days and the percentage of paid workspaces;
- workspaces with operational activity in the last 90 days and the percentage of paid workspaces;
- currently paid workspaces that have never recorded one of the covered operational actions.

Organizer activity is derived from real records such as conference creation, sponsorship inventory, sponsorship Deal Rooms, organizer broadcasts, professional invitations, and workspace access changes. Sponsor activity is derived from sponsorship preferences, saved opportunities, inquiries, Deal Rooms, sponsor requests, and workspace access changes.

These values are **operational activity retention snapshots**, not subscription-renewal retention and not classic cohort survival curves. ConferenceGate should not claim that a workspace was retained commercially merely because it performed an action.

## Phase 6.3 — Next-best activation action

The activation card now identifies the first incomplete core milestone as the workspace's **Next Best Action**. This is derived locally from the same ordered checklist; no behavioral profiling model is involved.

Once all five core milestones are complete, the card switches to a core-activation-complete state rather than continuing to manufacture additional required steps.

This guidance remains informational. It does not automatically message users or generate spam notifications.

## Workspace adoption

For Organizer and Sponsor workspaces separately, the report measures:

- number of workspaces;
- active seats;
- added team seats excluding the owner;
- total configured seat capacity;
- current seat-utilization percentage.

Workspace capacity is aggregated once per workspace, so adding team members does not inflate the denominator.

## Revenue operations

The report keeps financially different states separate:

- Deal Rooms by current deal status.
- Provider-confirmed settled sponsorship revenue by currency.
- Refunded sponsorship payments by currency.
- Realized platform-fee revenue by currency, excluding refunded payments.
- Organizer payout obligations by status and currency (`pending`, `held`, `paid`, `refunded`).
- Existing 30-day sponsorship engagement events: listing views, inquiries, negotiating, won, contract, and payment.

Currencies are never combined into a single misleading total.

## Activation and reporting definitions

These are operational definitions, not marketing claims:

- **Paid subscription** — the paid account owner's `subscription_status` is `active` or `trialing`.
- **Organizer first value** — the organizer account has created at least one conference.
- **Sponsor first value** — the sponsor account has preferences, a saved opportunity, or an inquiry.
- **Checkout start** — ConferenceGate has received a usable checkout URL and recorded the provider navigation immediately before redirect.
- **Checkout abandonment proxy** — checkout is at least 24 hours old and the account is currently not `active` or `trialing`.
- **Active paid workspace** — a currently paid workspace whose owner account has one of the covered role-specific operational activities in the selected lookback window.
- **Realized sponsorship revenue** — a provider-confirmed sponsorship payment remains `settled`; refunded payments are excluded.

Team seats are measured as workspace adoption rather than separate paid subscriptions because they inherit the workspace owner's subscription.

## Validation

Every push to `main` runs:

```text
node --check scripts/growthReport.mjs
node --check scripts/smokeGrowthReport.mjs
node scripts/smokeGrowthReport.mjs
```

The integration smoke test uses an isolated database and reproduces the Phase 6.2/6.3 flow: create unpaid Organizer and Sponsor accounts, obtain valid hosted checkout URLs, record checkout starts, activate both subscriptions through provider sync, perform real activation actions, read the paid-workspace activation APIs, run the growth report including retention queries, and assert the core checkout and activation counts.

## Phase 6 next slices

With checkout instrumentation, role-specific activation, retention activity snapshots, and next-best-action guidance implemented, the next slices are:

- acquisition-source attribution only when a source is explicitly supplied (for example campaign/UTM), without fingerprinting;
- recurring executive growth snapshots that compare movement against the prior period;
- historical paid-conversion cohorts once the product has enough clean billing history to distinguish activation, cancellation, reactivation, and renewal without approximation.
