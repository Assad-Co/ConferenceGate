// The human-readable gate in front of publication. Readiness is necessary but not sufficient:
// a random official-source audit must also pass before any production publication call can write.

import crypto from "crypto";
import { dbAll, dbGet, dbRun } from "../db";
import { auditDiscoveredConferences, type AuditReport } from "./audit";
import { isDirectoryHost } from "../braveSearch";
import type { UrlGuard } from "./httpClient";

export const GENERIC_EVENT_PAGE_RE = /\/(?:conferences?|events?|calendar|search|countries?|topics?|listing|browse)\/?$|\/(?:categor(?:y|ies)|country-listing|topic-listing)(?:\/|$)/i;

export interface PublicationAuditResult {
  id: string;
  passed: boolean;
  sampleSize: number;
  failures: Array<{ eventId: string; title: string; reasons: string[] }>;
  report: AuditReport;
}

function host(url: string): string { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }

export async function auditPublishReady(options: { sample?: number; urlGuard?: UrlGuard; onProgress?: (done: number, total: number, title: string) => void } = {}): Promise<PublicationAuditResult> {
  const sample = Math.max(10, Math.min(options.sample ?? 10, 100));
  const report = await auditDiscoveredConferences({
    sample,
    statuses: ["validated", "published"],
    publishReadiness: "publish_ready",
    preferOfficialSource: true,
    maxJinaPages: sample,
    urlGuard: options.urlGuard,
    onProgress: options.onProgress,
  });
  const rows = await dbAll<Record<string, any>>(
    `SELECT e.*, EXISTS(SELECT 1 FROM discovery_review_queue q WHERE q.status='open'
       AND (q.event_id=e.id OR q.candidate_event_id=e.id)) open_review,
       EXISTS(SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id
       AND s.is_official=1 AND s.classification_confidence>=0.8) official_verified
     FROM discovery_events e WHERE e.id IN (${report.records.map(() => "?").join(",") || "NULL"})`,
    report.records.map((record) => record.eventId)
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const failures: PublicationAuditResult["failures"] = [];
  for (const record of report.records) {
    const row = byId.get(record.eventId);
    const reasons: string[] = [];
    const url = String(row?.official_url || "");
    if (!record.pageReadable) reasons.push("official_page_unreadable");
    if (!row || row.publish_readiness !== "publish_ready") reasons.push("not_publish_ready");
    if (!row?.official_verified || !url || isDirectoryHost(host(url))) reasons.push("official_source_not_verified");
    try { if (GENERIC_EVENT_PAGE_RE.test(new URL(url).pathname)) reasons.push("generic_page_url"); } catch { reasons.push("invalid_official_url"); }
    if (row?.open_review) reasons.push("open_review");
    const readinessReasons = (() => { try { return JSON.parse(row?.readiness_reasons || "[]"); } catch { return ["malformed_readiness_reasons"]; } })();
    if (readinessReasons.length) reasons.push("unresolved_readiness_reason");
    const start = row?.start_date ? Date.parse(row.start_date) : NaN;
    if (!Number.isFinite(start) || start < Date.now()) reasons.push("start_date_not_future");
    if (!row?.country && row?.format !== "online") reasons.push("country_or_online_missing");
    if (record.suspicionFlags.length) reasons.push(...record.suspicionFlags);
    for (const field of ["title", "start_date", "country", "official_url"] as const) {
      const verdict = record.fields.find((item) => item.field === field)?.verdict;
      if (verdict === "not_supported" || verdict === "unverifiable") reasons.push(`${field}_${verdict}`);
    }
    if (reasons.length) failures.push({ eventId: record.eventId, title: record.title, reasons: [...new Set(reasons)] });
  }
  if (report.auditedRecords !== sample) failures.push({ eventId: "sample", title: "Audit sample", reasons: [`expected_${sample}_got_${report.auditedRecords}`] });
  const result: PublicationAuditResult = {
    id: `dpa_${crypto.randomUUID().replace(/-/g, "")}`,
    passed: failures.length === 0,
    sampleSize: report.auditedRecords,
    failures,
    report,
  };
  await dbRun(`INSERT INTO discovery_publication_audits (id,sample_size,passed,audited_event_ids,failures,report)
    VALUES (?,?,?,?,?,?)`, [result.id, result.sampleSize, result.passed ? 1 : 0,
    JSON.stringify(report.records.map((record) => record.eventId)), JSON.stringify(failures), JSON.stringify(report)]);
  return result;
}

export async function latestPassingPublicationAudit(): Promise<{ id: string; created_at: string } | undefined> {
  return dbGet(`SELECT id,created_at FROM discovery_publication_audits WHERE passed=1 AND sample_size>=10
    AND created_at >= datetime('now','-30 days') ORDER BY created_at DESC LIMIT 1`);
}
