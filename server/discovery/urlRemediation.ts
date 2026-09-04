// Phase 1.5.1: one bounded, idempotent repair of navigable official URLs and readiness.
// This pass never discovers events, calls AI, publishes, or deletes rows.

import crypto from "crypto";
import { dbAll, dbGet, dbRun } from "../db";
import { updateReadiness } from "./enrichment";
import { canonicalizeUrl, normalizeNavigableUrl } from "./normalize";
import {
  classifySource, isEligibleOfficialSource, sourceAuthorityBlockReasons,
  titleEvidenceScore, type SourceClassification,
} from "./sourceClassification";
import { getDomain } from "./sourceRegistry";
import type { PublishReadiness } from "./types";

const ACCEPTED = "('validated','published','needs_review')";
const OFFICIAL_CLASSES = new Set<SourceClassification>([
  "official_event_site", "organizer_site", "society_site", "university_host_site",
]);

interface Counts {
  total: number;
  officialUrls: number;
  absoluteOfficialUrls: number;
  schemeLessOfficialUrls: number;
  verifiedOfficialUrls: number;
  publishReady: number;
  needsEnrichment: number;
  needsReview: number;
  publishReadySchemeLess: number;
}

export interface UrlRemediationReport {
  runId: string;
  status: "completed" | "failed";
  recordsExamined: number;
  before: Counts;
  after: Counts;
  repairedFromProvenance: number;
  officialUrlsCleared: number;
  recordsDowngraded: number;
  directoriesRemovedOrDowngraded: number;
  roundupsRemovedOrDowngraded: number;
  thirdPartyCalendarsRemovedOrDowngraded: number;
  conflictsResolved: number;
  historyRowsAdded: number;
  aiCalls: 0;
  errors: string[];
}

