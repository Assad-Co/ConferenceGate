import crypto from "crypto";
import { dbAll, dbGet, dbRun } from "../db";
import { auditPublishReady } from "./controlledPublish";
import { auditDiscoveredConferences } from "./audit";
import { reclassifyAllPublishReadiness, runEnrichment } from "./enrichment";
import { buildInventoryReport, type InventoryReport } from "./inventory";
import { isPublishEnabled, publishDiscoveredConferences, type PublishResult } from "./publish";
import { runProductionScale } from "./scale";

const LOCK_NAME = "production_data_pipeline";
const ACCEPTED = "('validated','published','needs_review')";
const CHECKPOINTS = [2_000, 3_000, 5_000] as const;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export interface AutomationOptions {
  targetAccepted?: number;
  targetPublished?: number;
  batchPages?: number;
  enrichmentLimit?: number;
  maxSearchQueries?: number;
  enrichmentSearchQueries?: number;
  maxJinaPages?: number;
  enrichmentJinaPages?: number;
  discoveryTimeBudgetMs?: number;
  enrichmentTimeBudgetMs?: number;
  leaseMinutes?: number;
  scheduleHours?: number;
  quiet?: boolean;
}

export interface AutomationResult {
  runId: string;
  status: "completed" | "locked" | "failed";
  stage: string;
  inventory: InventoryReport;
  publication: PublishResult | null;
  nextScheduledAt: string;
}

export interface PipelineLease {
  acquired: boolean;
  ownerId: string;
  expiresAt: string | null;
}

export function automationPublicationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONFERENCEGATE_AUTOMATION_PUBLICATION === "1";
}

export function nextScheduledAt(now = new Date(), scheduleHours = 4): string {
  const cadence = Math.max(1, Math.floor(scheduleHours));
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(17);
  if (candidate <= now) candidate.setUTCHours(candidate.getUTCHours() + 1);
  while (candidate.getUTCHours() % cadence !== 0) candidate.setUTCHours(candidate.getUTCHours() + 1);
  return candidate.toISOString();
}

export async function acquirePipelineLease(ownerId: string, leaseMinutes = 90): Promise<PipelineLease> {
  const minutes = Math.max(15, Math.min(leaseMinutes, 180));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  await dbRun(`INSERT INTO discovery_pipeline_locks
      (name,owner_id,stage,acquired_at,heartbeat_at,lease_expires_at)
      VALUES (?,?,?, ?,?,?)
      ON CONFLICT(name) DO UPDATE SET owner_id=excluded.owner_id,stage=excluded.stage,
        acquired_at=excluded.acquired_at,heartbeat_at=excluded.heartbeat_at,
        lease_expires_at=excluded.lease_expires_at
      WHERE discovery_pipeline_locks.lease_expires_at<=? OR discovery_pipeline_locks.owner_id=?`,
    [LOCK_NAME, ownerId, "starting", now.toISOString(), now.toISOString(), expiresAt, now.toISOString(), ownerId]);
  const row = await dbGet<{ owner_id: string; lease_expires_at: string }>(
    "SELECT owner_id,lease_expires_at FROM discovery_pipeline_locks WHERE name=?", [LOCK_NAME]);
  return { acquired: row?.owner_id === ownerId, ownerId, expiresAt: row?.owner_id === ownerId ? row.lease_expires_at : null };
}

async function heartbeat(ownerId: string, stage: string, leaseMinutes: number): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  await dbRun(`UPDATE discovery_pipeline_locks SET stage=?,heartbeat_at=?,lease_expires_at=?
    WHERE name=? AND owner_id=?`, [stage, now.toISOString(), expires, LOCK_NAME, ownerId]);
}

export async function releasePipelineLease(ownerId: string): Promise<void> {
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name=? AND owner_id=?", [LOCK_NAME, ownerId]);
}

/** Applies the same database lease to manual/API heavy work, closing the race with automation. */
export async function withPipelineLease<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const ownerId = id("manual");
  const lease = await acquirePipelineLease(ownerId, 90);
  if (!lease.acquired) throw new Error("Another discovery, enrichment, or publication worker is already active.");
  const timer = setInterval(() => void heartbeat(ownerId, stage, 90).catch(() => undefined), 60_000);
  timer.unref();
  try {
    await heartbeat(ownerId, stage, 90);
    return await work();
  } finally {
    clearInterval(timer);
    await releasePipelineLease(ownerId);
  }
}

async function setStage(runId: string, ownerId: string, stage: string, leaseMinutes: number): Promise<void> {
  await heartbeat(ownerId, stage, leaseMinutes);
  await dbRun("UPDATE discovery_automation_runs SET stage=? WHERE id=?", [stage, runId]);
  await dbRun(`UPDATE discovery_automation_state SET status='running',current_stage=?,current_run_id=?,
    updated_at=datetime('now') WHERE id=1`, [stage, runId]);
}

