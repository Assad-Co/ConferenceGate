# Phase 7 — Production Launch & Marketplace Growth

Phase 7 moves ConferenceGate from a production-ready paid platform into live operating mode. The repository now covers production verification, executive growth operations, Organizer/Sponsor acquisition, explainable matching, notifications, revenue operations, and an explicit first-customer launch cohort.

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
- whether `DATABASE_PATH` is configured for persistent SQLite storage;
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

## Phase 7.3 — Organizer Acquisition Engine

Phase 7.3 turns Organizer acquisition into a measurable path from an explicit campaign touch to useful paid-product activity:

```text
explicit source/campaign → Organizer signup → paid access → first conference → sponsorship inventory
```

### Privacy-safe acquisition attribution

ConferenceGate continues to use explicit first-touch attribution only. Organizer/Sponsor acquisition can be supplied by `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, or an explicit referral code.

- the first explicit touch is stored with `INSERT OR IGNORE` and cannot be overwritten by later campaigns;
- ordinary password signup, Google role-completion, and LinkedIn role-completion all preserve the explicit acquisition touch;
- no source is inferred from IP address, browser/device fingerprint, geography, `document.referrer`, or identity-provider metadata;
- unattributed accounts stay unattributed.

### Organizer source and campaign funnel

The private Growth Operations dashboard now reports Organizer acquisition by source/medium and campaign, including:

- attributed Organizer signups;
- currently paid Organizer accounts;
- first-conference activation;
- organizers that have published sponsorship inventory;
- signup-to-paid conversion;
- signup-to-first-conference conversion;
- first-conference-to-sponsorship-inventory conversion.

Counts use account-level existence checks so multiple conferences or sponsorship needs do not inflate one Organizer account into multiple conversions.

### Import from official conference URL

Organizer Pro now includes an **Import from the official conference page** action at the top of the existing Conference Wizard.

The organizer supplies the public official URL. ConferenceGate then:

1. validates that the input is HTTP(S);
2. fetches it through the same SSRF-protected discovery client used by the conference discovery engine;
3. revalidates every redirect;
4. applies request timeouts and a response-size cap;
5. uses structured event data first and deterministic HTML extraction to fill gaps;
6. if the origin is JavaScript-dependent or blocks normal server requests, tries the installed rendered-browser path;
7. if the page is still weak/unreadable, tries the configured/public readable-page fallback;
8. records which import routes were attempted so the Organizer sees an actionable diagnostic rather than a generic error;
9. returns a reviewable draft only.

The import can prefill factual fields such as title, description, dates, location, topics, banner image, format, price text and official website when the page actually exposes them. Missing information remains missing.

The import endpoint never auto-publishes a conference. The organizer must review the wizard and explicitly submit it.

### Factual Wizard defaults

The Organizer Conference Wizard no longer seeds a new real account with demo conference facts such as Paris, a made-up hotel, airport guidance, generic Subsurface-AI topics, arbitrary fees, arbitrary deadlines, or a forced Hybrid format.

The organizer must explicitly select/confirm required basics such as industry, dates, location and format. Imported values remain editable before publication. Optional facts stay blank when the organizer has not supplied them.

### Existing activation handoff

The established Organizer Pro activation path remains intact:

- publishing the first conference records first-value activation;
- the wizard then opens Sponsorship Needs and carries the new conference ID/category/location context into the sponsorship setup;
- Organizer Pro already provides Professional Network search and invitations for technical-committee members, chairs and speakers;
- the Technical Committee and Sponsorship areas continue using the shared paid workspace.

### Phase 7.3 validation

The private growth-dashboard smoke test additionally verifies that:

- first-touch acquisition attribution cannot be overwritten by a later campaign;
- source-level Organizer signup → paid → first conference → sponsorship-inventory metrics resolve correctly;
- campaign-level Organizer conversion resolves correctly;
- a private/loopback URL is rejected by the official-URL import boundary;
- the same dashboard remains protected by signed-in session + admin token.

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
6. Confirm persistent SQLite path = ready/configured. If it is not configured, the site can run on temporary local SQLite but data is at redeploy/restart risk.
7. Confirm the intended billing provider is configured.
8. Confirm growth history schema = ready.
9. Review paid conversion, activation, retention/activity, acquisition, Deal Rooms, revenue and payout state.
10. Use **Lock dashboard** before leaving the operator device.

## Phase 7.4 — Sponsor Acquisition Engine

Sponsor Pro is organized around a real activation path rather than disconnected screens:

```text
company identity → matching preferences → relevant opportunities → watchlist → inquiry → Deal Room → paid sponsorship
```

The Sponsor Launchpad summarizes real account state and provides one **Next Best Action**. It uses persisted company/profile data, preferences, opportunity matches, saved opportunities, inquiries, Deal Rooms, payments, Sponsor Requests, organizer responses, and unread sponsorship notifications. It does not manufacture completion flags.

For owner-preview sessions, Sponsor Deal Rooms explicitly use Sponsor context without changing the account's stored Organizer role or creating billing state.

## Phase 7.5 — Explainable Marketplace Matching

Internal sponsorship needs are ranked from explicit business criteria already stored in ConferenceGate:

- target sector;
- conference/category relevance;
- region;
- sponsorship opportunity type;
- published price vs Sponsor budget range.

The existing weighted score is now accompanied by a structured breakdown and short human-readable reasons such as sector/category/region overlap and budget fit. Missing preference dimensions are omitted rather than treated as negative evidence.

The Match UI shows **Why this matches** so Sponsors can evaluate the recommendation instead of relying on an opaque percentage.

## Phase 7.6 — Rate-Controlled Notifications

Sponsor watchlist alerts remain workspace-shared and respect the Sponsor's configured cadence:

- `instant`;
- `daily` (minimum 24-hour delivery interval);
- `weekly` (minimum 168-hour delivery interval).

Changes are fingerprinted in `sponsor_watch_alert_events` so the same snapshot is not re-notified. Instant changes create notifications immediately; daily/weekly changes are grouped into digests. Alerts reach the Sponsor owner and active paid workspace seats.

The watch-alert worker now uses the same SQLite database path as the live application; Turso is not used by the notification runtime.

## Phase 7.7 — Revenue Optimization Operations

The private Growth Operations dashboard reports only revenue levers that have an actual implementation/configuration path:

- Organizer Pro checkout readiness and paid accounts;
- Sponsor Pro checkout readiness and paid accounts;
- subscription checkout starts over the trailing 30 days;
- configured sponsorship platform fee in basis points;
- paid workspace team-seat adoption and current seat cap;
- provider-confirmed settled sponsorship Deal Rooms.

Potential future add-ons such as featured conferences, featured sponsorship inventory, and premium matching are shown as **disabled** until a real product SKU and billing path exist. The dashboard does not count hypothetical revenue as launched revenue.

## Phase 7.8 — First Customer Launch

A private admin-managed `first_customer_launch` cohort lets the operator enroll selected existing Organizer/Sponsor accounts by exact email. Membership is explicit; ConferenceGate does not silently select customers.

Operating target:

- 10 Organizer accounts;
- 20–50 Sponsor accounts.

For each role, the cohort reports account-level counts and conversion percentages for:

```text
member → paid → activated → marketplace exposure → inquiry → Deal Room → settled payment
```

Definitions are based on actual ConferenceGate records:

- Organizer activation = at least one created conference;
- Sponsor activation = preferences, saved opportunity, or sponsorship inquiry;
- marketplace exposure = at least one recorded internal sponsorship listing view tied to that account/party;
- inquiry = at least one sponsorship inquiry;
- Deal Room = at least one sponsorship deal;
- payment = at least one provider-confirmed settled sponsorship payment.

The private cohort API is protected by the same signed-in session + `DISCOVERY_ADMIN_TOKEN` boundary as the executive dashboard. Operators can add or remove members without exposing the cohort to customers.

## Phase 7 completion state

Repository implementation for Phases **7.1–7.8** is complete when the final Application Validation workflow is green on the final commit.

Live launch remains an operating activity rather than a code claim. Before calling the marketplace commercially launched, verify the deployed release, persistent SQLite configuration, intended billing provider, real Organizer/Sponsor cohort membership, and observed funnel movement from actual customers.
