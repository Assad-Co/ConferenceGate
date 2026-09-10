// The one bridge from the discovery engine into Conference Gate's existing data.
//
// `extracted_conferences` is the table the app already treats as its canonical imported
// conference record, and `searchPreparedConferences` in server/braveSearch.ts already surfaces
// its rows through Discover. So a discovered conference reaching that table appears in the
// existing UI with no frontend change at all — which is exactly the integration this task calls
// for, and exactly why it needs to be careful.
//
// Three safeguards, all deliberate:
//
//   1. OFF BY DEFAULT. Section 44 says Phase 1 prioritises safe validation over publication.
//      Nothing is written here unless someone explicitly asks, per run or per call.
//   2. NEVER OVERWRITES. The insert is ON CONFLICT DO NOTHING. A conference that Conference Gate
//      has already crawled for itself keeps its own richer record; discovery never replaces it.
//   3. HIGH CONFIDENCE ONLY. A record has to have a title, a date, a country and a real official
//      URL, and must not be sitting in the review queue.

import { dbGet, dbRun } from "../db";
import { latestPassingPublicationAudit } from "./controlledPublish";
import { DEEP_SECTION_STORAGE, storedSectionIsEmpty, verifiedDeepSections } from "./deepEnrichment";
import { DEEP_SECTIONS } from "./deepSections";

export interface PublishOptions {
  /** Statuses eligible for publication. */
  statuses?: string[];
  limit?: number;
  minConfidence?: number;
  /** Report what would be written without writing it. */
  dryRun?: boolean;
  /** Restrict publication to events attributed to one discovery batch. */
  runId?: string;
  /** Tests may disable the production audit gate explicitly; production defaults to required. */
  requirePassingAudit?: boolean;
}

export interface PublishResult {
  considered: number;
  written: number;
  skippedExisting: number;
  skippedIneligible: number;
  urls: string[];
  /** Empty tabs filled in on conferences this engine had already published. */
  sectionsBackfilled?: number;
}

export function isPublishEnabled(): boolean {
  return process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1";
}

/** Maps a discovery record onto the tab-shaped payload `extracted_conferences` stores.
 *
 *  Only sections discovery actually knows about are filled. The others stay at their empty
 *  defaults, so the app can tell "this conference has no sponsor list on file" from "we read a
 *  page and it listed no sponsors" — the same distinction the rest of the app is careful about. */
