// The bridge between the launch catalogue and the discovery engine.
//
// These tests are about honesty in the handover rather than plumbing: a seeded record must not
// claim a page was read, must not invent deadlines it never had, and must not arrive already
// published.

import test from "node:test";
import assert from "node:assert/strict";
import { seedFingerprint, toNormalizedEvent } from "../seedDiscovery";
import type { LaunchConferenceRecord } from "../types";

function record(overrides: Partial<LaunchConferenceRecord> = {}): LaunchConferenceRecord {
  return {
    id: "eage-2027-amsterdam",
    title: "88th EAGE Annual Conference & Exhibition 2027",
    acronym: "EAGE",
    series: "EAGE Annual Conference & Exhibition",
    edition: "88th",
    year: 2027,
    startDate: "2027-05-31",
    endDate: "2027-06-03",
    datePrecision: "day",
    datesText: null,
    city: "Amsterdam",
    region: null,
    country: "Netherlands",
    countryCode: "NL",
    worldRegion: "Europe",
    venue: "RAI Amsterdam",
    format: "in-person",
    organization: "EAGE",
    category: "Geosciences & Earth Systems",
    categories: ["Geosciences & Earth Systems", "Petroleum & Energy"],
    topics: ["geoscience", "geophysics"],
    keywords: ["EAGE", "Amsterdam", "Netherlands"],
    description: "88th EAGE Annual Conference & Exhibition 2027, RAI Amsterdam, Amsterdam, Netherlands",
    sourceUrl: "https://eageannual.org/",
    sourceHost: "eageannual.org",
    sourceType: "official_site",
    officialUrl: "https://eageannual.org/",
    evidence: {
      query: "q",
      resultTitle: "t",
      statedText: "s",
      retrievedAt: "2026-09-09",
      method: "web_search",
    },
    provenance: {},
    corroboratingSourceUrls: [],
    origin: "launch_dataset",
    ...overrides,
  };
}

test("a seeded record carries its facts across without gaining any", () => {
  const event = toNormalizedEvent(record());
  assert.equal(event.title, "88th EAGE Annual Conference & Exhibition 2027");
  assert.equal(event.startDate, "2027-05-31");
  assert.equal(event.startMonth, 5);
  assert.equal(event.city, "Amsterdam");
  assert.equal(event.countryCode, "NL");
  assert.equal(event.worldRegion, "Europe");
  assert.equal(event.venue, "RAI Amsterdam");
  assert.equal(event.officialUrl, "https://eageannual.org/");
  assert.equal(event.series.edition, "88th");
});

test("it never claims a page was read", () => {
  // "html" or "structured_data" would assert a page read that never happened, and would outrank
  // what enrichment later reads from the conference's own site.
  assert.equal(toNormalizedEvent(record()).extractionMethod, "derived");
});

test("no deadlines are invented, because no source stated one", () => {
  const event = toNormalizedEvent(record());
  assert.deepEqual(event.deadlines, {
    abstractDeadline: null,
    paperSubmissionDeadline: null,
    earlyBirdDeadline: null,
    registrationDeadline: null,
    notificationDate: null,
    cameraReadyDeadline: null,
  });
  assert.equal(event.latitude, null);
  assert.equal(event.longitude, null);
  assert.equal(event.registrationUrl, null);
});

test("a listing-sourced record is seeded at low trust so a real page read outranks it", () => {
  const official = toNormalizedEvent(record({ sourceType: "official_site" }));
  const api = toNormalizedEvent(record({ sourceType: "event_api" }));
  const listing = toNormalizedEvent(record({ sourceType: "directory_listing" }));
  assert.ok(official.confidenceScore > api.confidenceScore);
  assert.ok(api.confidenceScore > listing.confidenceScore);
  assert.ok(listing.confidenceScore <= 0.25);
});

test("the engine's spelling of a format is used, and unknown is never guessed at", () => {
  assert.equal(toNormalizedEvent(record({ format: "in-person" })).format, "in_person");
  assert.equal(toNormalizedEvent(record({ format: "hybrid" })).format, "hybrid");
  assert.equal(toNormalizedEvent(record({ format: "online" })).format, "online");
});

/* --------------------------------------------------------------- writing it */

// The mapping tests above all passed while every single write failed in production with
// "Unsupported type of value" — three required fields were missing, bound as undefined, and a
// `as NormalizedEvent` cast had silenced the compiler error that says so. Unit tests on the shape
// could never catch that. This one actually stores the rows.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLaunchDataset } from "../build";
import { LAUNCH_DATASET_FILE, LAUNCH_INDEX_FILE, resetLaunchDatasetCache } from "../staticDataset";
import { seedLaunchRecords } from "../seedDiscovery";
import { initDiscoverySchema } from "../../discovery/schema";
import { dbAll, dbRun } from "../../db";

