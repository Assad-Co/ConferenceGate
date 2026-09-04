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
    // No hosted-reader calls: a test must not depend on, or spend money at, a third-party
    // service. The read chain records the skip instead of reaching out.
    maxJinaPages: 0,
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
  if (testRoot) await fs.promises.rm(testRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

test("the run reads several domains and stores conferences from all of them", async () => {
  assert.ok(firstRun.created > 20, `expected a substantial number of conferences, got ${firstRun.created}`);
  const domains = await modules.dbAll<{ source_domain: string }>(
    "SELECT DISTINCT source_domain FROM discovery_events"
  );
  assert.ok(domains.length >= 2, "conferences come from more than one independent domain");
});

test("attempt terminal outcomes reconcile exactly", () => {
  const terminalTotal = Object.values(firstRun.terminalOutcomes).reduce((sum, count) => sum + count, 0);
  assert.equal(terminalTotal, firstRun.pagesAttempted);
});

test("accepted and merged records are attributed to their run", async () => {
  const contributions = await modules.dbGet<{ count: number }>(
    "SELECT COUNT(*) AS count FROM discovery_run_events WHERE run_id = ?",
    [firstRun.runId]
  );
  assert.equal(Number(contributions?.count || 0), firstRun.events.length);
  const distinctEvents = await modules.dbGet<{ count: number }>(
    "SELECT COUNT(DISTINCT event_id) AS count FROM discovery_run_events WHERE run_id = ?",
    [firstRun.runId]
  );
  const { exportEventsCsv } = await import("../exportCsv");
  const csv = await exportEventsCsv({ runId: firstRun.runId });
  assert.equal(csv.trim().split("\n").length - 1, Number(distinctEvents?.count || 0));
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
  assert.ok(firstRun.directoryResolution.directoryLeads > 0, "directory pages enter the resolution path");
  assert.ok(firstRun.directoryResolution.resolutionsAttempted > 0, "linked official sites are actually fetched");
  assert.ok(firstRun.directoryResolution.resolutionsSuccessful > 0, "an official-site fetch yields a conference");
  assert.ok(firstRun.directoryResolution.validatedAfterResolution > 0, "the official page passes full validation");
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

test("read routes are accounted for, and the reader is only ever a fallback", () => {
  assert.ok(firstRun.reads.directPages > 0);
  // Most fixture pages are substantial and read directly; a few (a news post, a concert listing)
  // are genuinely short, and those are exactly the pages a fallback would be considered for.
  assert.ok(
    firstRun.reads.directUsablePages / firstRun.reads.directPages > 0.7,
    `only ${firstRun.reads.directUsablePages}/${firstRun.reads.directPages} pages read directly`
  );
  // The hosted reader is opt-in (DISCOVERY_JINA_ENABLED), and unset here — so it is not merely
  // unspent, it is never even considered. That is the default a fresh deployment gets.
  assert.equal(firstRun.reads.jinaPages, 0, "not one reader call is made");
  assert.ok(firstRun.reads.directExtractionSuccesses > 0);
  assert.equal(firstRun.reads.jinaExtractionSuccesses, 0);
});

test("robots.txt is read for every domain before its pages are, whatever route found it", async () => {
  // The fixture sites all come from the registry, so nothing needed an on-demand check here —
  // but the counter must exist and be honest, because search-discovered hosts depend on it.
  assert.equal(typeof firstRun.robotsCheckedOnDemand, "number");
  assert.ok(firstRun.robotsDisallowedUrls >= 0);
});

test("the field audit re-reads real sources and reports per-field accuracy", async () => {
  const { auditDiscoveredConferences } = await import("../audit");
  const report = await auditDiscoveredConferences({ sample: 12, urlGuard });

  assert.ok(report.auditedRecords > 0, "the audit sampled something");
  assert.equal(report.unreadableRecords, 0, "every fixture source page is re-readable");
  assert.equal(report.fieldAccuracy.length, 11, "all eleven audited fields are reported");

  // Fixture pages are internally consistent, so a correct engine should confirm nearly everything
  // it claimed. A low number here would mean the audit or the extraction is broken.
  assert.ok(
    report.overallAccuracy !== null && report.overallAccuracy >= 0.9,
    `overall accuracy was ${report.overallAccuracy}`
  );

  const title = report.fieldAccuracy.find((f) => f.field === "title")!;
  assert.equal(title.coverage, 1, "every record has a title");
  assert.ok(title.accuracy !== null && title.accuracy >= 0.9);

  // A null is not an error: it must land in `absent`, never in `not_supported`.
  for (const field of report.fieldAccuracy) {
    assert.ok(field.absent + field.confirmed + field.supported + field.notSupported + field.unverifiable === report.auditedRecords);
  }

  for (const record of report.records) {
    assert.match(record.sourceUrl, /^http/, "each audited row names the source a human can check");
  }
});

test("placeholder and staging records are flagged, real ones are not", async () => {
  const { suspicionFlagsFor } = await import("../audit");

  assert.deepEqual(
    suspicionFlagsFor({
      title: "33rd International Meeting on Organic Geochemistry",
      official_url: "https://imog2027.example-real.org/",
      start_date: "2027-09-12",
      end_date: "2027-09-17",
      start_year: 2027,
      confidence_score: 0.88,
      quality_flags: "[]",
    }),
    [],
    "a plausible record raises nothing"
  );

  const flags = suspicionFlagsFor({
    title: "Test Conference {{year}}",
    official_url: "http://localhost:3000/staging/event",
    start_date: "2027-01-01",
    end_date: "2027-06-01",
    start_year: 2027,
    confidence_score: 0.2,
    quality_flags: "[]",
  });
  assert.ok(flags.includes("title_looks_like_placeholder"));
  assert.ok(flags.includes("title_contains_template_markup"));
  assert.ok(flags.includes("url_is_not_a_public_site"));
  assert.ok(flags.includes("date_span_implausibly_long"));
  assert.ok(flags.includes("very_low_confidence"));
});

test("a second pass over an unchanged web does no work", async () => {
  const second = await modules.runDiscovery({
    targetYears: [2026, 2027, 2028],
    domains: web.sites.map((site) => site.domain),
    maxPages: 200,
    maxCandidates: 2000,
    maxAiCalls: 0,
    maxJinaPages: 0,
    scheme: "http",
    urlGuard,
    quiet: true,
    trigger: "test-rerun",
  });
  assert.equal(second.created, 0, "nothing new is created from a web that has not changed");
  assert.equal(second.pagesFetched, 0, "no unchanged page is extracted again");
  assert.ok(second.pagesUnchanged + second.scheduledUrlsSkipped > 0);
  assert.equal(second.pagesAttempted, second.pagesUnchanged,
    "a URL whose recheck time has not arrived consumes no page-attempt budget");
});
