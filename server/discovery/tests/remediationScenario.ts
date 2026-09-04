import assert from "node:assert/strict";
import { closeDb, dbGet, dbRun, initDb } from "../../db";
import { initDiscoverySchema } from "../schema";
import { runUrlRemediation } from "../urlRemediation";

await initDb();
await initDiscoverySchema();
const good = "dev_remediation_good";
const bad = "dev_remediation_bad";
const staleTitle = "dev_remediation_stale_title";
await dbRun(`INSERT INTO discovery_events (id,title,normalized_title,start_date,start_year,country,status,confidence_score,
  source_url,source_domain,official_url,publish_readiness,title_verified_at,official_source_verified_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
  [good,"Official Test Symposium","official test symposium","2028-05-10",2028,"Canada","validated",0.95,
    "https://official.test/event","official.test","official.test/event","publish_ready"]);
await dbRun(`INSERT INTO discovery_event_sources (id,event_id,source_url,source_domain,source_classification,
  classification_confidence,classification_evidence,extraction_method,confidence,is_official)
  VALUES (?,?,?,?,?,?,?,?,?,?)`, ["dsrc_remediation_good",good,"https://official.test/event","official.test",
    "official_event_site",0.95,"[]","html",0.95,1]);
for (const [field,value] of [["title","Official Test Symposium"],["startDate","2028-05-10"],["country","Canada"]]) {
  await dbRun(`INSERT INTO discovery_event_fields (id,event_id,field,value,source_url,source_domain,extraction_method,confidence)
    VALUES (?,?,?,?,?,?,?,?)`, [`dfld_${field}_good`,good,field,value,"https://official.test/event","official.test","html",0.95]);
}
await dbRun(`INSERT INTO discovery_events (id,title,normalized_title,start_date,start_year,country,status,confidence_score,
  source_url,source_domain,official_url,publish_readiness,title_verified_at,official_source_verified_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
  [bad,"Top Research Conferences to Put on Your Radar","top research conferences","2028-05-10",2028,"Canada","validated",0.9,
    "https://mainevent.info/listing","mainevent.info","mainevent.info/listing","publish_ready"]);
await dbRun(`INSERT INTO discovery_event_sources (id,event_id,source_url,source_domain,source_classification,
  classification_confidence,classification_evidence,extraction_method,confidence,is_official)
  VALUES (?,?,?,?,?,?,?,?,?,?)`, ["dsrc_remediation_bad",bad,"https://mainevent.info/listing","mainevent.info",
    "official_event_site",0.9,"[]","html",0.9,1]);
await dbRun(`INSERT INTO discovery_events (id,title,normalized_title,start_date,start_year,country,status,confidence_score,
  source_url,source_domain,official_url,publish_readiness,title_verified_at,official_source_verified_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
  [staleTitle,"Reliable Climate Symposium","reliable climate symposium","2028-05-10",2028,"Canada","validated",0.9,
    "https://society.test/event","society.test","https://society.test/event","publish_ready"]);
await dbRun(`INSERT INTO discovery_event_sources (id,event_id,source_url,source_domain,source_classification,
  classification_confidence,classification_evidence,extraction_method,confidence,is_official,raw_extraction)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`, ["dsrc_remediation_stale_title",staleTitle,"https://society.test/event","society.test",
    "society_site",0.9,"[]","html",0.9,1,JSON.stringify({ title: "Unrelated Dental Congress" })]);

const report = await runUrlRemediation({ limit: 5000, eventIds: [good, bad, staleTitle] });
const repaired = await dbGet<Record<string, any>>(`SELECT official_url,publish_readiness FROM discovery_events WHERE id=?`, [good]);
const downgraded = await dbGet<Record<string, any>>(`SELECT official_url,publish_readiness FROM discovery_events WHERE id=?`, [bad]);
const staleTitleResult = await dbGet<Record<string, any>>(`SELECT official_url,publish_readiness,title_verified_at FROM discovery_events WHERE id=?`, [staleTitle]);
const history = await dbGet<Record<string, any>>(`SELECT old_value,new_value,decision FROM discovery_event_field_history
  WHERE event_id=? AND field='officialUrl' ORDER BY recorded_at DESC LIMIT 1`, [good]);
assert.equal(repaired?.official_url, "https://official.test/event");
assert.equal(repaired?.publish_readiness, "publish_ready");
assert.equal(history?.old_value, "official.test/event");
assert.equal(history?.new_value, "https://official.test/event");
assert.equal(history?.decision, "repair_absolute_url");
assert.equal(downgraded?.official_url, null);
assert.notEqual(downgraded?.publish_readiness, "publish_ready");
assert.equal(staleTitleResult?.official_url, null);
assert.equal(staleTitleResult?.title_verified_at, null);
assert.notEqual(staleTitleResult?.publish_readiness, "publish_ready");
assert.ok(report.historyRowsAdded >= 2);
await closeDb();
console.log("REMEDIATION_SCENARIO_PASS");

