// CSV export and the quality report (sections 32 and 34).
//
// The CSV columns are exactly the ones section 32 names, in that order, so the file can be opened
// and checked against the specification without a mapping step. An empty cell means the source
// did not state the value — it never means "we filled in something plausible".

import fs from "fs";
import path from "path";
import { dbAll } from "../db";
import { coverageBreakdown, computeMetrics, type DiscoveryMetrics } from "./metrics";

export const CSV_COLUMNS = [
  "title",
  "start_date",
  "end_date",
  "city",
  "region",
  "country",
  "format",
  "event_type",
  "categories",
  "organizer",
  "official_url",
  "registration_url",
  "abstract_deadline",
  "description",
  "source_url",
  "source_domain",
  "extraction_method",
  "confidence_score",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\r?\n/g, " ").trim();
  if (!/[",;]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export interface ExportOptions {
  /** Statuses to include. Defaults to everything that passed validation. */
  statuses?: string[];
  limit?: number;
  years?: number[];
  /** Restrict rows to events attributable to one run, including merges into older records. */
  runId?: string;
}

export async function exportEventsCsv(options: ExportOptions = {}): Promise<string> {
  const statuses = options.statuses ?? ["validated", "published", "needs_review"];
  const placeholders = statuses.map(() => "?").join(", ");
  const yearFilter = options.years?.length ? ` AND start_year IN (${options.years.map(() => "?").join(", ")})` : "";
  const runJoin = options.runId ? " JOIN discovery_run_events re ON re.event_id = e.id AND re.run_id = ?" : "";

  const rows = await dbAll<Record<string, any>>(
    `SELECT DISTINCT e.*, (
        SELECT GROUP_CONCAT(c.category, '; ')
          FROM discovery_event_categories c
         WHERE c.event_id = e.id
       ) AS categories
       FROM discovery_events e${runJoin}
      WHERE e.status IN (${placeholders})${yearFilter}
      ORDER BY e.start_date IS NULL, e.start_date ASC, e.title ASC
      LIMIT ?`,
    [...(options.runId ? [options.runId] : []), ...statuses, ...(options.years ?? []), options.limit ?? 5000]
  );

  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.title,
        row.start_date,
        row.end_date,
        row.city,
        row.region,
        row.country,
        row.format,
        row.event_type,
        row.categories,
        row.organizer,
        row.official_url,
        row.registration_url,
        row.abstract_deadline,
        row.description,
        row.source_url,
        row.source_domain,
        row.extraction_method,
        row.confidence_score,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export async function writeEventsCsv(filePath: string, options: ExportOptions = {}): Promise<{ path: string; rows: number }> {
  const csv = await exportEventsCsv(options);
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${csv}\n`, "utf8");
  return { path: absolute, rows: Math.max(0, csv.split("\n").length - 1) };
}

/** What the most recent run actually did. Kept separate from the database totals because a
 *  rejected page never becomes a row — "records rejected" is only answerable from the run. */
export interface LastRunSummary {
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
  candidatesDiscovered: number;
  pagesFetched: number;
  pagesUnchanged: number;
  pagesFailed: number;
  eventsDetected: number;
  eventsRejected: number;
  created: number;
  updated: number;
  merged: number;
  reviewQueued: number;
  aiCalls: number;
  rejectionReasons: Record<string, number>;
}

export interface QualityReport {
  generatedAt: string;
  metrics: DiscoveryMetrics;
  lastRun: LastRunSummary | null;
  recordsDiscovered: number;
  recordsAccepted: number;
  recordsRejected: number;
  duplicatesFound: number;
  countries: Array<{ country: string; count: number }>;
  categories: Array<{ category: string; count: number }>;
  domains: Array<{ domain: string; count: number }>;
  missingFields: Record<string, number>;
  lowConfidenceRecords: number;
  reviewQueue: number;
  errors: Array<{ reason: string; count: number }>;
  qualityFlags: Array<{ flag: string; count: number }>;
}

export async function buildQualityReport(): Promise<QualityReport> {
  const metrics = await computeMetrics();
  const coverage = await coverageBreakdown();

  const rejected = (metrics.eventsByStatus.rejected ?? 0) + (metrics.eventsByStatus.expired ?? 0);
  const accepted =
    (metrics.eventsByStatus.validated ?? 0) +
    (metrics.eventsByStatus.published ?? 0) +
    (metrics.eventsByStatus.needs_review ?? 0);

  const flagRows = await dbAll<{ quality_flags: string }>(
    "SELECT quality_flags FROM discovery_events WHERE quality_flags <> '[]' LIMIT 5000"
  );
  const flagCounts = new Map<string, number>();
  for (const row of flagRows) {
    try {
      for (const flag of JSON.parse(row.quality_flags) as string[]) {
        flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
      }
    } catch {
      continue;
    }
  }

  const errorRows = await dbAll<{ last_failure_reason: string; count: number }>(
    `SELECT last_failure_reason, COUNT(*) AS count
       FROM discovery_urls
      WHERE last_failure_reason IS NOT NULL
      GROUP BY last_failure_reason ORDER BY count DESC LIMIT 25`
  );

  const lowConfidence = await dbAll<{ count: number }>(
    "SELECT COUNT(*) AS count FROM discovery_events WHERE confidence_score < 0.5"
  );

  const runRow = await dbAll<Record<string, any>>(
    "SELECT id, started_at, finished_at, status, counters FROM discovery_runs ORDER BY started_at DESC LIMIT 1"
  );
  const counters = (() => {
    try {
      return JSON.parse(runRow[0]?.counters || "{}");
    } catch {
      return {};
    }
  })();
  const lastRun: LastRunSummary | null = runRow[0]
    ? {
        runId: runRow[0].id,
        startedAt: runRow[0].started_at,
        finishedAt: runRow[0].finished_at,
        status: runRow[0].status,
        candidatesDiscovered: Number(counters.candidatesDiscovered ?? 0),
        pagesFetched: Number(counters.pagesFetched ?? 0),
        pagesUnchanged: Number(counters.pagesUnchanged ?? 0),
        pagesFailed: Number(counters.pagesFailed ?? 0),
        eventsDetected: Number(counters.eventsDetected ?? 0),
        eventsRejected: Number(counters.eventsRejected ?? 0),
        created: Number(counters.created ?? 0),
        updated: Number(counters.updated ?? 0),
        merged: Number(counters.merged ?? 0),
        reviewQueued: Number(counters.reviewQueued ?? 0),
        aiCalls: Number(counters.aiCalls ?? 0),
        rejectionReasons: counters.rejectionReasons || {},
      }
    : null;

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    lastRun,
    recordsDiscovered: metrics.totalEvents,
    recordsAccepted: accepted,
    recordsRejected: rejected,
    duplicatesFound: Math.round(metrics.duplicateRate * metrics.totalEvents),
    countries: coverage.countries,
    categories: coverage.categories,
    domains: coverage.domains,
    missingFields: coverage.missingFields,
    lowConfidenceRecords: Number(lowConfidence[0]?.count ?? 0),
    reviewQueue: metrics.reviewQueueOpen,
    errors: errorRows.map((row) => ({ reason: row.last_failure_reason, count: Number(row.count) })),
    qualityFlags: [...flagCounts.entries()]
      .map(([flag, count]) => ({ flag, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** The same report as plain text, for a terminal or a log. */
export function formatQualityReport(report: QualityReport): string {
  const lines: string[] = [];
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

  lines.push("CONFERENCE GATE — DISCOVERY QUALITY REPORT");
  lines.push(`Generated ${report.generatedAt}`);
  lines.push("");
  lines.push(`Candidate URLs known .......... ${report.metrics.totalCandidateUrls}`);
  lines.push(`URLs read ..................... ${report.metrics.urlsRead}`);
  lines.push(`Records stored ................ ${report.recordsDiscovered}`);
  lines.push(`Records accepted .............. ${report.recordsAccepted}`);
  lines.push(`Records expired or rejected ... ${report.recordsRejected}`);
  if (report.lastRun) {
    // A page rejected during a run never becomes a row, so these counts come from the run itself
    // rather than from the tables — otherwise "rejected" would always read as zero.
    lines.push("");
    lines.push(`Most recent run (${report.lastRun.runId ?? "unknown"}, ${report.lastRun.status ?? "unknown"})`);
    lines.push(`  candidate URLs discovered ... ${report.lastRun.candidatesDiscovered}`);
    lines.push(`  pages fetched ............... ${report.lastRun.pagesFetched}`);
    lines.push(`  pages unchanged (skipped) ... ${report.lastRun.pagesUnchanged}`);
    lines.push(`  pages failed ................ ${report.lastRun.pagesFailed}`);
    lines.push(`  events detected ............. ${report.lastRun.eventsDetected}`);
    lines.push(`  events rejected ............. ${report.lastRun.eventsRejected}`);
    lines.push(`  created / updated / merged .. ${report.lastRun.created} / ${report.lastRun.updated} / ${report.lastRun.merged}`);
    lines.push(`  queued for review ........... ${report.lastRun.reviewQueued}`);
    lines.push(`  AI calls .................... ${report.lastRun.aiCalls}`);
    for (const [reason, count] of Object.entries(report.lastRun.rejectionReasons)) {
      lines.push(`  rejected — ${reason}: ${count}`);
    }
    lines.push("");
  }
  lines.push(`Duplicates merged ............. ${report.duplicatesFound} (${pct(report.metrics.duplicateRate)})`);
  lines.push(`Held for review ............... ${report.reviewQueue}`);
  lines.push(`Low-confidence records ........ ${report.lowConfidenceRecords}`);
  lines.push(`Average confidence ............ ${report.metrics.averageConfidence}`);
  lines.push(`Fetch failure rate ............ ${pct(report.metrics.failureRate)}`);
  lines.push("");
  lines.push("Extraction method");
  lines.push(`  structured data ............. ${pct(report.metrics.extractionRates.structuredData)}`);
  lines.push(`  deterministic HTML .......... ${pct(report.metrics.extractionRates.html)}`);
  lines.push(`  AI fallback ................. ${pct(report.metrics.extractionRates.ai)}`);
  lines.push("");
  lines.push("By year");
  for (const [year, count] of Object.entries(report.metrics.eventsByYear)) {
    lines.push(`  ${year} ........................ ${count}`);
  }
  lines.push("");
  lines.push(`Countries represented ......... ${report.metrics.countriesRepresented}`);
  for (const row of report.countries.slice(0, 15)) lines.push(`  ${row.country}: ${row.count}`);
  lines.push("");
  lines.push(`Categories represented ........ ${report.metrics.categoriesRepresented}`);
  for (const row of report.categories.slice(0, 15)) lines.push(`  ${row.category}: ${row.count}`);
  lines.push("");
  lines.push(`Domains represented ........... ${report.metrics.domainsRepresented}`);
  for (const row of report.domains.slice(0, 15)) lines.push(`  ${row.domain}: ${row.count}`);
  lines.push("");
  lines.push("Missing fields (records without a value)");
  for (const [field, count] of Object.entries(report.missingFields)) lines.push(`  ${field}: ${count}`);
  if (report.qualityFlags.length > 0) {
    lines.push("");
    lines.push("Quality flags");
    for (const row of report.qualityFlags.slice(0, 20)) lines.push(`  ${row.flag}: ${row.count}`);
  }
  if (report.errors.length > 0) {
    lines.push("");
    lines.push("Fetch errors");
    for (const row of report.errors) lines.push(`  ${row.reason}: ${row.count}`);
  }
  return lines.join("\n");
}
