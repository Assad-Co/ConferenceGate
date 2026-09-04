// Field-level audit of real discovered records against their real sources.
//
// A run's own metrics say how much was found; they say nothing about whether it is TRUE. This
// re-fetches a random sample of stored records from the pages they came from and checks each
// audited field against what that page says today. It is the difference between "the pipeline
// produced 128 rows" and "the dates on those rows are right".
//
// Each field gets one of five verdicts, and the distinction between the middle three is the
// whole value of the exercise:
//
//   confirmed        re-extracting the page today produces exactly the stored value
//   supported        the stored value appears verbatim in the page's text, though re-extraction
//                    read it differently (normalisation, or a value stated in two places)
//   not_supported    the page does not contain the stored value — a real extraction error, or a
//                    page that has since changed
//   absent           the record stores null: nothing was claimed, so nothing can be wrong
//   unverifiable     the page could not be re-read, so no judgement is possible
//
// `absent` is deliberately NOT counted as an error. A null is the engine working correctly.
// It is counted separately as coverage, because a record with eleven nulls is honest and useless.
//
// This produces the evidence for a human audit rather than replacing one: every row carries its
// source URL so the sample can be checked by hand, which is the only way to catch a value that is
// on the page and still wrong.

import { dbAll, dbGet } from "../db";
import { pageText } from "./htmlExtract";
import { newReadBudget, readPage } from "./readPage";
import { classifyCategories } from "./categories";
import { canonicalizeUrl, normalizeDates, normalizeDeadlines, normalizeEventType, normalizeFormat, normalizeLocation } from "./normalize";
import { extractFromHtml } from "./htmlExtract";
import { extractStructuredEvents } from "./structuredData";
import type { UrlGuard } from "./httpClient";

export const AUDITED_FIELDS = [
  "title",
  "start_date",
  "end_date",
  "city",
  "country",
  "format",
  "event_type",
  "category",
  "organizer",
  "official_url",
  "abstract_deadline",
] as const;
export type AuditedField = (typeof AUDITED_FIELDS)[number];

export type FieldVerdict = "confirmed" | "supported" | "not_supported" | "absent" | "unverifiable";

export interface FieldAudit {
  field: AuditedField;
  stored: string | null;
  /** What re-reading the page produces for this field now. */
  reExtracted: string | null;
  verdict: FieldVerdict;
  note: string;
}

export interface RecordAudit {
  eventId: string;
  title: string;
  sourceUrl: string;
  sourceDomain: string;
  extractionMethod: string;
  confidenceScore: number;
  /** How the page was read for the audit, which may differ from how it was read originally. */
  reReadRoute: string;
  pageReadable: boolean;
  fields: FieldAudit[];
  /** Anything that makes this record look like test data or an invalid listing. */
  suspicionFlags: string[];
}

export interface AuditReport {
  ranAt: string;
  requestedSample: number;
  auditedRecords: number;
  unreadableRecords: number;
  /** Per field: how the verdicts fell, and the accuracy over the fields that made a claim. */
  fieldAccuracy: Array<{
    field: AuditedField;
    confirmed: number;
    supported: number;
    notSupported: number;
    absent: number;
    unverifiable: number;
    /** (confirmed + supported) / claims checked. Null when nothing claimed anything. */
    accuracy: number | null;
    /** How often the field carried a value at all. */
    coverage: number;
  }>;
  overallAccuracy: number | null;
  records: RecordAudit[];
  suspiciousRecords: Array<{ eventId: string; title: string; sourceUrl: string; flags: string[] }>;
}

/** Signals that a record is test data, a template, or otherwise not a real conference listing.
 *  Neutral and evidence-based — these are reasons to look, never accusations. */
