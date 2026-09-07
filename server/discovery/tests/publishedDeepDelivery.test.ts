// Why a published conference shows four empty tabs while its record holds the data.
//
// Both defects here are scheduling, not extraction: the pass that reads deep sections never
// visited publish_ready records, and the only thing that copied sections onto a published row was
// a side effect of `publish`, which runs behind the controlled permit and a passing audit.

import assert from "node:assert/strict";
import test from "node:test";
import { dbAll, dbGet, dbRun } from "../../db";
import { initDiscoverySchema } from "../schema";
import { syncPublishedDeepSections } from "../publish";

const SPEAKERS = JSON.stringify([
  { name: "Ines Marchetti", org: "Politecnico di Torino", role: "Keynote", source_url: "https://sync.example/speakers" },
]);

async function seedPublished(id: string, url: string, deep: Record<string, string> = {}): Promise<void> {
  const { initDb } = await import("../../db");
  await initDb();
  await initDiscoverySchema();
  await dbRun(`INSERT OR REPLACE INTO discovery_events
    (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
     publish_readiness,confidence_score,keynote_speakers,program_agenda)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "Sync Congress 2027", "sync congress 2027", "html", url, "sync.example", url,
      "published", "publish_ready", 0.9, deep.keynote_speakers ?? null, deep.program_agenda ?? null]);
}

test("a published conference's stored sections reach its detail record without a publication run", async () => {
  const url = `https://sync.example/${Date.now()}`;
  const id = `sync-${Date.now()}`;
  await seedPublished(id, url, { keynote_speakers: SPEAKERS });
  await dbRun(`INSERT OR REPLACE INTO extracted_conferences
    (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [url, JSON.stringify({ conference_name: "Sync Congress 2027" }), "[]",
      JSON.stringify({ origin: "discovery_engine", status: "success", discovery_event_id: id })]);
  try {
    // No permit, no audit, no publication call — this must still deliver the tab.
    const dry = await syncPublishedDeepSections({ dryRun: true });
    assert.equal(dry.sectionsFilled >= 1, true);
    const untouched = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.deepEqual(JSON.parse(untouched!.keynote_speakers), [], "a dry run writes nothing");

    const applied = await syncPublishedDeepSections({});
    assert.ok(applied.sectionsFilled >= 1);
    const filled = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.equal(JSON.parse(filled!.keynote_speakers)[0].name, "Ines Marchetti");

    // Idempotent: nothing left to do on a second pass.
    const again = await syncPublishedDeepSections({});
    assert.equal(again.filled.some((entry) => entry.sourceUrl === url), false);
  } finally {
    await dbRun("DELETE FROM extracted_conferences WHERE source_url=?", [url]);
    await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
  }
});

test("the tab sync never edits a record this engine did not write", async () => {
  const url = `https://manual.example/${Date.now()}`;
  const id = `manual-${Date.now()}`;
  await seedPublished(id, url, { keynote_speakers: SPEAKERS });
  await dbRun(`INSERT OR REPLACE INTO extracted_conferences
    (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [url, JSON.stringify({ conference_name: "Manually Crawled Congress" }), "[]",
      JSON.stringify({ origin: "site_crawl", status: "success", discovery_event_id: id })]);
  try {
    await syncPublishedDeepSections({});
    const row = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.deepEqual(JSON.parse(row!.keynote_speakers), [], "another origin's record is left alone");
  } finally {
    await dbRun("DELETE FROM extracted_conferences WHERE source_url=?", [url]);
    await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
  }
});

test("a populated tab is never overwritten by the sync", async () => {
  const url = `https://keep.example/${Date.now()}`;
  const id = `keep-${Date.now()}`;
  await seedPublished(id, url, { keynote_speakers: SPEAKERS });
  const existing = JSON.stringify([{ name: "Already Present", org: null, role: null }]);
  await dbRun(`INSERT OR REPLACE INTO extracted_conferences
    (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [url, JSON.stringify({ conference_name: "Keep Congress 2027" }), existing,
      JSON.stringify({ origin: "discovery_engine", status: "success", discovery_event_id: id })]);
  try {
    await syncPublishedDeepSections({});
    const row = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.equal(JSON.parse(row!.keynote_speakers)[0].name, "Already Present");
  } finally {
    await dbRun("DELETE FROM extracted_conferences WHERE source_url=?", [url]);
    await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
  }
});

test("the deep pass can be aimed at published records that are still missing sections", async () => {
  await initDiscoverySchema();
  const stamp = Date.now();
  const full = `deep-full-${stamp}`;
  const empty = `deep-empty-${stamp}`;
  try {
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,status,publish_readiness,keynote_speakers,program_agenda,technical_committee,sponsors_exhibitors,community)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [full, "Full Deep Congress 2027", "full deep congress 2027", "html", "https://full.example/",
        "full.example", "published", "publish_ready", SPEAKERS, "{\"sessions\":[{\"title\":\"x\"}]}",
        SPEAKERS, SPEAKERS, "{\"social_media\":[{\"platform\":\"X\",\"url\":\"https://x.com/a\"}]}"]);
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,status,publish_readiness)
      VALUES (?,?,?,?,?,?,?,?)`,
      [empty, "Empty Deep Congress 2027", "empty deep congress 2027", "html", "https://empty.example/",
        "empty.example", "published", "publish_ready"]);

    // The selector the scheduled published-conference pass uses.
    const selected = await dbAll<{ id: string }>(
      `SELECT id FROM discovery_events
        WHERE status IN ('validated','published','needs_review') AND publish_readiness IN ('publish_ready')
          AND (program_agenda IS NULL OR program_agenda IN ('','[]','{}')
            OR keynote_speakers IS NULL OR keynote_speakers IN ('','[]','{}')
            OR technical_committee IS NULL OR technical_committee IN ('','[]','{}')
            OR sponsors_exhibitors IS NULL OR sponsors_exhibitors IN ('','[]','{}')
            OR community IS NULL OR community IN ('','[]','{}'))
          AND id IN (?,?)`, [full, empty]);
    assert.deepEqual(selected.map((row) => row.id), [empty],
      "a record that already holds every section costs the pass nothing");
  } finally {
    for (const id of [full, empty]) await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
  }
});
