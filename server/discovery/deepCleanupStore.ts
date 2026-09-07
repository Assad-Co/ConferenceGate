import crypto from "node:crypto";
import { db, dbAll, dbGet, dbRun } from "../db";
import { acquirePipelineLease, releasePipelineLease } from "./automation";
import { DEEP_SECTIONS } from "./deepSections";
import { DEEP_SECTION_STORAGE } from "./deepEnrichment";
import { ACCEPTED, acceptedIds, digest, identityHash, needsChange, rulesDigest, type Plan, type Row, type Change } from "./deepRevalidation";

// Deliberately separate from application startup/schema migrations: dry-run never calls this.
async function initCleanupSchema(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS discovery_deep_cleanup_runs (
      id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL UNIQUE, rules TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS discovery_deep_cleanup_checkpoints (
      run_id TEXT NOT NULL, event_id TEXT NOT NULL, plan TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(run_id,event_id)
    );
    CREATE TABLE IF NOT EXISTS discovery_deep_cleanup_audit (
      run_id TEXT NOT NULL, event_id TEXT NOT NULL, target_table TEXT NOT NULL,
      target_key TEXT NOT NULL, section TEXT NOT NULL, before_json TEXT, after_json TEXT,
      field_before TEXT, field_after TEXT, sources TEXT NOT NULL, decisions TEXT NOT NULL,
      metadata_before TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(run_id,event_id,target_table,target_key,section)
    );
  `);
}
function validatePlan(plan: Plan): void {
  if (plan.version !== 1 || plan.rules !== rulesDigest()) throw new Error("Plan uses different rules; generate a new dry-run.");
  const inventoryIds = plan.inventoryIds || plan.events.map(e => e.id).sort();
  if (!Array.isArray(plan.events) || plan.events.length !== new Set(plan.events.map(e => e.id)).size ||
      inventoryIds.length !== new Set(inventoryIds).size || digest(inventoryIds) !== plan.inventoryHash ||
      plan.events.some(e => !inventoryIds.includes(e.id))) throw new Error("Invalid or incomplete inventory plan.");
  for (const event of plan.events) {
    const seen = new Set<string>();
    for (const change of event.changes) {
      const key = JSON.stringify([change.table, change.key, change.section]);
      if (seen.has(key)) throw new Error("Duplicate plan target."); seen.add(key);
      if (!DEEP_SECTIONS.includes(change.section) || !["discovery_events", "extracted_conferences"].includes(change.table) ||
          (change.table === "discovery_events" && change.key !== event.id) ||
          ![change.before, change.after].every(v => v === null || typeof v === "string")) throw new Error("Invalid cleanup target.");
    }
  }
}
async function fence(tx: any, owner: string): Promise<void> {
  const now = new Date();
  const result = await tx.execute({ sql: `UPDATE discovery_pipeline_locks SET stage='deep_cleanup',heartbeat_at=?,lease_expires_at=?
    WHERE name='production_data_pipeline' AND owner_id=? AND lease_expires_at>?`,
    args: [now.toISOString(), new Date(now.getTime() + 90 * 60_000).toISOString(), owner, now.toISOString()] });
  if (result.rowsAffected !== 1) throw new Error("Pipeline lease lost; cleanup stopped before any write.");
}
const get = async (tx: any, sql: string, args: any[]) => (await tx.execute({ sql, args })).rows[0] as Row | undefined;
function fieldAfter(change: Change, eventId: string, at: string): Row | null {
  if (change.after === null) return null;
  const source = Object.values(change.sources)[0];
  if (!source) throw new Error("Refusing payload without exact provenance.");
  return { id: change.fieldBefore?.id || `dfld_${crypto.randomUUID()}`, event_id: eventId,
    field: DEEP_SECTION_STORAGE[change.section].field, value: change.after, source_url: source,
    source_domain: new URL(source).hostname.replace(/^www\./, ""), extraction_method: "html",
    confidence: 0.8, last_verified: at };
}
async function replaceField(tx: any, eventId: string, section: Change["section"], field: Row | null): Promise<void> {
  const name = DEEP_SECTION_STORAGE[section].field;
  if (!field) {
    await tx.execute({ sql: "DELETE FROM discovery_event_fields WHERE event_id=? AND field=?", args: [eventId, name] }); return;
  }
  await tx.execute({ sql: `INSERT INTO discovery_event_fields
    (id,event_id,field,value,source_url,source_domain,extraction_method,confidence,last_verified) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(event_id,field) DO UPDATE SET value=excluded.value,source_url=excluded.source_url,
    source_domain=excluded.source_domain,extraction_method=excluded.extraction_method,confidence=excluded.confidence,last_verified=excluded.last_verified`,
    args: [field.id, eventId, name, field.value, field.source_url, field.source_domain, field.extraction_method, field.confidence, field.last_verified] });
}
function fieldEqual(a: Row | null | undefined, b: Row | null | undefined): boolean {
  const keys = ["id", "event_id", "field", "value", "source_url", "source_domain", "extraction_method", "confidence", "last_verified"];
  return digest(a ? keys.map(k => a[k] ?? null) : null) === digest(b ? keys.map(k => b[k] ?? null) : null);
}
async function assertTarget(tx: any, change: Change, expected: string | null): Promise<void> {
  const keyColumn = change.table === "discovery_events" ? "id" : "source_url";
  const row = await get(tx, `SELECT * FROM ${change.table} WHERE ${keyColumn}=?`, [change.key]);
  if (!row || (row[DEEP_SECTION_STORAGE[change.section].column] ?? null) !== expected ||
      (change.table === "extracted_conferences" && row.extraction_metadata !== change.metadataBefore)) {
    throw new Error(`Concurrent change at ${change.table}/${change.key}/${change.section}; generate a new dry-run.`);
  }
}

export async function applyPlan(plan: Plan, approvedHash: string,
  options: { batchSize?: number; maxEvents?: number; progress?: (done: number) => void } = {}): Promise<Row> {
  validatePlan(plan);
  const hash = digest(plan);
  if (approvedHash !== hash) throw new Error("Approval must exactly match the reviewed plan SHA-256.");
  const runId = `deep_${hash.slice(0, 24)}`;
  const owner = `deep_cleanup_${crypto.randomUUID()}`;
  const lease = await acquirePipelineLease(owner);
  if (!lease.acquired) throw new Error("Another pipeline worker is active. Retry later; schedule remains unchanged.");
  try {
    await initCleanupSchema();
    const existing = await dbGet<Row>("SELECT * FROM discovery_deep_cleanup_runs WHERE id=?", [runId]);
    if (existing?.status === "restored") throw new Error("This run was restored; create a new dry-run before cleaning again.");
    if (existing?.status === "restoring") throw new Error("Restore is in progress; resume restore instead.");
    if (existing?.status === "completed") return { runId, status: "completed", processed: 0, aiCalls: 0 };
    if (!existing && digest(await acceptedIds()) !== plan.inventoryHash) throw new Error("Accepted inventory changed; generate a new dry-run.");
    await dbRun(`INSERT OR IGNORE INTO discovery_deep_cleanup_runs(id,plan_hash,rules,status,created_at) VALUES (?,?,?,'preparing',?)`,
      [runId, hash, plan.rules, new Date().toISOString()]);
    // Durable preparation can restart midway. No conference changes until every plan is backed up.
    const batchSize = Math.max(1, Math.min(options.batchSize || 50, 100));
    for (let i = 0; i < plan.events.length; i += batchSize) {
      await db.batch(plan.events.slice(i, i + batchSize).map(event => ({
        sql: "INSERT OR IGNORE INTO discovery_deep_cleanup_checkpoints(run_id,event_id,plan,state) VALUES (?,?,?,'pending')",
        args: [runId, event.id, JSON.stringify(event)],
      })), "write");
    }
    const count = await dbGet<Row>("SELECT COUNT(*) n FROM discovery_deep_cleanup_checkpoints WHERE run_id=?", [runId]);
    if (Number(count?.n) !== plan.events.length) throw new Error("Durable plan backup incomplete; no cleanup permitted.");
    await dbRun("UPDATE discovery_deep_cleanup_runs SET status='running' WHERE id=?", [runId]);
    let processed = 0;
    for (;;) {
      const pending = await dbAll<Row>(`SELECT * FROM discovery_deep_cleanup_checkpoints WHERE run_id=? AND state='pending' ORDER BY event_id LIMIT ?`, [runId, batchSize]);
      if (!pending.length) break;
      for (const checkpoint of pending) {
        if (processed >= (options.maxEvents ?? Infinity)) return { runId, status: "paused", processed, aiCalls: 0 };
        const event = JSON.parse(checkpoint.plan) as Plan["events"][number];
        const tx = await db.transaction("write");
        try {
          await fence(tx, owner);
          const current = await get(tx, `SELECT * FROM discovery_events WHERE id=? AND ${ACCEPTED}`, [event.id]);
          if (!current || identityHash(current) !== event.identityHash) throw new Error(`Event ${event.id} changed identity or left accepted inventory.`);
          for (const change of event.changes) await assertTarget(tx, change, change.before);
          for (const change of event.changes.filter(needsChange)) {
            await assertTarget(tx, change, change.before);
            const at = new Date().toISOString();
            const field = change.table === "discovery_events" ? fieldAfter(change, event.id, at) : null;
            if (change.table === "discovery_events") {
              const currentField = await get(tx, "SELECT * FROM discovery_event_fields WHERE event_id=? AND field=?", [event.id, DEEP_SECTION_STORAGE[change.section].field]);
              if (!fieldEqual(currentField, change.fieldBefore)) throw new Error("Field provenance changed; refusing stale plan.");
            }
            // Audit insertion MUST succeed before any target UPDATE. Both commit atomically.
            await tx.execute({ sql: `INSERT INTO discovery_deep_cleanup_audit
              (run_id,event_id,target_table,target_key,section,before_json,after_json,field_before,field_after,sources,decisions,metadata_before,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [runId, event.id, change.table, change.key, change.section,
              change.before, change.after, JSON.stringify(change.fieldBefore), JSON.stringify(field),
              JSON.stringify(change.sources), JSON.stringify({ items: change.decisions, provenance: change.provenanceDecisions || [] }), change.metadataBefore || null, at] });
            const keyColumn = change.table === "discovery_events" ? "id" : "source_url";
            await tx.execute({ sql: `UPDATE ${change.table} SET ${DEEP_SECTION_STORAGE[change.section].column}=? WHERE ${keyColumn}=?`, args: [change.after, change.key] });
            if (change.table === "discovery_events") await replaceField(tx, event.id, change.section, field);
          }
          await tx.execute({ sql: "UPDATE discovery_deep_cleanup_checkpoints SET state='applied' WHERE run_id=? AND event_id=?", args: [runId, event.id] });
          await tx.commit();
        } catch (e) { await tx.rollback(); throw e; } finally { tx.close(); }
        processed++; options.progress?.(processed);
      }
    }
    await dbRun("UPDATE discovery_deep_cleanup_runs SET status='completed',completed_at=? WHERE id=?", [new Date().toISOString(), runId]);
    return { runId, status: "completed", processed, aiCalls: 0 };
  } finally { await releasePipelineLease(owner); }
}

