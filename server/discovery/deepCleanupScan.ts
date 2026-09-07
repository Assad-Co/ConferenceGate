// Bounded orchestration of EXISTING stored deep data. No enrichment, database writes,
// migrations or publication calls. Local checkpoint files are the only persisted progress.
import fs from "node:fs";
import { dbAll } from "../db";
import { DEEP_SECTIONS } from "./deepSections";
import { DEEP_SECTION_STORAGE } from "./deepEnrichment";
import { ACCEPTED, acceptedIds, buildPlan, digest, items, rulesDigest,
  type Plan, type Reader, type Row, type StoredSnapshot } from "./deepRevalidation";

class Deadline extends Error {}
export async function bounded<T>(work: Promise<T>, ms: number, onTimeout = () => {}): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Deadline(`Timed out after ${ms}ms`)); onTimeout(); }, ms);
    })]);
  } finally { clearTimeout(timer!); }
}
// JSON-aware filtering: empty envelopes such as {sessions:[],source_url:...} are not data.
// Malformed and unknown nonempty legacy values remain candidates for the existing validator.
function populated(column: string): string {
  return `(CASE WHEN ${column} IS NULL OR trim(${column})='' THEN 0
    WHEN NOT json_valid(${column}) THEN 1
    WHEN json_type(${column})='null' THEN 0
    WHEN json_type(${column})='array' THEN json_array_length(${column})>0
    WHEN json_type(${column})='object' THEN EXISTS (
      SELECT 1 FROM json_each(${column}) j WHERE j.key NOT IN ('source_url','item_sources')
      AND j.value IS NOT NULL AND CASE WHEN j.type='array' THEN json_array_length(j.value)>0
        ELSE CAST(j.value AS TEXT)<>'' END)
    ELSE ${column}<>'""' END)`;
}
const deepColumns = (alias: string) => DEEP_SECTIONS.map(s => populated(`${alias}.${DEEP_SECTION_STORAGE[s].column}`)).join(" OR ");
const metadata = "CASE WHEN json_valid(p.extraction_metadata) THEN p.extraction_metadata ELSE '{}' END";
const fields = DEEP_SECTIONS.map(s => `'${DEEP_SECTION_STORAGE[s].field}'`).join(",");

