# Phase 6 — Launch Conversion & Revenue Operations

Phase 6 starts after the paid Organizer/Sponsor foundation is production-ready. Its purpose is to measure whether real customers move from account creation to paid access, first value, commercial engagement, and realized sponsorship revenue.

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

## Activation definitions

These are operational definitions, not marketing claims:

- **Paid subscription** — the paid account owner's `subscription_status` is `active` or `trialing`.
- **Organizer first value** — the organizer account has created at least one conference.
- **Sponsor first value** — the sponsor account has preferences, a saved opportunity, or an inquiry.
- **Realized sponsorship revenue** — a provider-confirmed sponsorship payment remains `settled`; refunded payments are excluded.

Team seats are measured as workspace adoption rather than separate paid subscriptions because they inherit the workspace owner's subscription.

## Validation

Every push to `main` runs:

```text
node --check scripts/growthReport.mjs
node --check scripts/smokeGrowthReport.mjs
node scripts/smokeGrowthReport.mjs
```

The integration smoke test builds an isolated test database, creates one paid Organizer and one paid Sponsor, creates Organizer first value and sponsorship inventory, configures Sponsor first value, sends a real inquiry, runs the growth report against that same isolated database, and asserts the resulting funnel counts.

## Phase 6 next slices

After this baseline is stable, the next slices are:

- checkout-start and checkout-abandonment instrumentation using first-party server events;
- role-specific activation checklist inside Organizer Pro and Sponsor Pro;
- cohort retention (7/30/90-day active paid workspaces);
- acquisition-source attribution only when a source is explicitly supplied (for example campaign/UTM), without fingerprinting;
- recurring executive growth snapshot comparing movement against the prior period.
