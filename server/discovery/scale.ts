// Resumable production-scale inventory growth. Each bounded batch commits independently, so a
// Render restart loses at most the active process—not completed discovery, enrichment or metrics.

import crypto from "crypto";
import { dbGet, dbRun } from "../db";
import { CATEGORY_RULES } from "./categories";
import { runEnrichment } from "./enrichment";
import { buildInventoryReport, type InventoryReport } from "./inventory";
import { runDiscovery, type RunSummary } from "./pipeline";
import { isPublishEnabled } from "./publish";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
async function acceptedCount(): Promise<number> {
  return Number((await dbGet<{ count: number }>(`SELECT COUNT(*) count FROM discovery_events
    WHERE status IN ('validated','published','needs_review')`))?.count || 0);
}

export interface ScaleOptions {
  targetAccepted?: number; batchPages?: number; batchCandidates?: number; maxBatches?: number;
  batchTimeBudgetMs?: number; maxSearchQueries?: number; maxJinaPages?: number; quiet?: boolean;
}
export interface ScaleResult { scaleRunId: string; status: string; stopReason: string; batches: number; report: InventoryReport }

export function topicsForBatch(batchNumber: number, width = 6): string[] {
  const topics = CATEGORY_RULES.map((rule) => rule.category);
  const start = ((batchNumber - 1) * width) % topics.length;
  return Array.from({ length: Math.min(width, topics.length) }, (_, index) => topics[(start + index) % topics.length]);
}

export function assertScalePublishingDisabled(publishingEnabled = isPublishEnabled()): void {
  if (publishingEnabled) {
    throw new Error("Refusing inventory scaling while DISCOVERY_PUBLISH_TO_CONFERENCES is enabled.");
  }
}

export async function runProductionScale(options: ScaleOptions = {}): Promise<ScaleResult> {
  assertScalePublishingDisabled();
  const target = Math.max(1_000, options.targetAccepted ?? 1_000);
  const pages = Math.max(100, Math.min(options.batchPages ?? 500, 1_000));
  let scale = await dbGet<Record<string, any>>(`SELECT * FROM discovery_scale_runs WHERE status IN ('running','paused')
    AND target_accepted=? ORDER BY started_at DESC LIMIT 1`, [target]);
  if (!scale) {
    const scaleId = id("dscale");
    const before = await acceptedCount();
    await dbRun(`INSERT INTO discovery_scale_runs (id,target_accepted,accepted_at_start) VALUES (?,?,?)`, [scaleId, target, before]);
    scale = { id: scaleId, next_batch: 1 };
  }
  const scaleRunId = String(scale.id);
  await dbRun(`UPDATE discovery_scale_runs SET status='running',updated_at=datetime('now') WHERE id=?`, [scaleRunId]);
  let batchNumber = Number(scale.next_batch || 1);
  let noGrowth = 0;
  let batches = 0;
  let stopReason = "batch_limit";
  while (batches < (options.maxBatches ?? 50)) {
    const before = await acceptedCount();
    if (before >= target) { stopReason = "target_reached"; break; }
    const interrupted = await dbGet<{ id: string }>(`SELECT id FROM discovery_scale_batches WHERE scale_run_id=? AND batch_number=?`,
      [scaleRunId, batchNumber]);
    const batchId = interrupted?.id || id("dbatch");
    if (interrupted) {
      await dbRun(`UPDATE discovery_scale_batches SET status='running',accepted_before=?,metrics=?,started_at=datetime('now'),finished_at=NULL WHERE id=?`,
        [before, JSON.stringify({ resumedAfterInterruption: true }), batchId]);
    } else {
      await dbRun(`INSERT INTO discovery_scale_batches (id,scale_run_id,batch_number,accepted_before) VALUES (?,?,?,?)`,
        [batchId, scaleRunId, batchNumber, before]);
    }
    let discovery: RunSummary;
    try {
      discovery = await runDiscovery({
        targetYears: [2027, 2028, 2026], topics: topicsForBatch(batchNumber),
        maxPages: pages, maxCandidates: options.batchCandidates ?? 6_000,
        maxSearchQueries: options.maxSearchQueries ?? 48, maxJinaPages: options.maxJinaPages ?? 150,
        maxAlternateUrls: 150, maxCandidatesPerDomain: 25, domainConcurrency: 4,
        timeBudgetMs: options.batchTimeBudgetMs ?? 30 * 60_000, maxAiCalls: 0,
        allowAutoPublish: false, trigger: `production_scale:${scaleRunId}`, quiet: options.quiet,
      });
      const enrichment = await runEnrichment({ runId: discovery.runId, limit: 2_000,
        maxJinaPages: options.maxJinaPages ?? 150, maxSearchQueries: options.maxSearchQueries ?? 48,
        timeBudgetMs: options.batchTimeBudgetMs ?? 30 * 60_000, quiet: options.quiet });
      const after = await acceptedCount();
      noGrowth = after > before ? 0 : noGrowth + 1;
      const metrics = { discovery: { ...discovery, events: undefined }, enrichment, publishingEnabled: false };
      await dbRun(`UPDATE discovery_scale_batches SET status='completed',discovery_run_id=?,enrichment_run_id=?,
        accepted_after=?,published=?,metrics=?,finished_at=datetime('now') WHERE id=?`,
        [discovery.runId, enrichment.runId, after, 0, JSON.stringify(metrics), batchId]);
      batchNumber += 1; batches += 1;
      await dbRun(`UPDATE discovery_scale_runs SET next_batch=?,updated_at=datetime('now') WHERE id=?`, [batchNumber, scaleRunId]);
      if (after >= target) { stopReason = "target_reached"; break; }
      if (noGrowth >= 3) { stopReason = "candidate_exhaustion_after_three_zero-growth_batches"; break; }
    } catch (error: any) {
      await dbRun(`UPDATE discovery_scale_batches SET status='failed',metrics=?,finished_at=datetime('now') WHERE id=?`,
        [JSON.stringify({ error: String(error?.message || error) }), batchId]);
      throw error;
    }
  }
  const report = await buildInventoryReport(scaleRunId);
  const status = stopReason === "target_reached" ? "checkpoint_reached" : stopReason.includes("exhaustion") ? "exhausted" : "paused";
  await dbRun(`UPDATE discovery_scale_runs SET status=?,accepted_at_finish=?,stop_reason=?,checkpoint_report=?,
    updated_at=datetime('now'),finished_at=CASE WHEN ?='paused' THEN NULL ELSE datetime('now') END WHERE id=?`,
    [status, report.totalAccepted, stopReason, JSON.stringify(report), status, scaleRunId]);
  return { scaleRunId, status, stopReason, batches, report };
}

