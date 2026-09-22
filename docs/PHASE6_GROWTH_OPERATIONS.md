# Phase 6 — Launch Conversion & Revenue Operations

Phase 6 measures whether real Organizer and Sponsor customers move from account creation to paid access, first value, commercial engagement, repeat operational activity, and realized sponsorship revenue.

ConferenceGate deliberately uses first-party product records already required to operate the service. It does not add browser fingerprinting, inferred identity, IP-derived acquisition attribution, or a third-party analytics database.

## Operating commands

```text
npm run growth:schema
npm run growth:report
npm run growth:cohorts
npm run growth:executive
npm run growth:executive:json
```

- `growth:schema` installs the additive growth tables/triggers used for explicit acquisition attribution and forward-looking subscription history.
- `growth:report` is the operational funnel, checkout, retention, workspace, and revenue report.
- `growth:cohorts` reports signup cohorts, current paid conversion, acquisition-source cohorts, and instrumented subscription transitions.
- `growth:executive` prints a concise Markdown executive snapshot comparing the current 7/30-day windows with the immediately preceding non-overlapping periods.
- `growth:executive:json` returns the same executive snapshot as JSON.

With `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` configured, reports read production Turso. Tests are forced onto an explicit isolated `TEST_DATABASE_PATH` and refuse production Turso credentials.

## Phase 6.1 — Core paid funnel and revenue operations

### Organizer funnel

1. Organizer signup.
2. Current paid subscription (`active` or `trialing`).
3. First value: at least one created conference.
4. Sponsorship inventory published.
5. Sponsor interest received.
6. Deal Room reached.
7. Provider-confirmed sponsorship payment realized.

### Sponsor funnel

1. Sponsor signup.
2. Current paid subscription (`active` or `trialing`).
3. First value: sponsorship preferences, a saved opportunity, or a sponsorship inquiry.
4. Preference-profile adoption.
5. Watchlist adoption.
6. Sponsorship inquiry sent.
7. Deal Room reached.
8. Provider-confirmed sponsorship payment realized.

### Revenue operations

The report keeps financially different states separate:

- Deal Rooms by current status.
- Provider-confirmed settled sponsorship revenue by currency.
- Refunded payments by currency.
- Realized platform-fee revenue by currency, excluding refunded payments.
- Organizer payout obligations by `pending`, `held`, `paid`, or `refunded`.
- 30-day sponsorship engagement events.

Currencies are never combined into a misleading cross-currency total.

## Phase 6.2 — Checkout conversion

ConferenceGate records a checkout start only after the billing API has returned a usable provider checkout URL and immediately before provider navigation.

The first-party event stores the existing ConferenceGate account ID, provider, role, and a hash of the small operational payload. It does not store checkout URLs, browser fingerprints, IP-derived identities, or external analytics IDs.

For Organizer and Sponsor accounts separately, the report includes:

- trailing-30-day checkout starts;
- unique checkout-start accounts;
- checkout-start accounts that are currently paid;
- checkout-to-current-paid percentage;
- a 24-hour unconverted-checkout proxy;
- provider-level checkout-start counts.

The abandonment figure is deliberately a proxy: a later cancellation can make a formerly converted account currently unpaid. Tracking is best-effort and can never block checkout.

## Phase 6.2 — Paid workspace activation checklist

Organizer Pro core milestones:

1. Create the first conference.
2. Publish a sponsorship need.
3. Receive sponsor interest.
4. Open a Deal Room.
5. Complete a provider-confirmed sponsorship payment.

Sponsor Pro core milestones:

1. Configure sponsorship preferences.
2. Save a sponsorship opportunity.
3. Send a sponsorship inquiry.
4. Reach a Deal Room.
5. Complete a provider-confirmed sponsorship payment.

Adding a teammate is optional and excluded from the percentage. Workspace seats share the account owner's commercial activation state.

## Phase 6.3 — Retention activity

The growth report calculates currently paid workspace operational activity over trailing 7-, 30-, and 90-day windows.

For Organizer and Sponsor workspaces it reports:

- currently paid workspaces;
- active workspaces in each lookback window and the corresponding percentage;
- currently paid workspaces with no covered operational activity yet.

Organizer activity is derived from records such as conference creation, sponsorship inventory, Deal Rooms, broadcasts, professional invitations, and workspace changes. Sponsor activity is derived from preferences, saved opportunities, inquiries, Deal Rooms, sponsor requests, and workspace changes.

These are operational activity snapshots, not subscription-renewal retention.

## Phase 6.3 — Next Best Action

The activation card highlights the first incomplete core milestone as the workspace's Next Best Action. It uses only the ordered checklist state; there is no behavioral profiling model.

After all five core milestones are complete, the workspace is shown as core-activation complete rather than being given artificial additional requirements.

## Phase 6.4 — Explicit acquisition attribution

Attribution is first-touch and explicit-only.

ConferenceGate reads these parameters when a paid account is created:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `ref` or `referral`

