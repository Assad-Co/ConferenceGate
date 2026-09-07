import assert from "node:assert/strict";
import test from "node:test";
import { db, dbAll, dbGet, dbRun, initDb, closeDb } from "../../db";
import { initDiscoverySchema } from "../schema";
import { buildStoredDeepPlan } from "../deepCleanupScan";
import { backupControlled, writeControlled, auditControlled, restoreControlled, controlledPlan, subtract } from "../deepCleanupControlled";
import { digest, items, type Decision, type Plan } from "../deepRevalidation";
import { DEEP_SECTIONS } from "../deepSections";
test.after(() => closeDb());

test("REMOVE-only subtraction preserves REVIEW values, unknown fields and exact source associations", () => {
  const raw = JSON.stringify({tracks:["bad","uncertain"],legacy:{x:1},item_sources:{"tracks.0":"https://a","tracks.1":"https://b"},source_url:"https://original"});
  const decisions = items("program",raw).map(i=>({...i,verdict:i.path === "tracks.0" ? "REMOVE" : "REVIEW",reason:"stored decision"})) as Decision[];
  const after=JSON.parse(subtract(raw,"program",decisions,null)!);
  assert.deepEqual(after,{tracks:["uncertain"],legacy:{x:1},item_sources:{"tracks.0":"https://b"},source_url:"https://original"});
  assert.equal(subtract(raw,"program",decisions.map(d=>({...d,verdict:"REVIEW"})),null),raw);
  assert.throws(()=>subtract(raw,"program",decisions.slice(1),null),/exactly cover/);
});

test("production-sized approved plan removes exactly 514 and retains all 1281 REVIEW items", () => {
  const inventoryIds=Array.from({length:1104},(_,i)=>`conference-${String(i).padStart(4,"0")}`);
  const sections=Object.fromEntries(DEEP_SECTIONS.map(s=>[s,{scanned:s==="speakers"?1795:0,REMOVE:s==="speakers"?514:0,REVIEW:s==="speakers"?1281:0,KEEP:0}]));
  const events=inventoryIds.slice(0,61).map((id,index)=> {
    const decisions=Array.from({length:1795},(_,i)=>i).filter(i=>i%61===index).map((i,n)=>({path:String(n),kind:"entry",
      value:{name:`Stored person ${i}`,source_url:"https://example.org/speakers"},sourceUrl:"https://example.org/speakers",
      verdict:i<514?"REMOVE":"REVIEW",reason:i<514?"confirmed_bad":"uncertain"})) as Decision[];
    return {id,title:id,identityHash:"stored-identity",changes:[{table:"discovery_events" as const,key:id,section:"speakers" as const,
      before:JSON.stringify(decisions.map(d=>d.value)),after:null,decisions,fieldBefore:null,sources:{}}]};
  });
  const plan:Plan={version:1,rules:"previous-approved-rules",createdAt:"2026-09-07",inventoryIds,inventoryHash:digest(inventoryIds),events,
    summary:{sourceVerification:"stored_only",aiCalls:0,refillItems:0,sourceReads:0,REMOVE:514,REVIEW:1281,KEEP:0,actuallyScanned:61,itemsScanned:1795,sections,protected:[]}};
  const controlled=controlledPlan(plan);
  const retained=controlled.events.flatMap(e=>JSON.parse(e.changes[0].after!));
  assert.equal(retained.length,1281);
  assert.deepEqual(retained,plan.events.flatMap(e=>e.changes[0].decisions.filter(d=>d.verdict==="REVIEW").map(d=>d.value)));
  assert.equal(plan.events.flatMap(e=>e.changes[0].decisions).filter(d=>d.verdict==="REMOVE").length,514);
  const mismatch=structuredClone(plan); mismatch.summary.REVIEW=1280;
  assert.throws(()=>controlledPlan(mismatch),/REVIEW mismatch/);
});

