// Final historical cleanup: no readers, models, enrichment, or application writers.
import { db, dbAll, dbGet } from "../db";
import fs from "node:fs";
import crypto from "node:crypto";
import { acquirePipelineLease, releasePipelineLease } from "./automation";
import { DEEP_SECTIONS } from "./deepSections";
import { DEEP_SECTION_STORAGE } from "./deepEnrichment";
import { acceptedIds, buildPlan, digest, items, manual, parse, rulesDigest,
  type Change, type Decision, type Plan, type Row } from "./deepRevalidation";
import { applyPlan, restoreRun } from "./deepCleanupStore";
import { deepInventory } from "./deepCleanupScan";

type ControlledChange = Change & { preservedFieldAfter: Row | null };
export const EXPECTED = { REMOVE: 514, REVIEW: 1281, KEEP: 0, accepted: 1104, deep: 61 };
type Expected = typeof EXPECTED;
type SavedRow = { table: string; key: string; row: Row };
const canonical = (row: Row) => Object.keys(row).sort().map(k => [k, row[k] ?? null]);
const equal = (a: Row, b: Row) => digest(canonical(a)) === digest(canonical(b));
const codeDigest = () => digest([rulesDigest(), ...["deepCleanupControlled.ts","deepCleanupStore.ts","deepCleanupCli.ts"]
  .map(name => fs.readFileSync(new URL(name,import.meta.url),"utf8").replace(/\r\n/g,"\n"))]);

/** Delete by original item position. Retained values and provenance are never rebuilt. */
export function subtract(raw: string | null, section: Change["section"], decisions: Decision[], fallback: string | null): string | null {
  const listed = items(section, raw, fallback);
  if (digest(listed) !== digest(decisions.map(({path,kind,value,sourceUrl}) => ({path,kind,value,sourceUrl}))))
    throw new Error("Plan decisions do not exactly cover original stored items.");
  if (decisions.some(d => !["KEEP","REMOVE","REVIEW"].includes(d.verdict))) throw new Error("Invalid verdict.");
  const remove = decisions.filter(d => d.verdict === "REMOVE");
  if (!remove.length) return raw;
  if (manual(parse(raw)) || listed.some(i => manual(i.value)) || remove.some(d => d.kind === "unknown"))
    throw new Error("Protected or unknown content cannot be removed.");
  const value = parse(raw);
  if (Array.isArray(value)) return JSON.stringify(value.filter((_, i) => !remove.some(d => d.path === String(i))));
  for (const key of Object.keys(value)) {
    if (key === "item_sources") continue;
    if (Array.isArray(value[key])) {
      const old = value[key];
      const retained: any[] = [];
      const sources = value.item_sources;
      const nextSources = sources ? { ...sources } : null;
      old.forEach((v: any, i: number) => { if (nextSources) delete nextSources[`${key}.${i}`]; });
      old.forEach((v: any, i: number) => {
        if (remove.some(d => d.path === `${key}.${i}`)) return;
        if (nextSources && Object.hasOwn(sources, `${key}.${i}`)) nextSources[`${key}.${retained.length}`] = sources[`${key}.${i}`];
        retained.push(v);
      });
      value[key] = retained;
      if (nextSources) value.item_sources = nextSources;
    } else if (remove.some(d => d.path === key)) {
      delete value[key];
      if (value.item_sources) delete value.item_sources[key];
    }
  }
  return JSON.stringify(value);
}