/** Restores only the exact values this run wrote; concurrent edits fail closed, per conference. */
export async function restoreRun(runId: string, options: { maxEvents?: number } = {}): Promise<Row> {
  const run = await dbGet<Row>("SELECT * FROM discovery_deep_cleanup_runs WHERE id=?", [runId]);
  if (!run) throw new Error("Unknown cleanup run.");
  if (run.status === "restored") return { runId, status: "restored", processed: 0 };
  const owner = `deep_restore_${crypto.randomUUID()}`;
  if (!(await acquirePipelineLease(owner)).acquired) throw new Error("Another pipeline worker is active.");
  try {
    await dbRun("UPDATE discovery_deep_cleanup_runs SET status='restoring' WHERE id=?", [runId]);
    let processed = 0;
    for (;;) {
      const checkpoints = await dbAll<Row>("SELECT * FROM discovery_deep_cleanup_checkpoints WHERE run_id=? AND state='applied' ORDER BY event_id LIMIT 50", [runId]);
      if (!checkpoints.length) break;
      for (const checkpoint of checkpoints) {
        if (processed >= (options.maxEvents ?? Infinity)) return { runId, status: "restoring", processed };
        const tx = await db.transaction("write");
        try {
          await fence(tx, owner);
          const event = await get(tx, `SELECT * FROM discovery_events WHERE id=? AND ${ACCEPTED}`, [checkpoint.event_id]);
          if (!event || identityHash(event) !== JSON.parse(checkpoint.plan).identityHash) throw new Error("Restore event identity/status changed; manual review required.");
          const audits = (await tx.execute({ sql: "SELECT * FROM discovery_deep_cleanup_audit WHERE run_id=? AND event_id=?", args: [runId, checkpoint.event_id] })).rows as Row[];
          if (audits.length !== JSON.parse(checkpoint.plan).changes.filter(needsChange).length) throw new Error("Incomplete audit backup; restore stopped.");
          for (const audit of audits) {
            const change: Change = { table: audit.target_table, key: audit.target_key, section: audit.section,
              before: audit.before_json, after: audit.after_json, metadataBefore: audit.metadata_before, decisions: [], sources: {}, fieldBefore: null };
            await assertTarget(tx, change, change.after);
            if (change.table === "discovery_events") {
              const field = await get(tx, "SELECT * FROM discovery_event_fields WHERE event_id=? AND field=?", [event.id, DEEP_SECTION_STORAGE[change.section].field]);
              if (!fieldEqual(field, JSON.parse(audit.field_after))) throw new Error("Restore would overwrite newer provenance; stopped.");
              await replaceField(tx, event.id, change.section, JSON.parse(audit.field_before));
            }
            const keyColumn = change.table === "discovery_events" ? "id" : "source_url";
            await tx.execute({ sql: `UPDATE ${change.table} SET ${DEEP_SECTION_STORAGE[change.section].column}=? WHERE ${keyColumn}=?`, args: [change.before, change.key] });
          }
          await tx.execute({ sql: "UPDATE discovery_deep_cleanup_checkpoints SET state='restored' WHERE run_id=? AND event_id=?", args: [runId, event.id] });
          await tx.commit();
        } catch (e) { await tx.rollback(); throw e; } finally { tx.close(); }
        processed++;
      }
    }
    await dbRun("UPDATE discovery_deep_cleanup_runs SET status='restored' WHERE id=?", [runId]);
    return { runId, status: "restored", processed };
  } finally { await releasePipelineLease(owner); }
}