export function toExtractedConferenceRecord(
  row: Record<string, any>, verifiedSections: Iterable<string> = []
): Record<string, string> {
  const topics = safeParseArray(row.topics);
  const importantDates = [
    { label: "Abstract submission deadline", date: row.abstract_deadline, isDeadline: true },
    { label: "Paper submission deadline", date: row.paper_submission_deadline, isDeadline: true },
    { label: "Early bird deadline", date: row.early_bird_deadline, isDeadline: true },
    { label: "Registration deadline", date: row.registration_deadline, isDeadline: true },
    { label: "Notification of acceptance", date: row.notification_date, isDeadline: true },
  ].filter((entry) => !!entry.date);

  const overview = {
    conference_name: row.title,
    acronym: row.acronym,
    edition: row.edition,
    description: row.description,
    start_date: row.start_date,
    end_date: row.end_date,
    dates_text: row.dates_text,
    city: row.city,
    country: row.country,
    format: row.format,
    organizer: row.organizer,
    topics,
    official_website: row.official_url,
    contact_email: row.contact_email,
    important_dates: importantDates,
    // Captured from the conference's own og:image when its page was read (htmlExtract), stored on
    // the event, and until now dropped at publication — so a record that HAD a picture of itself
    // still rendered a grey globe. Null when the page published none; never a stand-in.
    image_url: row.image_url || null,
  };

  const callForPapers = {
    status: null,
    abstract_submission_deadline: row.abstract_deadline,
    notification_date: row.notification_date,
    submission_guidelines: null,
    paper_requirements: null,
    abstract_requirements: null,
    submission_url: row.submission_url,
    submission_email: null,
    submission_template_url: null,
    submission_format: null,
    length_limit: null,
    review_process: null,
    topics_tracks: topics,
    publication_information: {
      proceedingsPublisher: null, journals: [], indexing: [], doi: null, isbn: null, issn: null,
    },
  };

  // The deep sections, when enrichment managed to read them from the organiser's own pages. They
  // are stored in exactly the shape `extracted_conferences` already holds and the detail tabs
  // already render, so a populated section reaches the UI without a line of frontend change. A
  // section nobody published stays at its empty default rather than becoming a plausible guess.
  const deep = deepSectionPayloads(row, new Set(verifiedSections));
  return {
    overview: JSON.stringify(overview),
    call_for_papers: JSON.stringify(callForPapers),
    program_agenda: deep.program_agenda ?? JSON.stringify({ sessions: [] }),
    keynote_speakers: deep.keynote_speakers ?? JSON.stringify([]),
    technical_committee: deep.technical_committee ?? JSON.stringify([]),
    sponsors_exhibitors: deep.sponsors_exhibitors ?? JSON.stringify([]),
    venue_accommodation: JSON.stringify({
      venue_name: row.venue,
      address: row.venue_address,
      city: row.city,
      country: row.country,
      hotels: [],
      accommodation: null,
      travel_information: null,
    }),
    fees_pricing: JSON.stringify({
      registration_url: row.registration_url,
      registration_fees: [],
      early_bird_deadline: row.early_bird_deadline,
      source_url: row.source_url,
    }),
    community: deep.community ?? JSON.stringify({ social_media: [] }),
    extraction_metadata: JSON.stringify({
      // "success" is what the app's prepared-conference search requires to consider a row usable;
      // `origin` and `confidence` say plainly that this came from discovery rather than from a
      // full site crawl, so a consumer is never misled about how much was actually read.
      status: "success",
      origin: "discovery_engine",
      discovery_event_id: row.id,
      schema_version: "discovery-1",
      pages_crawled: deep.sourceUrls.length || 1,
      source_urls: [row.source_url, ...deep.sourceUrls.filter((url) => url !== row.source_url)],
      confidence: row.confidence_score,
      extraction_method: row.extraction_method,
      quality_flags: safeParseArray(row.quality_flags),
      conflicts: [],
      // Say which tabs are genuinely empty, rather than declaring all four missing regardless.
      missing_sections: ["program_agenda", "keynote_speakers", "technical_committee", "sponsors_exhibitors"]
        .filter((column) => !deep[column as keyof DeepSectionPayloads]),
      // The same list under the name the reader-facing payload uses, so a consumer can tell a
      // section nobody has read from one that was read and found empty. Without it the detail page
      // rendered "(0) speakers" for a conference whose speakers page had never been opened.
      sections_not_read: ["program_agenda", "keynote_speakers", "technical_committee", "sponsors_exhibitors"]
        .filter((column) => !deep[column as keyof DeepSectionPayloads]),
      pages_failed: [],
      crawl_complete: true,
    }),
  };
}

interface DeepSectionPayloads {
  program_agenda: string | null;
  keynote_speakers: string | null;
  technical_committee: string | null;
  sponsors_exhibitors: string | null;
  community: string | null;
  /** Every page the stored sections name, so the published record says where each tab came from. */
  sourceUrls: string[];
}

/**
 * Reads the stored deep sections off a discovery row, keeping every source URL they carry.
 *
 * `verified` is the ledger of sections a hardened read has actually confirmed. A section missing
 * from it is HELD: its items stay in discovery storage and are simply not part of what a customer
 * is shown. An empty set therefore publishes nothing deep at all, which is the safe direction for
 * any caller that has not looked the ledger up.
 */
