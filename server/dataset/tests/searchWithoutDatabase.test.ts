// The launch dataset's reason for existing: Discover has to answer on a host with no database.
//
// These tests run against a database that has no `extracted_conferences` table at all, which is
// what an unconfigured deployment looks like from the query's point of view. The search must return
// the static catalogue rather than a 502, and it must do it without touching the network.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLaunchDataset } from "../build";
import type { HarvestEvidence } from "../parseEvidence";
import { LAUNCH_DATASET_FILE, LAUNCH_INDEX_FILE, resetLaunchDatasetCache } from "../staticDataset";
import { browseStoredConferences, searchConferences } from "../../braveSearch";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

function row(url: string, stated: string, org: string | null = null): HarvestEvidence {
  return { query: "q", title: "t", url, stated, org };
}

const EVIDENCE: HarvestEvidence[] = [
  row("https://www.eag.org/events/goldschmidt/", "Goldschmidt 2027 Conference, Paris, France, July 11-16, 2027", "European Association of Geochemistry"),
  row("https://onegiantleap.com/", "LEAP 2027 Tech Conference, Riyadh, Saudi Arabia, April 12-15, 2027"),
  row("https://www.atce.org/", "SPE ATCE 2026 Annual Technical Conference and Exhibition, Houston, Texas, USA, October 21-23, 2026", "SPE"),
];

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-dataset-nodb-"));
const built = buildLaunchDataset(EVIDENCE, OPTIONS);
fs.writeFileSync(path.join(fixtureDir, LAUNCH_DATASET_FILE), JSON.stringify(built.dataset));
fs.writeFileSync(path.join(fixtureDir, LAUNCH_INDEX_FILE), JSON.stringify(built.index));
process.env.LAUNCH_DATASET_DIR = fixtureDir;
resetLaunchDatasetCache();

test("a search answers from the static catalogue when the database has no stored conferences", async () => {
  const results = await searchConferences("Goldschmidt");
  assert.ok(results.length > 0, "expected the static catalogue to answer");
  assert.equal(results[0].title, "Goldschmidt 2027 Conference");
  assert.equal(results[0].link, "https://www.eag.org/events/goldschmidt/");
});

test("an organisation and a country both find their conference without a database", async () => {
  const bySociety = await searchConferences("SPE");
  assert.ok(bySociety.some((result) => result.title.includes("ATCE")));

  const byCountry = await searchConferences("Saudi Arabia");
  assert.ok(byCountry.some((result) => result.title.includes("LEAP")));
});

test("the search spends no provider quota and starts no fetch", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    calls += 1;
    throw new Error(`unexpected fetch: ${String(args[0])}`);
  }) as typeof globalThis.fetch;
  try {
    await searchConferences("petroleum engineering 2027");
    await browseStoredConferences(20);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test("browsing with no database still lists the catalogue, soonest first", async () => {
  const results = await browseStoredConferences(20);
  assert.ok(results.length > 0);
  const dates = results.map((result) => result.startDate).filter((date): date is string => Boolean(date));
  assert.deepEqual([...dates].sort(), dates, "browse is ordered by soonest start date");
});
