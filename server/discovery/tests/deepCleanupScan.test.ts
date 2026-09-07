import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { db, dbAll, dbGet, dbRun, initDb, closeDb } from "../../db";
import { initDiscoverySchema } from "../schema";
import { buildStoredDeepPlan, deepInventory } from "../deepCleanupScan";
import { digest } from "../deepRevalidation";
import { applyPlan } from "../deepCleanupStore";

test.after(closeDb);
const prefix = "stored-scan-";
const source = "https://stored-scan.example";
const member = JSON.stringify([{ name: "Amara Okafor", source_url: `${source}/speakers` }]);
async function seed(suffix: string, value: string | null = member) {
  await dbRun(`INSERT INTO discovery_events(id,title,normalized_title,acronym,start_year,status,official_url,source_url,source_domain,keynote_speakers)
    VALUES (?,?,?,'OSC',2027,'validated',?,?,?,?)`, [prefix + suffix, "Optical Science Congress 2027", "optical science", source, `${source}/${suffix}`, "stored-scan.example", value]);
}
async function clean() {
  const ids = (await dbAll<any>("SELECT id FROM discovery_events WHERE id LIKE ?", [prefix + "%"])).map(r => r.id);
  for (const id of ids) {
    await dbRun("DELETE FROM discovery_event_fields WHERE event_id=?", [id]);
    await dbRun("DELETE FROM discovery_events WHERE id=?", [id]);
  }
  await dbRun("DELETE FROM extracted_conferences WHERE source_url LIKE ?", [source + "/%"]);
}
test("stored-only scan filters empty envelopes and includes orphaned provenance and published copies without fetching", async () => {
  await initDb(); await initDiscoverySchema();
  try {
    for (let n = 0; n < 12; n++) await seed(`empty-${n}`, n % 2 ? "[]" : null);
    await dbRun(`UPDATE discovery_events SET program_agenda=?,community=? WHERE id LIKE ?`,
      ['{"sessions": [ ],"tracks":[],"important_dates":[],"source_url":"https://stored-scan.example"}', '{"social_media":[],"hashtag":null,"contact_email":null}', prefix + "empty-%"]);
    await seed("populated"); await seed("orphan", null); await seed("published", null);
    await dbRun(`INSERT INTO discovery_event_fields(id,event_id,field,value,source_url,source_domain,extraction_method)
      VALUES ('stored-scan-field',?,'keynoteSpeakers',?,?,'stored-scan.example','html')`, [prefix + "orphan", member, `${source}/speakers`]);
    await dbRun("INSERT INTO extracted_conferences(source_url,keynote_speakers,extraction_metadata) VALUES (?,?,?)",
      [`${source}/published`, member, JSON.stringify({ origin: "discovery_engine", discovery_event_id: prefix + "published" })]);
    const inventory = await deepInventory();
    assert.deepEqual(inventory.ids.filter(id => id.startsWith(prefix)), [prefix + "orphan", prefix + "populated", prefix + "published"]);
    const before = JSON.stringify(await dbAll("SELECT * FROM discovery_events ORDER BY id"));
    await db.execute("PRAGMA query_only=ON");
    let plan;
    try { plan = await buildStoredDeepPlan(async () => { throw new Error("must not crawl in default mode"); }, { batchSize: 1 }); }
    finally { await db.execute("PRAGMA query_only=OFF"); }
    assert.equal(JSON.stringify(await dbAll("SELECT * FROM discovery_events ORDER BY id")), before);
    assert.equal(plan.summary.sourceReads, 0);
    assert.ok(plan.summary.skippedWithoutDeepData >= 12);
    assert.equal(plan.summary.actuallyScanned, inventory.ids.length);
    assert.ok(!plan.events.some(e => e.id.includes("empty-")));
    assert.equal(plan.events.find(e => e.id === prefix + "populated")!.changes.find(c => c.section === "speakers")!.decisions[0].reason, "source_verification_not_requested");
    // A filtered plan still carries the complete accepted inventory manifest for guarded writes.
    assert.equal(digest(plan.inventoryIds), plan.inventoryHash);
    assert.ok(plan.inventoryIds!.includes(prefix + "empty-0"));
    await assert.rejects(applyPlan(plan, "not-approved"), /Approval must exactly match/);
  } finally { await clean(); }
});

