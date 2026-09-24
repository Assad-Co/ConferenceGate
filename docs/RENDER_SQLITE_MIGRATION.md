# Render Persistent SQLite Migration

ConferenceGate no longer requires Turso for normal production operation.

## Target architecture

- Database engine: SQLite through `@libsql/client`
- Render persistent disk mount: `/var/data`
- Database file: `/var/data/conferencegate.db`
- Runtime:
  - `DATABASE_BACKEND=sqlite`
  - `DATABASE_PATH=/var/data/conferencegate.db`
- Turso variables are not required for startup and should be removed after any recovery import is complete.

The existing ConferenceGate SQL is SQLite-native, so this avoids a risky PostgreSQL dialect rewrite.

## Render setup

In the existing ConferenceGate web service:

1. Open **Disk**.
2. Add a persistent disk.
3. Mount path: `/var/data`.
4. Use the smallest practical size to start.
5. Add/update environment variables:
   - `DATABASE_BACKEND=sqlite`
   - `DATABASE_PATH=/var/data/conferencegate.db`
6. Remove `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` after any optional recovery attempt.
7. Redeploy the latest `main` commit.

Render persistent disks are available only on paid-compatible service plans. Without a persistent disk, SQLite still starts, but the database file can be lost on a restart or redeploy.

## Existing scripts

Some older maintenance scripts still open `data/app.db` directly. The production start command runs `scripts/prepareLocalDatabase.mjs`, which links `data/app.db` to `DATABASE_PATH` when a separate path is configured. This keeps the web server and legacy maintenance jobs on the same SQLite file.

## Turso recovery

The existing Turso database is currently blocked from reads, so ConferenceGate must not depend on it to boot.

If Turso access is temporarily restored later and old production rows need to be recovered, run this from a trusted shell with the persistent Render disk mounted:

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
- `databaseBackend: "sqlite"`
- `databasePersistentPathConfigured: true`
- the expected release SHA prefix

Then run:

```bash
npm run production:readiness:strict
```

It must report `ready: true`.

## Owner preview

The owner-preview path remains independent of billing. Once the owner account exists in the new persistent SQLite database, normal authentication is still required, but Sponsor/Organizer preview access does not require a subscription.
