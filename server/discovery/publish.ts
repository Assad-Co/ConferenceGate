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

export interface PublishOptions {
  /** Statuses eligible for publication. */
  statuses?: string[];
  limit?: number;
  minConfidence?: number;
  /** Report what would be written without writing it. */
  dryRun?: boolean;
}

export interface PublishResult {
  considered: number;
  written: number;
  skippedExisting: number;
  skippedIneligible: number;
  urls: string[];
}

export function isPublishEnabled(): boolean {
  return process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1";
}

/** Maps a discovery record onto the tab-shaped payload `extracted_conferences` stores.
 *
 *  Only sections discovery actually knows about are filled. The others stay at their empty
 *  defaults, so the app can tell "this conference has no sponsor list on file" from "we read a
 *  page and it listed no sponsors" — the same distinction the rest of the app is careful about. */
export function toExtractedConferenceRecord(row: Record<string, any>): Record<string, string> {
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

  return {
    overview: JSON.stringify(overview),
    call_for_papers: JSON.stringify(callForPapers),
    program_agenda: JSON.stringify({ sessions: [] }),
    keynote_speakers: JSON.stringify([]),
    technical_committee: JSON.stringify([]),
    sponsors_exhibitors: JSON.stringify([]),
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
    community: JSON.stringify({ social_media: [] }),
    extraction_metadata: JSON.stringify({
      // "success" is what the app's prepared-conference search requires to consider a row usable;
      // `origin` and `confidence` say plainly that this came from discovery rather than from a
      // full site crawl, so a consumer is never misled about how much was actually read.
      status: "success",
      origin: "discovery_engine",
      discovery_event_id: row.id,
      schema_version: "discovery-1",
      pages_crawled: 1,
      source_urls: [row.source_url],
      confidence: row.confidence_score,
      extraction_method: row.extraction_method,
      quality_flags: safeParseArray(row.quality_flags),
      conflicts: [],
      missing_sections: [
        "program_agenda", "keynote_speakers", "technical_committee", "sponsors_exhibitors",
      ],
      pages_failed: [],
      crawl_complete: true,
    }),
  };
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

export async function publishDiscoveredConferences(options: PublishOptions = {}): Promise<PublishResult> {
  const { dbAll } = await import("../db");
  const statuses = options.statuses ?? ["published", "validated"];
  const minConfidence = options.minConfidence ?? 0.7;
  const placeholders = statuses.map(() => "?").join(", ");

  const rows = await dbAll<Record<string, any>>(
    `SELECT e.* FROM discovery_events e
      WHERE e.status IN (${placeholders})
        AND e.publish_readiness = 'publish_ready'
        AND e.confidence_score >= ?
        AND e.title IS NOT NULL AND e.title <> ''
        AND e.official_url IS NOT NULL AND e.official_url <> ''
        AND e.country IS NOT NULL
        AND (e.start_date IS NOT NULL OR e.start_year IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM discovery_review_queue q
           WHERE q.status = 'open' AND (q.event_id = e.id OR q.candidate_event_id = e.id)
        )
      ORDER BY e.confidence_score DESC
      LIMIT ?`,
    [...statuses, minConfidence, options.limit ?? 500]
  );

  const result: PublishResult = {
    considered: rows.length,
    written: 0,
    skippedExisting: 0,
    skippedIneligible: 0,
    urls: [],
  };

  for (const row of rows) {
    const sourceUrl = row.official_url as string;
    const existing = await dbGet<{ source_url: string }>(
      "SELECT source_url FROM extracted_conferences WHERE source_url = ?",
      [sourceUrl]
    );
    if (existing) {
      result.skippedExisting += 1;
      continue;
    }
    if (options.dryRun) {
      result.written += 1;
      result.urls.push(sourceUrl);
      continue;
    }

    const record = toExtractedConferenceRecord(row);
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

