import assert from "node:assert/strict";
import test from "node:test";
import { dbGet, dbRun } from "../../db";
import {
  acquirePipelineLease,
  automationPublicationEnabled,
  nextScheduledAt,
  releasePipelineLease,
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
