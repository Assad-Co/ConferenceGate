// Persistence.
//
// This is where the five outcomes of section 23 actually happen: NEW creates, MATCH attaches a
// source, UPDATED changes fields, DUPLICATE merges, UNCERTAIN queues for review. Nothing here
// deletes a record, and nothing overwrites a value from a more trusted source with one from a
// less trusted one — a directory disagreeing with the organiser's own site is recorded as a
// second source and a change entry, not applied on top (section 20).
//
// Every write is field-level: a value, where it came from, how confident, when last confirmed.
// That is what makes "which source supplied the date?" answerable for any conference in the
// database (section 43).

import { dbAll, dbGet, dbRun } from "../db";
import { bestDuplicate, seriesKeyFor, seriesNameFor, type DuplicateCandidate, type DuplicateVerdict } from "./dedupe";
import { canonicalizeUrl, normalizeTitle } from "./normalize";
import { newId } from "./sourceRegistry";
import type { NormalizedEvent, PublicationStatus } from "./types";
import type { SourceClassification } from "./sourceClassification";

export type StoreOutcome = "created" | "updated" | "unchanged" | "merged" | "review_queued";

export interface StoreResult {
  outcome: StoreOutcome;
  eventId: string;
  duplicate: DuplicateVerdict | null;
  changedFields: string[];
}

export interface StoreOptions {
  status: PublicationStatus;
  /** Which retrieval route finally produced this record: direct, jina, alternate_url or
   *  directory_resolution. Without it, "the reader recovered one event" is an anecdote. */
  recoveryMethod?: string | null;
  /** True when this record began as a directory listing whose own site was then found. */
  resolvedFromDirectory?: boolean;
  /** Trust of the domain this record came from, 0–1. Decides who wins a field-level conflict. */
  sourceTrust: number;
  sourceType?: string | null;
  provider?: string;
  /** True when the record came from the conference's own site rather than someone writing about
   *  it. Official sources outrank directories. */
  isOfficial?: boolean;
  sourceClassification?: SourceClassification;
  classificationConfidence?: number;
  classificationEvidence?: string[];
}

/** Columns that hold a value read from a page, and can therefore be updated by a better source. */
const UPDATABLE_FIELDS: Array<{ column: string; read: (event: NormalizedEvent) => unknown }> = [
  { column: "title", read: (e) => e.title },
  { column: "acronym", read: (e) => e.acronym },
  { column: "description", read: (e) => e.description },
  { column: "start_date", read: (e) => e.startDate },
  { column: "end_date", read: (e) => e.endDate },
  { column: "start_year", read: (e) => e.startYear },
  { column: "start_month", read: (e) => e.startMonth },
  { column: "date_precision", read: (e) => e.datePrecision },
  { column: "dates_text", read: (e) => e.datesText },
  { column: "abstract_deadline", read: (e) => e.deadlines.abstractDeadline },
  { column: "paper_submission_deadline", read: (e) => e.deadlines.paperSubmissionDeadline },
  { column: "early_bird_deadline", read: (e) => e.deadlines.earlyBirdDeadline },
  { column: "registration_deadline", read: (e) => e.deadlines.registrationDeadline },
  { column: "notification_date", read: (e) => e.deadlines.notificationDate },
  { column: "camera_ready_deadline", read: (e) => e.deadlines.cameraReadyDeadline },
  { column: "venue", read: (e) => e.venue },
  { column: "venue_address", read: (e) => e.venueAddress },
  { column: "city", read: (e) => e.city },
  { column: "region", read: (e) => e.region },
  { column: "country", read: (e) => e.country },
  { column: "country_code", read: (e) => e.countryCode },
  { column: "world_region", read: (e) => e.worldRegion },
  { column: "raw_location", read: (e) => e.rawLocation },
  { column: "latitude", read: (e) => e.latitude },
  { column: "longitude", read: (e) => e.longitude },
  { column: "format", read: (e) => e.format },
  { column: "event_type", read: (e) => e.eventType },
  { column: "original_event_type", read: (e) => e.originalEventType },
  { column: "organizer", read: (e) => e.organizer },
  { column: "organizer_url", read: (e) => e.organizerUrl },
  { column: "official_url", read: (e) => e.officialUrl },
  { column: "registration_url", read: (e) => e.registrationUrl },
  { column: "submission_url", read: (e) => e.submissionUrl },
  { column: "image_url", read: (e) => e.imageUrl },
  { column: "price", read: (e) => e.price },
  { column: "currency", read: (e) => e.currency },
  { column: "language", read: (e) => e.language },
  { column: "contact_name", read: (e) => e.contactName },
  { column: "contact_email", read: (e) => e.contactEmail },
  { column: "contact_phone", read: (e) => e.contactPhone },
  { column: "edition", read: (e) => e.series.edition },
];