function deepSectionPayloads(row: Record<string, any>, verified: Set<string>): DeepSectionPayloads {
  const payloads: Record<string, string | null> = {
    program_agenda: null, keynote_speakers: null, technical_committee: null,
    sponsors_exhibitors: null, community: null,
  };
  const sourceUrls = new Set<string>();
  for (const section of DEEP_SECTIONS) {
    const { column } = DEEP_SECTION_STORAGE[section];
    const stored = row[column];
    if (storedSectionIsEmpty(stored) || !verified.has(section)) { payloads[column] = null; continue; }
    payloads[column] = typeof stored === "string" ? stored : JSON.stringify(stored);
    try {
      const parsed = JSON.parse(payloads[column]!);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && typeof item === "object" && typeof item.source_url === "string") sourceUrls.add(item.source_url);
      }
    } catch { /* a malformed stored section simply contributes no provenance */ }
  }
  return { ...(payloads as unknown as Omit<DeepSectionPayloads, "sourceUrls">), sourceUrls: [...sourceUrls] };
}

function safeParseArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** True only for a row this engine published; anything else is somebody else's record. */
function isDiscoveryEngineRow(existing: Record<string, any>): boolean {
  try {
    return JSON.parse(String(existing.extraction_metadata || "{}"))?.origin === "discovery_engine";
  } catch {
    return false;
  }
}

/** Fills the empty deep sections of an already-published row. Returns how many it filled. */
async function backfillDeepSections(
  existing: Record<string, any>, row: Record<string, any>, verified: Set<string>
): Promise<number> {
  if (!isDiscoveryEngineRow(existing)) return 0;
  const deep = deepSectionPayloads(row, verified);
  const updates: Array<[string, string]> = [];
  for (const section of DEEP_SECTIONS) {
    const { column } = DEEP_SECTION_STORAGE[section];
    const payload = deep[column as keyof DeepSectionPayloads];
    if (typeof payload !== "string") continue;
    if (!storedSectionIsEmpty(existing[column])) continue;
    updates.push([column, payload]);
  }
  if (updates.length === 0) return 0;
  await dbRun(
    `UPDATE extracted_conferences SET ${updates.map(([column]) => `${column}=?`).join(", ")},
       updated_at=datetime('now') WHERE source_url=?`,
    [...updates.map(([, payload]) => payload), existing.source_url]
  );
  return updates.length;
}

export interface DeepSectionSyncResult {
  examined: number;
  updatedRecords: number;
  sectionsFilled: number;
  dryRun: boolean;
  /** Sections withheld from a published row because no hardened read has confirmed them. */
  sectionsHeld: number;
  filled: Array<{ sourceUrl: string; sections: string[]; held: string[] }>;
}

/**
 * Copies stored deep sections onto the published rows that are still missing them.
 *
 * This exists because filling an empty tab was only ever a side effect of `publish`, and `publish`
 * runs behind the controlled permit AND a fresh passing audit. A conference published in March
 * whose speakers page was read in September therefore kept four empty tabs until the next
 * successful publication run — and if the audit failed, indefinitely. Enrichment is what learns
 * the sections, so enrichment is what should deliver them.
 *
 * It publishes nothing. It cannot make a conference visible, cannot change readiness, and touches
 * no row this engine did not write: the eligibility SQL, the audit and the permit all continue to
 * govern which conferences exist in `extracted_conferences` at all. The only thing that changes is
 * whether a tab on an already-visible conference shows what the organiser's own page said.
 */