export function suspicionFlagsFor(row: Record<string, any>): string[] {
  const flags: string[] = [];
  const title = String(row.title || "");

  if (/\b(?:lorem ipsum|test|sample|demo|example|placeholder|dummy|untitled|coming soon|tbd|tba)\b/i.test(title)) {
    flags.push("title_looks_like_placeholder");
  }
  if (/\{\{|\}\}|%%|\$\{|__[A-Z_]+__/.test(title)) flags.push("title_contains_template_markup");
  if (title.length < 12) flags.push("title_implausibly_short");
  if (/^[A-Z\s\d]+$/.test(title) && title.length > 40) flags.push("title_all_caps");

  const url = String(row.official_url || row.source_url || "");
  if (/(?:localhost|127\.0\.0\.1|\.local|\.test|\.invalid|example\.(?:com|org|net))/i.test(url)) {
    flags.push("url_is_not_a_public_site");
  }
  if (/\/(?:wp-admin|staging|preview|draft|test)\//i.test(url)) flags.push("url_looks_like_staging");

  if (row.start_date && row.end_date) {
    const span = (Date.parse(row.end_date) - Date.parse(row.start_date)) / 86_400_000;
    if (span > 30) flags.push("date_span_implausibly_long");
    if (span < 0) flags.push("end_date_before_start_date");
  }
  if (row.start_year && (Number(row.start_year) < 2000 || Number(row.start_year) > 2100)) {
    flags.push("year_out_of_plausible_range");
  }
  if (Number(row.confidence_score) < 0.4) flags.push("very_low_confidence");

  try {
    const flagsStored = JSON.parse(row.quality_flags || "[]");
    if (Array.isArray(flagsStored) && flagsStored.includes("inconsistent_dates")) flags.push("inconsistent_dates");
  } catch {
    /* the column is malformed, which is not itself a suspicion about the conference */
  }

  return flags;
}

function normalizeForComparison(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Is the stored value literally present in the page's own text? */
function appearsInPage(stored: string, text: string): boolean {
  const needle = normalizeForComparison(stored);
  if (needle.length < 3) return false;
  return normalizeForComparison(text).includes(needle);
}

/** Dates are the field most worth being careful about: the page may write "22–24 February 2027"
 *  where the record stores "2027-02-22", and neither is wrong. */
function dateAppearsInPage(isoDate: string, text: string): boolean {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return false;
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const haystack = text.toLowerCase();
  const monthName = monthNames[month - 1];
  const shortMonth = monthName.slice(0, 3);
  const patterns = [
    isoDate,
    `${day} ${monthName} ${year}`,
    `${day} ${shortMonth}`,
    `${monthName} ${day}`,
    `${shortMonth} ${day}`,
    `${day}/${month}/${year}`,
    `${month}/${day}/${year}`,
  ];
  if (patterns.some((pattern) => haystack.includes(pattern.toLowerCase()))) return true;
  // A range: the day and the month appear near each other and the year is on the page.
  const dayNearMonth = new RegExp(`\\b${day}\\b[^.]{0,30}\\b${shortMonth}`, "i").test(text) ||
    new RegExp(`\\b${shortMonth}[^.]{0,30}\\b${day}\\b`, "i").test(text);
  return dayNearMonth && haystack.includes(String(year));
}

function verdictFor(
  field: AuditedField,
  stored: string | null,
  reExtracted: string | null,
  text: string,
  pageReadable: boolean
): FieldAudit {
  if (stored === null || stored === "" || stored === "unknown") {
    return { field, stored, reExtracted, verdict: "absent", note: "the record claims nothing for this field" };
  }
  if (!pageReadable) {
    return { field, stored, reExtracted, verdict: "unverifiable", note: "the source page could not be re-read" };
  }
  if (reExtracted !== null && normalizeForComparison(reExtracted) === normalizeForComparison(stored)) {
    return { field, stored, reExtracted, verdict: "confirmed", note: "re-reading the page produces the same value" };
  }

  const present =
    field === "start_date" || field === "end_date" || field === "abstract_deadline"
      ? dateAppearsInPage(stored, text)
      : field === "official_url"
        ? canonicalizeUrl(stored) === canonicalizeUrl(reExtracted) || appearsInPage(stored.replace(/^https?:\/\//, ""), text)
        : appearsInPage(stored, text);

  if (present) {
    return {
      field,
      stored,
      reExtracted,
      verdict: "supported",
      note: reExtracted
        ? `the page states this, though re-extraction read "${reExtracted}"`
        : "the page states this, though re-extraction did not pick it up",
    };
  }

  return {
    field,
    stored,
    reExtracted,
    verdict: "not_supported",
    note: reExtracted
      ? `the page does not appear to state this; it now reads "${reExtracted}"`
      : "the page does not appear to state this",
  };
}

export interface AuditOptions {
  sample?: number;
  /** Statuses eligible for auditing. Defaults to whatever the run accepted. */
  statuses?: string[];
  urlGuard?: UrlGuard;
  maxJinaPages?: number;
  onProgress?: (done: number, total: number, title: string) => void;
  publishReadiness?: string;
  eventIds?: string[];
  /** Publication audits must re-read the verified official URL, not the original discovery lead. */
  preferOfficialSource?: boolean;
}

export async function auditDiscoveredConferences(options: AuditOptions = {}): Promise<AuditReport> {
  const sample = Math.max(1, Math.min(options.sample ?? 20, 200));
  const statuses = options.statuses ?? ["validated", "published", "needs_review"];
  const placeholders = statuses.map(() => "?").join(", ");
  const readinessFilter = options.publishReadiness ? " AND publish_readiness = ?" : "";
  const ids = options.eventIds?.filter(Boolean) ?? [];
  const idFilter = ids.length ? ` AND id IN (${ids.map(() => "?").join(",")})` : "";

  // RANDOM() rather than a fixed ordering: an audit of the twenty most confident records would
  // flatter the engine, which is the opposite of the point.
  const rows = await dbAll<Record<string, any>>(
    `SELECT * FROM discovery_events WHERE status IN (${placeholders})${readinessFilter}${idFilter} ORDER BY RANDOM() LIMIT ?`,
    [...statuses, ...(options.publishReadiness ? [options.publishReadiness] : []), ...ids, sample]
  );

  const budget = newReadBudget(options.maxJinaPages ?? sample);
  const records: RecordAudit[] = [];

  for (const [index, row] of rows.entries()) {
    options.onProgress?.(index + 1, rows.length, String(row.title));

    const categories = await dbAll<{ category: string }>(
      "SELECT category FROM discovery_event_categories WHERE event_id = ? ORDER BY confidence DESC LIMIT 1",
      [row.id]
    );
    const storedCategory = categories[0]?.category ?? row.primary_category ?? null;

    const auditUrl = String(options.preferOfficialSource && row.official_url ? row.official_url : row.source_url);
    const read = await readPage(auditUrl, { budget, urlGuard: options.urlGuard });
    const pageReadable = !!read.html;
    const text = pageReadable ? pageText(read.html, 40000) : "";

    // Re-run the real extraction path, so the comparison is against what the engine would say
    // today rather than against a hand-written reading of the page.
    let reTitle: string | null = null;
    let reDates: ReturnType<typeof normalizeDates> | null = null;
    let reLocation: ReturnType<typeof normalizeLocation> | null = null;
    let reFormat: string | null = null;
    let reEventType: string | null = null;
    let reOrganizer: string | null = null;
    let reCategory: string | null = null;
    let reAbstractDeadline: string | null = null;
    let reOfficialUrl: string | null = null;

    if (pageReadable) {
      const structured = extractStructuredEvents(read.html, auditUrl);
      const raw = extractFromHtml(read.html, auditUrl, { seed: structured.events[0] ?? null });
      reTitle = raw.title;
      reDates = normalizeDates(raw);
      reLocation = normalizeLocation(raw);
      reFormat = normalizeFormat(raw.formatText, raw.locationText, raw.title, text.slice(0, 4000));
      reEventType = normalizeEventType(raw.eventTypeText, raw.title, raw.schemaType).eventType;
      reOrganizer = raw.organizer;
      reAbstractDeadline = normalizeDeadlines(raw, reDates.startDate).abstractDeadline;
      reOfficialUrl = raw.officialUrl || auditUrl;
      reCategory =
        classifyCategories({
          title: raw.title,
          description: raw.description,
          topics: raw.topics,
          organizer: raw.organizer,
          pageText: text,
        })[0]?.category ?? null;
    }

    const fields: FieldAudit[] = [
      verdictFor("title", row.title ?? null, reTitle, text, pageReadable),
      verdictFor("start_date", row.start_date ?? null, reDates?.startDate ?? null, text, pageReadable),
      verdictFor("end_date", row.end_date ?? null, reDates?.endDate ?? null, text, pageReadable),
      verdictFor("city", row.city ?? null, reLocation?.city ?? null, text, pageReadable),
      verdictFor("country", row.country ?? null, reLocation?.country ?? null, text, pageReadable),
      verdictFor("format", row.format === "unknown" ? null : row.format, reFormat, text, pageReadable),
      verdictFor("event_type", row.event_type ?? null, reEventType, text, pageReadable),
      verdictFor("category", storedCategory, reCategory, text, pageReadable),
      verdictFor("organizer", row.organizer ?? null, reOrganizer, text, pageReadable),
      verdictFor("official_url", row.official_url ?? null, reOfficialUrl, text, pageReadable),
      verdictFor("abstract_deadline", row.abstract_deadline ?? null, reAbstractDeadline, text, pageReadable),
    ];

    records.push({
      eventId: String(row.id),
      title: String(row.title),
      sourceUrl: auditUrl,
      sourceDomain: (() => { try { return new URL(auditUrl).hostname; } catch { return String(row.source_domain); } })(),
      extractionMethod: String(row.extraction_method),
      confidenceScore: Number(row.confidence_score),
      reReadRoute: read.route,
      pageReadable,
      fields,
      suspicionFlags: suspicionFlagsFor(row),
    });
  }

  // ---- Aggregate.
  const fieldAccuracy = AUDITED_FIELDS.map((field) => {
    const audits = records.map((record) => record.fields.find((f) => f.field === field)!).filter(Boolean);
    const confirmed = audits.filter((a) => a.verdict === "confirmed").length;
    const supported = audits.filter((a) => a.verdict === "supported").length;
    const notSupported = audits.filter((a) => a.verdict === "not_supported").length;
    const absent = audits.filter((a) => a.verdict === "absent").length;
    const unverifiable = audits.filter((a) => a.verdict === "unverifiable").length;
    const claimsChecked = confirmed + supported + notSupported;
    return {
      field,
      confirmed,
      supported,
      notSupported,
      absent,
      unverifiable,
      accuracy: claimsChecked > 0 ? Number(((confirmed + supported) / claimsChecked).toFixed(3)) : null,
      coverage: records.length > 0 ? Number(((records.length - absent) / records.length).toFixed(3)) : 0,
    };
  });

  const totalChecked = fieldAccuracy.reduce((sum, f) => sum + f.confirmed + f.supported + f.notSupported, 0);
  const totalRight = fieldAccuracy.reduce((sum, f) => sum + f.confirmed + f.supported, 0);

  return {
    ranAt: new Date().toISOString(),
    requestedSample: sample,
    auditedRecords: records.length,
    unreadableRecords: records.filter((record) => !record.pageReadable).length,
    fieldAccuracy,
    overallAccuracy: totalChecked > 0 ? Number((totalRight / totalChecked).toFixed(3)) : null,
    records,
    suspiciousRecords: records
      .filter((record) => record.suspicionFlags.length > 0)
      .map((record) => ({
        eventId: record.eventId,
        title: record.title,
        sourceUrl: record.sourceUrl,
        flags: record.suspicionFlags,
      })),
  };
}

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  const pct = (value: number | null) => (value === null ? "  n/a" : `${(value * 100).toFixed(1)}%`);

  lines.push("CONFERENCE GATE — DISCOVERY FIELD AUDIT");
  lines.push(`Ran ${report.ranAt}`);
  lines.push(`Sampled ${report.auditedRecords} record(s) at random; ${report.unreadableRecords} source page(s) could not be re-read.`);
  lines.push("");
  lines.push("Field                 confirmed  supported  NOT SUPPORTED  absent  unverif.  accuracy  coverage");
  for (const row of report.fieldAccuracy) {
    lines.push(
      `  ${row.field.padEnd(20)}${String(row.confirmed).padStart(6)}${String(row.supported).padStart(11)}${String(row.notSupported).padStart(15)}${String(row.absent).padStart(8)}${String(row.unverifiable).padStart(10)}${pct(row.accuracy).padStart(10)}${pct(row.coverage).padStart(10)}`
    );
  }
  lines.push("");
  lines.push(`Overall field accuracy (over fields that made a claim): ${pct(report.overallAccuracy)}`);
  lines.push("");

  const failures = report.records.flatMap((record) =>
    record.fields
      .filter((field) => field.verdict === "not_supported")
      .map((field) => ({ record, field }))
  );
  if (failures.length === 0) {
    lines.push("No field in the sample stored a value its source page does not support.");
  } else {
    lines.push(`Every unsupported field in the sample (${failures.length}):`);
    for (const { record, field } of failures) {
      lines.push(`  ${record.title.slice(0, 60)}`);
      lines.push(`    ${field.field}: stored "${String(field.stored).slice(0, 80)}" — ${field.note}`);
      lines.push(`    source: ${record.sourceUrl}`);
    }
  }

  if (report.suspiciousRecords.length > 0) {
    lines.push("");
    lines.push(`Records flagged for a closer look (${report.suspiciousRecords.length}) — neutral indicators, not accusations:`);
    for (const record of report.suspiciousRecords) {
      lines.push(`  ${record.title.slice(0, 60)} — ${record.flags.join(", ")}`);
      lines.push(`    ${record.sourceUrl}`);
    }
  }

  lines.push("");
  lines.push("The sample, for checking by hand:");
  for (const record of report.records) {
    lines.push(`  ${record.sourceUrl}`);
  }
  return lines.join("\n");
}
