// End-to-end: the whole chain against the local fixture web.
//
// The unit suites prove each stage in isolation; this proves they are wired together — that a
// robots.txt refusal really stops a crawl, that a directory listing really merges into the
// conference's own record, that a concert really never reaches the database, and that a second
// pass over an unchanged site really does no work.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildFixtureSites, startFixtureWeb, type FixtureWeb } from "./fixtureWeb";

const urlGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);

let web: FixtureWeb;
let modules: {
  runDiscovery: typeof import("../pipeline").runDiscovery;
  dbAll: typeof import("../../db").dbAll;
  dbGet: typeof import("../../db").dbGet;
  resetDomainLimits: typeof import("../httpClient").resetDomainLimits;
  closeDb: typeof import("../../db").closeDb;
};
let testRoot: string;
const originalCwd = process.cwd();
let firstRun: Awaited<ReturnType<typeof import("../pipeline").runDiscovery>>;

before(async () => {
  // The dedicated test runner has already removed Turso credentials and selected a disposable
  // SQLite database. Keep a separate working directory for the fixture web's own scratch files.
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(process.env.TEST_DATABASE_PATH);
  assert.equal(process.env.TURSO_DATABASE_URL, undefined);
  assert.equal(process.env.TURSO_AUTH_TOKEN, undefined);
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-pipeline-"));
  process.chdir(testRoot);

  const { initDb, dbAll, dbGet, closeDb } = await import("../../db");
  const { initDiscoverySchema } = await import("../schema");
  const { upsertDomain } = await import("../sourceRegistry");
  const { runDiscovery } = await import("../pipeline");
  const { configureDomainLimits, resetDomainLimits } = await import("../httpClient");

  // A representative slice: a JSON-LD society, a plain-HTML publisher, the directory that
  // re-lists both, and the site that refuses to be crawled.
  const wanted = new Set(["socai", "pub", "directory", "closed"]);
  web = await startFixtureWeb(buildFixtureSites().filter((site) => wanted.has(site.key)));
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 8 });

  await initDb();
  await initDiscoverySchema();
  for (const site of web.sites) {
    await upsertDomain({
      domain: site.domain,
      sourceName: site.name,
      sourceType: site.sourceType,
      country: site.country,
      region: site.region,
    });
  }

  modules = { runDiscovery, dbAll, dbGet, resetDomainLimits, closeDb };
  firstRun = await runDiscovery({
    targetYears: [2026, 2027, 2028],
    domains: web.sites.map((site) => site.domain),
    maxPages: 200,
    maxCandidates: 2000,
    maxAiCalls: 0,
    scheme: "http",
    urlGuard,
    quiet: true,
    trigger: "test",
  });
});

