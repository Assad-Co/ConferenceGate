// Metrics: the numbers section 31 asks for, computed from the database rather than kept in
// memory, so they are answerable at any time and not only at the end of a run.
//
// All of these are indexed aggregate queries — nothing loads the events table into memory.

import { dbAll, dbGet } from "../db";

export interface DiscoveryMetrics {
  totalCandidateUrls: number;
  urlsRead: number;
  urlsIdentifiedAsEvents: number;
  totalEvents: number;
  eventsByStatus: Record<string, number>;
  eventsByYear: Record<string, number>;
  countriesRepresented: number;
  categoriesRepresented: number;
  domainsRepresented: number;
  extractionRates: {
    structuredData: number;
    html: number;
    ai: number;
  };
  duplicateRate: number;
  failureRate: number;
  averageConfidence: number;
  reviewQueueOpen: number;
  seriesTracked: number;
  changesRecorded: number;
}

async function scalar(sql: string, args: any[] = []): Promise<number> {
  const row = await dbGet<{ value: number }>(sql, args);
  return Number(row?.value ?? 0);
}

export async function computeMetrics(): Promise<DiscoveryMetrics> {
  const totalCandidateUrls = await scalar("SELECT COUNT(*) AS value FROM discovery_urls");
  const urlsRead = await scalar("SELECT COUNT(*) AS value FROM discovery_urls WHERE last_checked IS NOT NULL");
  const urlsIdentifiedAsEvents = await scalar("SELECT COUNT(*) AS value FROM discovery_urls WHERE is_event = 1");
  const urlsFailed = await scalar("SELECT COUNT(*) AS value FROM discovery_urls WHERE fetch_failures > 0");
  const totalEvents = await scalar("SELECT COUNT(*) AS value FROM discovery_events");

  const statusRows = await dbAll<{ status: string; value: number }>(
    "SELECT status, COUNT(*) AS value FROM discovery_events GROUP BY status"
  );
  const yearRows = await dbAll<{ start_year: number | null; value: number }>(
    "SELECT start_year, COUNT(*) AS value FROM discovery_events GROUP BY start_year ORDER BY start_year"
  );
  const methodRows = await dbAll<{ extraction_method: string; value: number }>(
    "SELECT extraction_method, COUNT(*) AS value FROM discovery_events GROUP BY extraction_method"
  );

  const methodTotal = methodRows.reduce((sum, row) => sum + Number(row.value), 0) || 1;
  const methodShare = (name: string) =>
    Number(((methodRows.find((row) => row.extraction_method === name)?.value ?? 0) / methodTotal).toFixed(3));

  return {
    totalCandidateUrls,
    urlsRead,
    urlsIdentifiedAsEvents,
    totalEvents,
    eventsByStatus: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.value)])),
    eventsByYear: Object.fromEntries(yearRows.map((row) => [row.start_year ?? "unknown", Number(row.value)])),
    countriesRepresented: await scalar(
      "SELECT COUNT(DISTINCT country) AS value FROM discovery_events WHERE country IS NOT NULL"
    ),
    categoriesRepresented: await scalar("SELECT COUNT(DISTINCT category) AS value FROM discovery_event_categories"),
    domainsRepresented: await scalar("SELECT COUNT(DISTINCT source_domain) AS value FROM discovery_events"),
    extractionRates: {
      structuredData: methodShare("structured_data"),
      html: methodShare("html"),
      ai: methodShare("ai"),
    },
    // Events with more than one source are ones deduplication actually collapsed.
    duplicateRate: totalEvents
      ? Number(
          (
            (await scalar(
              `SELECT COUNT(*) AS value FROM (
                 SELECT event_id FROM discovery_event_sources GROUP BY event_id HAVING COUNT(*) > 1
               )`
            )) / totalEvents
          ).toFixed(3)
        )
      : 0,
    failureRate: urlsRead ? Number((urlsFailed / urlsRead).toFixed(3)) : 0,
    averageConfidence: Number(
      (await scalar("SELECT COALESCE(AVG(confidence_score), 0) AS value FROM discovery_events")).toFixed(3)
    ),
    reviewQueueOpen: await scalar("SELECT COUNT(*) AS value FROM discovery_review_queue WHERE status = 'open'"),
    seriesTracked: await scalar("SELECT COUNT(*) AS value FROM discovery_series"),
    changesRecorded: await scalar("SELECT COUNT(*) AS value FROM discovery_event_changes"),
  };
}

/** Country and category breakdowns for the quality report. */
export async function coverageBreakdown(): Promise<{
  countries: Array<{ country: string; count: number }>;
  categories: Array<{ category: string; count: number }>;
  domains: Array<{ domain: string; count: number }>;
  missingFields: Record<string, number>;
}> {
  const countries = await dbAll<{ country: string; count: number }>(
    `SELECT COALESCE(country, '(unknown)') AS country, COUNT(*) AS count
       FROM discovery_events GROUP BY country ORDER BY count DESC LIMIT 100`
  );
  const categories = await dbAll<{ category: string; count: number }>(
    `SELECT category, COUNT(*) AS count FROM discovery_event_categories GROUP BY category ORDER BY count DESC LIMIT 100`
  );
  const domains = await dbAll<{ domain: string; count: number }>(
    `SELECT source_domain AS domain, COUNT(*) AS count FROM discovery_events GROUP BY source_domain ORDER BY count DESC LIMIT 100`
  );

  const missing: Record<string, number> = {};
  for (const field of [
    "start_date", "end_date", "city", "country", "venue", "organizer",
    "official_url", "registration_url", "abstract_deadline", "description",
  ]) {
    missing[field] = await scalar(
      `SELECT COUNT(*) AS value FROM discovery_events WHERE ${field} IS NULL OR ${field} = ''`
    );
  }

  return { countries, categories, domains, missingFields: missing };
}
