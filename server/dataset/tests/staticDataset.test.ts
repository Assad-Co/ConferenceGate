import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLaunchDataset } from "../build";
import type { HarvestEvidence } from "../parseEvidence";
import {
  browseLaunchDataset,
  findLaunchRecordByUrl,
  launchRecordToTabbedExtraction,
  loadLaunchDataset,
  resetLaunchDatasetCache,
  searchLaunchDataset,
  LAUNCH_DATASET_FILE,
  LAUNCH_INDEX_FILE,
} from "../staticDataset";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

function row(url: string, stated: string, org: string | null = null): HarvestEvidence {
  return { query: "q", title: "t", url, stated, org };
}

const FIXTURE_EVIDENCE: HarvestEvidence[] = [
  row("https://www.atce.org/", "SPE ATCE 2026 Annual Technical Conference and Exhibition, George R. Brown Convention Center, Houston, Texas, USA, October 21-23, 2026", "SPE"),
  row("https://eageannual.org/", "88th EAGE Annual Conference & Exhibition 2027, RAI Amsterdam, Amsterdam, Netherlands, 31 May - 3 June 2027", "EAGE"),
  row("https://www.eag.org/events/goldschmidt/", "Goldschmidt 2027 Conference, Paris, France, July 11-16, 2027", "European Association of Geochemistry"),
  row("https://www.rsaconference.com/", "RSA Conference 2027, San Francisco, California, USA, April 5-8, 2027"),
  row("https://www.wicys.org/event/wicys-2027-annual-conference/", "WiCyS 2027 Annual Conference, Women in Cybersecurity, Aurora, Colorado, USA, March 17-19, 2027", "WiCyS"),
  row("https://onegiantleap.com/", "LEAP 2027 Tech Conference, Riyadh, Saudi Arabia, April 12-15, 2027"),
  row("https://miccai.org/2028", "MICCAI 2028 International Conference on Medical Image Computing, Sao Paulo, Brazil, October 16-20, 2028"),
];

/** Writes the fixture dataset where the reader looks, and points the reader at it. */
function withFixtureDataset<T>(run: () => T): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "launch-dataset-"));
  const result = buildLaunchDataset(FIXTURE_EVIDENCE, OPTIONS);
  fs.writeFileSync(path.join(directory, LAUNCH_DATASET_FILE), JSON.stringify(result.dataset));
  fs.writeFileSync(path.join(directory, LAUNCH_INDEX_FILE), JSON.stringify(result.index));
  const previous = process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR = directory;
  resetLaunchDatasetCache();
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR = previous;
    resetLaunchDatasetCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("the dataset loads from disk and indexes every record by its source URL", () => {
  withFixtureDataset(() => {
    const loaded = loadLaunchDataset();
    assert.equal(loaded.records.length, FIXTURE_EVIDENCE.length);
    assert.ok(findLaunchRecordByUrl("https://www.atce.org/"));
    assert.equal(findLaunchRecordByUrl("https://nothing-here.example/"), null);
  });
});

test("search matches on acronym, organisation, city, country and year", () => {
  withFixtureDataset(() => {
    const titlesFor = (query: string) => searchLaunchDataset(query).map((result) => result.title);
    assert.ok(titlesFor("SPE").some((title) => title.includes("ATCE")));
    assert.ok(titlesFor("EAGE").some((title) => title.includes("EAGE")));
    assert.ok(titlesFor("Goldschmidt").some((title) => title.includes("Goldschmidt")));
    assert.ok(titlesFor("geochemistry").some((title) => title.includes("Goldschmidt")));
    assert.ok(titlesFor("Saudi Arabia").some((title) => title.includes("LEAP")));
    assert.ok(titlesFor("cybersecurity").some((title) => title.includes("WiCyS")));
    assert.ok(titlesFor("2028").some((title) => title.includes("MICCAI")));
    assert.equal(titlesFor("conference in Antarctica about penguins").length, 0);
  });
});

test("a static result never claims prepared tab data it does not have", () => {
  withFixtureDataset(() => {
    for (const result of searchLaunchDataset("conference")) {
      assert.equal(result.prepared, false);
    }
  });
});

test("browsing returns upcoming conferences soonest first and leaves finished ones out", () => {
  withFixtureDataset(() => {
    const now = new Date("2027-01-01T00:00:00Z");
    const results = browseLaunchDataset(60, now);
    const dates = results.map((result) => result.startDate);
    assert.deepEqual([...dates].sort(), dates);
    assert.ok(!results.some((result) => (result.startDate || "") < "2027-01-01"));
  });
});

test("the detail payload fills only verified fields and marks the deep sections unread", () => {
  withFixtureDataset(() => {
    const record = findLaunchRecordByUrl("https://eageannual.org/");
    assert.ok(record);
    const payload = launchRecordToTabbedExtraction(record!) as Record<string, any>;

    assert.equal(payload.extracted, true);
    assert.equal(payload.crawlComplete, true);
    assert.equal(payload.fetchFailed, false);
    // The distinction the detail page renders: nothing was read, so no section may be reported as
    // "the crawl found none".
    assert.equal(payload.sectionsNotRead, true);
    assert.equal(payload.pagesRead, 0);

    assert.equal(payload.overview.conference_name, "88th EAGE Annual Conference & Exhibition 2027");
    assert.equal(payload.overview.city, "Amsterdam");
    assert.equal(payload.overview.country, "Netherlands");
    assert.equal(payload.overview.venue, "RAI Amsterdam");
    assert.equal(payload.overview.start_date, "2027-05-31");
    assert.equal(payload.overview.organizer, "EAGE");
    // The source text is preserved rather than discarded because structured parsing was partial.
    assert.ok(String(payload.overview.description).includes("RAI Amsterdam"));

    assert.deepEqual(payload.keynote_speakers, []);
    assert.deepEqual(payload.technical_committee, []);
    assert.deepEqual(payload.sponsors_exhibitors, []);
    assert.deepEqual(payload.call_for_papers, {});
    assert.equal(payload.extraction_metadata.origin, "launch_dataset");
    assert.ok(payload.extraction_metadata.sections_not_read.includes("keynote_speakers"));
    assert.equal(payload.extraction_metadata.evidence.method, "web_search");
  });
});

test("reading the dataset makes no network request", async () => {
  await withFixtureDataset(async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: unknown[]) => {
      calls += 1;
      throw new Error(`unexpected fetch: ${String(args[0])}`);
    }) as typeof globalThis.fetch;
    try {
      searchLaunchDataset("petroleum");
      browseLaunchDataset(10);
      const record = findLaunchRecordByUrl("https://www.atce.org/");
      launchRecordToTabbedExtraction(record!);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(calls, 0);
  });
});

test("a missing dataset degrades to no records rather than throwing", () => {
  const previous = process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR = path.join(os.tmpdir(), "launch-dataset-does-not-exist");
  resetLaunchDatasetCache();
  try {
    assert.deepEqual(searchLaunchDataset("anything"), []);
    assert.deepEqual(browseLaunchDataset(10), []);
    assert.equal(findLaunchRecordByUrl("https://www.atce.org/"), null);
  } finally {
    if (previous === undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR = previous;
    resetLaunchDatasetCache();
  }
});