interface EventRow extends Record<string, any> { id: string; title: string; official_url: string | null }
interface SourceRow extends Record<string, any> {
  id: string; event_id: string; source_url: string; source_classification: SourceClassification;
  classification_confidence: number; classification_evidence: string; is_official: number; raw_extraction: string | null;
}
interface AssessedSource { source: SourceRow; url: string; classification: SourceClassification; confidence: number; eligible: boolean; blockers: string[] }

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
const parseObject = (value: unknown): Record<string, any> => {
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
};
const parseReasons = (value: unknown): string[] => {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const host = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const sameUrl = (a: unknown, b: unknown) => !!a && !!b && canonicalizeUrl(String(a)) === canonicalizeUrl(String(b));

async function counts(): Promise<Counts> {
  const row = await dbGet<Record<string, any>>(`SELECT COUNT(*) total,
    SUM(official_url IS NOT NULL AND official_url<>'') official_urls,
    SUM(official_url LIKE 'https://%' OR official_url LIKE 'http://%') absolute_urls,
    SUM(official_url IS NOT NULL AND official_url<>'' AND official_url NOT LIKE 'https://%' AND official_url NOT LIKE 'http://%') scheme_less,
    SUM(EXISTS(SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id AND s.is_official=1 AND s.classification_confidence>=0.8)) verified,
    SUM(publish_readiness='publish_ready') ready,
    SUM(publish_readiness='needs_enrichment') enrichment,
    SUM(publish_readiness='needs_review') review,
    SUM(publish_readiness='publish_ready' AND official_url IS NOT NULL AND official_url<>''
      AND official_url NOT LIKE 'https://%' AND official_url NOT LIKE 'http://%') ready_scheme_less
    FROM discovery_events e WHERE status IN ${ACCEPTED}`);
  return {
    total: Number(row?.total || 0), officialUrls: Number(row?.official_urls || 0),
    absoluteOfficialUrls: Number(row?.absolute_urls || 0), schemeLessOfficialUrls: Number(row?.scheme_less || 0),
    verifiedOfficialUrls: Number(row?.verified || 0), publishReady: Number(row?.ready || 0),
    needsEnrichment: Number(row?.enrichment || 0), needsReview: Number(row?.review || 0),
    publishReadySchemeLess: Number(row?.ready_scheme_less || 0),
  };
}

async function assess(event: EventRow, source: SourceRow): Promise<AssessedSource | null> {
  const url = normalizeNavigableUrl(source.source_url);
  if (!url) return null;
  const raw = parseObject(source.raw_extraction);
  const registry = await getDomain(host(url));
  const blockers = sourceAuthorityBlockReasons({ pageUrl: url, title: event.title,
    organizerUrl: raw.organizerUrl || event.organizer_url, registryType: registry?.source_type });
  if (raw.title && titleEvidenceScore(event.title, raw.title) < 0.55) blockers.push("stored_title_not_supported");
  const recomputed = classifySource({ pageUrl: url, officialUrl: raw.officialUrl,
    organizerUrl: raw.organizerUrl || event.organizer_url, title: event.title, organizer: event.organizer,
    pageText: [raw.title, raw.description, source.classification_evidence].filter(Boolean).join(" "),
    registryType: registry?.source_type });
  // A previously verified high-authority classification may be retained only if the new
  // structural deny rules find no directory, roundup, generic page or third-party calendar.
  const retainVerified = blockers.length === 0 && Number(source.is_official) === 1
    && Number(source.classification_confidence) >= 0.8 && OFFICIAL_CLASSES.has(source.source_classification);
  const classification = retainVerified ? source.source_classification : recomputed.classification;
  const confidence = retainVerified ? Number(source.classification_confidence) : recomputed.confidence;
  const eligible = isEligibleOfficialSource({ pageUrl: url, title: event.title,
    organizerUrl: raw.organizerUrl || event.organizer_url, registryType: registry?.source_type,
    classification, confidence });
  await dbRun(`UPDATE discovery_event_sources SET source_classification=?,classification_confidence=?,
    classification_evidence=?,is_official=? WHERE id=?`, [classification, confidence,
    JSON.stringify(blockers.length ? blockers : recomputed.evidence), eligible ? 1 : 0, source.id]);
  return { source, url, classification, confidence, eligible, blockers };
}

function rank(candidate: AssessedSource, current: string | null): number {
  const classRank: Record<string, number> = { official_event_site: 40, organizer_site: 30, society_site: 20, university_host_site: 10 };
  return (sameUrl(candidate.url, current) ? 100 : 0) + (classRank[candidate.classification] || 0) + candidate.confidence;
}

async function recordHistory(runId: string, event: EventRow, oldValue: string | null, replacement: AssessedSource | null,
  reason: string): Promise<void> {
  const active = await dbGet<Record<string, any>>(`SELECT f.source_url,s.source_classification FROM discovery_event_fields f
    LEFT JOIN discovery_event_sources s ON s.event_id=f.event_id AND s.source_url=f.source_url
    WHERE f.event_id=? AND f.field='officialUrl'`, [event.id]);
  const sourceUrl = replacement?.url || normalizeNavigableUrl(event.source_url) || event.source_url || "about:blank";
  await dbRun(`INSERT INTO discovery_event_field_history (id,enrichment_run_id,event_id,field,old_value,old_source_url,
    old_source_classification,new_value,new_source_url,new_source_classification,decision,reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [makeId("dfhist"), runId, event.id, "officialUrl", oldValue,
    active?.source_url || oldValue, active?.source_classification || null, replacement?.url || null, sourceUrl, replacement?.classification || "unknown",
    replacement ? "repair_absolute_url" : "downgrade_clear", reason]);
  await dbRun(`INSERT INTO discovery_event_changes (id,event_id,change_type,field,old_value,new_value,source_url)
    VALUES (?,?,?,?,?,?,?)`, [makeId("dchg"), event.id, replacement ? "official_url_repaired" : "unverified_official_url_cleared",
    "official_url", oldValue, replacement?.url || null, sourceUrl]);
}

export async function runUrlRemediation(options: { limit?: number; eventIds?: string[] } = {}): Promise<UrlRemediationReport> {
  if (process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1") {
    throw new Error("Refusing URL remediation while DISCOVERY_PUBLISH_TO_CONFERENCES=1.");
  }
  const runId = makeId("durl");
  const before = await counts();
  const errors: string[] = [];
  let repairedFromProvenance = 0, officialUrlsCleared = 0, recordsDowngraded = 0;
  let directories = 0, roundups = 0, calendars = 0, conflictsResolved = 0, historyRowsAdded = 0, examined = 0;
  await dbRun(`INSERT INTO discovery_url_remediation_runs (id,before_metrics) VALUES (?,?)`, [runId, JSON.stringify(before)]);
  try {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const selectedIds = [...new Set(options.eventIds || [])];
    const idFilter = selectedIds.length ? ` AND id IN (${selectedIds.map(() => "?").join(",")})` : "";
    const events = await dbAll<EventRow>(`SELECT * FROM discovery_events WHERE status IN ${ACCEPTED}${idFilter}
      ORDER BY CASE WHEN publish_readiness='publish_ready' THEN 0 ELSE 1 END,date_discovered LIMIT ?`, [...selectedIds, limit]);
    for (const event of events) {
      examined += 1;
      const oldUrl = event.official_url ? String(event.official_url) : null;
      const oldReadiness = event.publish_readiness as PublishReadiness;
      const sources = await dbAll<SourceRow>(`SELECT * FROM discovery_event_sources WHERE event_id=?
        ORDER BY is_official DESC,classification_confidence DESC,trust_score DESC`, [event.id]);
      const assessed: AssessedSource[] = [];
      for (const source of sources) {
        const result = await assess(event, source);
        if (result) assessed.push(result);
      }
      const oldSource = assessed.find((candidate) => sameUrl(candidate.url, oldUrl));
      const oldBlockers = oldSource?.blockers || (oldUrl ? sourceAuthorityBlockReasons({ pageUrl: oldUrl, title: event.title, organizerUrl: event.organizer_url }) : []);
      const replacement = assessed.filter((candidate) => candidate.eligible).sort((a, b) => rank(b, oldUrl) - rank(a, oldUrl))[0] || null;
      const newUrl = replacement?.url || null;
      const changed = (oldUrl || null) !== newUrl;
      if (changed) {
        await recordHistory(runId, event, oldUrl, replacement,
          replacement ? "reconstructed the navigable URL from preserved authoritative source provenance"
            : `no authoritative navigable source survived reassessment${oldBlockers.length ? `: ${oldBlockers.join(",")}` : ""}`);
        historyRowsAdded += 1;
        if (oldUrl) conflictsResolved += 1;
        if (replacement) repairedFromProvenance += 1; else if (oldUrl) officialUrlsCleared += 1;
      }
      if (oldBlockers.includes("directory_source") && (changed || !replacement)) directories += 1;
      if (oldBlockers.includes("roundup_or_list_title") || oldBlockers.includes("generic_collection_page")) {
        if (changed || !replacement) roundups += 1;
      }
      if (oldBlockers.includes("third_party_calendar") && (changed || !replacement)) calendars += 1;
      await dbRun(`UPDATE discovery_events SET official_url=?,official_source_verified_at=? WHERE id=?`,
        [newUrl, replacement ? (event.official_source_verified_at || new Date().toISOString()) : null, event.id]);
      if (!replacement || oldBlockers.includes("stored_title_not_supported") || oldBlockers.includes("malformed_event_title")) {
        await dbRun(`UPDATE discovery_events SET title_verified_at=NULL WHERE id=?`, [event.id]);
      }
      if (replacement) {
        await dbRun(`INSERT INTO discovery_event_fields (id,event_id,field,value,source_url,source_domain,extraction_method,confidence,last_verified)
          VALUES (?,?,?,?,?,?,?, ?,datetime('now')) ON CONFLICT(event_id,field) DO UPDATE SET value=excluded.value,
          source_url=excluded.source_url,source_domain=excluded.source_domain,confidence=excluded.confidence,last_verified=datetime('now')`,
          [makeId("dfld"), event.id, "officialUrl", newUrl, replacement.url, host(replacement.url), "derived", replacement.confidence]);
      } else {
        await dbRun(`UPDATE discovery_event_fields SET value=NULL,confidence=0,last_verified=datetime('now')
          WHERE event_id=? AND field='officialUrl'`, [event.id]);
      }
      const unresolved = parseReasons(event.readiness_reasons).includes("unresolved_authoritative_conflict");
      await updateReadiness(event.id, unresolved);
      const updated = await dbGet<{ publish_readiness: PublishReadiness }>(`SELECT publish_readiness FROM discovery_events WHERE id=?`, [event.id]);
      if (oldReadiness === "publish_ready" && updated?.publish_readiness !== "publish_ready") recordsDowngraded += 1;
    }
    const after = await counts();
    const report: UrlRemediationReport = { runId, status: "completed", recordsExamined: examined, before, after,
      repairedFromProvenance, officialUrlsCleared, recordsDowngraded,
      directoriesRemovedOrDowngraded: directories, roundupsRemovedOrDowngraded: roundups,
      thirdPartyCalendarsRemovedOrDowngraded: calendars, conflictsResolved, historyRowsAdded, aiCalls: 0, errors };
    await dbRun(`UPDATE discovery_url_remediation_runs SET status='completed',records_examined=?,after_metrics=?,changes=?,
      finished_at=datetime('now') WHERE id=?`, [examined, JSON.stringify(after), JSON.stringify(report), runId]);
    return report;
  } catch (error: any) {
    errors.push(String(error?.message || error));
    const after = await counts();
    await dbRun(`UPDATE discovery_url_remediation_runs SET status='failed',records_examined=?,after_metrics=?,changes=?,errors=?,
      finished_at=datetime('now') WHERE id=?`, [examined, JSON.stringify(after), JSON.stringify({ repairedFromProvenance,
      officialUrlsCleared, recordsDowngraded: recordsDowngraded, historyRowsAdded }), JSON.stringify(errors), runId]);
    throw error;
  }
}

