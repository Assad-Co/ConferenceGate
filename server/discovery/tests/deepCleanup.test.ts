import assert from "node:assert/strict";
import test from "node:test";
import { db, dbAll, dbGet, dbRun, initDb, closeDb } from "../../db";
import { initDiscoverySchema } from "../schema";
import { DEEP_SECTIONS, extractDeepSections } from "../deepSections";
import { DEEP_SECTION_STORAGE, serializeDeepSection } from "../deepEnrichment";
import { eventIdentityFrom } from "../eventIdentity";
import { buildPlan, digest, validateSection, needsChange, type Reader } from "../deepRevalidation";
import { applyPlan, restoreRun } from "../deepCleanupStore";

const origin = "https://cleanup.example";
const identity = eventIdentityFrom({ title: "Optical Science Congress 2027", acronym: "OSC", start_year: 2027, official_url: `${origin}/` })!;
const html = `<html><title>OSC 2027</title><h1>OSC 2027</h1>
  <h2>Keynote Speakers</h2><ul><li>Amara Okafor</li></ul>
  <h2>Scientific Committee</h2><ul><li>Lars Henriksen</li></ul>
  <h2>Gold Sponsors</h2><ul><li>Acme Instruments Ltd</li></ul>
  <h2>Conference Programme</h2><table><tr><th>Time</th><th>Session</th></tr><tr><td>09:00</td><td>Advances in Optical Sensing</td></tr></table>
  <h2>Contact</h2><a href="https://www.linkedin.com/company/osc2027">LinkedIn</a></html>`;
const read: Reader = async url => ({ url, html });
const bad = JSON.stringify([{ name: "Premium Profile", source_url: `${origin}/speakers` }]);
test.after(() => closeDb());

for (const section of DEEP_SECTIONS) {
  test(`deep cleanup retains real ${section} from conference-owned subpage`, async () => {
    const url = `${origin}/${section}`;
    const raw = serializeDeepSection(section, extractDeepSections(html, url));
    assert.ok(raw, `${section} fixture must contain genuine data`);
    const decisions = await validateSection(section, raw, url, identity, read);
    assert.ok(decisions.length > 0);
    assert.ok(decisions.every(d => d.verdict === "KEEP"), JSON.stringify(decisions));
  });
}
test("deep cleanup rejects cross-event shared-platform contamination without fetching", async () => {
  const shared = eventIdentityFrom({ title: "SNMMI Annual Meeting", acronym: "SNMMI", start_year: 2027, official_url: "https://emedevents.com/c/2027/snmmi" })!;
  for (const url of ["https://emedevents.com/c/2026/cme-workshop", "https://emedevents.com/medical-organizers", "https://emedevents.com/medical-conference-speaker-opportunities", "https://emedevents.com/newsletter"]) {
    const results = await validateSection("speakers", [{ name: "Amara Okafor", source_url: url }], null, shared, async () => { throw new Error("must not fetch unrelated URL"); });
    assert.equal(results[0].verdict, "REMOVE", url);
  }
});
test("deep cleanup removes wrong-year pages, URLs and foreign redirects", async () => {
  for (const reader of [async (url: string) => ({ url, html: html.replaceAll("2027", "2026") }),
    async () => ({ url: "https://unrelated.example/speakers", html })]) {
    const decisions = await validateSection("speakers", [{ name: "Amara Okafor", source_url: `${origin}/speakers` }], null, identity, reader);
    assert.equal(decisions[0].verdict, "REMOVE");
  }
});
test("deep cleanup reviews unreadable/malformed/no-provenance data and removes boilerplate", async () => {
  assert.equal((await validateSection("speakers", bad, null, identity, read))[0].verdict, "REMOVE");
  assert.equal((await validateSection("speakers", [{ name: "Amara Okafor" }], null, identity, read))[0].verdict, "REVIEW");
  assert.equal((await validateSection("program", "broken JSON", null, identity, read))[0].verdict, "REVIEW");
  const valid = [{ name: "Amara Okafor", source_url: `${origin}/speakers` }];
  assert.equal((await validateSection("speakers", valid, null, identity, async () => null))[0].verdict, "REVIEW");
  valid[0] = { ...valid[0], ...{ org: "Invented University" } };
  assert.equal((await validateSection("speakers", valid, null, identity, read))[0].verdict, "REMOVE");
});