The values are kept temporarily in the browser session only when one of those explicit acquisition signals exists. After Organizer/Sponsor account creation, the first explicit record is stored in `account_acquisition`. Later campaigns cannot overwrite it.

ConferenceGate does **not** infer acquisition source from `document.referrer`, IP address, device/browser fingerprint, geography, or identity-provider metadata. Accounts without an explicit source remain unattributed.

The cohort report shows:

- paid-role signups with explicit attribution;
- acquisition coverage percentage;
- source / medium / campaign cohorts;
- current paid conversion by acquisition cohort.

## Phase 6.4 — Executive growth snapshot

The executive report compares current periods with immediately preceding non-overlapping periods:

- current 7 days vs prior 7 days;
- current 30 days vs prior 30 days.

It includes:

- Organizer and Sponsor signup movement;
- checkout-account movement;
- sponsorship inquiry movement;
- Deal Room creation movement;
- settled payment movement;
- settled sponsorship revenue movement by currency;
- top explicit acquisition sources;
- recent signup cohorts;
- 24-hour unconverted checkout follow-up counts;
- paid workspaces that have never become operationally active;
- pending or held organizer payout obligations.

This allows the same command to be run repeatedly for a consistent executive review without requiring a separate analytics vendor.

## Phase 6.5 — Signup and paid-conversion cohorts

The cohort report groups Organizer/Sponsor accounts by signup month and shows:

- signups;
- current paid accounts;
- first-value activated accounts;
- paid-and-activated accounts;
- current paid conversion percentage;
- first-value activation percentage;
- paid activation percentage.

`currentPaidConversionPct` is explicitly a **current-state measure by signup cohort**. It is not presented as historical renewal retention.

## Phase 6.5 — Clean subscription transition history

`growth:schema` installs forward-looking subscription instrumentation:

- `subscription_status_history` stores paid-account status transitions;
- activation, cancellation, past-due, and reactivation transitions are captured when `subscription_status` changes;
- a paid `subscription_period_end` change is stored separately as `period_end_changed`, which is a renewal/period-extension signal rather than proof of a new charge;
- `growth_schema_meta.subscription_history_started_at` records when clean history began.

Accounts that were already `active`, `trialing`, `past_due`, or `canceled` when the schema was installed receive one `baseline_observed_state` record. This preserves their known state without inventing the date on which that state originally began.

The cohort report therefore exposes both:

- all observed paid states, including baseline accounts; and
- instrumented paid transitions that occurred after clean history started.

Cancellation/reactivation and period-end signals can be analyzed reliably from the instrumentation start date forward. Earlier lifecycle history remains unknown unless supplied by an authoritative payment-provider export.

## Workspace adoption

For Organizer and Sponsor workspaces separately, ConferenceGate measures:

- number of workspaces;
- active seats;
- added team seats excluding the owner;
- total seat capacity;
- seat-utilization percentage.

Capacity is counted once per workspace so team seats do not inflate the denominator.

## Reporting definitions

- **Paid subscription** — account-owner `subscription_status` is `active` or `trialing`.
- **Organizer first value** — organizer has created at least one conference.
- **Sponsor first value** — sponsor has preferences, a saved opportunity, or an inquiry.
- **Checkout start** — a usable checkout URL was returned and provider navigation was recorded immediately before redirect.
- **Checkout abandonment proxy** — checkout start is at least 24 hours old and the account is currently not paid.
- **Active paid workspace** — a currently paid workspace with covered role-specific operational activity in the chosen lookback window.
- **Realized sponsorship revenue** — provider-confirmed sponsorship payment remains `settled`; refunds are excluded.
- **Explicit acquisition** — first supplied UTM/referral information only; missing values are not inferred.
- **Baseline observed subscription state** — state known at instrumentation start; historical transition date unknown.
- **Period-end change** — renewal/period-extension signal; not independent proof of a renewal charge.

Team seats are workspace adoption, not separate paid subscriptions.

## Validation

Every `main` push runs the growth integration smoke test as part of Application Validation. The smoke flow uses an isolated database and now covers all Phase 6 slices:

1. Initialize the growth schema and subscription-history triggers.
2. Create unpaid Organizer and Sponsor accounts.
3. Store explicit first-touch acquisition and verify later touches cannot overwrite it.
4. Obtain valid hosted checkout URLs and record checkout starts.
5. Activate subscriptions through provider sync.
6. Exercise cancellation/reactivation and paid-period extension history.
7. Perform real Organizer/Sponsor activation actions.
8. Validate activation checklists and retention queries.
9. Run the main growth report.
10. Run acquisition/cohort reporting.
11. Run the executive period-over-period snapshot.
12. Assert attribution coverage, cohort conversion, transition history, and executive movement.

## Phase 6 status

**Phase 6.1 through Phase 6.5 are implemented.**

The growth system now covers the full planned sequence: core funnel and revenue operations, checkout conversion, activation guidance, paid-workspace activity retention, explicit acquisition attribution, executive period comparisons, signup cohorts, and clean forward-looking subscription lifecycle history.
