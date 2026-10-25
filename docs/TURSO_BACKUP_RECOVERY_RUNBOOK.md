# ConferenceGate Turso backup and recovery runbook

## Scope
Professional accounts remain free. Paid organizer and sponsor launch stays gated.
Production runs on Turso; Render deploys do not constitute database backups.

## Non-destructive checks
1. In GitHub Actions, run **Turso Recovery Readiness (Read Only)** after configuring `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as repository Actions secrets with minimum necessary access.
2. Confirm database integrity and foreign key checks pass. The workflow does not download or print personal records.
3. Verify Turso's configured point-in-time recovery/backup capability and retention in the Turso dashboard. Do not assume the plan supports any particular retention window.

## Restore rehearsal — isolated database only
1. Create a fresh, isolated Turso database for a restore rehearsal. Never overwrite production.
2. Take a current production backup or recovery point using Turso's supported dashboard/CLI procedures; note the timestamp and retention.
3. Restore the selected recovery point into the isolated database using Turso's documented restore workflow. Verify the destination identity twice.
4. Run `TURSO_DATABASE_URL=<isolated URL> TURSO_AUTH_TOKEN=<isolated token> node scripts/verifyTursoRecovery.mjs` against the isolated copy.
5. Compare table counts and representative non-sensitive checksums using a privileged, private process. Confirm login and conference data integrity without sending personal data to CI logs.
6. Record RPO (latest recoverable timestamp), RTO (time to restore), operator, backup timestamp, and verification outcome in a private operational log.
7. Delete the rehearsal database only after authorized sign-off, following data retention requirements.

## Emergency
Pause writes and new signups, record the incident time, preserve evidence, identify the latest verified recovery point, restore to a **new** database, validate, and only then change the production connection after explicit approval. Do not run the legacy migration directly against a populated destination.

**Status:** Recovery remains unverified until an isolated restore rehearsal succeeds. A passing integrity check is not a backup.