async function countPublishCandidates(): Promise<number> {
  return Number((await dbGet<{ count: number }>(`SELECT COUNT(*) count FROM discovery_events e
    WHERE e.status='validated' AND e.publish_readiness='publish_ready'
      AND NOT EXISTS (SELECT 1 FROM discovery_review_queue q WHERE q.status='open'
        AND (q.event_id=e.id OR q.candidate_event_id=e.id))`))?.count || 0);
}

async function quarantineAuditFailures(failures: Array<{ eventId: string; reasons: string[] }>): Promise<void> {
  for (const failure of failures) {
    if (!failure.eventId || failure.eventId === "sample") continue;
    const reviewId = id("dreview");
    await dbRun(`INSERT INTO discovery_review_queue (id,event_id,reason,payload,status)
      SELECT ?,?,?,?,'open' WHERE NOT EXISTS (SELECT 1 FROM discovery_review_queue
        WHERE event_id=? AND status='open' AND reason='automated_publication_audit_failed')`,
      [reviewId, failure.eventId, "automated_publication_audit_failed",
        JSON.stringify({ reasons: failure.reasons }), failure.eventId]);
    await dbRun(`UPDATE discovery_events SET publish_readiness='needs_review' WHERE id=?`, [failure.eventId]);
  }
}

export async function buildEnrichmentCoverage(): Promise<Record<string, number>> {
  const row = await dbGet<Record<string, number>>(`SELECT COUNT(*) total,
    SUM(description IS NOT NULL AND description<>'') description,
    SUM(organizer IS NOT NULL AND organizer<>'') organizer,
    SUM(acronym IS NOT NULL AND acronym<>'') acronym,
    SUM(topics IS NOT NULL AND topics<>'[]') topics,
    SUM(abstract_deadline IS NOT NULL OR paper_submission_deadline IS NOT NULL OR submission_url IS NOT NULL) cfp,
    SUM(registration_url IS NOT NULL OR early_bird_deadline IS NOT NULL) fees,
    SUM(venue IS NOT NULL OR venue_address IS NOT NULL) venue_accommodation
    FROM discovery_events WHERE status IN ${ACCEPTED}`);
  const publishedSections = await dbGet<Record<string, number>>(`SELECT
    SUM(program_agenda IS NOT NULL AND program_agenda<>'{}' AND program_agenda<>'{"sessions":[]}') program,
    SUM(keynote_speakers IS NOT NULL AND keynote_speakers<>'[]') keynote_speakers,
    SUM(technical_committee IS NOT NULL AND technical_committee<>'[]') technical_committee,
    SUM(sponsors_exhibitors IS NOT NULL AND sponsors_exhibitors<>'[]') sponsors_exhibitors,
    SUM(community IS NOT NULL AND community<>'{}' AND community<>'{"social_media":[]}') community
    FROM extracted_conferences ec WHERE json_extract(ec.extraction_metadata,'$.origin')='discovery_engine'`);
  return {
    total: Number(row?.total || 0), description: Number(row?.description || 0), organizer: Number(row?.organizer || 0),
    acronym: Number(row?.acronym || 0), topics: Number(row?.topics || 0), cfp: Number(row?.cfp || 0),
    fees: Number(row?.fees || 0), venueAccommodation: Number(row?.venue_accommodation || 0),
    program: Number(publishedSections?.program || 0), keynoteSpeakers: Number(publishedSections?.keynote_speakers || 0),
    technicalCommittee: Number(publishedSections?.technical_committee || 0),
    sponsorsExhibitors: Number(publishedSections?.sponsors_exhibitors || 0), community: Number(publishedSections?.community || 0),
  };
}

async function captureCheckpoints(report: InventoryReport): Promise<void> {
  for (const target of CHECKPOINTS) {
    if (report.totalAccepted < target) continue;
    const existing = await dbGet("SELECT target_accepted FROM discovery_quality_checkpoints WHERE target_accepted=?", [target]);
    if (existing) continue;
    const audit = target === 5_000
      ? await auditDiscoveredConferences({ sample: 20, statuses: ["validated", "published", "needs_review"] })
      : null;
    await dbRun(`INSERT INTO discovery_quality_checkpoints
      (target_accepted,accepted_at_capture,report,enrichment_coverage) VALUES (?,?,?,?)`,
      [target, report.totalAccepted, JSON.stringify(report), JSON.stringify(await buildEnrichmentCoverage())]);
    if (audit) await dbRun("UPDATE discovery_quality_checkpoints SET audit_report=? WHERE target_accepted=?", [JSON.stringify(audit), target]);
  }
  await dbRun(`INSERT OR IGNORE INTO discovery_daily_reports
    (report_date,report,enrichment_coverage) VALUES (date('now'),?,?)`,
    [JSON.stringify(report), JSON.stringify(await buildEnrichmentCoverage())]);
}

