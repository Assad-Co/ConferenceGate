# Final historical deep cleanup: REMOVE only

This workflow deletes exactly the 514 decisions marked REMOVE in the approved stored-only
plan. It retains all 1,281 REVIEW decisions without reclassification. No enrichment, source
verification, AI, frontend, publication policy, cron or core conference changes occur.
The old `write` CLI command is disabled because old plan replacement payloads excluded REVIEW.

## 1. Durable backup, before cleanup

Run after deploying the controlled-cleanup commit, with the existing Turso configuration:

```sh
npx tsx server/discovery/deepCleanupCli.ts backup --plan /tmp/deep-cleanup-stored-plan.json --run historical-deep-514
```

This command asserts REMOVE=514, REVIEW=1281, KEEP=0, accepted inventory=1104,
61 populated conferences and 1795 counted items before any database writes. It verifies
stored values, provenance, identity and ownership against the approved input, without web
requests. It never uses the input plan's old replacement payloads.

Durable backup location: the existing remote Turso database, table
`discovery_deep_controlled_backup`, `run_id='historical-deep-514'`. It contains each removed
item's conference ID/title, section, original value, source/provenance, removal reason,
timestamp and cleanup run ID, plus complete original row/provenance snapshots and the
controlled plan. Backup commits before any cleanup. No persistent Render disk is required.
A backup failure prevents cleanup. The command is repeatable for the same approved plan.

The approved input file is required only for backup. If it disappeared during deployment,
do NOT recreate and immediately write. First recreate a dry-run:

```sh
npx tsx server/discovery/deepCleanupCli.ts dry-run --out /tmp/deep-cleanup-stored-plan.json --batch-size 50 --verify-sources 0 --resume 1
```

Stop and review its totals: exactly 514 REMOVE and 1281 REVIEW (plus the inventory totals
above). Only after confirming the recreated plan may the separate backup command run.
A differing plan cannot overwrite an existing durable run. No command automatically regenerates
missing input or silently accepts different counts.

## 2. Controlled cleanup

```sh
npx tsx server/discovery/deepCleanupCli.ts controlled-write --run historical-deep-514 --batch-size 10
```

This reads the durable backup, reasserts the exact counts, checks unchanged core/deep data,
and acquires the existing pipeline lease. Each conference and its corresponding eligible
published deep copies commit in one transaction with an audit inserted before updates.
Only original positions explicitly marked REMOVE are deleted; retained values and their
source associations are preserved. Divergent field provenance is handled independently.
Manual/app-owned sections remain protected. Batch fetches are bounded, checkpoints live in
Turso, and repeating the identical command resumes safely without double deletion.

A failed conference transaction rolls back that conference; completed transactions remain
checkpointed and restorable. Changed data fails closed. No schedule is changed: a busy pipeline
causes a retryable refusal. The command automatically runs the final verification when complete.

## 3. Independent verification

```sh
npx tsx server/discovery/deepCleanupCli.ts verify-cleanup --run historical-deep-514
```

Read-only audit compares every saved discovery, published and field-provenance row against
exact expected values. It fails on extra/missing rows, changed core fields, publication/readiness,
protected content or unexpected deep changes. It verifies completion of all checkpoints and
counts remaining items using the original plan's counting convention, including separate
published copies and originally divergent provenance. It reports each section's before,
removed and remaining totals and the actual remaining populated-conference count.

Expected: 514 targeted items removed, zero REVIEW intentionally removed, 1281 REVIEW remaining,
zero KEEP, 1281 counted deep items remaining, accepted inventory unchanged at 1104, AI calls zero.
The remaining populated-conference count may be below 61; the audit supplies the exact count.
Customer search architecture and hardened extraction rules are unchanged in this commit.

## 4. Restore

```sh
npx tsx server/discovery/deepCleanupCli.ts controlled-restore --run historical-deep-514
```

Restores exact original deep values and provenance from durable transactional audit backups,
including eligible published copies. Supports partial-run restoration and idempotent repeated
execution. Newer edits cause a refusal instead of being overwritten. Full original row equality
is checked after restoration. The backup does not expire or depend on `/tmp`.

All production commands above are operator-run. Automated tests use an isolated local database.