/** Field changes worth a named change-detection entry rather than a generic one (section 24). */
const CHANGE_TYPE_BY_FIELD: Record<string, string> = {
  start_date: "date_changed",
  end_date: "date_changed",
  venue: "venue_changed",
  city: "venue_changed",
  country: "country_changed",
  format: "format_changed",
  abstract_deadline: "abstract_deadline_changed",
  registration_url: "registration_opened",
  official_url: "official_url_changed",
};

interface EventRow extends DuplicateCandidate {
  confidence_score: number;
  status: string;
  content_hash: string | null;
  source_domain: string;
  [key: string]: unknown;
}

/** Records that could plausibly be the same conference, cheaply narrowed before scoring.
 *
 *  Indexed lookups only — canonical URL, normalized title, or the same year and country — so this
 *  stays a few indexed reads however large the table grows, rather than a scan (section 37). */
async function duplicateCandidates(event: NormalizedEvent): Promise<EventRow[]> {
  const canonical = canonicalizeUrl(event.officialUrl || event.sourceUrl);
  const byUrl = canonical
    ? await dbAll<EventRow>("SELECT * FROM discovery_events WHERE canonical_url = ? LIMIT 10", [canonical])
    : [];

  const byTitle = await dbAll<EventRow>(
    "SELECT * FROM discovery_events WHERE normalized_title = ? LIMIT 25",
    [normalizedTitleOf(event)]
  );

  const byYearCountry =
    event.startYear && event.country
      ? await dbAll<EventRow>(
          `SELECT * FROM discovery_events
            WHERE start_year = ? AND country = ?
            ORDER BY last_seen DESC LIMIT 50`,
          [event.startYear, event.country]
        )
      : [];

  const seriesKey = seriesKeyFor(event);
  const bySeries = seriesKey
    ? await dbAll<EventRow>(
        "SELECT * FROM discovery_events WHERE series_id = ? ORDER BY last_seen DESC LIMIT 25",
        [seriesKey]
      )
    : [];

  const byId = new Map<string, EventRow>();
  for (const row of [...byUrl, ...byTitle, ...byYearCountry, ...bySeries]) byId.set(row.id, row);
  return [...byId.values()];
}

function normalizedTitleOf(event: NormalizedEvent): string {
  return normalizeTitle(event.title);
}

export async function storeEvent(event: NormalizedEvent, options: StoreOptions): Promise<StoreResult> {
  const candidates = await duplicateCandidates(event);
  const match = bestDuplicate(event, candidates);

  if (!match) {
    const eventId = await insertEvent(event, options);
    return { outcome: "created", eventId, duplicate: null, changedFields: [] };
  }

  if (match.verdict.decision === "review") {
    // Both records stand. A person decides. Nothing is deleted and nothing is merged on a guess.
    const eventId = await insertEvent(event, options);
    await queueForReview({
      eventId: match.candidate.id,
      candidateEventId: eventId,
      reason: "possible_duplicate",
      duplicateScore: match.verdict.score,
      duplicateReason: match.verdict.reason,
      payload: { incomingTitle: event.title, existingTitle: match.candidate.title, sourceUrl: event.sourceUrl },
    });
    return { outcome: "review_queued", eventId, duplicate: match.verdict, changedFields: [] };
  }

  const changedFields = await mergeIntoExisting(match.candidate.id, event, options);
  return {
    outcome: changedFields.length > 0 ? "updated" : "merged",
    eventId: match.candidate.id,
    duplicate: match.verdict,
    changedFields,
  };
}

