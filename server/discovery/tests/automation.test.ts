import assert from "node:assert/strict";
import test from "node:test";
import { dbGet, dbRun } from "../../db";
import {
  acquireOrRecoverPipelineLease,
  acquirePipelineLease,
  automationPublicationEnabled,
  nextScheduledAt,
  readPipelineLock,
  releasePipelineLease,
  releaseStalePipelineLock,
} from "../automation";
import { buildOperationalStatus } from "../operations";
import { initDiscoverySchema } from "../schema";

test("automation schema is additive and contains durable operations tables", async () => {
  await initDiscoverySchema();
  const expected = [
    "discovery_pipeline_locks",
    "discovery_automation_runs",
    "discovery_automation_state",
    "discovery_quality_checkpoints",
    "discovery_daily_reports",
  ];
  for (const name of expected) {
    assert.ok(await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]));
  }
});

test("only one worker owns the production lease and a stale lease is recoverable", async () => {
  await initDiscoverySchema();
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name='production_data_pipeline'");
  const first = await acquirePipelineLease("worker-a", 15);
  const blocked = await acquirePipelineLease("worker-b", 15);
  assert.equal(first.acquired, true);
  assert.equal(blocked.acquired, false);

  await dbRun("UPDATE discovery_pipeline_locks SET lease_expires_at=? WHERE name='production_data_pipeline'", [
    "2000-01-01T00:00:00.000Z",
  ]);
  const recovered = await acquirePipelineLease("worker-b", 15);
  assert.equal(recovered.acquired, true);
  await releasePipelineLease("worker-b");
});

test("a lease that is still heartbeating is never released, however long it has been held", async () => {
  await initDiscoverySchema();
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name='production_data_pipeline'");
  await acquirePipelineLease("worker-live", 90);

  const status = await readPipelineLock();
  assert.equal(status.verdict, "live");
  const outcome = await releaseStalePipelineLock();
  assert.equal(outcome.released, false);
  assert.equal(outcome.reason, "holder_is_alive");
  // The point of the refusal: the holder still owns it, so a second enrichment cannot start.
  assert.equal((await readPipelineLock()).ownerId, "worker-live");
  await releasePipelineLease("worker-live");
});

test("a lease whose holder stopped heartbeating is released, and reports why", async () => {
  await initDiscoverySchema();
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name='production_data_pipeline'");
  await acquirePipelineLease("worker-killed", 90);
  // What a redeploy leaves behind: the lease has 90 minutes left to run, but nothing is alive to
  // heartbeat it. Eight missed beats.
  await dbRun(`UPDATE discovery_pipeline_locks SET heartbeat_at=datetime('now','-9 minutes')
    WHERE name='production_data_pipeline'`);

  const status = await readPipelineLock();
  assert.equal(status.verdict, "stale");
  assert.ok((status.secondsSinceHeartbeat ?? 0) > 300);
  assert.ok(Date.parse(status.leaseExpiresAt!) > Date.now(), "lease has not expired on its own");

  const outcome = await releaseStalePipelineLock();
  assert.equal(outcome.released, true);
  assert.equal(outcome.reason, "released");
  assert.equal((await readPipelineLock()).held, false);
  // And the lock is genuinely available again, not merely reported as free.
  assert.equal((await acquirePipelineLease("worker-next", 15)).acquired, true);
  await releasePipelineLease("worker-next");
});

test("releasing a stale lease does not disturb a lease a new owner has since taken", async () => {
  await initDiscoverySchema();
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name='production_data_pipeline'");
  assert.equal((await releaseStalePipelineLock()).reason, "nothing_held");

  await acquirePipelineLease("worker-fresh", 90);
  const held = await readPipelineLock();
  assert.equal(held.ownerId, "worker-fresh");
  assert.equal(held.verdict, "live");
  await releasePipelineLease("worker-fresh");
});

test("a cycle recovers a lease a killed run abandoned, instead of standing down for 90 minutes", async () => {
  await initDiscoverySchema();
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name='production_data_pipeline'");
  // Exactly what a redeploy leaves: the lease has most of its 90 minutes left to run, and nothing
  // is alive to heartbeat it. Until this, every cycle — including one triggered by hand — returned
  // another_worker_active in seconds and did no work at all.
  await acquirePipelineLease("worker-killed-by-deploy", 90);
  await dbRun(`UPDATE discovery_pipeline_locks SET heartbeat_at=datetime('now','-11 minutes')
    WHERE name='production_data_pipeline'`);

  const lease = await acquireOrRecoverPipelineLease("worker-next-cycle", 90);
  assert.equal(lease.acquired, true, "the abandoned lease was cleared and the cycle proceeded");
  assert.equal((await readPipelineLock()).ownerId, "worker-next-cycle");
  await releasePipelineLease("worker-next-cycle");
});

test("a cycle still stands down for a worker that is genuinely running", async () => {
  await initDiscoverySchema();
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name='production_data_pipeline'");
  // The guard this recovery must not weaken: two enrichment passes over the same records at once.
  await acquirePipelineLease("worker-alive", 90);

  const lease = await acquireOrRecoverPipelineLease("worker-intruder", 90);
  assert.equal(lease.acquired, false);
  assert.equal((await readPipelineLock()).ownerId, "worker-alive", "the live holder kept its lease");
  await releasePipelineLease("worker-alive");
});

test("automation publication has a separate exact permit and unrestricted publishing is not implied", () => {
  assert.equal(automationPublicationEnabled({ CONFERENCEGATE_AUTOMATION_PUBLICATION: "1" }), true);
  assert.equal(automationPublicationEnabled({ CONFERENCEGATE_AUTOMATION_PUBLICATION: "true" }), false);
  assert.equal(automationPublicationEnabled({ DISCOVERY_PUBLISH_TO_CONFERENCES: "1" }), false);
});

test("the next scheduled time follows the configured bounded cadence", () => {
  assert.equal(nextScheduledAt(new Date("2027-01-01T00:20:00.000Z"), 4), "2027-01-01T04:17:00.000Z");
});

test("private operational status reports lock and target progress without secrets", async () => {
  await initDiscoverySchema();
  const status = await buildOperationalStatus();
  assert.equal(status.progress.acceptedTarget, 5_000);
  assert.equal(status.progress.publishedTarget, 1_000);
  assert.equal(status.safeguards.aiCallsAllowedPerAutomationRun, 0);
  assert.equal(status.safeguards.customerSearchMode, "stored_published_records_only");
  assert.equal(JSON.stringify(status).includes("TURSO_AUTH_TOKEN"), false);
});