test("an unresponsive source becomes REVIEW within the deadline and the next conference is scanned", async () => {
  await seed("a-hanging"); await seed("b-next");
  await dbRun("UPDATE discovery_events SET keynote_speakers=? WHERE id=?", [JSON.stringify([{ name: "Amara Okafor", source_url: `${source}/next` }]), prefix + "b-next"]);
  const started = Date.now();
  const progress: number[] = [];
  let aborted = false;
  try {
    const plan = await buildStoredDeepPlan(async (url, signal) => {
      if (url.endsWith("speakers")) { signal?.addEventListener("abort", () => { aborted = true; }); return new Promise(() => {}); }
      return { url, html: "<title>OSC 2027</title><h1>OSC 2027</h1><h2>Keynote Speakers</h2><ul><li>Amara Okafor</li></ul>" };
    }, { verifySources: true, recordTimeoutMs: 200, networkTimeoutMs: 30, batchSize: 1, progress: s => progress.push(s.actuallyScanned) });
    assert.ok(Date.now() - started < 3000, "one source must not block the scan");
    const hanging = plan.events.find(e => e.id === prefix + "a-hanging")!.changes.find(c => c.section === "speakers")!.decisions[0];
    assert.equal(hanging.verdict, "REVIEW"); assert.match(hanging.reason, /timeout/);
    assert.equal(plan.events.find(e => e.id === prefix + "b-next")!.changes.find(c => c.section === "speakers")!.decisions[0].verdict, "KEEP");
    assert.ok(plan.summary.timedOutRecords >= 1); assert.ok(aborted);
    assert.equal(progress.at(-1), plan.summary.conferencesWithDeepData);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id=?", [prefix + "a-hanging"])).keynote_speakers, member);
  } finally { await clean(); }
});

test("the whole-record deadline bounds multiple individually responsive sources", async () => {
  await seed("multi", JSON.stringify(Array.from({ length: 5 }, (_, n) => ({ name: "Amara Okafor", source_url: `${source}/speakers-${n}` }))));
  try {
    const plan = await buildStoredDeepPlan(async url => {
      await new Promise(resolve => setTimeout(resolve, 25));
      return { url, html: "<title>OSC 2027</title><h2>Keynote Speakers</h2><ul><li>Amara Okafor</li></ul>" };
    }, { verifySources: true, recordTimeoutMs: 40, networkTimeoutMs: 35 });
    const decisions = plan.events.find(e => e.id === prefix + "multi")!.changes.find(c => c.section === "speakers")!.decisions;
    assert.ok(decisions.every(d => d.verdict === "REVIEW" && d.reason === "record_timeout"));
  } finally { await clean(); }
});

test("local checkpoints resume without repeated reads or double-counting and reject changed stored data", async () => {
  await seed("resume-a"); await seed("resume-b");
  const file = path.resolve(`.stored-scan-checkpoint-${process.pid}.json`);
  let reads = 0;
  const read = async (url: string) => { reads++; return { url, html: "<title>OSC 2027</title><h2>Keynote Speakers</h2><ul><li>Amara Okafor</li></ul>" }; };
  const options = { verifySources: true, checkpointPath: file, resume: true, batchSize: 1 };
  try {
    await assert.rejects(buildStoredDeepPlan(read, { ...options, maxRecords: 1 }), /paused/);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).completed).length, 1);
    const plan = await buildStoredDeepPlan(read, options);
    const readCount = reads;
    const again = await buildStoredDeepPlan(read, options);
    assert.equal(reads, readCount);
    assert.equal(digest(again), digest(plan));
    await dbRun("UPDATE discovery_events SET keynote_speakers=? WHERE id=?", [member.replace("Amara", "Nadia"), prefix + "resume-a"]);
    await assert.rejects(buildStoredDeepPlan(read, options), /Stored data changed/);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await clean();
  }
});

