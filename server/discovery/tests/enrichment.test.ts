import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { classifyPublishReadiness, decideEvidence, runEnrichment } from "../enrichment";
import { dbAll, dbGet, dbRun } from "../../db";
import { initDiscoverySchema } from "../schema";
import { canonicalizeUrl, normalizeNavigableUrl } from "../normalize";
import {
  classifySource, isEligibleOfficialSource, isPlausibleEventTitle,
  sourceAuthorityBlockReasons, titleEvidenceScore,
} from "../sourceClassification";

const execFileAsync = promisify(execFile);


test("a deep-section pass asks only for records that hold a page it could read", async () => {
  await initDiscoverySchema();
  // Reproduces the production shape exactly: a real conference with a website sitting behind a
  // directory listing page that was stored as an event and has no website at all. The listing
  // sorts first on every ordering the queue uses, so without the filter it takes the whole budget
  // and the pass reads nothing.
  const withSite = "dev_test_withsite";
  const listing = "dev_test_listing";
  const ids = [withSite, listing];
  for (const [id, title, official] of [
    [withSite, "International Conference on Applied Geophysics 2027", "https://example.org/icag2027"],
    [listing, "Conferences in UAE 2026/2027/2028", null],
  ] as Array<[string, string, string | null]>) {
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,start_year,official_url,source_url,source_domain,status,extraction_method)
      VALUES (?,?,?,?,?,?,?,'validated','derived')`,
      [id, title, title.toLowerCase(), 2027, official, "https://example.org/source", "example.org"]);
  }

  try {
    const report = await runEnrichment({
      limit: 200,
      // Nothing may be fetched, searched or read: this test is about which records are asked for.
      urlGuard: async () => false,
      maxSearchQueries: 0,
      maxJinaPages: 0,
      maxDeepPagesPerEvent: 0,
      missingDeepSectionsOnly: true,
      requireOfficialUrl: true,
      trace: true,
      quiet: true,
    });
    const examined = new Set((report.deepTrace || []).map((entry) => entry.eventId));
    assert.ok(examined.has(withSite), "a record with a website is worked");
    assert.equal(examined.has(listing), false, "a record with no website cannot yield deep sections");
    // And every record the pass did ask for has something to read, which is the property that
    // makes the budget meaningful rather than merely smaller.
    for (const entry of report.deepTrace || []) {
      const row = await dbGet<{ official_url: string | null }>(
        "SELECT official_url FROM discovery_events WHERE id=?", [entry.eventId]);
      assert.ok(row?.official_url && row.official_url.trim() !== "",
        `${entry.eventId} was asked for without an official URL`);
    }
  } finally {
    for (const id of ids) await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
  }
});

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
  assert.ok(tables.some((table) => table.name === "discovery_automation_runs"));
  assert.ok(tables.some((table) => table.name === "discovery_pipeline_locks"));
});

test("an open review makes and keeps publish_ready impossible at the database boundary", async () => {
  const eventId = `trigger-review-${Date.now()}-${Math.random()}`;
  await dbRun(`INSERT INTO discovery_events
    (id,title,normalized_title,extraction_method,source_url,source_domain,publish_readiness)
    VALUES (?,?,?,?,?,?,?)`, [eventId, "Trigger Safety Conference 2028", "trigger safety conference 2028",
      "html", "https://official.example/2028", "official.example", "publish_ready"]);
  await dbRun(`INSERT INTO discovery_review_queue (id,event_id,reason,status) VALUES (?,?,?,'open')`,
    [`review-${eventId}`, eventId, "material_validation_conflict"]);
  let row = await dbGet<{ publish_readiness: string; readiness_reasons: string }>(
    `SELECT publish_readiness,readiness_reasons FROM discovery_events WHERE id=?`, [eventId]);
  assert.equal(row?.publish_readiness, "needs_review");
  assert.ok(JSON.parse(row?.readiness_reasons || "[]").includes("open_review"));
  await dbRun(`UPDATE discovery_events SET publish_readiness='publish_ready',readiness_reasons='[]' WHERE id=?`, [eventId]);
  row = await dbGet(`SELECT publish_readiness,readiness_reasons FROM discovery_events WHERE id=?`, [eventId]);
  assert.equal(row?.publish_readiness, "needs_review");
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
  assert.ok(sourceAuthorityBlockReasons({ pageUrl: "https://example.test/calendar-of-conferences-in-australia", title: "Calendar of conferences in Australia and New Zealand" }).includes("generic_collection_page"));
  assert.ok(sourceAuthorityBlockReasons({ pageUrl: "https://conferencesked.com/conferences/ai-conferences-2027", title: "AI conferences 2027" }).includes("directory_source"));
  assert.ok(sourceAuthorityBlockReasons({ pageUrl: "https://example.test/events", title: "https://example.test/events" }).includes("malformed_event_title"));
});

test("title evidence permits an authoritative short title but rejects unrelated or URL-shaped titles", () => {
  assert.equal(isPlausibleEventTitle("conferencesked.com/conferences/ai-conferences-2027"), false);
  assert.equal(isPlausibleEventTitle("CPEEE 2026"), true);
  assert.equal(titleEvidenceScore("CPEEE 2026", "CPEEE 2026"), 1);
  assert.equal(titleEvidenceScore("2027 Ocean Decade Conference — GEO Blue Planet", "2027 Ocean Decade Conference"), 1);
  assert.equal(titleEvidenceScore("Australian Energy Week 2027", "International Dental Congress 2027"), 0);
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
      ["--import", "data:text/javascript,if(!process.geteuid)process.geteuid=()=>0",
        "--import", "tsx", "server/discovery/tests/remediationScenario.ts"], {
        cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", TEST_DATABASE_PATH: database,
          TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", DISCOVERY_PUBLISH_TO_CONFERENCES: "0" },
      });
    assert.match(stdout, /REMEDIATION_SCENARIO_PASS/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

