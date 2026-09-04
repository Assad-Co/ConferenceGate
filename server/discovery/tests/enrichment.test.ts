import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { classifyPublishReadiness, decideEvidence } from "../enrichment";
import { dbAll } from "../../db";
import { initDiscoverySchema } from "../schema";
import { canonicalizeUrl, normalizeNavigableUrl } from "../normalize";
import { classifySource, isEligibleOfficialSource, sourceAuthorityBlockReasons } from "../sourceClassification";

const execFileAsync = promisify(execFile);

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
  assert.ok(tables.some((table) => table.name === "discovery_url_remediation_runs"));
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
    officialUrlAbsolute: true,
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
    officialUrlAbsolute: true,
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
    officialUrlAbsolute: true,
    openReview: false,
    unresolvedConflict: false,
    now: new Date("2026-09-03T00:00:00Z"),
  }).readiness, "publish_ready");
});

test("scheme-less official URLs can never be publish_ready while canonical identity still ignores scheme", () => {
  assert.equal(normalizeNavigableUrl("conference.example/2027"), null);
  assert.equal(canonicalizeUrl("https://conference.example/2027"), canonicalizeUrl("http://conference.example/2027"));
  const result = classifyPublishReadiness({
    titleVerified: true, startDate: "2028-06-10", startDateVerified: true, countryVerified: true,
    explicitlyOnline: false, formatVerified: false, officialSourceVerified: true, officialUrlAbsolute: false,
    openReview: false, unresolvedConflict: false, now: new Date("2026-09-03T00:00:00Z"),
  });
  assert.equal(result.readiness, "needs_enrichment");
  assert.ok(result.reasons.includes("official_url_not_absolute"));
});

test("structural authority rules reject directories, roundups, generic collections and third-party calendars", () => {
  assert.ok(sourceAuthorityBlockReasons({ pageUrl: "https://mainevent.info/international-conference-123", title: "Research Conference" }).includes("directory_source"));
  assert.ok(sourceAuthorityBlockReasons({ pageUrl: "https://publisher.example/higher-education-conferences-to-watch", title: "Top Higher Education Conferences to Put on Your Radar" }).includes("roundup_or_list_title"));
  for (const url of ["https://example.test/countries", "https://example.test/topics/ai", "https://example.test/category/science", "https://example.test/search?q=events"]) {
    assert.ok(sourceAuthorityBlockReasons({ pageUrl: url, title: "Science Conference" }).includes("generic_collection_page"));
  }
  assert.ok(sourceAuthorityBlockReasons({ pageUrl: "https://vendor.example/events-calendar/real-conference-2028", title: "Real Conference 2028" }).includes("third_party_calendar"));
});

test("a valid organizer-owned individual conference URL remains eligible", () => {
  const pageUrl = "https://futuretechsummit.example/2028";
  const result = classifySource({ pageUrl, organizerUrl: "https://futuretechsummit.example/about",
    title: "Future Tech Summit 2028", pageText: "Registration programme agenda venue" });
  assert.equal(isEligibleOfficialSource({ pageUrl, organizerUrl: "https://futuretechsummit.example/about",
    title: "Future Tech Summit 2028", classification: result.classification, confidence: result.confidence }), true);
});

test("URL remediation restores authoritative provenance, preserves history, and downgrades unsupported authority", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conferencegate-remediation-"));
  const database = path.join(root, "scenario.sqlite");
  try {
    const { stdout } = await execFileAsync(process.execPath,
      ["--import", "tsx", "server/discovery/tests/remediationScenario.ts"], {
        cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", TEST_DATABASE_PATH: database,
          TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", DISCOVERY_PUBLISH_TO_CONFERENCES: "0" },
      });
    assert.match(stdout, /REMEDIATION_SCENARIO_PASS/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