export async function deepInventory(): Promise<{ ids: string[]; hasPublished: boolean }> {
  const hasPublished = (await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='extracted_conferences'")).length > 0;
  const result = await dbAll<Row>(`SELECT e.id FROM discovery_events e WHERE ${ACCEPTED} AND (
    ${deepColumns("e")} OR EXISTS (SELECT 1 FROM discovery_event_fields f WHERE f.event_id=e.id
      AND f.field IN (${fields}) AND ${populated("f.value")})
    ${hasPublished ? `OR EXISTS (SELECT 1 FROM extracted_conferences p
      WHERE json_extract(${metadata},'$.origin')='discovery_engine'
      AND json_extract(${metadata},'$.discovery_event_id')=e.id AND (${deepColumns("p")}))` : ""}
    ) ORDER BY e.id`);
  return { ids: result.map(r => String(r.id)), hasPublished };
}
async function snapshots(ids: string[], hasPublished: boolean): Promise<StoredSnapshot[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const events = await dbAll<Row>(`SELECT * FROM discovery_events WHERE ${ACCEPTED} AND id IN (${placeholders}) ORDER BY id`, ids);
  const provenance = await dbAll<Row>(`SELECT * FROM discovery_event_fields WHERE event_id IN (${placeholders}) AND field IN (${fields}) ORDER BY event_id,field`, ids);
  const published = hasPublished ? await dbAll<Row>(`SELECT p.* FROM extracted_conferences p WHERE
    json_extract(${metadata},'$.origin')='discovery_engine' AND json_extract(${metadata},'$.discovery_event_id') IN (${placeholders}) ORDER BY source_url`, ids) : [];
  if (events.length !== ids.length) throw new Error("Accepted inventory changed; start a new dry-run.");
  return events.map(event => ({ event, fields: provenance.filter(f => f.event_id === event.id),
    published: published.filter(p => JSON.parse(p.extraction_metadata).discovery_event_id === event.id) }));
}
interface Completed { inputHash: string; plan: Plan }
interface Checkpoint {
  version: 1; manifest: string; inventoryIds: string[]; deepIds: string[];
  createdAt: string; completed: Record<string, Completed>;
}
export interface ScanOptions {
  batchSize?: number; recordTimeoutMs?: number; networkTimeoutMs?: number;
  verifySources?: boolean; checkpointPath?: string; resume?: boolean; maxRecords?: number;
  progress?: (summary: Row) => void;
}
function inputHash(snapshot: StoredSnapshot): string {
  const { event } = snapshot;
  return digest({ identity: [event.id,event.title,event.acronym,event.start_year,event.start_date,event.official_url,event.status],
    sections: DEEP_SECTIONS.map(s => event[DEEP_SECTION_STORAGE[s].column] ?? null),
    fields: snapshot.fields, published: snapshot.published });
}
function summaryFor(total: number, deep: number): Row {
  return { totalAcceptedInventory: total, conferencesWithDeepData: deep, actuallyScanned: 0, acceptedScanned: 0,
    skippedWithoutDeepData: total - deep, itemsScanned: 0, KEEP: 0, REMOVE: 0, REVIEW: 0,
    affectedConferences: 0, protected: [], representativeRemovals: [], refillItems: 0,
    timedOutRecords: 0, networkTimeouts: 0, sourceReads: 0, aiCalls: 0,
    sections: Object.fromEntries(DEEP_SECTIONS.map(s => [s, { scanned: 0, KEEP: 0, REMOVE: 0, REVIEW: 0 }])) };
}
function add(summary: Row, part: Row): void {
  summary.actuallyScanned++; summary.acceptedScanned++;
  for (const key of ["itemsScanned","KEEP","REMOVE","REVIEW","affectedConferences","timedOutRecords","networkTimeouts","sourceReads"]) summary[key] += Number(part[key] || 0);
  summary.protected.push(...part.protected);
  summary.representativeRemovals.push(...part.representativeRemovals.slice(0, 30 - summary.representativeRemovals.length));
  for (const s of DEEP_SECTIONS) for (const key of ["scanned","KEEP","REMOVE","REVIEW"]) summary.sections[s][key] += part.sections[s][key];
}
function save(file: string, checkpoint: Checkpoint): void {
  const temporary = `${file}.tmp`;
  const fd = fs.openSync(temporary, "w");
  try { fs.writeFileSync(fd, JSON.stringify(checkpoint)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
async function scanRecord(snapshot: StoredSnapshot, read: Reader, options: Required<Pick<ScanOptions,"verifySources"|"recordTimeoutMs"|"networkTimeoutMs">>): Promise<Plan> {
  const controller = new AbortController();
  const cache = new Map<string, ReturnType<Reader>>();
  const timeoutUrls = new Set<string>();
  let sourceReads = 0;
  const limited: Reader = url => {
    if (!options.verifySources || controller.signal.aborted) return Promise.resolve(null);
    if (!cache.has(url)) cache.set(url, (async () => {
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      sourceReads++;
      try { return await bounded(read(url, request.signal), options.networkTimeoutMs, () => request.abort()); }
      catch (error) { if (error instanceof Deadline) timeoutUrls.add(url); return null; }
      finally { controller.signal.removeEventListener("abort", abort); }
    })());
    return cache.get(url)!;
  };
  let recordTimeout = false;
  let plan: Plan;
  try {
    plan = await bounded(buildPlan(limited, { snapshots: [snapshot], maxRefillPages: 0 }), options.recordTimeoutMs, () => controller.abort());
  } catch (error) {
    if (!(error instanceof Deadline)) throw error;
    recordTimeout = true;
    // Same validators, now with unavailable evidence. Unsupported items become REVIEW;
    // deterministic stored-value removals and manual protections still apply unchanged.
    plan = await buildPlan(async () => null, { snapshots: [snapshot], maxRefillPages: 0 });
  } finally { controller.abort(); }
  const reason = (url: string | null) => recordTimeout ? "record_timeout" : timeoutUrls.has(url || "") ? "source_verification_timeout" :
    !options.verifySources ? "source_verification_not_requested" : "source_unreadable";
  for (const event of plan.events) for (const change of event.changes) {
    for (const d of [...change.decisions, ...(change.provenanceDecisions || [])]) if (d.reason === "source_unreadable") d.reason = reason(d.sourceUrl);
  }
  for (const d of plan.summary.representativeRemovals) if (d.reason === "source_unreadable") d.reason = reason(d.sourceUrl);
  Object.assign(plan.summary, { timedOutRecords: recordTimeout || timeoutUrls.size > 0 ? 1 : 0, networkTimeouts: timeoutUrls.size, sourceReads });
  return plan;
}

export async function buildStoredDeepPlan(read: Reader, options: ScanOptions = {}): Promise<Plan> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 50, 100));
  const recordTimeoutMs = Math.max(1, Math.min(options.recordTimeoutMs ?? 15000, 60000));
  const networkTimeoutMs = Math.max(1, Math.min(options.networkTimeoutMs ?? 5000, recordTimeoutMs));
  const databaseTimeoutMs = 30000;
  // Filter before loading any conference payload or requesting source evidence.
  const inventory = await bounded(deepInventory(), databaseTimeoutMs);
  const inventoryIds = await bounded(acceptedIds(), databaseTimeoutMs);
  const rules = rulesDigest();
  const manifest = digest([rules, inventoryIds, inventory.ids, !!options.verifySources, recordTimeoutMs, networkTimeoutMs]);
  let checkpoint: Checkpoint = { version: 1, manifest, inventoryIds, deepIds: inventory.ids, createdAt: new Date().toISOString(), completed: {} };
  if (options.checkpointPath && fs.existsSync(options.checkpointPath)) {
    if (!options.resume) throw new Error("Checkpoint exists; use --resume 1 or a new checkpoint path.");
    checkpoint = JSON.parse(fs.readFileSync(options.checkpointPath, "utf8"));
    if (checkpoint.version !== 1 || checkpoint.manifest !== manifest ||
        Object.keys(checkpoint.completed).some(id => !inventory.ids.includes(id))) throw new Error("Checkpoint inventory, rules or options changed; start a new dry-run.");
  }
  if (options.checkpointPath) save(options.checkpointPath, checkpoint);
  const summary = summaryFor(inventoryIds.length, inventory.ids.length);
  const plan: Plan = { version: 1, rules, createdAt: checkpoint.createdAt, inventoryIds,
    inventoryHash: digest(inventoryIds), events: [], summary };
  summary.sourceVerification = options.verifySources ? "stored_source_urls_only" : "stored_only";
  options.progress?.(summary);
  let newlyScanned = 0;
  for (let offset = 0; offset < inventory.ids.length; offset += batchSize) {
    const batch = await bounded(snapshots(inventory.ids.slice(offset, offset + batchSize), inventory.hasPublished), databaseTimeoutMs);
    for (const snapshot of batch) {
      const id = String(snapshot.event.id);
      const hash = inputHash(snapshot);
      const previous = checkpoint.completed[id];
      if (previous && previous.inputHash !== hash) throw new Error(`Stored data changed for ${id}; start a new dry-run.`);
      if (!previous) {
        if (newlyScanned >= (options.maxRecords ?? Infinity)) throw new Error("Dry-run paused at its record limit; resume using the saved checkpoint.");
        // SQL and the actual item enumerator must agree before any optional network call.
        const hasItems = DEEP_SECTIONS.some(s => items(s, snapshot.event[DEEP_SECTION_STORAGE[s].column]).length ||
          snapshot.fields.some(f => f.field === DEEP_SECTION_STORAGE[s].field && items(s, f.value).length) ||
          snapshot.published.some(p => items(s, p[DEEP_SECTION_STORAGE[s].column]).length));
        if (!hasItems) throw new Error(`Stored-data inventory changed for ${id}; start a new dry-run.`);
        const result = await scanRecord(snapshot, read, { verifySources: !!options.verifySources, recordTimeoutMs, networkTimeoutMs });
        checkpoint.completed[id] = { inputHash: hash, plan: result };
        if (options.checkpointPath) save(options.checkpointPath, checkpoint);
        newlyScanned++;
      }
      const result = checkpoint.completed[id].plan;
      plan.events.push(...result.events); add(summary, result.summary);
      options.progress?.(summary);
    }
  }
  // Reject a moving inventory rather than silently certify a partial scan.
  if (digest((await bounded(deepInventory(), databaseTimeoutMs)).ids) !== digest(inventory.ids) ||
      digest(await bounded(acceptedIds(), databaseTimeoutMs)) !== plan.inventoryHash) throw new Error("Inventory changed during scan; start a new dry-run.");
  summary.cleanlinessCanBeCertified = summary.protected.length === 0;
  summary.protectedConferenceCount = new Set(summary.protected.map((p: Row) => p.eventId)).size;
  return plan;
}