test("durable REMOVE-only backup, exact-count abort, failed conference rollback, resume, audit and full restore", async () => {
  await initDb(); await initDiscoverySchema();
  const origin="https://controlled.example";
  const raw=JSON.stringify([{name:"Premium Profile",source_url:origin+"/speakers"},{name:"Uncertain Person"}]);
  const provenance=JSON.stringify([{name:"Contact Us Today",source_url:origin+"/speakers"},{name:"Uncertain Provenance"}]);
  const ids=["controlled-a","controlled-b"];
  try {
    for(const id of ids) await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,start_year,official_url,source_url,source_domain,status,keynote_speakers,description)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[id,"Optical Science Congress 2027","optical science",2027,origin,origin+"/"+id,"controlled.example","validated",raw,"Protected core"]);
    await dbRun(`INSERT INTO discovery_event_fields(id,event_id,field,value,source_url,source_domain,extraction_method)
      VALUES ('controlled-field','controlled-a','keynoteSpeakers',?,?,'controlled.example','html')`,[provenance,origin+"/speakers"]);
    await dbRun("INSERT INTO extracted_conferences(source_url,keynote_speakers,extraction_metadata) VALUES (?,?,?)",
      [origin+"/published",raw,JSON.stringify({origin:"discovery_engine",discovery_event_id:ids[0]})]);
    await dbRun("INSERT INTO extracted_conferences(source_url,keynote_speakers,extraction_metadata) VALUES (?,?,?)",
      [origin+"/manual",raw,JSON.stringify({origin:"manual",discovery_event_id:ids[0]})]);
    const plan=await buildStoredDeepPlan(async()=>{throw new Error("AI/network forbidden");});
    const expected={REMOVE:plan.summary.REMOVE,REVIEW:plan.summary.REVIEW,KEEP:plan.summary.KEEP,accepted:plan.inventoryIds!.length,deep:plan.events.length};
    assert.equal(expected.REMOVE,4); assert.equal(expected.REVIEW,4);
    const before=JSON.stringify(await dbAll("SELECT * FROM discovery_events ORDER BY id"));
    const tablesBefore=JSON.stringify(await dbAll("SELECT name FROM sqlite_master ORDER BY name"));
    await assert.rejects(backupControlled(plan,"bad-count"),/mismatch/);
    assert.equal(JSON.stringify(await dbAll("SELECT name FROM sqlite_master ORDER BY name")),tablesBefore,"count mismatch creates no tables or rows");
    const corrupted=structuredClone(plan); corrupted.events.flatMap(e=>e.changes).find(c=>c.decisions.length)!.decisions=[];
    assert.throws(()=>controlledPlan(corrupted,expected),/mismatch|cover/);
    const backed=await backupControlled(plan,"controlled-final-test",expected);
    assert.equal(backed.removals,4);
    assert.equal(JSON.stringify(await dbAll("SELECT * FROM discovery_events ORDER BY id")),before);
    assert.equal((await dbAll("SELECT * FROM discovery_deep_controlled_backup WHERE run_id='controlled-final-test' AND kind='removal'")).length,4);
    assert.equal((await backupControlled(plan,"controlled-final-test",expected)).status,"backed_up");
    await assert.rejects(writeControlled("controlled-final-test"),/mismatch/);
    assert.equal(JSON.stringify(await dbAll("SELECT * FROM discovery_events ORDER BY id")),before);
    await db.executeMultiple(`CREATE TRIGGER controlled_backup_failure BEFORE INSERT ON discovery_deep_controlled_backup
      WHEN NEW.run_id='failed-backup' AND NEW.kind='manifest' BEGIN SELECT RAISE(ABORT,'durable backup failure'); END;`);
    await assert.rejects(backupControlled(plan,"failed-backup",expected),/durable backup failure/);
    assert.equal((await dbAll("SELECT * FROM discovery_deep_controlled_backup WHERE run_id='failed-backup'")).length,0);
    await db.executeMultiple("DROP TRIGGER controlled_backup_failure");
    await db.executeMultiple(`CREATE TRIGGER controlled_failure BEFORE UPDATE OF keynote_speakers ON discovery_events
      WHEN OLD.id='controlled-b' BEGIN SELECT RAISE(ABORT,'controlled batch failure'); END;`);
    await assert.rejects(writeControlled("controlled-final-test",{batchSize:1},expected),/controlled batch failure/);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id='controlled-b'")).keynote_speakers,raw);
    assert.deepEqual(JSON.parse((await dbGet<any>("SELECT keynote_speakers FROM discovery_events WHERE id='controlled-a'")).keynote_speakers),[{name:"Uncertain Person"}]);
    await assert.rejects(auditControlled("controlled-final-test",expected),/incomplete/);
    await db.executeMultiple("DROP TRIGGER controlled_failure");
    const finished=await writeControlled("controlled-final-test",{batchSize:1},expected);
    assert.equal(finished.audit.targetedItemsRemoved,4); assert.equal(finished.audit.reviewItemsIntentionallyRemoved,0);
    assert.equal((await writeControlled("controlled-final-test",{},expected)).processed,0);
    assert.deepEqual(JSON.parse((await dbGet<any>("SELECT value FROM discovery_event_fields WHERE id='controlled-field'")).value),[{name:"Uncertain Provenance"}]);
    assert.deepEqual(JSON.parse((await dbGet<any>("SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?",[origin+"/published"])).keynote_speakers),[{name:"Uncertain Person"}]);
    assert.equal((await dbGet<any>("SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?",[origin+"/manual"])).keynote_speakers,raw);
    await dbRun("UPDATE discovery_events SET description='concurrent edit' WHERE id='controlled-a'");
    await assert.rejects(auditControlled("controlled-final-test",expected),/mismatch/);
    await dbRun("UPDATE discovery_events SET description='Protected core' WHERE id='controlled-a'");
    assert.equal((await restoreControlled("controlled-final-test")).fullRestorationVerified,true);
    assert.equal(JSON.stringify(await dbAll("SELECT * FROM discovery_events ORDER BY id")),before);
    assert.equal((await restoreControlled("controlled-final-test")).processed,0);
  } finally {
    await db.executeMultiple("DROP TRIGGER IF EXISTS controlled_failure; DROP TRIGGER IF EXISTS controlled_backup_failure;");
    for(const id of ids) {await dbRun("DELETE FROM discovery_event_fields WHERE event_id=?",[id]);await dbRun("DELETE FROM discovery_events WHERE id=?",[id]);}
    await dbRun("DELETE FROM extracted_conferences WHERE source_url IN (?,?)",[origin+"/published",origin+"/manual"]);
  }
});