after(async () => {
  await web?.stop();
  modules?.resetDomainLimits();
  modules?.closeDb();
  process.chdir(originalCwd);
  if (testRoot) fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("the run reads several domains and stores conferences from all of them", async () => {
  assert.ok(firstRun.created > 20, `expected a substantial number of conferences, got ${firstRun.created}`);
  const domains = await modules.dbAll<{ source_domain: string }>(
    "SELECT DISTINCT source_domain FROM discovery_events"
  );
  assert.ok(domains.length >= 2, "conferences come from more than one independent domain");
});

test("no model call is made when deterministic extraction is enough", () => {
  assert.equal(firstRun.aiCalls, 0);
  assert.ok((firstRun.extractionMethods.structured_data ?? 0) > 0);
  assert.ok((firstRun.extractionMethods.html ?? 0) > 0, "the plain-HTML site is read without structured data");
});

test("a site whose robots.txt disallows crawling is skipped, with the reason recorded", async () => {
  const closed = web.sites.find((site) => site.disallowAll)!;
  assert.ok(
    firstRun.skippedDomains.some((entry) => entry.domain === closed.domain && entry.reason === "robots_txt_disallows_crawling")
  );
  const fetched = await modules.dbAll<{ url: string }>("SELECT url FROM discovery_urls WHERE domain = ?", [closed.domain]);
  assert.equal(fetched.length, 0, "not one URL from a disallowed site is even queued");
});

test("a path robots.txt forbids is never fetched", async () => {
  const rows = await modules.dbAll<{ url: string }>("SELECT url FROM discovery_urls WHERE url LIKE '%members-only%'");
  assert.equal(rows.length, 0);
});

test("concerts, roundups and finished events are rejected rather than stored", async () => {
  assert.ok(firstRun.eventsRejected > 0);
  const concert = await modules.dbGet("SELECT id FROM discovery_events WHERE title LIKE '%Summer Nights Live%'");
  assert.equal(concert, undefined, "a music event is not a conference");
  const roundup = await modules.dbGet("SELECT id FROM discovery_events WHERE title LIKE '%Top 20 Conferences%'");
  assert.equal(roundup, undefined, "a roundup of conferences is not a conference");
  const past = await modules.dbGet("SELECT id FROM discovery_events WHERE title LIKE '%Coastal Resilience%'");
  assert.equal(past, undefined, "a 2019 event is not an upcoming conference");
  assert.ok(firstRun.rejectionReasons.classified_as_not_a_conference > 0);
  assert.equal(firstRun.rejectionReasons.event_already_finished || 0, 0, "obvious past sitemap URLs are filtered before fetch");
});

test("a directory listing joins the conference's own record instead of duplicating it", async () => {
  const directory = web.sites.find((site) => site.key === "directory")!;
  const shared = await modules.dbAll<{ event_id: string; sources: number }>(
    `SELECT event_id, COUNT(*) AS sources FROM discovery_event_sources GROUP BY event_id HAVING COUNT(*) > 1`
  );
  assert.ok(shared.length > 0, "at least one conference is known from more than one source");

  const fromDirectory = await modules.dbAll<{ event_id: string; source_url: string }>(
    "SELECT event_id, source_url FROM discovery_event_sources WHERE source_domain = ?",
    [directory.domain]
  );
  assert.ok(fromDirectory.length > 0, "the directory is recorded as a source");

  // The record's official URL must be the organiser's own site, not the directory page.
  for (const source of fromDirectory.slice(0, 5)) {
    const event = await modules.dbGet<{ official_url: string }>(
      "SELECT official_url FROM discovery_events WHERE id = ?",
      [source.event_id]
    );
    assert.ok(event?.official_url);
    assert.ok(
      !event!.official_url.startsWith(directory.origin),
      "a directory's own page is never presented as the conference's official website"
    );
  }
});

test("every stored value carries provenance", async () => {
  const event = await modules.dbGet<{ id: string; title: string }>(
    "SELECT id, title FROM discovery_events ORDER BY confidence_score DESC LIMIT 1"
  );
  assert.ok(event);
  const fields = await modules.dbAll<{ field: string; source_url: string; extraction_method: string; confidence: number }>(
    "SELECT field, source_url, extraction_method, confidence FROM discovery_event_fields WHERE event_id = ?",
    [event!.id]
  );
  assert.ok(fields.length >= 5, "the fields a page supplied are individually attributed");
  for (const field of fields) {
    assert.match(field.source_url, /^http/);
    assert.ok(["structured_data", "html", "ai", "derived", "manual"].includes(field.extraction_method));
    assert.ok(field.confidence > 0);
  }
});

test("nothing is auto-published in Phase 1", async () => {
  const published = await modules.dbGet<{ count: number }>(
    "SELECT COUNT(*) AS count FROM discovery_events WHERE status = 'published'"
  );
  assert.equal(Number(published?.count ?? 0), 0);
  const extracted = await modules.dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM extracted_conferences");
  assert.equal(Number(extracted?.count ?? 0), 0, "the app's own table is untouched unless publishing is enabled");
});

test("every needs_review event has an open review queue row", async () => {
  const missing = await modules.dbGet<{ count: number }>(
    `SELECT COUNT(*) AS count FROM discovery_events e
      WHERE e.status = 'needs_review'
        AND NOT EXISTS (SELECT 1 FROM discovery_review_queue q WHERE q.event_id = e.id AND q.status = 'open')`
  );
  assert.equal(Number(missing?.count ?? 0), 0);
});

test("dates, countries and formats are normalized on the way in", async () => {
  const rows = await modules.dbAll<{
    start_date: string | null;
    end_date: string | null;
    country: string | null;
    format: string;
    event_type: string;
  }>("SELECT start_date, end_date, country, format, event_type FROM discovery_events LIMIT 200");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    if (row.start_date) assert.match(row.start_date, /^\d{4}-\d{2}-\d{2}$/);
    if (row.start_date && row.end_date) assert.ok(row.end_date >= row.start_date);
    assert.ok(["in_person", "online", "hybrid", "unknown"].includes(row.format));
    assert.ok(row.event_type.length > 0);
  }
  const countries = new Set(rows.map((row) => row.country).filter(Boolean));
  assert.ok(countries.size >= 3, "several countries are represented");
  // "USA", "UK", "UAE" and "Republic of Korea" appear in the fixtures; none should survive raw.
  for (const country of countries) {
    assert.ok(!["USA", "UK", "UAE", "Republic of Korea"].includes(country!), `${country} was not normalized`);
  }
});

test("a second pass over an unchanged web does no work", async () => {
  const second = await modules.runDiscovery({
    targetYears: [2026, 2027, 2028],
    domains: web.sites.map((site) => site.domain),
    maxPages: 200,
    maxCandidates: 2000,
    maxAiCalls: 0,
    scheme: "http",
    urlGuard,
    quiet: true,
    trigger: "test-rerun",
  });
  assert.equal(second.created, 0, "nothing new is created from a web that has not changed");
  assert.equal(second.pagesFetched, 0, "every page answers 304 and is skipped");
  assert.ok(second.pagesUnchanged > 0);
});