async function seed(id: string, status = "validated") {
  await dbRun(`INSERT INTO discovery_events(id,title,normalized_title,start_year,official_url,source_url,source_domain,status,keynote_speakers,description,city,country)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, "Optical Science Congress 2027", "optical science", 2027,
    `${origin}/`, `${origin}/${id}`, "cleanup.example", status, bad, "Core description stays", "Paris", "France"]);
}
async function snapshot() {
  const tables = await dbAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const result: Record<string, unknown> = {};
  for (const { name } of tables) result[name] = await dbAll(`SELECT * FROM "${name.replaceAll('"', '""')}"`);
  return JSON.stringify(result);
}
test("database-wide dry-run, audited writes, resumable checkpoints, published/manual safety, idempotence and restore", async () => {
  await initDb(); await initDiscoverySchema();
  const ids = ["cleanup-a", "cleanup-b", "cleanup-c", "cleanup-rejected", "cleanup-manual"];
  try {
    await seed(ids[0]); await seed(ids[1], "published"); await seed(ids[2]); await seed(ids[3], "rejected"); await seed(ids[4]);
    await dbRun(`INSERT INTO discovery_event_fields(id,event_id,field,value,source_url,source_domain,extraction_method)
      VALUES ('cleanup-field',?,'keynoteSpeakers',?,?,'cleanup.example','manual')`, [ids[4], bad, `${origin}/speakers`]);
    await dbRun(`INSERT INTO extracted_conferences(source_url,keynote_speakers,extraction_metadata)
      VALUES (?,?,?)`, [`${origin}/published`, bad, JSON.stringify({ origin: "discovery_engine", discovery_event_id: ids[1] })]);
    await dbRun(`INSERT INTO extracted_conferences(source_url,keynote_speakers,extraction_metadata)
      VALUES (?,?,?)`, [`${origin}/manual`, bad, JSON.stringify({ origin: "manual", discovery_event_id: ids[1] })]);
    const before = await snapshot();
    await db.execute("PRAGMA query_only=ON");
    let plan: Awaited<ReturnType<typeof buildPlan>>;
    try { plan = await buildPlan(read, { batchSize: 1, maxRefillPages: 0 }); }
    finally { await db.execute("PRAGMA query_only=OFF"); }
    assert.equal(await snapshot(), before, "dry-run writes zero rows and creates zero tables");
    assert.equal(plan.summary.acceptedScanned, Number((await dbGet<any>("SELECT COUNT(*) n FROM discovery_events WHERE status IN ('validated','published','needs_review')")).n));
    assert.ok(plan.events.some(e => e.id === ids[1]));
    assert.ok(!plan.events.some(e => e.id === ids[3]));
    assert.ok(plan.summary.protected.some((p: any) => p.eventId === ids[4]));
    assert.equal(plan.summary.aiCalls, 0);
    await assert.rejects(applyPlan(plan, "wrong"), /Approval/);
    const paused = await applyPlan(plan, digest(plan), { batchSize: 1, maxEvents: 1 });
    assert.equal(paused.status, "paused");
    const run = await applyPlan(plan, digest(plan), { batchSize: 1 });
    assert.equal(run.status, "completed");
    for (const id of ids.slice(0, 3)) {
      const event = await dbGet<any>("SELECT * FROM discovery_events WHERE id=?", [id]);
      assert.equal(event.keynote_speakers, null);
      assert.equal(event.description, "Core description stays"); assert.equal(event.city, "Paris");
    }
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id=?", [ids[3]])).keynote_speakers, bad);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id=?", [ids[4]])).keynote_speakers, bad);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [`${origin}/published`])).keynote_speakers, "[]");
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [`${origin}/manual`])).keynote_speakers, bad);
    const audits = await dbAll<any>("SELECT * FROM discovery_deep_cleanup_audit WHERE run_id=?", [run.runId]);
    assert.ok(audits.some(a => a.before_json === bad && a.decisions.includes("Premium Profile")));
    assert.equal((await applyPlan(plan, digest(plan))).processed, 0);
    const again = await buildPlan(read, { maxRefillPages: 0 });
    assert.ok(again.events.filter(e => ids.includes(e.id)).every(e => !e.changes.some(needsChange)));
    assert.equal((await restoreRun(run.runId, { maxEvents: 1 })).status, "restoring");
    await assert.rejects(applyPlan(plan, digest(plan)), /Restore is in progress/);
    assert.equal((await restoreRun(run.runId)).status, "restored");
    assert.equal((await restoreRun(run.runId)).processed, 0);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id=?", [ids[0]])).keynote_speakers, bad);
  } finally {
    for (const id of ids) { await dbRun("DELETE FROM discovery_events WHERE id=?", [id]); await dbRun("DELETE FROM discovery_event_fields WHERE event_id=?", [id]); }
    await dbRun("DELETE FROM extracted_conferences WHERE source_url IN (?,?)", [`${origin}/published`, `${origin}/manual`]);
  }
});
test("audit must exist before removal and audit failure rolls back the conference", async () => {
  await initDb(); await initDiscoverySchema(); await seed("cleanup-audit");
  try {
    const plan = await buildPlan(read, { maxRefillPages: 0 });
    // Prepare durable tables without applying a conference, simulating an interrupted job.
    await applyPlan(plan, digest(plan), { maxEvents: 0 });
    await db.executeMultiple(`CREATE TRIGGER cleanup_audit_failure BEFORE INSERT ON discovery_deep_cleanup_audit
      WHEN NEW.event_id='cleanup-audit' BEGIN SELECT RAISE(ABORT,'audit storage failed'); END;`);
    await assert.rejects(applyPlan(plan, digest(plan)), /audit storage failed/);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id='cleanup-audit'")).keynote_speakers, bad);
    await db.executeMultiple("DROP TRIGGER cleanup_audit_failure;");
    await db.executeMultiple(`CREATE TRIGGER cleanup_requires_audit BEFORE UPDATE OF keynote_speakers ON discovery_events
      WHEN OLD.id='cleanup-audit' AND NOT EXISTS (SELECT 1 FROM discovery_deep_cleanup_audit WHERE event_id=OLD.id AND before_json=OLD.keynote_speakers)
      BEGIN SELECT RAISE(ABORT,'missing preceding audit'); END;`);
    await applyPlan(plan, digest(plan));
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id='cleanup-audit'")).keynote_speakers, null);
  } finally {
    await db.executeMultiple("DROP TRIGGER IF EXISTS cleanup_audit_failure; DROP TRIGGER IF EXISTS cleanup_requires_audit;");
    await dbRun("DELETE FROM discovery_events WHERE id='cleanup-audit'");
  }
});
test("cleanup refuses stale data and restore refuses newer manual edits", async () => {
  await seed("cleanup-race");
  try {
    const plan = await buildPlan(read, { maxRefillPages: 0 });
    await dbRun("UPDATE discovery_events SET keynote_speakers='[]' WHERE id='cleanup-race'");
    await assert.rejects(applyPlan(plan, digest(plan)), /Concurrent change/);
    await dbRun("UPDATE discovery_events SET keynote_speakers=? WHERE id='cleanup-race'", [bad]);
    const run = await applyPlan(plan, digest(plan));
    await dbRun("UPDATE discovery_events SET keynote_speakers='[]' WHERE id='cleanup-race'");
    await assert.rejects(restoreRun(run.runId), /Concurrent change/);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id='cleanup-race'")).keynote_speakers, "[]");
  } finally { await dbRun("DELETE FROM discovery_events WHERE id='cleanup-race'"); }
});
test("missing sections are rebuilt with exact provenance and rejected content stays excluded", async () => {
  await seed("cleanup-refill");
  try {
    const plan = await buildPlan(read, { maxRefillPages: 4 });
    const event = plan.events.find(e => e.id === "cleanup-refill")!;
    for (const section of DEEP_SECTIONS) {
      const change = event.changes.find(c => c.section === section)!;
      assert.ok(change.after, section);
      assert.ok(!change.after.includes("Premium Profile"));
      assert.ok(Object.values(change.sources).every(url => url.startsWith(origin)));
    }
    await applyPlan(plan, digest(plan));
    const again = await buildPlan(read, { maxRefillPages: 4 });
    assert.ok(!again.events.find(e => e.id === "cleanup-refill")!.changes.some(needsChange));
  } finally { await dbRun("DELETE FROM discovery_events WHERE id='cleanup-refill'"); await dbRun("DELETE FROM discovery_event_fields WHERE event_id='cleanup-refill'"); }
});
test("orphaned field provenance is revalidated, audited and restored; divergent published content is reported", async () => {
  await seed("cleanup-orphan");
  try {
    await dbRun("UPDATE discovery_events SET keynote_speakers=NULL WHERE id='cleanup-orphan'");
    await dbRun(`INSERT INTO discovery_event_fields(id,event_id,field,value,source_url,source_domain,extraction_method)
      VALUES ('cleanup-orphan-field','cleanup-orphan','keynoteSpeakers',?,?,'cleanup.example','html')`, [bad, `${origin}/speakers`]);
    await dbRun(`INSERT INTO extracted_conferences(source_url,keynote_speakers,extraction_metadata) VALUES (?,?,?)`,
      [`${origin}/divergent`, '[{"name":"Manual Custom Name"}]', JSON.stringify({ origin: "discovery_engine", discovery_event_id: "cleanup-orphan" })]);
    const plan = await buildPlan(read, { maxRefillPages: 0 });
    assert.ok(plan.summary.protected.some((p: any) => p.reason === "published_field_ownership_unresolved"));
    assert.ok(plan.events.find(e => e.id === "cleanup-orphan")!.changes.some(c => c.provenanceDecisions?.length));
    const run = await applyPlan(plan, digest(plan));
    assert.equal(await dbGet("SELECT * FROM discovery_event_fields WHERE id='cleanup-orphan-field'"), undefined);
    await restoreRun(run.runId);
    assert.equal((await dbGet<any>("SELECT value FROM discovery_event_fields WHERE id='cleanup-orphan-field'")).value, bad);
  } finally {
    await dbRun("DELETE FROM discovery_events WHERE id='cleanup-orphan'");
    await dbRun("DELETE FROM discovery_event_fields WHERE event_id='cleanup-orphan'");
    await dbRun("DELETE FROM extracted_conferences WHERE source_url=?", [`${origin}/divergent`]);
  }
});
