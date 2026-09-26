# Phase 9 — Customer Acquisition & Marketplace Growth Automation

Phase 9 turns ConferenceGate's launch funnel into an operator-controlled growth system. It builds on Phase 7 launch operations and Phase 8 marketplace intelligence without inventing activity, sending unsolicited external messages, or assuming a sponsorship payment provider is live.

The private operator surface remains `/growth.html`, protected by a signed-in ConferenceGate session plus `DISCOVERY_ADMIN_TOKEN`.

## Phase 9.1 — Organizer & Sponsor Lead Pipelines

ConferenceGate now stores explicit Organizer and Sponsor prospects in `growth_leads`.

Each lead can contain:

- role: Organizer or Sponsor;
- organization and contact name;
- email and website;
- source and campaign;
- deterministic 0–100 operator score;
- pipeline stage;
- next action and due time;
- linked ConferenceGate user when conversion occurs;
- operator notes.

Supported stages are:

```text
new → contacted → qualified → invited → signup → activated → paid
                                                   ↘ lost
```

The private Growth Operations dashboard includes:

- Organizer lead count;
- Sponsor lead count;
- qualified, signup, activated and paid progress;
- lead-to-signup and lead-to-paid conversion;
- overdue follow-up count;
- a lead table with direct stage controls.

## Phase 9.2 — Conversion Campaigns & First-Touch Attribution

ConferenceGate already captures explicit first-touch attribution for Organizer and Sponsor signups from:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `ref` / `referral`

The browser records only explicit campaign/referral values. ConferenceGate does not infer acquisition source from IP address, browser fingerprint, referrer heuristics, or third-party identity.

Phase 9 connects that attribution to the lead pipeline. When an Organizer or Sponsor creates an account and the exact lead email/role is already in the pipeline, the lead becomes linked to the real ConferenceGate user and advances to `signup`.

The private dashboard then auto-advances a linked lead from real product state:

- Organizer `activated`: at least one created conference;
- Sponsor `activated`: preferences, saved opportunity, or sponsorship inquiry exists;
- `paid`: subscription state is `active` or `trialing`.

A lead is never advanced from guessed activity.

## Phase 9.3 — Referral Loop

Operators can create role-specific or role-neutral referral codes.

A valid referral conversion is counted only when:

1. the landing/signup flow explicitly carries `?ref=CODE` or `?referral=CODE`;
2. the referral code exists and is active;
3. its optional role target matches the actual Organizer/Sponsor account;
4. the account completes ConferenceGate signup and first-touch acquisition is stored.

Referral conversions are durable in `growth_referral_conversions` and appear in the private Growth dashboard.

The system does not award money, credits, commissions, or discounts. Those require a separately defined commercial program.

## Phase 9.4 — Marketplace Liquidity Targets

The operator dashboard now tracks marketplace balance instead of looking only at raw signup totals.

Default operating targets are configurable:

- 10 qualified Organizer leads;
- 20 qualified Sponsor leads;
- 10 active Organizer sponsorship opportunities;
- 2 Sponsor accounts per active sponsorship opportunity;
- 30% of active sponsorship inventory with at least one inquiry.

Measured current state includes:

- active sponsorship inventory;
- Sponsor account count;
- Sponsor-to-inventory ratio;
- inventory inquiry coverage.

Targets are editable from the private Growth dashboard and persisted in `growth_targets`.

These are operating targets, not fabricated forecasts.

## Phase 9.5 — Outreach Tracking & Follow-Up Discipline

Manual business-development touches can be recorded in `growth_outreach_events`.

The dashboard supports:

- channel;
- event type;
- short note;
- timestamp;
- last outreach time;
- total touch count.

Leads with a due next-action time in the past are counted as overdue until they become paid or lost.

Phase 9 deliberately records outreach but does **not** automatically send email, LinkedIn messages, SMS, or external contact. An operator remains responsible for the message and relationship.

## Phase 9.6 — Revenue-Growth Controls

Phase 9 uses the existing real subscription and marketplace state to distinguish:

- prospect;
- signup;
- activated account;
- paid/trialing account;
- marketplace inventory;
- inquiries;
- Deal Rooms.

Sponsorship payment collection is **not** presented as live. The Organizer/Sponsor Payment Ledger remains hidden from customer workspaces until ConferenceGate has a real sponsorship checkout/provider flow. Existing billing backend code remains dormant for future integration.

No hypothetical sponsorship revenue is counted as settled revenue.

## Private APIs

All routes below require a signed-in ConferenceGate session plus the discovery admin token:

```text
GET    /api/admin/discovery/growth-automation
POST   /api/admin/discovery/growth-leads
PATCH  /api/admin/discovery/growth-leads/:id
POST   /api/admin/discovery/growth-leads/:id/outreach
POST   /api/admin/discovery/growth-referrals
PATCH  /api/admin/discovery/growth-targets/:key
```

The standard private growth endpoint also embeds the Phase 9 snapshot:

```text
GET /api/admin/discovery/growth-dashboard
```

## Data Tables

Phase 9 creates additive tables only:

```text
growth_leads
growth_outreach_events
growth_referral_codes
growth_referral_conversions
growth_targets
```

Existing ConferenceGate data is not replaced.

## Phase 9.7 — Validation

`scripts/smokeGrowthAutomation.mjs` validates Phase 9 against an isolated database and built production server.

It verifies:

1. the growth surface requires both a signed-in session and admin token;
2. a Sponsor lead can be created;
3. overdue follow-up is calculated from a real due timestamp;
4. a manual outreach touch is stored;
5. a role-targeted referral code can be created;
6. a matching Sponsor signup records explicit referral attribution;
7. the referral conversion is persisted;
8. the matching lead advances to `signup`;
9. real subscription activation advances the lead to `paid`;
10. real Organizer sponsorship inventory is counted;
11. a real Sponsor inquiry updates inquiry coverage;
12. an operator growth target can be changed and persists;
13. the private Growth dashboard exposes the same Phase 9 state.

Application Validation runs this smoke together with the existing billing, commercial lifecycle, growth, marketplace intelligence, owner-preview, workspace-seat and built-server checks.

## Phase 9 completion state

Repository implementation for Phases **9.1–9.7** is complete when:

- the Phase 9 smoke test is green;
- the full Application Validation workflow is green;
- the production deployment succeeds.

Phase 9 intentionally stops short of automated external outreach and sponsorship payment collection. Those require explicit provider/channel configuration and a separate launch decision.