export async function syncPublishedDeepSections(
  options: { limit?: number; dryRun?: boolean } = {}
): Promise<DeepSectionSyncResult> {
  // `extracted_conferences` belongs to the app's own schema, not the discovery engine's, so a
  // worker that only initialised the discovery tables would fail here rather than report zero.
  const { dbAll, initDb } = await import("../db");
  await initDb();
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
  const result: DeepSectionSyncResult = {
    examined: 0, updatedRecords: 0, sectionsFilled: 0, sectionsHeld: 0, dryRun: !!options.dryRun, filled: [],
  };

  // Only rows this engine wrote, only where the discovery record actually holds something the
  // published row does not.
  const rows = await dbAll<Record<string, any>>(
    `SELECT ec.source_url, e.id AS event_id, ec.program_agenda, ec.keynote_speakers, ec.technical_committee,
            ec.sponsors_exhibitors, ec.community, ec.extraction_metadata,
            e.program_agenda AS e_program_agenda, e.keynote_speakers AS e_keynote_speakers,
            e.technical_committee AS e_technical_committee,
            e.sponsors_exhibitors AS e_sponsors_exhibitors, e.community AS e_community
       FROM extracted_conferences ec
       JOIN discovery_events e
         ON e.id = json_extract(ec.extraction_metadata, '$.discovery_event_id')
      WHERE json_extract(ec.extraction_metadata, '$.origin') = 'discovery_engine'
      ORDER BY ec.updated_at DESC
      LIMIT ?`,
    [limit]
  );

  const EMPTY_SECTION: Record<string, string> = {
    program_agenda: JSON.stringify({ sessions: [] }),
    keynote_speakers: JSON.stringify([]),
    technical_committee: JSON.stringify([]),
    sponsors_exhibitors: JSON.stringify([]),
    community: JSON.stringify({ social_media: [] }),
  };

  for (const row of rows) {
    result.examined += 1;
    const eventId = String(row.event_id || "");
    const verified = await verifiedDeepSections(eventId);
    const stored: Record<string, any> = {};
    for (const section of DEEP_SECTIONS) {
      const { column } = DEEP_SECTION_STORAGE[section];
      stored[column] = row[`e_${column}`];
    }

    const sections = DEEP_SECTIONS.filter((section) => {
      const { column } = DEEP_SECTION_STORAGE[section];
      return verified.has(section) && !storedSectionIsEmpty(stored[column]) && storedSectionIsEmpty(row[column]);
    });
    // A section on the published row that no hardened read has confirmed. The items stay in
    // discovery storage untouched; what changes is only that a customer stops being shown them
    // until a read either confirms them or replaces them.
    const held = DEEP_SECTIONS.filter((section) => {
      const { column } = DEEP_SECTION_STORAGE[section];
      return !verified.has(section) && !storedSectionIsEmpty(row[column]);
    });
    if (sections.length === 0 && held.length === 0) continue;

    if (!options.dryRun) {
      let changed = 0;
      if (sections.length > 0) changed += await backfillDeepSections(row, stored, verified);
      if (held.length > 0) {
        await dbRun(
          `UPDATE extracted_conferences SET ${held.map((section) => `${DEEP_SECTION_STORAGE[section].column}=?`).join(", ")},
             updated_at=datetime('now') WHERE source_url=?`,
          [...held.map((section) => EMPTY_SECTION[DEEP_SECTION_STORAGE[section].column]), row.source_url]
        );
        changed += held.length;
      }
      if (changed === 0) continue;
      result.sectionsFilled += sections.length;
      result.sectionsHeld += held.length;
    } else {
      result.sectionsFilled += sections.length;
      result.sectionsHeld += held.length;
    }
    result.updatedRecords += 1;
    if (result.filled.length < 20) {
      result.filled.push({ sourceUrl: String(row.source_url), sections: [...sections], held: [...held] });
    }
  }
  return result;
}

