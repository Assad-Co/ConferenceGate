import { dbAll, dbGet } from "../db";

const ACCEPTED = "('validated','published','needs_review')";
const n = (value: unknown) => Number(value || 0);

export interface InventoryReport {
  totalAccepted: number; publishReady: number; totalPublished: number; needsEnrichment: number; needsReview: number;
  years: Record<string, number>; countriesRepresented: number; regionsRepresented: number;
  categoriesRepresented: number; uniqueDomains: number; officialSourcePercent: number; directorySourcePercent: number;
  missingDatePercent: number; missingCountryPercent: number; missingOfficialUrlPercent: number;
  duplicateMergeRate: number; fetchFailureRate: number; braveContribution: number; serperContribution: number;
  jinaRecoveryContribution: number; aiCalls: number; publishingFailures: number;
}

export async function buildInventoryReport(scaleRunId?: string): Promise<InventoryReport> {
  const total = await dbGet<Record<string, any>>(`SELECT COUNT(*) total,
    SUM(publish_readiness='publish_ready') ready, SUM(publish_readiness='needs_enrichment') enrichment,
    SUM(publish_readiness='needs_review') review, SUM(status='published') published,
    SUM(start_date IS NULL AND start_year IS NULL) missing_date,
    SUM(country IS NULL OR country='') missing_country,
    SUM(official_url IS NULL OR official_url='') missing_url
    FROM discovery_events WHERE status IN ${ACCEPTED}`);
  const accepted = n(total?.total);
  const years = await dbAll<{ start_year: number | null; count: number }>(`SELECT start_year,COUNT(*) count FROM discovery_events
    WHERE status IN ${ACCEPTED} AND start_year IN (2026,2027,2028) GROUP BY start_year`);
  const sources = await dbGet<Record<string, any>>(`SELECT
    SUM(EXISTS(SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id AND s.is_official=1 AND s.classification_confidence>=0.8)) official,
    SUM(NOT EXISTS(SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id AND s.is_official=1 AND s.classification_confidence>=0.8)
      AND EXISTS(SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id AND s.source_classification IN ('directory','aggregator'))) directory
    FROM discovery_events e WHERE e.status IN ${ACCEPTED}`);
  const duplicateEvents = await dbGet<{ count: number }>(`SELECT COUNT(*) count FROM (SELECT s.event_id FROM discovery_event_sources s
    JOIN discovery_events e ON e.id=s.event_id WHERE e.status IN ${ACCEPTED} GROUP BY s.event_id HAVING COUNT(*)>1)`);
  const runFilter = scaleRunId ? " WHERE trigger=?" : "";
  const runs = await dbAll<{ counters: string }>(`SELECT counters FROM discovery_runs${runFilter}`,
    scaleRunId ? [`production_scale:${scaleRunId}`] : []);
  let attempted = 0, failed = 0, jina = 0, ai = 0;
  for (const row of runs) { try { const c = JSON.parse(row.counters || "{}"); attempted += n(c.pagesAttempted); failed += n(c.pagesFailed); jina += n(c.recoveryMethods?.jina); ai += n(c.aiCalls); } catch { /* malformed old run */ } }
  const providers = await dbAll<{ provider: string; accepted: number }>(`SELECT p.provider,SUM(p.accepted_events) accepted
    FROM discovery_run_providers p JOIN discovery_runs r ON r.id=p.run_id${scaleRunId ? " WHERE r.trigger=?" : ""} GROUP BY p.provider`,
    scaleRunId ? [`production_scale:${scaleRunId}`] : []);
  const pct = (value: number) => accepted ? Number((100 * value / accepted).toFixed(1)) : 0;
  return {
    totalAccepted: accepted, publishReady: n(total?.ready), totalPublished: n(total?.published),
    needsEnrichment: n(total?.enrichment), needsReview: n(total?.review),
    years: Object.fromEntries(years.map((row) => [String(row.start_year), n(row.count)])),
    countriesRepresented: n((await dbGet<{ count: number }>(`SELECT COUNT(DISTINCT country) count FROM discovery_events WHERE status IN ${ACCEPTED} AND country IS NOT NULL`))?.count),
    regionsRepresented: n((await dbGet<{ count: number }>(`SELECT COUNT(DISTINCT world_region) count FROM discovery_events WHERE status IN ${ACCEPTED} AND world_region IS NOT NULL`))?.count),
    categoriesRepresented: n((await dbGet<{ count: number }>(`SELECT COUNT(DISTINCT c.category) count FROM discovery_event_categories c JOIN discovery_events e ON e.id=c.event_id WHERE e.status IN ${ACCEPTED}`))?.count),
    uniqueDomains: n((await dbGet<{ count: number }>(`SELECT COUNT(DISTINCT source_domain) count FROM discovery_events WHERE status IN ${ACCEPTED}`))?.count),
    officialSourcePercent: pct(n(sources?.official)), directorySourcePercent: pct(n(sources?.directory)),
    missingDatePercent: pct(n(total?.missing_date)), missingCountryPercent: pct(n(total?.missing_country)), missingOfficialUrlPercent: pct(n(total?.missing_url)),
    duplicateMergeRate: accepted ? Number((100 * n(duplicateEvents?.count) / accepted).toFixed(1)) : 0,
    fetchFailureRate: attempted ? Number((100 * failed / attempted).toFixed(1)) : 0,
    braveContribution: n(providers.find((row) => row.provider === "brave")?.accepted),
    serperContribution: n(providers.find((row) => row.provider === "serper")?.accepted),
    jinaRecoveryContribution: jina, aiCalls: ai, publishingFailures: 0,
  };
}