test("seeding actually writes rows a database accepts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seed-discovery-"));
  const built = buildLaunchDataset(
    [
      {
        query: "q",
        title: "t",
        url: "https://eageannual.org/",
        stated: "88th EAGE Annual Conference & Exhibition 2027, RAI Amsterdam, Amsterdam, Netherlands, 31 May - 3 June 2027",
        org: "EAGE",
      },
      {
        query: "q",
        title: "t",
        url: "https://www.atce.org/",
        stated: "SPE ATCE 2027 Annual Technical Conference and Exhibition, Houston, Texas, USA, October 4-6, 2027",
        org: "SPE",
      },
    ],
    { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] }
  );
  fs.writeFileSync(path.join(directory, LAUNCH_DATASET_FILE), JSON.stringify(built.dataset));
  fs.writeFileSync(path.join(directory, LAUNCH_INDEX_FILE), JSON.stringify(built.index));

  const previous = process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR = directory;
  resetLaunchDatasetCache();
  // Every test file shares one database, and the cleanup suites assert on exact row counts. This
  // test therefore has to leave the store exactly as it found it.
  await initDiscoverySchema();
  const before = new Set((await dbAll<{ id: string }>(`SELECT id FROM discovery_events`)).map((row) => row.id));
  try {
    // force, because this test is about the write path. Without it a store that already holds these
    // records from an earlier run correctly skips them, and the assertion below would be measuring
    // the skip rather than the write.
    const result = await seedLaunchRecords({ force: true });

    assert.equal(result.failures.length, 0, `expected no failures, got ${JSON.stringify(result.failures)}`);
    assert.equal(result.seeded, 2);

    // And the second pass writes nothing, because nothing changed. That is the twelve minutes back.
    const again = await seedLaunchRecords();
    assert.equal(again.seeded, 0, "a re-seed rewrote records the store already held unchanged");
    assert.equal(again.unchanged, 2);

    const rows = await dbAll<Record<string, any>>(
      `SELECT id, title, start_date, city, country, official_url, status, extraction_method
         FROM discovery_events ORDER BY start_date`
    );
    const seededRows = rows.filter((row) => !before.has(row.id));
    assert.equal(seededRows.length, 2);
    assert.equal(seededRows[0].status, "validated");
    assert.equal(seededRows[0].extraction_method, "derived");
    assert.equal(seededRows[0].city, "Amsterdam");
    assert.equal(seededRows[0].country, "Netherlands");
    assert.equal(seededRows[0].official_url, "https://eageannual.org/");
    assert.ok(String(seededRows[0].title).includes("EAGE"));
  } finally {
    const after = await dbAll<{ id: string }>(`SELECT id FROM discovery_events`);
    for (const row of after) {
      if (before.has(row.id)) continue;
      await dbRun(`DELETE FROM discovery_event_fields WHERE event_id=?`, [row.id]);
      await dbRun(`DELETE FROM discovery_event_sources WHERE event_id=?`, [row.id]);
      await dbRun(`DELETE FROM discovery_events WHERE id=?`, [row.id]);
    }
    if (previous === undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR = previous;
    resetLaunchDatasetCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a re-seed writes only what changed, and never skips a change that matters", () => {
  // Seeding rewrote all 375 records every run at roughly two seconds a round trip — twelve minutes
  // of a twenty-five minute cycle spent restating what the store already said. The fingerprint is
  // what makes a second run cheap, so what it covers is the whole safety argument.
  const base = {
    id: "aapg-ice-2026", title: "AAPG ICE 2026", startDate: "2026-12-07", endDate: "2026-12-09",
    city: "Jakarta", country: "Indonesia", venue: null, format: "in-person",
    organization: "AAPG", officialUrl: "https://iceevent.org/2026/",
    sourceUrl: "https://iceevent.org/2026/", sourceType: "official_site",
    description: "A conference.", topics: ["geology"], categories: ["energy"], details: null,
  } as any;

  // The same record twice is the same fingerprint, which is the whole point.
  assert.equal(seedFingerprint(base), seedFingerprint({ ...base }));

  // Every field seeding carries must move it.
  for (const change of [
    { title: "AAPG ICE 2027" }, { startDate: "2026-12-08" }, { city: "Bali" },
    { officialUrl: "https://iceevent.org/2027/" }, { venue: "NICE" }, { organization: "SEG" },
    { topics: ["geophysics"] }, { description: "Something else." },
  ]) {
    assert.notEqual(
      seedFingerprint({ ...base, ...change }), seedFingerprint(base),
      `a change to ${Object.keys(change)[0]} would have been skipped as unchanged`
    );
  }

  // And the case the narrower content hash would miss: the conference is the same conference, but
  // its committee arrived. Skipping that would leave the tab empty in the store forever.
  const withCommittee = {
    ...base,
    details: { source: "aapg-details", committee: { items: [{ name: "Herman Darman" }] } },
  };
  assert.notEqual(seedFingerprint(withCommittee), seedFingerprint(base));
  assert.notEqual(
    seedFingerprint({ ...withCommittee, details: { ...withCommittee.details, committee: { items: [] } } }),
    seedFingerprint(withCommittee)
  );
});