export function controlledPlan(original: Plan, expected: Expected = EXPECTED): Plan {
  if (original.version !== 1 || original.summary.sourceVerification !== "stored_only" ||
      original.summary.aiCalls !== 0 || original.summary.refillItems !== 0 || original.summary.sourceReads !== 0)
    throw new Error("Only a completed stored-only, zero-AI/no-refill plan is accepted.");
  const counts = { REMOVE: 0, REVIEW: 0, KEEP: 0 };
  const sections = Object.fromEntries(DEEP_SECTIONS.map(s => [s,{scanned:0,REMOVE:0,REVIEW:0,KEEP:0}]));
  for (const event of original.events) for (const c of event.changes)
    for (const d of [...c.decisions, ...(c.provenanceDecisions || [])]) {
      counts[d.verdict]++; sections[c.section][d.verdict]++; sections[c.section].scanned++;
    }
  for (const p of original.summary.protected || []) {
    if (p.reason === "mixed_manual_items") throw new Error("Mixed manual decision counts require a fresh protected-content plan; zero writes.");
    for (const d of p.decisions || []) {
      if (d.verdict !== "REVIEW") throw new Error("Protected content has a removal decision; zero writes.");
      counts.REVIEW++;
      sections[p.section].REVIEW++; sections[p.section].scanned++;
    }
  }
  for (const key of ["REMOVE", "REVIEW", "KEEP"] as const)
    if (counts[key] !== expected[key] || original.summary[key] !== expected[key])
      throw new Error(`${key} mismatch: expected ${expected[key]}, actual ${counts[key]}; zero writes.`);
  for (const section of DEEP_SECTIONS) if (!equal(sections[section], original.summary.sections[section]))
    throw new Error("Per-section decision count mismatch; zero writes.");
  const ids = original.inventoryIds;
  if (!ids || ids.length !== expected.accepted || digest(ids) !== original.inventoryHash ||
      new Set(ids).size !== ids.length || original.events.length !== expected.deep ||
      new Set(original.events.map(e => e.id)).size !== expected.deep ||
      original.events.some(e => !ids.includes(e.id)) || original.summary.actuallyScanned !== expected.deep ||
      original.summary.itemsScanned !== expected.REMOVE + expected.REVIEW + expected.KEEP)
    throw new Error("Approved inventory/item counts mismatch; zero writes.");
  const plan = structuredClone(original);
  // Only orchestration changed since the approved plan. Decisions are not revalidated or reclassified.
  plan.rules = rulesDigest();
  plan.summary.controlledRemoveOnly = true;
  plan.summary.approvedInputHash = digest(original);
  for (const event of plan.events) {
    const seen = new Set<string>();
    for (const change of event.changes) {
    const key = JSON.stringify([change.table,change.key,change.section]);
    if (seen.has(key)) throw new Error("Duplicate cleanup target; zero writes.");
    seen.add(key);
    if (!DEEP_SECTIONS.includes(change.section) || !["discovery_events","extracted_conferences"].includes(change.table) ||
        (change.table === "discovery_events" && change.key !== event.id) || manual(change.fieldBefore)) throw new Error("Invalid/protected target.");
    change.after = subtract(change.before, change.section, change.decisions, event.changes.find(c => c.table === "discovery_events" && c.section === change.section)?.fieldBefore?.source_url || null);
    const field = change.fieldBefore;
    let afterField = field ? structuredClone(field) : null;
    if (field) {
      const decisions = field.value === change.before ? change.decisions : change.provenanceDecisions || [];
      const value = subtract(field.value, change.section, decisions, field.source_url);
      afterField = value === field.value ? afterField : { ...field, value };
    }
    (change as ControlledChange).preservedFieldAfter = afterField;
    }
  }
  const {events,...header} = plan;
  return {...header,events};
}

async function capture(): Promise<SavedRow[]> {
  const result: SavedRow[] = [];
  // All rows, including protected published/app records, are compared by the audit.
  for (const [table, key] of [["discovery_events","id"], ["extracted_conferences","source_url"], ["discovery_event_fields","id"]]) {
    for (let offset = 0;; offset += 50) {
      const batch = await dbAll<Row>(`SELECT * FROM ${table} ORDER BY ${key} LIMIT 50 OFFSET ?`,[offset]);
      for (const row of batch) result.push({ table, key: String(row[key]), row });
      if (batch.length < 50) break;
    }
  }
  return result;
}
function expectedRows(rows: SavedRow[], plan: Plan, applied: Set<string>): SavedRow[] {
  const copy = structuredClone(rows);
  for (const event of plan.events) if (applied.has(event.id)) for (const c of event.changes as ControlledChange[]) {
    const target = copy.find(r => r.table === c.table && r.key === c.key);
    if (!target) throw new Error("Backup target missing.");
    target.row[DEEP_SECTION_STORAGE[c.section].column] = c.after;
    if (c.table === "discovery_events" && c.fieldBefore) {
      const field = copy.find(r => r.table === "discovery_event_fields" && r.key === c.fieldBefore!.id);
      if (!field || !c.preservedFieldAfter) throw new Error("Provenance backup missing.");
      field.row = structuredClone(c.preservedFieldAfter);
    }
  }
  return copy;
}
function assertRows(expected: SavedRow[], current: SavedRow[]): void {
  const index = new Map(current.map(r => [`${r.table}/${r.key}`, r.row]));
  if (expected.length !== current.length) throw new Error("Inventory/row count changed; audit stopped.");
  for (const r of expected) {
    const actual = index.get(`${r.table}/${r.key}`);
    if (!actual || !equal(r.row, actual)) throw new Error(`Stored data/core/protected-content mismatch: ${r.table}/${r.key}`);
  }
}

