import { dbAll, dbGet } from "../db";
import { buildInventoryReport } from "./inventory";
import { providerStatus } from "./providers";

function json(value: unknown, fallback: any = null): any {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function buildOperationalStatus(targetAccepted = 5_000, targetPublished = 1_000) {
  const [inventory, state, lock, lastDiscovery, lastEnrichment, lastAutomation, lastAudit, checkpoint, daily, providerRows] = await Promise.all([
    buildInventoryReport(),
    dbGet<Record<string, any>>("SELECT * FROM discovery_automation_state WHERE id=1"),
    dbGet<Record<string, any>>("SELECT * FROM discovery_pipeline_locks WHERE name='production_data_pipeline'"),
    dbGet<Record<string, any>>("SELECT id,status,started_at,finished_at,trigger,counters,error FROM discovery_runs ORDER BY started_at DESC LIMIT 1"),
    dbGet<Record<string, any>>("SELECT id,status,started_at,finished_at,records_examined,provider_usage,errors FROM discovery_enrichment_runs ORDER BY started_at DESC LIMIT 1"),
    dbGet<Record<string, any>>("SELECT * FROM discovery_automation_runs ORDER BY started_at DESC LIMIT 1"),
    dbGet<Record<string, any>>("SELECT id,passed,sample_size,failures,created_at FROM discovery_publication_audits ORDER BY created_at DESC LIMIT 1"),
    dbGet<Record<string, any>>("SELECT * FROM discovery_quality_checkpoints ORDER BY target_accepted DESC LIMIT 1"),
    dbGet<Record<string, any>>("SELECT * FROM discovery_daily_reports ORDER BY report_date DESC LIMIT 1"),
    dbAll<Record<string, any>>(`SELECT provider,SUM(queries_issued) queries,SUM(raw_results) results,
      SUM(accepted_events) accepted,SUM(queries_failed) errors FROM discovery_run_providers
      WHERE created_at>=datetime('now','-1 day') GROUP BY provider`),
  ]);
  const lockExpires = lock?.lease_expires_at ? Date.parse(lock.lease_expires_at) : NaN;
  const lockActive = Number.isFinite(lockExpires) && lockExpires > Date.now();
  return {
    pipeline: {
      running: state?.status === "running" && lockActive,
      status: state?.status || "idle",
      currentStage: lockActive ? lock?.stage : state?.current_stage || "idle",
      currentRunId: lockActive ? state?.current_run_id : null,
      nextScheduledAt: state?.next_scheduled_at || null,
      lastSuccessfulAt: state?.last_success_at || null,
      lastFailure: state?.last_failure || null,
    },
    lock: lock ? {
      active: lockActive, ownerId: lockActive ? lock.owner_id : null, stage: lock.stage,
      heartbeatAt: lock.heartbeat_at, leaseExpiresAt: lock.lease_expires_at, staleRecoverable: !lockActive,
    } : { active: false, staleRecoverable: false },
    inventory,
    progress: {
      acceptedTarget: targetAccepted,
      acceptedPercent: Number((100 * Math.min(inventory.totalAccepted, targetAccepted) / targetAccepted).toFixed(1)),
      publishedTarget: targetPublished,
      publishedPercent: Number((100 * Math.min(inventory.totalPublished, targetPublished) / targetPublished).toFixed(1)),
    },
    lastRuns: {
      discovery: lastDiscovery ? { ...lastDiscovery, counters: json(lastDiscovery.counters, {}) } : null,
      enrichment: lastEnrichment ? { ...lastEnrichment, provider_usage: json(lastEnrichment.provider_usage, {}), errors: json(lastEnrichment.errors, []) } : null,
      automation: lastAutomation ? { ...lastAutomation, publication_result: json(lastAutomation.publication_result), provider_usage: json(lastAutomation.provider_usage, {}) } : null,
      publicationAudit: lastAudit ? { ...lastAudit, passed: !!lastAudit.passed, failures: json(lastAudit.failures, []) } : null,
    },
    providerUsageLast24Hours: providerRows,
    aiCalls: inventory.aiCalls,
    latestQualityCheckpoint: checkpoint ? {
      targetAccepted: checkpoint.target_accepted, acceptedAtCapture: checkpoint.accepted_at_capture,
      report: json(checkpoint.report, {}), enrichmentCoverage: json(checkpoint.enrichment_coverage, {}),
      auditReport: json(checkpoint.audit_report), createdAt: checkpoint.created_at,
    } : null,
    latestDailyReport: daily ? {
      date: daily.report_date, report: json(daily.report, {}),
      enrichmentCoverage: json(daily.enrichment_coverage, {}), createdAt: daily.created_at,
    } : null,
    providersConfigured: providerStatus(),
    safeguards: {
      unrestrictedPublishingEnabled: process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1",
      controlledAutomationPublishingEnabled: process.env.CONFERENCEGATE_AUTOMATION_PUBLICATION === "1",
      aiCallsAllowedPerAutomationRun: 0,
      customerSearchMode: "stored_published_records_only",
      customerDetailMode: "stored_records_only",
    },
  };
}
