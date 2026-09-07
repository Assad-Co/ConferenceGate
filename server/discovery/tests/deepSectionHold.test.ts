// Historical deep items are held, not deleted, not shown.
//
// The 1,281 items a cleanup could not decide on stayed inside their sections. That left them in
// two wrong places at once: in front of customers as though verified, and in the way of the
// enrichment pass, which saw a full section and moved on. A section is now customer-visible only
// when the verification ledger says a hardened read confirmed it.

import assert from "node:assert/strict";
import test from "node:test";
import { dbAll, dbGet, dbRun } from "../../db";
import { initDiscoverySchema } from "../schema";
import { syncPublishedDeepSections, toExtractedConferenceRecord } from "../publish";
import {
  deepSectionIsHeld, deepSectionsToRead, storeDeepSections, verifiedDeepSections,
} from "../deepEnrichment";

const REVIEW_ITEMS = JSON.stringify([
  { name: "Uncertain Legacy Person", org: null, role: null, source_url: "https://hold.example/old" },
]);
const EMPTY_ARRAY = JSON.stringify([]);

async function seed(id: string, url: string, speakers: string | null): Promise<void> {
  const { initDb } = await import("../../db");
  await initDb();
  await initDiscoverySchema();
  await dbRun(`INSERT OR REPLACE INTO discovery_events
    (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
     publish_readiness,confidence_score,start_year,keynote_speakers)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "Hold Congress 2027", "hold congress 2027", "html", url, new URL(url).hostname, url,
      "published", "publish_ready", 0.9, 2027, speakers]);
}

async function forget(id: string, url: string): Promise<void> {
  await dbRun("DELETE FROM extracted_conferences WHERE source_url=?", [url]);
  await dbRun("DELETE FROM discovery_deep_section_verifications WHERE event_id=?", [id]);
  await dbRun("DELETE FROM discovery_event_changes WHERE event_id=?", [id]);
  await dbRun("DELETE FROM discovery_event_fields WHERE event_id=?", [id]);
  await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
}

test("an unverified section is held: kept in storage, absent from the published payload", async () => {
  const id = `hold-${Date.now()}`;
  const url = `https://hold.example/${Date.now()}`;
  await seed(id, url, REVIEW_ITEMS);
  try {
    const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [id]);
    const verified = await verifiedDeepSections(id);
    assert.equal(verified.size, 0, "nothing is verified until a hardened read says so");
    assert.equal(deepSectionIsHeld(event!, "speakers", verified), true);

    // The published payload for this record carries no speakers at all.
    const record = toExtractedConferenceRecord(event!, verified);
    assert.deepEqual(JSON.parse(record.keynote_speakers), []);

    // And the items are still exactly where they were.
    const stored = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM discovery_events WHERE id=?", [id]);
    assert.equal(JSON.parse(stored!.keynote_speakers)[0].name, "Uncertain Legacy Person");
  } finally {
    await forget(id, url);
  }
});

test("a held section is treated as still to be read, and its items are never promoted", async () => {
  const id = `hold-read-${Date.now()}`;
  const url = `https://hold.example/${Date.now()}-r`;
  await seed(id, url, REVIEW_ITEMS);
  try {
    const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [id]);
    assert.ok(deepSectionsToRead(event!, await verifiedDeepSections(id)).includes("speakers"),
      "the enrichment pass must revisit a section it has never confirmed");

    // Reclassifying, re-reporting or re-running anything must not make it verified. Only a write
    // through storeDeepSections can, and only for what that read actually found.
    assert.equal((await verifiedDeepSections(id)).size, 0);
  } finally {
    await forget(id, url);
  }
});

test("a verified read replaces the held items, keeps provenance, and archives what it replaced", async () => {
  const id = `hold-replace-${Date.now()}`;
  const url = `https://hold.example/${Date.now()}-x`;
  await seed(id, url, REVIEW_ITEMS);
  try {
    const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [id]);
    const stored = await storeDeepSections({
      eventId: id, event: event!, officialUrl: url,
      extraction: {
        program: null, community: null, committee: [], sponsors: [],
        speakers: [{
          name: "Verified Nadia Farouk", title: null, org: "Cairo University", role: "Keynote",
          presentation_title: null, email: null, imageUrl: null, source_url: `${url}speakers`,
        }],
      },
    });
    assert.deepEqual(stored.filled, ["speakers"]);
    assert.equal(stored.provenance.speakers, `${url}speakers`);

    const after = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [id]);
    assert.equal(JSON.parse(after!.keynote_speakers)[0].name, "Verified Nadia Farouk");
    assert.ok((await verifiedDeepSections(id)).has("speakers"));

    // The published payload now carries it, with its source URL intact.
    const record = toExtractedConferenceRecord(after!, await verifiedDeepSections(id));
    assert.equal(JSON.parse(record.keynote_speakers)[0].source_url, `${url}speakers`);

    // What was replaced is preserved rather than lost.
    const archived = await dbAll<{ old_value: string; change_type: string }>(
      "SELECT old_value, change_type FROM discovery_event_changes WHERE event_id=? AND change_type=?",
      [id, "held_deep_section_replaced_by_verified_read"]);
    assert.equal(archived.length, 1);
    assert.match(archived[0].old_value, /Uncertain Legacy Person/);
  } finally {
    await forget(id, url);
  }
});