async function load(run: string): Promise<{ plan: Plan; rows: SavedRow[]; manifest: Row }> {
  const saved: Row[] = [];
  for (let offset = 0;; offset += 50) {
    const batch = await dbAll<Row>("SELECT * FROM discovery_deep_controlled_backup WHERE run_id=? ORDER BY kind,entry_key LIMIT 50 OFFSET ?", [run,offset]);
    saved.push(...batch);
    if (batch.length < 50) break;
  }
  const manifest = saved.find(r => r.kind === "manifest");
  if (!manifest) throw new Error("Durable backup missing. Restore the approved file or recreate and review a dry-run first.");
  const meta = JSON.parse(manifest.payload);
  const plan: Plan = { ...meta.plan, events: saved.filter(r => r.kind === "plan").map(r => JSON.parse(r.payload)) };
  const rows = saved.filter(r => r.kind === "row").map(r => JSON.parse(r.payload)) as SavedRow[];
  if (digest(plan) !== meta.planHash || digest(rows) !== meta.rowsHash ||
      saved.filter(r => r.kind === "removal").length !== meta.expected.REMOVE) throw new Error("Durable backup incomplete or damaged.");
  return { plan, rows, manifest: meta };
}

export async function backupControlled(original: Plan, run: string, expected: Expected = EXPECTED): Promise<Row> {
  const plan = controlledPlan(original, expected); // All count assertions occur BEFORE schema/lease writes.
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(run)) throw new Error("Invalid run ID.");
  const exists = await dbGet<Row>("SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_deep_controlled_backup'");
  if (exists && await dbGet("SELECT 1 FROM discovery_deep_controlled_backup WHERE run_id=? LIMIT 1", [run])) {
    const previous = await load(run);
    if (previous.manifest.inputHash !== digest(original)) throw new Error("Run already backs up a different plan.");
    return { run, status: "backed_up", cleanupRunId: previous.manifest.cleanupRunId, conferenceRowsModified: 0, aiCalls: 0 };
  }
  if (digest(await acceptedIds()) !== plan.inventoryHash) throw new Error("Accepted inventory changed; zero writes.");
  if (digest((await deepInventory()).ids) !== digest(plan.events.map(e => e.id).sort())) throw new Error("Deep inventory changed; zero writes.");
  const owner = `controlled_backup_${crypto.randomUUID()}`;
  if (!(await acquirePipelineLease(owner)).acquired) throw new Error("Pipeline is active; retry later.");
  try {
    const rows = await capture();
    // Check current ownership and exact before payloads, without using fresh verdicts.
    const fresh = await buildPlan(async () => null, { snapshots: plan.events.map(e => ({
      event: rows.find(r => r.table === "discovery_events" && r.key === e.id)!.row,
      fields: rows.filter(r => r.table === "discovery_event_fields" && r.row.event_id === e.id).map(r => r.row),
      published: rows.filter(r => r.table === "extracted_conferences" && parse(r.row.extraction_metadata)?.origin === "discovery_engine" && parse(r.row.extraction_metadata)?.discovery_event_id === e.id).map(r => r.row),
    })), maxRefillPages: 0 });
    const protectedDigest = (entries: Row[]) => digest(entries.map(p => JSON.stringify(p)).sort());
    if (protectedDigest(fresh.summary.protected) !== protectedDigest(plan.summary.protected))
      throw new Error("Protected REVIEW content changed; recreate and review dry-run.");
    for (const e of plan.events) {
      if (fresh.events.find(f => f.id === e.id)?.identityHash !== e.identityHash) throw new Error("Conference identity changed; zero cleanup writes.");
      if (fresh.events.find(f => f.id === e.id)?.changes.length !== e.changes.length) throw new Error("Deep target inventory changed; recreate and review dry-run.");
      for (const c of e.changes) {
      const valid = fresh.events.find(f => f.id === e.id)?.changes.find(f => f.table === c.table && f.key === c.key && f.section === c.section);
      if (!valid || valid.before !== c.before || !equal(valid.fieldBefore || {}, c.fieldBefore || {}) || valid.metadataBefore !== c.metadataBefore)
        throw new Error("Plan data/provenance/ownership changed; recreate and review dry-run.");
      }
    }
    assertRows(rows, await capture());
    await db.execute(`CREATE TABLE IF NOT EXISTS discovery_deep_controlled_backup (
      run_id TEXT NOT NULL,kind TEXT NOT NULL,entry_key TEXT NOT NULL,payload TEXT NOT NULL,
      PRIMARY KEY(run_id,kind,entry_key))`);
    const orderedRows = rows.sort((a,b) => `${a.table}/${a.key}` < `${b.table}/${b.key}` ? -1 : 1);
    plan.events.sort((a,b) => a.id < b.id ? -1 : 1);
    const { events, ...header } = plan;
    const timestamp = new Date().toISOString();
    const meta = { inputHash: digest(original), planHash: digest(plan), rowsHash: digest(orderedRows), codeDigest:codeDigest(),
      cleanupRunId: `deep_${digest(plan).slice(0,24)}`, timestamp, expected, plan: header };
    const records = [
      ...orderedRows.map(r => ({kind:"row",key:`${r.table}/${r.key}`,payload:r})),
      ...events.map(e => ({kind:"plan",key:e.id,payload:e})),
      ...events.flatMap(e => e.changes.flatMap((c, ci) => [...c.decisions, ...(c.provenanceDecisions || [])]
        .filter(d => d.verdict === "REMOVE").map((d, i) => ({kind:"removal",key:`${e.id}/${ci}/${i}`,payload:{runId:run,cleanupRunId:meta.cleanupRunId,
          conferenceId:e.id,conferenceTitle:e.title,section:c.section,table:c.table,targetKey:c.key,
          originalValue:d.value,source:d.sourceUrl,provenance:c.fieldBefore,reason:d.reason,timestamp}})))),
      {kind:"manifest",key:"manifest",payload:meta},
    ];
    // One durable transaction: an incomplete backup never becomes available to write mode.
    const tx = await db.transaction("write");
    try {
      for (let offset = 0; offset < records.length; offset += 50) {
        await tx.batch(records.slice(offset,offset+50).map(r => ({sql:"INSERT INTO discovery_deep_controlled_backup VALUES (?,?,?,?)",
          args:[run,r.kind,r.key,JSON.stringify(r.payload)]})));
      }
      await tx.commit();
    } catch (error) { await tx.rollback(); throw error; } finally { tx.close(); }
    await load(run);
    return { run, status:"backed_up", cleanupRunId:meta.cleanupRunId, inputHash:meta.inputHash,
      durableLocation:`Turso:discovery_deep_controlled_backup/run_id=${run}`, removals:expected.REMOVE, reviewPreserved:expected.REVIEW, conferenceRowsModified:0, aiCalls:0 };
  } finally { await releasePipelineLease(owner); }
}