test("REVIEW-plan verification pins prior conferences, preserves settled decisions and resumes safely", async () => {
  await seed("review-a"); await seed("review-b");
  await dbRun("UPDATE discovery_events SET keynote_speakers=? WHERE id=?", [member.replace("/speakers", "/pending"), prefix + "review-b"]);
  const file = path.resolve(`.review-scan-checkpoint-${process.pid}.json`);
  try {
    const original = await buildStoredDeepPlan(async () => { throw new Error("offline"); });
    const settled = original.events.find(e => e.id === prefix + "review-a")!.changes.find(c => c.section === "speakers")!;
    // A settled decision must never be sent for verification, even if its source is reachable.
    settled.decisions[0].verdict = "REMOVE"; settled.decisions[0].reason = "prior_removal";
    original.summary.REVIEW--; original.summary.REMOVE++;
    original.summary.sections.speakers.REVIEW--; original.summary.sections.speakers.REMOVE++;
    await seed("review-new-outside-scope");
    const seen: string[] = [];
    const read = async (url: string) => { seen.push(url); return { url, html: "<title>OSC 2027</title><h2>Keynote Speakers</h2><ul><li>Amara Okafor</li></ul>" }; };
    const options = { reviewPlan: original, verifySources: true, checkpointPath: file, resume: true };
    await db.execute("PRAGMA query_only=ON");
    let verified;
    try { verified = await buildStoredDeepPlan(read, options); }
    finally { await db.execute("PRAGMA query_only=OFF"); }
    assert.deepEqual(seen, [`${source}/pending`]);
    assert.equal(verified.events.length, original.events.length);
    assert.ok(!verified.events.some(e => e.id === prefix + "review-new-outside-scope"));
    assert.deepEqual(verified.events.find(e => e.id === prefix + "review-a")!.changes.find(c => c.section === "speakers")!.decisions, settled.decisions);
    assert.equal(verified.events.find(e => e.id === prefix + "review-b")!.changes.find(c => c.section === "speakers")!.decisions[0].verdict, "KEEP");
    assert.equal(verified.summary.inputPlanHash, digest(original));
    const again = await buildStoredDeepPlan(read, options);
    assert.equal(digest(again), digest(verified)); assert.equal(seen.length, 1);
    await dbRun("UPDATE discovery_events SET keynote_speakers=? WHERE id=?", [member.replace("Amara", "Nadia"), prefix + "review-b"]);
    await assert.rejects(buildStoredDeepPlan(read, options), /Stored deep data changed/);
  } finally { if (fs.existsSync(file)) fs.unlinkSync(file); await clean(); }
});

test("REVIEW-plan network failures remain REVIEW and verified absence becomes REMOVE", async () => {
  await seed("review-errors"); await seed("review-absent");
  await dbRun("UPDATE discovery_events SET keynote_speakers=? WHERE id=?", [member.replace("/speakers", "/absent"), prefix + "review-absent"]);
  try {
    const original = await buildStoredDeepPlan(async () => null);
    const result = await buildStoredDeepPlan(async url => {
      if (url.endsWith("speakers")) throw new Error("source offline");
      return { url, html: "<title>OSC 2027</title><h1>OSC 2027</h1><h2>Keynote Speakers</h2><ul><li>Lars Henriksen</li></ul>" };
    }, { reviewPlan: original, verifySources: true, networkTimeoutMs: 30, recordTimeoutMs: 200 });
    assert.equal(result.events.find(e => e.id === prefix + "review-errors")!.changes.find(c => c.section === "speakers")!.decisions[0].verdict, "REVIEW");
    assert.equal(result.events.find(e => e.id === prefix + "review-absent")!.changes.find(c => c.section === "speakers")!.decisions[0].verdict, "REMOVE");
  } finally { await clean(); }
});
