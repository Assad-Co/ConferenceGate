# Deep-section cleanup

This is an operator-invoked backend maintenance tool. It does not run at startup or on cron.
AI, paid readers and search providers are never used. The existing pipeline lease excludes
discovery/enrichment/publication workers during write and restore. Core fields, readiness,
publication state, permits and customer routes are never updated.

## First: dry-run only, on the Render worker

```sh
npx tsx server/discovery/deepCleanupCli.ts dry-run --out /tmp/deep-cleanup-stored-plan.json --batch-size 50 --verify-sources 0 --resume 1
```

Requires the worker's existing `TURSO_DATABASE_URL` and auth configuration. There is no local
database fallback. This separate entry point never calls the normal schema initializer, takes
no database lock and executes only SELECTs. It first selects conferences with nonempty deep
data, including active field provenance and linked discovery-owned published copies. Empty
conferences are skipped immediately. The full accepted inventory is retained as a manifest,
but only conferences with stored data are scanned. This is not an enrichment pass.

Default mode uses stored values and provenance only: **zero source-page requests**. Existing
deterministic identity, boilerplate and item rules remain unchanged. Items that require fresh
source evidence are REVIEW (`source_verification_not_requested`), never assumed to be KEEP.
As before, REVIEW removals are only proposals; do not approve them without inspecting the plan.

Optional `--verify-sources 1` verifies only the exact URLs attached to stored data, using the
existing SSRF/redirect guard, robots policy and rate-limited HTTP reader. It never follows
section links, refills empty sections, substitutes another URL, uses a paid fallback or AI.
Default deadlines are `--record-timeout-ms 15000 --network-timeout-ms 5000`; caps are 60 seconds
per record and the record deadline per network read. Timeout produces REVIEW and processing
continues. Requests receive cancellation signals. Database batch reads have a 30-second deadline;
a database outage exits nonzero and retains completed local checkpoints.

The command prints counts, representative decisions with IDs/titles/source URLs, the SHA-256
of the complete plan, and the proposed run ID. The JSON file contains every conference and every
item decision, full before/after section payloads, current provenance and proposed replacements.
It includes active provenance values that differ from the conference column. Counts include
separate stored copies in discovery, published records and divergent field provenance.

Progress prints `Scanned N/XX conferences with deep data` and running KEEP/REMOVE/REVIEW totals.
The final summary distinguishes total accepted inventory, deep-data inventory and actual scans,
and prints `PRODUCTION ROWS MODIFIED: 0` only after successfully creating the completed plan.

Progress is atomically checkpointed locally after every conference, by default at
`/tmp/deep-cleanup-stored-plan.json.checkpoint.json`. Repeat the exact command to resume;
completed records are checked for changed stored data and never re-fetched or double-counted.
An unchanged completed rerun returns the same plan/hash without rewriting it. Inventory,
options, rules or completed-record changes require a fresh checkpoint/output path.
Use `--checkpoint PATH` for a different location, or `--max-records 50` to pause after 50 new
records. A deliberate pause exits nonzero with a resume message and no misleading final plan.

Download and retain the plan and checkpoint before a container restart: `/tmp` is ephemeral.
For automatic recovery across container replacements, choose an existing persistent-disk path
with `--checkpoint`; this tool does not configure a disk or change cron. The files are sensitive
operational data and must not be published on a public endpoint. Dry-run refuses to overwrite
a different existing plan. Use a different output filename for another run. It has no database
checkpoint or partial database writes.

Inspect **REMOVE and REVIEW**, replacement data, and `summary.protected`. REVIEW items with
uncertain source/precision are proposed for removal. Explicit manual sections, mixed manual
items and published sections whose discovery ownership cannot be established are protected and
listed as exceptions. A divergent published section is not assumed to be discovery-owned just
because the containing record originated in discovery. Such exceptions prevent an unconditional
claim that all stored data is clean; resolve ownership separately and rerun the dry-run.

Empty sections are not rebuilt by this cleanup dry-run. `--refill-pages` may only be zero.
Any later enrichment remains a separate action. With optional source verification, all retained
properties must still be supported by the unchanged hardened extraction and identity rules.
Per-item provenance is stored on objects; primitive tracks/community values use an `item_sources`
map keyed by the item's path. Empty sections remain optional enrichment.

## Write only after review and explicit approval

Substitute the exact SHA-256 printed by the reviewed dry-run; restore the unchanged plan file
at the specified path if Render restarted. Do not regenerate a different file under an old hash.

```sh
npx tsx server/discovery/deepCleanupCli.ts write --plan /tmp/deep-cleanup-stored-plan.json --approve REVIEWED_SHA256 --batch-size 50
```

The hash is an explicit operator acknowledgement, not an authentication mechanism. Use only
trusted plans generated by this command. A changed validator requires a new plan. No network
reads occur in write mode: it applies exactly what was reviewed. If the inventory, event identity,
deep payload or provenance changed, it fails closed rather than overwrite newer data.

Write first backs up the entire plan in Turso in bounded batches. Every conference then has a
short transaction: verify the lease and current values, insert its full audit backup, update
only deep columns and active deep provenance, and advance its checkpoint atomically. Backup
failure means no removal. The audit retains complete item JSON, exact source URLs, reasons,
timestamps, and before/after provenance; it is not the truncated normal change log.

Repeat the same write command to resume after a restart or failure. Completed conferences are
not reapplied. Optional `--max-events 50` stops at a checkpoint after 50 conferences; subsequent
invocations resume. A busy pipeline worker causes a safe refusal; retry when its lease is free.
No worker is stopped and no schedule is changed. Ownership/identity conflicts require a fresh
review plan; the already completed audit remains available for restore.

## Restore

Use `proposedRunId` from the dry-run or `runId` from write output:

```sh
npx tsx server/discovery/deepCleanupCli.ts restore --run CLEANUP_RUN_ID
```

Restore needs only the durable Turso audit/checkpoints, not the local plan file. It restores
exact section bytes and provenance per conference, verifies the complete backup is present,
and refuses to overwrite later changes or records no longer accepted. It leaves core fields
untouched, is resumable with the same command, and retains all audit records. Optional
`--max-events 50` bounds a restore invocation. A restored plan cannot be reapplied; generate
and review a new dry-run.

## Verification

```sh
npm run test:discovery
npm run lint
```

Tests use isolated local databases with production credentials stripped. They cover all five
real sections, cross-event/platform/wrong-year rejection, missing evidence, fresh refill,
read-only dry-run enforcement, audit failure and ordering, published/manual protection,
checkpoint resume, idempotence, concurrent changes, orphaned provenance and restore.

This implementation does not certify live production contents. That requires reviewing the
production dry-run, authorizing and completing write mode, and checking any ownership exceptions.