async function appliedIds(cleanupRunId: string): Promise<Set<string>> {
  if (!await dbGet("SELECT name FROM sqlite_master WHERE name='discovery_deep_cleanup_checkpoints'")) return new Set();
  return new Set((await dbAll<Row>("SELECT event_id FROM discovery_deep_cleanup_checkpoints WHERE run_id=? AND state='applied'", [cleanupRunId])).map(r => r.event_id));
}
export async function writeControlled(run: string, options: {batchSize?:number;maxEvents?:number} = {}, expected: Expected = EXPECTED): Promise<Row> {
  const {plan,rows,manifest} = await load(run);
  controlledPlan(plan,expected); // Recount exact REMOVE and REVIEW decisions before any write or lease.
  if (!equal(manifest.expected,expected)) throw new Error("Backup expected-count mismatch; zero writes.");
  if (plan.rules !== rulesDigest() || manifest.codeDigest !== codeDigest()) throw new Error("Code changed since backup; review required.");
  if (digest(await acceptedIds()) !== plan.inventoryHash) throw new Error("Accepted inventory changed; zero cleanup writes.");
  assertRows(expectedRows(rows,plan,await appliedIds(manifest.cleanupRunId)),await capture());
  const result = await applyPlan(plan,digest(plan),{...options,beforeEvent:async(tx,eventId) => {
    // Validate the full conference row and every associated published/provenance row inside its transaction.
    for (const r of rows.filter(r => (r.table === "discovery_events" && r.key === eventId) ||
      (r.table === "discovery_event_fields" && r.row.event_id === eventId) ||
      (r.table === "extracted_conferences" && parse(r.row.extraction_metadata)?.discovery_event_id === eventId))) {
      const key = r.table === "extracted_conferences" ? "source_url" : "id";
      const actual = (await tx.execute({sql:`SELECT * FROM ${r.table} WHERE ${key}=?`,args:[r.key]})).rows[0];
      if (!actual || !equal(r.row,actual)) throw new Error("Concurrent core/protected data change; conference transaction aborted.");
    }
  }});
  return result.status === "completed" ? { ...result, audit:await auditControlled(run,expected) } : result;
}
export async function auditControlled(run: string, expected: Expected = EXPECTED): Promise<Row> {
  const {plan,rows,manifest} = await load(run);
  controlledPlan(plan,expected);
  const applied = await appliedIds(manifest.cleanupRunId);
  if (applied.size !== plan.events.length) throw new Error("Cleanup incomplete; resume write before final audit.");
  assertRows(expectedRows(rows,plan,applied),await capture());
  if (digest(await acceptedIds()) !== plan.inventoryHash) throw new Error("Accepted inventory changed.");
  const sections = Object.fromEntries(DEEP_SECTIONS.map(s => [s,{before:plan.summary.sections[s].scanned,
    removed:plan.summary.sections[s].REMOVE,remaining:plan.summary.sections[s].scanned-plan.summary.sections[s].REMOVE}]));
  // Count actual retained stored copies using the original inventory's counting convention.
  const remaining = Object.fromEntries(DEEP_SECTIONS.map(s => [s,0]));
  for (const e of plan.events) for (const c of e.changes as ControlledChange[]) {
    remaining[c.section] += items(c.section,c.after).length;
    if (c.provenanceDecisions?.length) remaining[c.section] += items(c.section,c.preservedFieldAfter?.value).length;
  }
  for (const p of plan.summary.protected || []) remaining[p.section] += (p.decisions || []).length;
  for (const s of DEEP_SECTIONS) if (remaining[s] !== sections[s].remaining) throw new Error(`Remaining ${s} item count mismatch.`);
  return { run, status:"verified", targetedItemsRemoved:manifest.expected.REMOVE, reviewItemsIntentionallyRemoved:0,
    remainingReview:manifest.expected.REVIEW, remainingKeep:manifest.expected.KEEP,
    remainingDeepItems:Object.values(remaining).reduce((a,b)=>a+b,0), conferencesWithDeepData:(await deepInventory()).ids.length,
    acceptedConferences:manifest.expected.accepted, coreFieldsUnchanged:true, publicationReadinessUnchanged:true,
    protectedContentUnchanged:true, customerStoredOnlyArchitecture:"unchanged by this backend-only cleanup",aiCalls:0,sections };
}
export async function restoreControlled(run: string): Promise<Row> {
  const {plan,rows,manifest} = await load(run);
  assertRows(expectedRows(rows,plan,await appliedIds(manifest.cleanupRunId)),await capture());
  const result = await restoreRun(manifest.cleanupRunId);
  assertRows(rows,await capture());
  return {...result,fullRestorationVerified:true,aiCalls:0};
}
