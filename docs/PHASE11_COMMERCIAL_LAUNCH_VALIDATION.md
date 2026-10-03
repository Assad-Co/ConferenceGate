# Phase 11 — Commercial Launch & Production Validation

Phase 11 converts ConferenceGate from repository-complete software into a production-verified commercial release. It deliberately separates code validation from live-environment evidence so the platform is not called launched until the deployed service, database, access controls, and customer journeys are verified against production.

## Phase 11.1 — Live Launch Gate

ConferenceGate includes a non-destructive live verification command:

```text
npm run launch:verify-live
```

The command reads only public or intentionally unauthenticated surfaces. It does not create users, conferences, sponsorship records, payments, or other production data.

Configure:

```text
PHASE11_BASE_URL=https://conferencegate.onrender.com
EXPECTED_RELEASE=<expected Git commit prefix>
```

If `PHASE11_BASE_URL` is not supplied, the command falls back to `PUBLIC_BASE_URL` and then `APP_BASE_URL`.

The live gate verifies:

1. the production base URL is HTTPS, except localhost during deliberate local testing;
2. `GET /api/health` returns HTTP 200;
3. health reports `status: "ok"`;
4. health reports `database: "ready"`;
5. health reports the active database backend;
6. durable database persistence is configured;
7. SQLite uses a configured persistent path when SQLite is the live backend, or Turso reports a complete runtime configuration when Turso is the live backend;
8. health exposes a non-empty release identifier;
9. when `EXPECTED_RELEASE` is supplied, the deployed release matches that Git commit prefix;
10. the public application shell is reachable;
11. the private Growth Operations API remains protected without a signed-in session and admin token.

The command prints a structured result and exits non-zero when a required launch check fails.

## Phase 11.2 — Production Configuration Evidence

ConferenceGate now has a dedicated GitHub Actions workflow:

```text
Live Production Validation
```

It runs after every push to `main` and can also be started manually. The workflow waits for Render to deploy the pushed commit, then runs the non-destructive live launch gate against:

```text
https://conferencegate.onrender.com
```

The workflow requires the deployed release to match the exact Git commit and captures safe production evidence from `/api/health`, including:

- active database backend;
- durable database persistence status;
- persistent SQLite-path status when applicable;
- Turso runtime status when applicable;
- release identifier;
- public application reachability;
- unauthenticated protection of the private Growth Operations API.

The first live Phase 11.2 validation passed on commit `81917b53f39d84c6588f4cd44d6f33255e38ff57` and confirmed:

- HTTP health status 200;
- `database: "ready"`;
- `databaseBackend: "turso"`;
- `databasePersistenceConfigured: true`;
- `tursoRuntimeConfigured: true`;
- deployed release matched the expected Git commit;
- the application shell returned HTTP 200;
- the unauthenticated private Growth Operations API returned HTTP 401.

Because Turso is the active production backend, legacy Turso-to-SQLite recovery is migration-only and is skipped unless an explicit `DATABASE_PATH` SQLite target is configured.

Before commercial launch, the deployed Render service must additionally show:

- the intended Organizer/Sponsor billing mode;
- a configured signed subscription webhook provider;
- `PUBLIC_BASE_URL` and `APP_BASE_URL`;
- production OAuth settings for any enabled identity provider;
- `DISCOVERY_ADMIN_TOKEN` for the private operator dashboard.

Run inside the production environment when shell access is available:

```text
npm run production:readiness:strict
```

This must report `ready: true`.

## Phase 11.3 — Identity & Profile Acceptance

Production verification must cover:

- normal email/password authentication;
- Google login when enabled;
- LinkedIn login when enabled;
- persisted LinkedIn profile photo and imported profile data after reload;
- no stale fallback portrait replacing the user's verified LinkedIn portrait;
- correct Professional/Organizer/Sponsor role behavior;
- owner-preview behavior remains isolated from normal customer accounts.

No production identity test should silently overwrite an existing customer's profile.

## Phase 11.4 — Organizer Commercial Journey

Using a controlled production test account or first-customer account, verify:

```text
signup → paid access → conference → sponsorship need → Sponsor inquiry → Deal Room
```

The Organizer journey must preserve workspace ownership, team-seat permissions, auditability, and conference/sponsorship data across reloads and deploys.

## Phase 11.5 — Sponsor Commercial Journey

Using a controlled production test account or first-customer account, verify:

```text
signup → paid access → preferences → opportunity match → saved opportunity → inquiry → Deal Room
```

The matching explanation must remain deterministic and based on stored Sponsor and conference criteria.

## Phase 11.6 — Payment Activation

Subscription billing and sponsorship settlement are separate launch gates.

For subscription billing:

- one Organizer Pro checkout;
- one Sponsor Pro checkout;
- signed provider webhook activates the correct ConferenceGate account;
- browser redirect alone never activates paid access.

For sponsorship settlement:

- keep the customer Payment Ledger hidden until the real sponsorship payment provider flow is deliberately activated;
- a Deal Room must become paid only from a verified payment event;
- settlement, refund, platform fee, and Organizer payout states remain distinct.

## Phase 11.7 — First Customer Cohort

The initial controlled launch target is:

- 10 Organizer accounts;
- 20–50 Sponsor accounts.

The private Growth Operations dashboard should track real movement through:

```text
member → paid → activated → marketplace exposure → inquiry → Deal Room → settled payment
```

No fabricated activity or hypothetical revenue should be counted.

## Phase 11.8 — Release Candidate Sign-off

A ConferenceGate release can be called commercially launch-ready only when all of the following are true:

- GitHub Application Validation is green on the release commit;
- Render is serving that same release;
- Live Production Validation passes against production;
- `npm run production:readiness:strict` reports `ready: true` in production;
- persistent database configuration has been confirmed;
- identity/profile acceptance is complete;
- Organizer and Sponsor production journeys are complete;
- billing/webhook activation is confirmed for the intended live provider;
- the first-customer cohort is enrolled;
- no critical launch-blocking defects remain open.

## Phase 11 status

- **Phase 11.1: complete.**
- **Phase 11.2: live production evidence passed; Turso persistence and release identity are verified. Startup hardening prevents obsolete Turso-to-SQLite recovery from running against the active production backend.**
- Phases 11.3–11.8 require controlled production evidence and must not be marked complete from repository CI alone.