export async function publishDiscoveredConferences(options: PublishOptions = {}): Promise<PublishResult> {
  const { dbAll } = await import("../db");
  const statuses = options.statuses ?? ["published", "validated"];
  const minConfidence = options.minConfidence ?? 0.7;
  const placeholders = statuses.map(() => "?").join(", ");
  if (!options.dryRun && options.requirePassingAudit !== false && !(await latestPassingPublicationAudit())) {
    throw new Error("Refusing publication: no passing 10-record publish_ready audit exists from the last 30 days.");
  }
  const runJoin = options.runId
    ? " JOIN discovery_run_events re ON re.event_id=e.id AND re.run_id=?"
    : "";

  const rows = await dbAll<Record<string, any>>(
    `SELECT DISTINCT e.* FROM discovery_events e${runJoin}
      WHERE e.status IN (${placeholders})
        AND e.publish_readiness = 'publish_ready'
        AND e.confidence_score >= ?
        AND e.title IS NOT NULL AND e.title <> ''
        AND e.official_url IS NOT NULL AND e.official_url <> ''
        AND (e.official_url LIKE 'https://%' OR e.official_url LIKE 'http://%')
        AND (e.country IS NOT NULL OR e.format = 'online')
        AND (e.start_date IS NOT NULL OR e.start_year IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM discovery_event_sources s
           WHERE s.event_id = e.id
             AND s.is_official = 1
             AND s.classification_confidence >= 0.8
             AND s.source_classification IN ('official_event_site','organizer_site','society_site','university_host_site')
             AND lower(rtrim(s.source_url,'/')) = lower(rtrim(e.official_url,'/'))
        )
        AND NOT EXISTS (
          SELECT 1 FROM discovery_review_queue q
           WHERE q.status = 'open' AND (q.event_id = e.id OR q.candidate_event_id = e.id)
        )
      ORDER BY e.confidence_score DESC
      LIMIT ?`,
    [...(options.runId ? [options.runId] : []), ...statuses, minConfidence, options.limit ?? 500]
  );

  const result: PublishResult = {
    considered: rows.length,
    written: 0,
    skippedExisting: 0,
    skippedIneligible: 0,
    urls: [],
    sectionsBackfilled: 0,
  };

  for (const row of rows) {
    const sourceUrl = row.official_url as string;
    const existing = await dbGet<Record<string, any>>(
      `SELECT source_url, program_agenda, keynote_speakers, technical_committee, sponsors_exhibitors,
              community, extraction_metadata
         FROM extracted_conferences WHERE source_url = ?`,
      [sourceUrl]
    );
    if (existing) {
      result.skippedExisting += 1;
      // The row is already published and already passed every gate above; the conference is not
      // in question. What is in question is whether its tabs are still empty because enrichment
      // had not yet read the organiser's programme and speakers pages when it was written. Fill
      // only the sections that are empty, only on rows this engine wrote itself, and never
      // overwrite anything — a conference the app crawled for itself keeps its own record, which
      // is the same rule the insert below has always followed.
      if (!options.dryRun) {
        result.sectionsBackfilled = (result.sectionsBackfilled ?? 0)
          + await backfillDeepSections(existing, row, await verifiedDeepSections(String(row.id)));
      }
      continue;
    }
    if (options.dryRun) {
      result.written += 1;
      result.urls.push(sourceUrl);
      continue;
    }

    const record = toExtractedConferenceRecord(row, await verifiedDeepSections(String(row.id)));
    await dbRun(
      `INSERT INTO extracted_conferences (
         source_url, overview, call_for_papers, program_agenda, keynote_speakers,
         technical_committee, sponsors_exhibitors, venue_accommodation, fees_pricing, community,
         extraction_metadata, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(source_url) DO NOTHING`,
      [
        sourceUrl,
        record.overview,
        record.call_for_papers,
        record.program_agenda,
        record.keynote_speakers,
        record.technical_committee,
        record.sponsors_exhibitors,
        record.venue_accommodation,
        record.fees_pricing,
        record.community,
        record.extraction_metadata,
      ]
    );
    await dbRun("UPDATE discovery_events SET published_at = datetime('now'), status = 'published' WHERE id = ?", [row.id]);
    result.written += 1;
    result.urls.push(sourceUrl);
  }

  return result;
}