async function ensureSeries(event: NormalizedEvent): Promise<string | null> {
  const key = seriesKeyFor(event);
  if (!key) return null;
  const existing = await dbGet<{ id: string }>("SELECT id FROM discovery_series WHERE series_key = ?", [key]);
  if (existing) {
    await dbRun("UPDATE discovery_series SET last_seen = datetime('now') WHERE id = ?", [existing.id]);
    return key;
  }
  await dbRun(
    `INSERT INTO discovery_series (id, series_key, series_name, series_acronym, organizer)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(series_key) DO NOTHING`,
    [newId("ser"), key, seriesNameFor(event.title), event.acronym, event.organizer]
  );
  return key;
}

async function insertEvent(event: NormalizedEvent, options: StoreOptions): Promise<string> {
  const id = newId("dev");
  const seriesId = await ensureSeries(event);
  const canonical = canonicalizeUrl(event.officialUrl || event.sourceUrl);

  await dbRun(
    `INSERT INTO discovery_events (
       id, title, normalized_title, acronym, description,
       start_date, end_date, start_year, start_month, date_precision, dates_text,
       abstract_deadline, paper_submission_deadline, early_bird_deadline,
       registration_deadline, notification_date, camera_ready_deadline,
       venue, venue_address, city, region, country, country_code, world_region, raw_location, latitude, longitude,
       format, event_type, original_event_type,
       organizer, organizer_url, official_url, canonical_url, registration_url, submission_url, image_url,
       price, currency, language, contact_name, contact_email, contact_phone,
       topics, primary_category, series_id, edition,
       status, confidence_score, relevance_classification, relevance_reason, quality_flags,
       extraction_method, source_url, source_domain, content_hash,
       recovery_method, resolved_from_directory,
       last_verified
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      event.title,
      normalizedTitleOf(event),
      event.acronym,
      event.description,
      event.startDate,
      event.endDate,
      event.startYear,
      event.startMonth,
      event.datePrecision,
      event.datesText,
      event.deadlines.abstractDeadline,
      event.deadlines.paperSubmissionDeadline,
      event.deadlines.earlyBirdDeadline,
      event.deadlines.registrationDeadline,
      event.deadlines.notificationDate,
      event.deadlines.cameraReadyDeadline,
      event.venue,
      event.venueAddress,
      event.city,
      event.region,
      event.country,
      event.countryCode,
      event.worldRegion,
      event.rawLocation,
      event.latitude,
      event.longitude,
      event.format,
      event.eventType,
      event.originalEventType,
      event.organizer,
      event.organizerUrl,
      event.officialUrl,
      canonical,
      event.registrationUrl,
      event.submissionUrl,
      event.imageUrl,
      event.price,
      event.currency,
      event.language,
      event.contactName,
      event.contactEmail,
      event.contactPhone,
      JSON.stringify(event.topics.slice(0, 40)),
      event.categories[0]?.category ?? null,
      seriesId,
      event.series.edition,
      options.status,
      event.confidenceScore,
      event.relevance.classification,
      event.relevance.classificationReason,
      JSON.stringify(event.qualityFlags),
      event.extractionMethod,
      event.sourceUrl,
      event.sourceDomain,
      event.contentHash,
      options.recoveryMethod ?? null,
      options.resolvedFromDirectory ? 1 : 0,
    ]
  );

  await writeCategories(id, event);
  await writeSource(id, event, options);
  await writeFieldProvenance(id, event);
  await recordChange(id, "new_event", null, null, event.title, event.sourceUrl);
  return id;
}

/**
 * Applies an incoming reading to an existing record.
 *
 * Field by field: an empty field is filled by any source, and a filled field is only overwritten
 * by a source at least as trusted as the one that supplied it. Anything else is kept as a change
 * entry for the audit trail rather than applied, which is how a directory's wrong date stays out
 * of the record while remaining visible (section 20).
 */
async function mergeIntoExisting(
  eventId: string,
  event: NormalizedEvent,
  options: StoreOptions
): Promise<string[]> {
  const existing = await dbGet<EventRow>("SELECT * FROM discovery_events WHERE id = ?", [eventId]);
  if (!existing) return [];

  const existingSources = await dbAll<{ source_url: string; trust_score: number }>(
    "SELECT source_url, trust_score FROM discovery_event_sources WHERE event_id = ?",
    [eventId]
  );
  const bestExistingTrust = existingSources.reduce((max, row) => Math.max(max, row.trust_score), 0);

  const updates: Array<{ column: string; value: unknown }> = [];
  const changed: string[] = [];

  for (const field of UPDATABLE_FIELDS) {
    const incoming = field.read(event);
    if (incoming === null || incoming === undefined || incoming === "") continue;
    const current = existing[field.column];

    if (current === null || current === undefined || current === "") {
      updates.push({ column: field.column, value: incoming });
      changed.push(field.column);
      continue;
    }
    if (String(current) === String(incoming)) continue;

    if (options.sourceTrust >= bestExistingTrust) {
      updates.push({ column: field.column, value: incoming });
      changed.push(field.column);
      await recordChange(
        eventId,
        CHANGE_TYPE_BY_FIELD[field.column] || "field_updated",
        field.column,
        String(current),
        String(incoming),
        event.sourceUrl
      );
    } else {
      // Kept for audit, not applied: a less trusted source disagreed with a more trusted one.
      await recordChange(
        eventId,
        "conflicting_value_ignored",
        field.column,
        String(current),
        String(incoming),
        event.sourceUrl
      );
    }
  }

  if (updates.length > 0) {
    const setClause = updates.map((u) => `${u.column} = ?`).join(", ");
    await dbRun(
      `UPDATE discovery_events SET ${setClause}, last_seen = datetime('now'), last_checked = datetime('now'),
         last_verified = datetime('now'), last_modified = datetime('now') WHERE id = ?`,
      [...updates.map((u) => u.value as any), eventId]
    );
  } else {
    await dbRun(
      `UPDATE discovery_events SET last_seen = datetime('now'), last_checked = datetime('now'),
         last_verified = datetime('now') WHERE id = ?`,
      [eventId]
    );
  }

  // A better reading raises the record's confidence; a weaker one never lowers it.
  if (event.confidenceScore > (existing.confidence_score ?? 0)) {
    await dbRun("UPDATE discovery_events SET confidence_score = ? WHERE id = ?", [event.confidenceScore, eventId]);
  }

  await writeCategories(eventId, event);
  await writeSource(eventId, event, options);
  await writeFieldProvenance(eventId, event);
  return changed;
}

async function writeSource(eventId: string, event: NormalizedEvent, options: StoreOptions): Promise<void> {
  await dbRun(
    `INSERT INTO discovery_event_sources (
       id, event_id, source_url, source_domain, source_type, provider, trust_score,
       extraction_method, confidence, is_official, raw_extraction,
       source_classification, classification_confidence, classification_evidence
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, source_url) DO UPDATE SET
       trust_score = excluded.trust_score,
       extraction_method = excluded.extraction_method,
       confidence = excluded.confidence,
       is_official = excluded.is_official,
       source_classification = excluded.source_classification,
       classification_confidence = excluded.classification_confidence,
       classification_evidence = excluded.classification_evidence,
       last_verified = datetime('now')`,
    [
      newId("dsrc"),
      eventId,
      event.sourceUrl,
      event.sourceDomain,
      options.sourceType ?? null,
      options.provider ?? null,
      options.sourceTrust,
      event.extractionMethod,
      event.confidenceScore,
      options.isOfficial ? 1 : 0,
      JSON.stringify({ contentHash: event.contentHash, qualityFlags: event.qualityFlags }),
      options.sourceClassification ?? "unknown",
      options.classificationConfidence ?? 0,
      JSON.stringify(options.classificationEvidence ?? []),
    ]
  );
  if (event.officialUrl && event.officialUrl !== event.sourceUrl) {
    let officialDomain = event.sourceDomain;
    try { officialDomain = new URL(event.officialUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* validated elsewhere */ }
    await dbRun(
      `INSERT INTO discovery_event_sources (id, event_id, source_url, source_domain, source_type, provider, trust_score, extraction_method, confidence, is_official, raw_extraction, source_classification, classification_confidence, classification_evidence)
       VALUES (?, ?, ?, ?, 'official_website', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, source_url) DO NOTHING`,
      [newId("dsrc"), eventId, event.officialUrl, officialDomain, options.provider ?? null, Math.max(options.sourceTrust, 0.7), event.extractionMethod, event.confidenceScore, options.isOfficial ? 1 : 0, JSON.stringify({ discoveredFrom: event.sourceUrl }), options.sourceClassification ?? "unknown", options.classificationConfidence ?? 0, JSON.stringify(options.classificationEvidence ?? [])]
    );
  }
}

async function writeFieldProvenance(eventId: string, event: NormalizedEvent): Promise<void> {
  for (const [field, provenance] of Object.entries(event.provenance)) {
    await dbRun(
      `INSERT INTO discovery_event_fields (
         id, event_id, field, value, source_url, source_domain, extraction_method, confidence, last_verified
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(event_id, field) DO UPDATE SET
         value = excluded.value,
         source_url = excluded.source_url,
         source_domain = excluded.source_domain,
         extraction_method = excluded.extraction_method,
         confidence = excluded.confidence,
         last_verified = datetime('now')`,
      [
        newId("dfld"),
        eventId,
        field,
        provenance.value,
        provenance.sourceUrl,
        provenance.sourceDomain,
        provenance.method,
        provenance.confidence,
      ]
    );
  }
}

async function writeCategories(eventId: string, event: NormalizedEvent): Promise<void> {
  for (const assignment of event.categories) {
    await dbRun(
      `INSERT INTO discovery_event_categories (id, event_id, category, confidence, evidence)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_id, category) DO UPDATE SET
         confidence = MAX(discovery_event_categories.confidence, excluded.confidence),
         evidence = excluded.evidence`,
      [newId("dcat"), eventId, assignment.category, assignment.confidence, JSON.stringify(assignment.evidence)]
    );
  }
}

export async function recordChange(
  eventId: string,
  changeType: string,
  field: string | null,
  oldValue: string | null,
  newValue: string | null,
  sourceUrl: string | null
): Promise<void> {
  await dbRun(
    `INSERT INTO discovery_event_changes (id, event_id, change_type, field, old_value, new_value, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("dchg"),
      eventId,
      changeType,
      field,
      oldValue ? oldValue.slice(0, 500) : null,
      newValue ? newValue.slice(0, 500) : null,
      sourceUrl,
    ]
  );
}

