import assert from "node:assert/strict";
import test from "node:test";
import { classifyPublishReadiness, decideEvidence } from "../enrichment";
import { dbAll } from "../../db";
import { initDiscoverySchema } from "../schema";

test("Phase 1.4 schema is additive and exposes readiness plus append-only history", async () => {
  await initDiscoverySchema();
  const columns = await dbAll<{ name: string }>("PRAGMA table_info(discovery_events)");
  assert.ok(columns.some((column) => column.name === "publish_readiness"));
  assert.ok(columns.some((column) => column.name === "readiness_reasons"));
  const tables = await dbAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
  assert.ok(tables.some((table) => table.name === "discovery_event_field_history"));
  assert.ok(tables.some((table) => table.name === "discovery_enrichment_runs"));
  assert.ok(tables.some((table) => table.name === "discovery_publication_audits"));
  assert.ok(tables.some((table) => table.name === "discovery_scale_runs"));
  assert.ok(tables.some((table) => table.name === "discovery_scale_batches"));
});

test("directory or other lower-trust evidence never overwrites an authoritative value", () => {
  assert.deepEqual(decideEvidence({
    currentValue: "https://official.example/event",
    incomingValue: "https://directory.example/listing",
    currentAuthority: 0.95,
    incomingAuthority: 0.5,
    sameSource: false,
  }), { decision: "keep_existing", reason: "lower-trust evidence cannot replace a stored value" });
});

test("a newly fetched authoritative page supersedes its own stale stored date", () => {
  assert.equal(decideEvidence({
    currentValue: "2027-05-10",
    incomingValue: "2027-05-17",
    currentAuthority: 0.9,
    incomingAuthority: 0.9,
    sameSource: true,
  }).decision, "supersede");
});

test("higher-authority evidence supersedes a conflicting directory value", () => {
  assert.equal(decideEvidence({
    currentValue: "2027-05-10",
    incomingValue: "2027-05-17",
    currentAuthority: 0.5,
    incomingAuthority: 0.9,
    sameSource: false,
  }).decision, "supersede");
});

test("publish_ready requires every independently verified minimum", () => {
  const ready = classifyPublishReadiness({
    titleVerified: true,
    startDate: "2027-06-10",
    startDateVerified: true,
    countryVerified: true,
    explicitlyOnline: false,
    formatVerified: false,
    officialSourceVerified: true,
    openReview: false,
    unresolvedConflict: false,
    now: new Date("2026-09-03T00:00:00Z"),
  });
  assert.deepEqual(ready, { readiness: "publish_ready", reasons: [] });
});

test("unresolved conflicts and open reviews force needs_review", () => {
  const result = classifyPublishReadiness({
    titleVerified: true,
    startDate: "2027-06-10",
    startDateVerified: true,
    countryVerified: true,
    explicitlyOnline: false,
    formatVerified: false,
    officialSourceVerified: true,
    openReview: false,
    unresolvedConflict: true,
    now: new Date("2026-09-03T00:00:00Z"),
  });
  assert.equal(result.readiness, "needs_review");
  assert.ok(result.reasons.includes("unresolved_authoritative_conflict"));
});

test("verified online format may replace country for an online-only conference", () => {
  assert.equal(classifyPublishReadiness({
    titleVerified: true,
    startDate: "2027-06-10",
    startDateVerified: true,
    countryVerified: false,
    explicitlyOnline: true,
    formatVerified: true,
    officialSourceVerified: true,
    openReview: false,
    unresolvedConflict: false,
    now: new Date("2026-09-03T00:00:00Z"),
  }).readiness, "publish_ready");
});
