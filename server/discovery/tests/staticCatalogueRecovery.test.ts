import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conferencegate-catalogue-recovery-"));
process.env.NODE_ENV = "test";
process.env.TEST_DATABASE_PATH = path.join(tempDir, "empty.db");
process.env.DATABASE_PATH = process.env.TEST_DATABASE_PATH;

test("empty SQLite still returns the committed ConferenceGate catalogue", async () => {
  const { initDb } = await import("../../db");
  await initDb();

  const { browseStoredConferences } = await import("../../braveSearch");
  const results = await browseStoredConferences(1000);

  assert.ok(
    results.length >= 150,
    `expected a substantial committed fallback catalogue, got ${results.length}`
  );
  assert.ok(
    results.some((result) => Boolean(result.startDate) && Boolean(result.location?.country)),
    "fallback catalogue should include dated conferences with a country"
  );
  assert.ok(
    results.some((result) => result.prepared !== true),
    "core verified conferences must remain discoverable before six-tab enrichment"
  );
});

test("Discover uses the core-record visibility gate for search and browse", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server/braveSearch.ts"), "utf8");
  assert.match(source, /merged\.filter\(isDiscoverableConference\)/);
  assert.match(source, /browseLaunchDataset\(limit\)[\s\S]*?filter\(isDiscoverableConference\)/);
});