export async function queueForReview(input: {
  eventId?: string | null;
  candidateEventId?: string | null;
  reason: string;
  duplicateScore?: number | null;
  duplicateReason?: string | null;
  payload?: Record<string, unknown>;
}): Promise<string> {
  const id = newId("drev");
  await dbRun(
    `INSERT INTO discovery_review_queue (
       id, event_id, candidate_event_id, reason, duplicate_score, duplicate_reason, payload
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.eventId ?? null,
      input.candidateEventId ?? null,
      input.reason,
      input.duplicateScore ?? null,
      input.duplicateReason ?? null,
      JSON.stringify(input.payload || {}),
    ]
  );
  return id;
}

// ---------------------------------------------------------------------------------------------
// URL state, for incremental crawling
// ---------------------------------------------------------------------------------------------

export interface UrlState {
  url: string;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  last_checked: string | null;
  fetch_failures: number;
  next_check_at: string | null;
  is_event: number | null;
}

/** The event a previously-read URL produced, if it produced one. */
export async function eventIdForUrl(url: string): Promise<string | null> {
  const row = await dbGet<{ event_id: string | null }>("SELECT event_id FROM discovery_urls WHERE url = ?", [url]);
  return row?.event_id ?? null;
}

export async function getUrlState(url: string): Promise<UrlState | undefined> {
  return dbGet<UrlState>(
    "SELECT url, etag, last_modified, content_hash, last_checked, fetch_failures, next_check_at, is_event FROM discovery_urls WHERE url = ?",
    [url]
  );
}

export async function rememberUrl(input: {
  url: string;
  domain: string;
  provider: string;
  priority: number;
}): Promise<void> {
  await dbRun(
    `INSERT INTO discovery_urls (url, domain, provider, priority) VALUES (?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       priority = MAX(discovery_urls.priority, excluded.priority),
       provider = CASE
         WHEN discovery_urls.provider = excluded.provider OR instr(discovery_urls.provider, excluded.provider) > 0 THEN discovery_urls.provider
         ELSE discovery_urls.provider || '+' || excluded.provider
       END`,
    [input.url, input.domain, input.provider, input.priority]
  );
}

/** Records the outcome of reading a URL, including when it should next be looked at.
 *
 *  An unchanged page is checked again later than a changed one, and a page that keeps failing
 *  backs off — that is the whole of "do not crawl every URL every day" (section 25). */
export async function recordUrlVisit(input: {
  url: string;
  domain: string;
  provider: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  failureReason?: string | null;
  /** The taxonomy class, so a run's failures can be counted by kind rather than by message. */
  failureClass?: string | null;
  /** A URL found to carry the same conference when this one did not answer. */
  alternateUrl?: string | null;
  isEvent?: boolean | null;
  eventId?: string | null;
  recheckHours: number;
}): Promise<void> {
  const failed = !!input.failureReason;
  await dbRun(
    `INSERT INTO discovery_urls (
       url, domain, provider, last_checked, last_status, etag, last_modified, content_hash,
       fetch_failures, last_failure_reason, failure_class, alternate_url, next_check_at, is_event, event_id
     ) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'), ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       last_checked = datetime('now'),
       last_status = excluded.last_status,
       etag = COALESCE(excluded.etag, discovery_urls.etag),
       last_modified = COALESCE(excluded.last_modified, discovery_urls.last_modified),
       content_hash = COALESCE(excluded.content_hash, discovery_urls.content_hash),
       fetch_failures = CASE WHEN ? THEN discovery_urls.fetch_failures + 1 ELSE 0 END,
       last_failure_reason = excluded.last_failure_reason,
       failure_class = excluded.failure_class,
       alternate_url = COALESCE(excluded.alternate_url, discovery_urls.alternate_url),
       next_check_at = excluded.next_check_at,
       is_event = COALESCE(excluded.is_event, discovery_urls.is_event),
       event_id = COALESCE(excluded.event_id, discovery_urls.event_id)`,
    [
      input.url,
      input.domain,
      input.provider,
      input.status,
      input.etag,
      input.lastModified,
      input.contentHash,
      failed ? 1 : 0,
      input.failureReason ?? null,
      input.failureClass ?? null,
      input.alternateUrl ?? null,
      input.recheckHours,
      input.isEvent === null || input.isEvent === undefined ? null : input.isEvent ? 1 : 0,
      input.eventId ?? null,
      failed ? 1 : 0,
    ]
  );
}
