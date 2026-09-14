import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "apify-stage7-validated-2026-09-14.json");

function formatValue(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "in-person" || normalized === "in person") return "in-person";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "online") return "online";
  return normalized || null;
}

function people(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item !== "string") return item;
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
  });
}

function sponsorRows(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (typeof item !== "string") return item;
    return {
      name: item,
      tier: null,
      sponsorship_level: null,
      logoUrl: null,
      logo_url: null,
      logo_source: null,
    };
  });
}

function buildSections(record) {
  const sourceUrl = record.source_page_url || record.official_url;
  const locationText = [record.venue, record.city, record.state_region, record.country].filter(Boolean).join(", ") || null;
  const importantDates = [];
  if (record.start_date) importantDates.push({ label: "Conference dates", date: record.start_date, isDeadline: false });
  if (record.abstract_deadline) importantDates.push({ label: "Abstract deadline", date: record.abstract_deadline, isDeadline: true });
  if (record.registration_deadline) importantDates.push({ label: "Registration deadline", date: record.registration_deadline, isDeadline: true });
  if (record.early_bird_deadline) importantDates.push({ label: "Early-bird deadline", date: record.early_bird_deadline, isDeadline: true });

  const cfp = {
    status: null,
    abstract_submission_deadline: record.abstract_deadline || null,
    submission_email: record.contact_emails?.[0] || null,
    length_limit: null,
    submission_url: record.submission_url || null,
  };
  const hasCfp = Object.values(cfp).some((value) => typeof value === "string" && value.trim());

  return {
    overview: {
      conference_name: record.conference_name,
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
    call_for_papers: hasCfp ? cfp : {},
    program_agenda: { sessions: [], themes: [], overview: null },
    keynote_speakers: people(record.keynote_speakers),
    technical_committee: [],
    sponsors_exhibitors: sponsorRows(record.sponsors),
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
      import_batch: "apify-stage7-validated-2026-09-14",
    },
  };
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log("[apify-import] no seed file; skipping");
    return;
  }

  const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const records = Array.isArray(payload?.records) ? payload.records : [];

  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

  const localPath = path.join(process.cwd(), "data", "app.db");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const db = tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoToken || undefined })
    : createClient({ url: `file:${localPath}` });

  try {
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS extracted_conferences (
        source_url TEXT PRIMARY KEY,
        overview TEXT NOT NULL DEFAULT '{}',
        call_for_papers TEXT NOT NULL DEFAULT '{}',
        program_agenda TEXT NOT NULL DEFAULT '{}',
        keynote_speakers TEXT NOT NULL DEFAULT '[]',
        technical_committee TEXT NOT NULL DEFAULT '[]',
        sponsors_exhibitors TEXT NOT NULL DEFAULT '[]',
        venue_accommodation TEXT NOT NULL DEFAULT '{}',
        fees_pricing TEXT NOT NULL DEFAULT '{}',
        community TEXT NOT NULL DEFAULT '{}',
        extraction_metadata TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    let inserted = 0;
    let alreadyThere = 0;

    for (const record of records) {
      if (record.validation_status !== "VALIDATED") continue;
      const sourceUrl = record.source_page_url || record.official_url;
      if (!sourceUrl || !record.conference_name || !record.start_date) continue;

      const sections = buildSections(record);
      const result = await db.execute({
        sql: `INSERT OR IGNORE INTO extracted_conferences (
          source_url, overview, call_for_papers, program_agenda, keynote_speakers,
          technical_committee, sponsors_exhibitors, venue_accommodation, fees_pricing,
          community, extraction_metadata, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          sourceUrl,
          JSON.stringify(sections.overview),
          JSON.stringify(sections.call_for_papers),
          JSON.stringify(sections.program_agenda),
          JSON.stringify(sections.keynote_speakers),
          JSON.stringify(sections.technical_committee),
          JSON.stringify(sections.sponsors_exhibitors),
          JSON.stringify(sections.venue_accommodation),
          JSON.stringify(sections.fees_pricing),
          JSON.stringify(sections.community),
          JSON.stringify(sections.extraction_metadata),
        ],
      });

      if (Number(result.rowsAffected || 0) > 0) inserted += 1;
      else alreadyThere += 1;
    }

    console.log(`[apify-import] target=${tursoUrl ? "Turso" : "local SQLite"} inserted=${inserted} existing=${alreadyThere}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[apify-import] failed; ConferenceGate will still start:", error?.stack || error?.message || error);
  process.exitCode = 0;
});