export async function runProductionAutomation(options: AutomationOptions = {}): Promise<AutomationResult> {
  if (!process.env.TURSO_DATABASE_URL && process.env.NODE_ENV !== "test") {
    throw new Error("Refusing unattended production automation without durable TURSO_DATABASE_URL.");
  }
  if (isPublishEnabled()) {
    throw new Error("Refusing automation while unrestricted DISCOVERY_PUBLISH_TO_CONFERENCES is enabled.");
  }
  const ownerId = id("worker");
  const runId = id("dauto");
  const leaseMinutes = Math.max(15, Math.min(options.leaseMinutes ?? 90, 180));
  const scheduleHours = Math.max(1, options.scheduleHours ?? 8);
  const next = nextScheduledAt(new Date(), scheduleHours);
  const lease = await acquirePipelineLease(ownerId, leaseMinutes);
  const initial = await buildInventoryReport();
  if (!lease.acquired) return { runId, status: "locked", stage: "another_worker_active", inventory: initial, publication: null, nextScheduledAt: next };

  await dbRun(`INSERT INTO discovery_automation_runs
    (id,owner_id,accepted_before,published_before) VALUES (?,?,?,?)`,
    [runId, ownerId, initial.totalAccepted, initial.totalPublished]);
  let publication: PublishResult | null = null;
  let scaleRunId: string | null = null;
  let enrichmentRunId: string | null = null;
  let auditId: string | null = null;
  try {
    if (initial.totalAccepted < (options.targetAccepted ?? 5_000)) {
      await setStage(runId, ownerId, "discovery", leaseMinutes);
      const scale = await runProductionScale({
        targetAccepted: options.targetAccepted ?? 5_000,
        batchPages: options.batchPages ?? 500,
        maxBatches: 1,
        batchTimeBudgetMs: options.discoveryTimeBudgetMs ?? 25 * 60_000,
        maxSearchQueries: options.maxSearchQueries ?? 14,
        maxJinaPages: options.maxJinaPages ?? 100,
        quiet: options.quiet,
      });
      scaleRunId = scale.scaleRunId;
      await dbRun("UPDATE discovery_automation_state SET last_discovery_at=datetime('now') WHERE id=1");
    }

    await setStage(runId, ownerId, "enrichment", leaseMinutes);
    const enrichment = await runEnrichment({
      readiness: ["needs_enrichment"], limit: options.enrichmentLimit ?? 250,
      maxSearchQueries: options.enrichmentSearchQueries ?? 6,
      maxJinaPages: options.enrichmentJinaPages ?? 50,
      timeBudgetMs: options.enrichmentTimeBudgetMs ?? 20 * 60_000, quiet: options.quiet,
    });
    enrichmentRunId = enrichment.runId;
    await dbRun("UPDATE discovery_automation_state SET last_enrichment_at=datetime('now') WHERE id=1");

    await setStage(runId, ownerId, "readiness", leaseMinutes);
    await reclassifyAllPublishReadiness();
    const candidates = await countPublishCandidates();
    if (candidates > 0 && automationPublicationEnabled()) {
      await setStage(runId, ownerId, "publication_audit", leaseMinutes);
      const audit = await auditPublishReady({ sample: 10 });
      auditId = audit.id;
      if (audit.passed) {
        await setStage(runId, ownerId, "controlled_publication", leaseMinutes);
        publication = await publishDiscoveredConferences({ limit: 500, requirePassingAudit: true });
      } else {
        await quarantineAuditFailures(audit.failures);
        publication = { considered: candidates, written: 0, skippedExisting: 0, skippedIneligible: candidates, urls: [] };
      }
      await dbRun("UPDATE discovery_automation_state SET last_publication_at=datetime('now') WHERE id=1");
    }

    await setStage(runId, ownerId, "checkpoint", leaseMinutes);
    const inventory = await buildInventoryReport();
    await captureCheckpoints(inventory);
    const providerUsage = await dbGet<{ counters: string }>("SELECT counters FROM discovery_runs ORDER BY started_at DESC LIMIT 1");
    await dbRun(`UPDATE discovery_automation_runs SET status='completed',stage='idle',accepted_after=?,published_after=?,
      discovery_scale_run_id=?,enrichment_run_id=?,publication_audit_id=?,publication_result=?,provider_usage=?,finished_at=datetime('now') WHERE id=?`,
      [inventory.totalAccepted, inventory.totalPublished, scaleRunId, enrichmentRunId, auditId,
        JSON.stringify(publication), providerUsage?.counters || "{}", runId]);
    await dbRun(`UPDATE discovery_automation_state SET status='idle',current_stage='idle',current_run_id=NULL,
      last_success_at=datetime('now'),next_scheduled_at=?,last_failure=NULL,updated_at=datetime('now') WHERE id=1`, [next]);
    return { runId, status: "completed", stage: "idle", inventory, publication, nextScheduledAt: next };
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 1000);
    await dbRun(`UPDATE discovery_automation_runs SET status='failed',error=?,finished_at=datetime('now') WHERE id=?`, [message, runId]);
    await dbRun(`UPDATE discovery_automation_state SET status='failed',last_failure=?,next_scheduled_at=?,
      updated_at=datetime('now') WHERE id=1`, [message, next]);
    throw error;
  } finally {
    await releasePipelineLease(ownerId);
  }
}
