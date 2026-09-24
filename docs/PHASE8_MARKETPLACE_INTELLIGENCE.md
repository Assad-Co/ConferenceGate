# Phase 8 — Marketplace Intelligence & Automation

Phase 8 turns ConferenceGate marketplace activity into an operating system for Organizer and Sponsor teams. It is deliberately deterministic: actions are derived from persisted marketplace state and transparent thresholds rather than an opaque recommendation model.

## Phase 8.1 — Marketplace Health

The private Growth Operations dashboard now includes a Marketplace Intelligence section based on real sponsorship activity.

Tracked signals include:

- active Organizer sponsorship inventory;
- inventory with at least one distinct Sponsor listing view;
- inventory with at least one sponsorship inquiry;
- inventory view coverage percentage;
- inventory inquiry coverage percentage;
- quiet inventory: active for at least 7 days with zero distinct Sponsor listing views;
- high-intent/no-inquiry inventory: active for at least 7 days with 3+ distinct Sponsor viewers and zero inquiries;
- open sponsorship inquiries;
- active Deal Rooms;
- stalled Deal Rooms: active with no update for at least 7 days;
- settled sponsorship payments over the trailing 30 days;
- currently paid Organizer and Sponsor accounts.

The dashboard also lists current bottlenecks and publishes the exact definitions used for each threshold.

## Phase 8.2 — Organizer and Sponsor Action Queues

Paid Organizer and Sponsor workspaces receive a Priority Action Queue inside their existing dashboards.

The API is:

```text
GET /api/marketplace-intelligence/actions?role=organizer
GET /api/marketplace-intelligence/actions?role=sponsor
```

It respects paid workspace ownership and team-seat inheritance. Viewer seats can read the queue but are not granted new write privileges.

### Organizer actions

Examples include:

- create the first conference;
- publish sponsorship inventory after a conference exists;
- respond to pending Sponsor inquiries;
- advance Deal Rooms that have had no update for at least 5 days;
- improve an opportunity that has repeated Sponsor views but no inquiry;
- improve sponsorship inventory that has had zero Sponsor views after 7 days.

### Sponsor actions

Examples include:

- complete matching preferences;
- advance Deal Rooms that have had no update for at least 5 days;
- follow up on open inquiries;
- act on saved opportunities that have waited at least 3 days without an inquiry;
- enable alerts for saved opportunities;
- review active Organizer sponsorship inventory;
- publish a Sponsor Request.

Each action includes:

- an explicit action key;
- priority and deterministic score;
- human-readable reason;
- target area in the existing UI;
- related entity when available;
- measurable supporting metric when available.

The UI states explicitly that these are deterministic actions from real marketplace activity rather than a black-box recommendation.

## Phase 8.3 — Rate-Limited Action Notifications

The startup maintenance process now runs:

```text
node scripts/refreshMarketplaceActionAlerts.mjs
```

The worker uses the same SQLite database path as the live application.

Notifications are created only for measurable action-required conditions such as:

- Organizer inquiry waiting at least 2 days;
- Organizer or Sponsor Deal Room idle for at least 5 days;
- Organizer conference with no active sponsorship inventory after at least 1 day;
- Sponsor account older than 1 day with no matching preferences;
- Sponsor saved opportunity waiting at least 3 days without an inquiry.

`marketplace_nudge_events` stores the last notification time for each account/role/action/entity combination. Cooldowns prevent repeated deployments or startup runs from spamming the same customer.

Typical cooldowns:

- action-specific inquiry/deal/saved-opportunity reminders: 72 hours;
- account-level setup/inventory reminders: 168 hours.

Action notifications are delivered to the workspace owner plus active owner/admin/member seats. Viewer seats are excluded from action-required nudges because they cannot perform writes.

## Phase 8.4 — Operator Intelligence

The private `/growth.html` dashboard exposes marketplace bottlenecks without exposing them to ordinary customer accounts.

Current operator signals include:

- view coverage;
- inquiry coverage;
- quiet inventory;
- high-intent/no-inquiry inventory;
- open inquiries;
- active vs stalled Deal Rooms;
- recent settled payments;
- paid Organizer/Sponsor account counts.

The purpose is to identify where the marketplace funnel is slowing:

```text
inventory → Sponsor view → inquiry → Deal Room → settled payment
```

No financial currencies are merged and no hypothetical revenue is counted.

## Phase 8.5 — Validation & Feedback Loop

`scripts/smokeMarketplaceIntelligence.mjs` performs an end-to-end validation against an isolated SQLite database.

It verifies:

1. a new Organizer receives a create-conference action;
2. after creating a conference, the action changes to publish sponsorship inventory;
3. a new Sponsor receives a complete-preferences action;
4. after preferences are configured, the Sponsor is directed to current marketplace inventory;
5. matched-opportunity browsing records marketplace exposure;
6. a Sponsor inquiry appears in the Organizer action queue;
7. backdated unanswered inquiries generate a rate-limited notification;
8. an immediate repeat worker run does not create a duplicate notification;
9. entering negotiation creates a Deal Room;
10. a Deal Room backdated beyond the inactivity threshold appears in both Organizer and Sponsor queues;
11. both parties receive rate-limited stalled-Deal-Room notifications;
12. the private Growth dashboard reports the resulting marketplace health state and bottleneck.

The Application Validation workflow runs this smoke together with all existing billing, lifecycle, growth, owner-preview, workspace-seat and built-server checks.

## Phase 8 completion state

Repository implementation for Phases **8.1–8.5** is complete when the final Application Validation workflow is green on the final commit.

The intelligence layer intentionally does not auto-send external email, auto-contact counterparties, alter commercial terms, move a Deal Room status, or make a payment. It surfaces and rate-limits recommended actions while leaving commercial decisions with the Organizer or Sponsor.
