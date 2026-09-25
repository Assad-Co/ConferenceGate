# Render Database Configuration

ConferenceGate supports two durable production database modes. **Turso is the preferred Render runtime**
when the existing production Turso database contains the authoritative users and ConferenceGate data.
Persistent SQLite remains available as a fallback.

## Target architecture

### Recommended: Turso

- Database engine: libSQL/Turso through `@libsql/client`
- Runtime:
  - `TURSO_DATABASE_URL=libsql://...`
  - `TURSO_AUTH_TOKEN=...`
- No Render persistent disk is required for database durability.
- When `TURSO_DATABASE_URL` is configured, Turso takes precedence over `DATABASE_PATH`.

### Alternative: persistent SQLite

- Render persistent disk mount: `/var/data`
- Database file: `/var/data/conferencegate.db`
- Runtime:
  - `DATABASE_PATH=/var/data/conferencegate.db`

The existing ConferenceGate SQL is SQLite-native, so both modes use the same schema and query layer.

## Render setup

For the existing production account/data in Turso:

1. Add `TURSO_DATABASE_URL` to the Render web service.
2. Add the matching `TURSO_AUTH_TOKEN`.
3. Set a stable `JWT_SECRET`.
4. `DATABASE_PATH` may be left unset when Turso is active.
5. Redeploy the latest `main` commit.
6. Verify `GET /api/health` reports `databaseBackend: "turso"`,
   `databasePersistenceConfigured: true`, and `tursoRuntimeConfigured: true`.

Use persistent SQLite only when intentionally running production from a Render disk.

## Existing scripts

Some older maintenance scripts still open `data/app.db` directly. The production start command runs `scripts/prepareLocalDatabase.mjs`, which links `data/app.db` to `DATABASE_PATH` when a separate path is configured. This keeps the web server and legacy maintenance jobs on the same SQLite file.

## Turso recovery / migration to SQLite

When Turso is reachable and contains the authoritative production data, ConferenceGate can use it directly
as the runtime database; no copy step is required.

If you intentionally want to migrate those rows into persistent SQLite instead, run this from a trusted shell with the persistent Render disk mounted:

```bash
DATABASE_PATH=/var/data/conferencegate.db \
TURSO_DATABASE_URL='...' \
TURSO_AUTH_TOKEN='...' \
npm run database:migrate-from-turso
```

The recovery command:

- reads all non-internal SQLite tables from Turso;
- creates missing tables in the destination;
- copies rows into the persistent SQLite file;
- refuses to merge into a destination that already contains users unless `MIGRATION_MERGE=1` is explicitly supplied.

Run recovery before creating replacement production accounts whenever possible.

## Verification

After deployment:

```text
GET /api/health
```

must report:

- `status: "ok"`
- `database: "ready"`
- `databaseBackend: "turso"` when Turso is configured, otherwise `"sqlite"`
- `databasePersistenceConfigured: true`
- `tursoRuntimeConfigured: true` when Turso is the runtime backend
- the expected release SHA prefix

Then run:

```bash
npm run production:readiness:strict
```

It must report `ready: true`.

## Owner preview

The owner-preview path remains independent of billing. Once the owner account exists in the new persistent SQLite database, normal authentication is still required, but Sponsor/Organizer preview access does not require a subscription.


## Recover one legacy Professional profile into an existing owner account

If a replacement SQLite owner account was created before the original Professional account was
recovered, do **not** create a second user and do not replace the current password/billing/workspace
state.

Use the dedicated email-matched recovery command:

```bash
DATABASE_PATH=/var/data/conferencegate.db \
TURSO_DATABASE_URL='...' \
TURSO_AUTH_TOKEN='...' \
LEGACY_PROFILE_EMAIL='owner@example.com' \
npm run database:restore-legacy-professional
```

The command is **dry-run by default**. It reports which legacy profile fields and Professional
activity rows would be restored.

After reviewing the output, apply it explicitly:

```bash
DATABASE_PATH=/var/data/conferencegate.db \
TURSO_DATABASE_URL='...' \
TURSO_AUTH_TOKEN='...' \
LEGACY_PROFILE_EMAIL='owner@example.com' \
LEGACY_PROFILE_APPLY=1 \
npm run database:restore-legacy-professional
```

The recovery restores the legacy account as the **real Professional primary identity** while
preserving owner-preview access, subscription fields, billing state, and current SQLite
workspaces. It restores Professional-facing identity/profile fields (including avatar when
present), LinkedIn profile enrichment, publication matches, self-reported conference history,
registrations, Professional opportunity interests/invitations, and reviewer activity where
those legacy tables exist.

By default the current SQLite password is preserved. If the Turso legacy row still contains the
original Professional password hash and you explicitly want the old credentials restored, add:

```bash
LEGACY_PROFILE_RESTORE_PASSWORD=1
```

together with `LEGACY_PROFILE_APPLY=1`. This credential restoration is opt-in; it is never done
implicitly.