test("a read that finds nothing leaves the section empty and the held items hidden", async () => {
  const id = `hold-fail-${Date.now()}`;
  const url = `https://hold.example/${Date.now()}-f`;
  await seed(id, url, REVIEW_ITEMS);
  try {
    const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [id]);
    const stored = await storeDeepSections({
      eventId: id, event: event!, officialUrl: url,
      extraction: { program: null, community: null, committee: [], sponsors: [], speakers: [] },
    });
    assert.deepEqual(stored.filled, [], "an unsuccessful read verifies nothing");
    assert.equal((await verifiedDeepSections(id)).size, 0);
    const record = toExtractedConferenceRecord(
      (await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [id]))!,
      await verifiedDeepSections(id));
    assert.deepEqual(JSON.parse(record.keynote_speakers), [], "still empty, never the held items");
  } finally {
    await forget(id, url);
  }
});

test("held items already on a published row are withdrawn, and the withdrawal is idempotent", async () => {
  const id = `hold-sync-${Date.now()}`;
  const url = `https://hold.example/${Date.now()}-s`;
  await seed(id, url, REVIEW_ITEMS);
  await dbRun(`INSERT OR REPLACE INTO extracted_conferences
    (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [url, JSON.stringify({ conference_name: "Hold Congress 2027" }), REVIEW_ITEMS,
      JSON.stringify({ origin: "discovery_engine", status: "success", discovery_event_id: id })]);
  try {
    const dry = await syncPublishedDeepSections({ dryRun: true });
    assert.ok(dry.sectionsHeld >= 1, "a dry run reports the withdrawal it would make");
    const untouched = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.equal(JSON.parse(untouched!.keynote_speakers)[0].name, "Uncertain Legacy Person",
      "a dry run writes nothing");

    await syncPublishedDeepSections({});
    const cleared = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.deepEqual(JSON.parse(cleared!.keynote_speakers), []);
    // Discovery storage still holds them.
    const kept = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM discovery_events WHERE id=?", [id]);
    assert.equal(JSON.parse(kept!.keynote_speakers)[0].name, "Uncertain Legacy Person");

    const again = await syncPublishedDeepSections({});
    assert.equal(again.filled.some((entry) => entry.sourceUrl === url), false, "nothing left to do");
  } finally {
    await forget(id, url);
  }
});

test("a record this engine did not write is never withdrawn from", async () => {
  const id = `hold-manual-${Date.now()}`;
  const url = `https://manual-hold.example/${Date.now()}`;
  await seed(id, url, REVIEW_ITEMS);
  await dbRun(`INSERT OR REPLACE INTO extracted_conferences
    (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [url, JSON.stringify({ conference_name: "Manually Curated Congress" }), REVIEW_ITEMS,
      JSON.stringify({ origin: "site_crawl", status: "success", discovery_event_id: id })]);
  try {
    await syncPublishedDeepSections({});
    const row = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [url]);
    assert.equal(JSON.parse(row!.keynote_speakers)[0].name, "Uncertain Legacy Person",
      "another origin's record is not this engine's to edit");
  } finally {
    await forget(id, url);
  }
});

test("the ledger is additive: nothing is ever deleted from discovery storage", async () => {
  const id = `hold-additive-${Date.now()}`;
  const url = `https://hold.example/${Date.now()}-a`;
  await seed(id, url, REVIEW_ITEMS);
  try {
    await syncPublishedDeepSections({});
    const kept = await dbGet<{ keynote_speakers: string }>(
      "SELECT keynote_speakers FROM discovery_events WHERE id=?", [id]);
    assert.equal(JSON.parse(kept!.keynote_speakers).length, 1);
  } finally {
    await forget(id, url);
  }
});
