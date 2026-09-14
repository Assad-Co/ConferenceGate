import fs from "node:fs";
import path from "node:path";
import { dbRun } from "./db";

const APIFY_STAGE7_FILE = path.join(process.cwd(), "data", "apify-stage7-validated-2026-09-14.json");

type ApifyConference = {
  conference_name?: string;
  event_type?: string;
  category?: string;
  event_year?: number;
  start_date?: string | null;
  end_date?: string | null;
  city?: string | null;
  state_region?: string | null;
  country?: string | null;
  venue?: string | null;
  format?: string | null;
  organizer?: string | null;
  official_url?: string | null;
  source_page_url?: string | null;
  official_site_resolved?: boolean;
  registration_url?: string | null;
  submission_url?: string | null;
  abstract_deadline?: string | null;
  registration_deadline?: string | null;
  early_bird_deadline?: string | null;
  contact_emails?: string[];
  keynote_speakers?: Array<string | Record<string, unknown>>;
  sponsors?: Array<string | Record<string, unknown>>;
  logo_url?: string | null;
  image_url?: string | null;
  source_domain?: string | null;
  source_page_title?: string | null;
  validation_status?: string;
  validation_score?: number;
};

function formatValue(value?: string | null): string | null {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "in-person" || normalized === "in person") return "in-person";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "online") return "online";
  return normalized || null;
}

function people(items: ApifyConference["keynote_speakers"]): Array<Record<string, unknown>> {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === "string") {
      return {
        name: item,
        full_name: item,
        role: null,
        org: null,
        organization: null,
        title: null,
        topic: null,
        email: null,
        imageUrl: null,
        photo_url: null,
      };
    }
    return item as Record<string, unknown>;
  });
}

function sponsors(items: ApifyConference["sponsors"]): Array<Record<string, unknown>> {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item === "string") {
      return {
        name: item,
        tier: null,
        sponsorship_level: null,
        logoUrl: null,
        logo_url: null,
        logo_source: null,
      };
    }
    return item as Record<string, unknown>;
  });
}

function sections(record: ApifyConference) {
  const sourceUrl = record.source_page_url || record.official_url || "";
  const locationText = [record.venue, record.city, record.state_region, record.country].filter(Boolean).join(", ") || null;
  const importantDates: Array<Record<string, unknown>> = [];
  if (record.start_date) importantDates.push({ label: "Conference dates", date: record.start_date, isDeadline: false });
  if (record.abstract_deadline) importantDates.push({ label: "Abstract deadline", date: record.abstract_deadline, isDeadline: true });
  if (record.registration_deadline) importantDates.push({ label: "Registration deadline", date: record.registration_deadline, isDeadline: true });
  if (record.early_bird_deadline) importantDates.push({ label: "Early-bird deadline", date: record.early_bird_deadline, isDeadline: true });

  const callForPapers = {
    status: null,
    abstract_submission_deadline: record.abstract_deadline || null,
    submission_email: record.contact_emails?.[0] || null,
    length_limit: null,
    submission_url: record.submission_url || null,
  };
  const hasCfp = Object.values(callForPapers).some((value) => typeof value === "string" && value.trim().length > 0);
  const keynoteRows = people(record.keynote_speakers);
  const sponsorRows = sponsors(record.sponsors);

  return {
    overview: {
      conference_name: record.conference_name || null,
      acronym: null,
      edition: null,
      description: null,
      dates_text: record.start_date && record.end_date
        ? (record.start_date === record.end_date ? record.start_date : `${record.start_date} – ${record.end_date}`)
        : record.start_date || null,
      start_date: record.start_date || null,
      end_date: record.end_date || null,
      city: record.city || null,
      region: record.state_region || null,
      country: record.country || null,
      world_region: null,
      venue: record.venue || null,
      location_text: locationText,
      format: formatValue(record.format),
      organizer: record.organizer || null,
      topics: [],
      categories: record.category ? [record.category] : [],
      keywords: [],
      important_dates: importantDates,
      official_url: record.official_url || null,
      source_url: sourceUrl,
      logo_url: record.logo_url || null,
      logo_source: record.logo_url ? "stated" : null,
      image_url: record.image_url || null,
    },
    call_for_papers: hasCfp ? callForPapers : {},
    program_agenda: { sessions: [], themes: [], overview: null },
    keynote_speakers: keynoteRows,
    technical_committee: [],
    sponsors_exhibitors: sponsorRows,
    venue_accommodation: {
      venue_name: record.venue || null,
      address: locationText,
      accommodation: null,
      hotels: [],
      travel_advisory: null,
      travel_advisory_source: null,
    },
    fees_pricing: {
      registration_url: record.registration_url || null,
      registration_fees: [],
      early_bird_deadline: record.early_bird_deadline || null,
      pricing_text: null,
    },
    community: {},
    extraction_metadata: {
      origin: "apify_stage7",
      status: "success",
      validation_status: record.validation_status,
      validation_score: record.validation_score,
      source_domain: record.source_domain || null,
      source_page_title: record.source_page_title || null,
      official_site_resolved: Boolean(record.official_site_resolved),
      imported_at: new Date().toISOString(),
      import_batch: "apify-stage7-validated-2026-09-14",
    },
  };
}

/**
 * Seed the validated Apify batch into the same canonical table ConferenceGate already reads.
 * INSERT OR IGNORE means an existing prepared/crawled conference always wins and is never overwritten.
 */
export async function importValidatedApifyConferences(): Promise<void> {
  if (!fs.existsSync(APIFY_STAGE7_FILE)) return;

  try {
    const payload = JSON.parse(fs.readFileSync(APIFY_STAGE7_FILE, "utf8"));
    const records: ApifyConference[] = Array.isArray(payload?.records) ? payload.records : [];
    let inserted = 0;

    for (const record of records) {
      if (record.validation_status !== "VALIDATED") continue;
      const sourceUrl = record.source_page_url || record.official_url;
      if (!sourceUrl || !record.conference_name || !record.start_date) continue;

      const data = sections(record);
      await dbRun(
        `INSERT OR IGNORE INTO extracted_conferences (
          source_url, overview, call_for_papers, program_agenda, keynote_speakers,
          technical_committee, sponsors_exhibitors, venue_accommodation, fees_pricing,
          community, extraction_metadata, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          sourceUrl,
          JSON.stringify(data.overview),
          JSON.stringify(data.call_for_papers),
          JSON.stringify(data.program_agenda),
          JSON.stringify(data.keynote_speakers),
          JSON.stringify(data.technical_committee),
          JSON.stringify(data.sponsors_exhibitors),
          JSON.stringify(data.venue_accommodation),
          JSON.stringify(data.fees_pricing),
          JSON.stringify(data.community),
          JSON.stringify(data.extraction_metadata),
        ]
      );
      inserted += 1;
    }

    console.log(`[apify-import] processed ${inserted} validated conferences into extracted_conferences`);
  } catch (error) {
    console.error("[apify-import] failed; continuing without seed import:", (error as Error).message);
  }
}
