import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "apify-stage7-validated-2026-09-14.json");
const BATCH = "apify-stage7-validated-2026-09-14";

function formatValue(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "in-person" || normalized === "in person") return "in-person";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "online") return "online";
  return normalized || null;
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha1").update(String(value || "")).digest("hex").slice(0, 24)}`;
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

function sectionAvailability(record) {
  const hasVenue = Boolean(record.venue || record.city || record.country);
  const hasCfp = Boolean(record.submission_url || record.abstract_deadline);
  const hasFees = Boolean(record.registration_url || record.registration_deadline || record.early_bird_deadline);
  const hasSpeakers = Array.isArray(record.keynote_speakers) && record.keynote_speakers.length > 0;
  const hasSponsors = Array.isArray(record.sponsors) && record.sponsors.length > 0;

  return {
    // Overview and venue are authoritative Stage 7 fields. Keeping both explicit lets the existing
    // customer search distinguish a validated Apify record from a row whose site was never read.
    overview: "stated",
    venue: hasVenue ? "stated" : "unread",
    cfp: hasCfp ? "stated" : "unread",
    fees: hasFees ? "stated" : "unread",
    speakers: hasSpeakers ? "stated" : "unread",
    sponsors: hasSponsors ? "stated" : "unread",
    agenda: "unread",
    committee: "unread",
    community: "unread",
  };
}

function buildSections(record, eventId) {
  const sourceUrl = record.official_url || record.source_page_url;
  const locationText = [record.venue, record.city, record.state_region, record.country]
    .filter(Boolean)
    .join(", ") || null;

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
      // Keep both shapes because the website/search stack supports legacy `category` and the newer
      // multi-category array. This makes the category chip and the category filters work immediately.
      category: record.category || null,
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
      // ConferenceGate's customer search intentionally exposes rows published through the discovery
      // inventory. `import_origin` keeps the true provenance while `origin` lets these validated
      // records enter that same safe published path.
      origin: "discovery_engine",
      import_origin: "apify_stage7",
      status: "success",
      validation_status: record.validation_status,
      validation_score: record.validation_score,
      source_domain: record.source_domain || null,
      source_page_title: record.source_page_title || null,
      official_site_resolved: Boolean(record.official_site_resolved),
      discovery_event_id: eventId,
      section_availability: sectionAvailability(record),
      pages_crawled: 1,
      import_batch: BATCH,
    },
  };
}

async function ensurePublishedDiscoveryEvent(db, record, eventId, sourceUrl) {
  const sourceDomain = hostOf(sourceUrl);
  const startYear = record.start_date ? Number(record.start_date.slice(0, 4)) : (record.event_year || null);
  const startMonth = record.start_date ? Number(record.start_date.slice(5, 7)) : null;
  const confidence = Math.max(0, Math.min(1, Number(record.validation_score || 0) / 100));
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO discovery_events (
      id, title, normalized_title,
      start_date, end_date, start_year, start_month, date_precision, dates_text,
      venue, city, region, country, raw_location,
      format, event_type, organizer, official_url, canonical_url,
      registration_url, submission_url, image_url, contact_email,
      topics, primary_category,
      status, confidence_score, relevance_classification, relevance_reason, quality_flags,
      extraction_method, source_url, source_domain,
      last_seen, last_checked, last_verified, published_at,
      publish_readiness, readiness_reasons, official_source_verified_at, title_verified_at
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      'published', ?, 'conference', 'validated_apify_stage7', '[]',
      'apify_stage7', ?, ?,
      ?, ?, ?, ?,
      'publish_ready', '[]', ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      start_year = excluded.start_year,
      start_month = excluded.start_month,
      dates_text = excluded.dates_text,
      venue = excluded.venue,
      city = excluded.city,
      region = excluded.region,
      country = excluded.country,
      raw_location = excluded.raw_location,
      format = excluded.format,
      event_type = excluded.event_type,
      organizer = excluded.organizer,
      official_url = excluded.official_url,
      canonical_url = excluded.canonical_url,
      registration_url = excluded.registration_url,
      submission_url = excluded.submission_url,
      image_url = excluded.image_url,
      contact_email = excluded.contact_email,
      topics = excluded.topics,
      primary_category = excluded.primary_category,
      status = 'published',
      confidence_score = excluded.confidence_score,
      relevance_classification = 'conference',
      relevance_reason = 'validated_apify_stage7',
      extraction_method = 'apify_stage7',
      source_url = excluded.source_url,
      source_domain = excluded.source_domain,
      last_seen = excluded.last_seen,
      last_checked = excluded.last_checked,
      last_verified = excluded.last_verified,
      published_at = COALESCE(discovery_events.published_at, excluded.published_at),
      publish_readiness = 'publish_ready',
      readiness_reasons = '[]',
      official_source_verified_at = excluded.official_source_verified_at,
      title_verified_at = excluded.title_verified_at`,
    args: [
      eventId,
      record.conference_name,
      normalizeTitle(record.conference_name),
      record.start_date || null,
      record.end_date || null,
      startYear,
      startMonth,
      record.start_date ? "day" : (startYear ? "year" : null),
      record.start_date && record.end_date
        ? (record.start_date === record.end_date ? record.start_date : `${record.start_date} – ${record.end_date}`)
        : record.start_date || null,
      record.venue || null,
      record.city || null,
      record.state_region || null,
      record.country || null,
      [record.venue, record.city, record.state_region, record.country].filter(Boolean).join(", ") || null,
      formatValue(record.format) || "unknown",
      String(record.event_type || "other").toLowerCase(),
      record.organizer || null,
      record.official_url || sourceUrl,
      record.official_url || sourceUrl,
      record.registration_url || null,
      record.submission_url || null,
      record.image_url || null,
      record.contact_emails?.[0] || null,
      "[]",
      record.category || null,
      confidence,
      sourceUrl,
      sourceDomain,
      now,
      now,
      now,
      now,
      now,
      now,
    ],
  });

  if (record.category) {
    const categoryId = stableId("apify_cat", `${eventId}|${record.category}`);
    await db.execute({
      sql: `INSERT OR IGNORE INTO discovery_event_categories
              (id, event_id, category, confidence, evidence)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        categoryId,
        eventId,
        record.category,
        confidence,
        JSON.stringify(["Apify Stage 7 validated category"]),
      ],
    });
  }
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

    // ConferenceGate has already initialized the discovery schema in production. If this is a
    // brand-new local database, defer this one import until the server has created that schema.
    const tableCheck = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_events' LIMIT 1`
    );
    if (!tableCheck.rows?.length) {
      console.log("[apify-import] discovery schema not initialized yet; deferring categorized publish");
      return;
    }

    let inserted = 0;
    let updated = 0;
    let preserved = 0;

    for (const record of records) {
      if (record.validation_status !== "VALIDATED") continue;

      // The conference's own page is the public identity. Older imports used the page where it was
      // first found; keeping that only as metadata prevents a referring society page from becoming
      // the card's website after an official site has already been resolved.
      const sourceUrl = record.official_url || record.source_page_url;
      if (!sourceUrl || !record.conference_name || !record.start_date) continue;

      const eventId = stableId(
        "apify",
        `${sourceUrl}|${record.conference_name}|${record.start_date}`
      );

      const existingResult = await db.execute({
        sql: `SELECT extraction_metadata FROM extracted_conferences WHERE source_url = ? LIMIT 1`,
        args: [sourceUrl],
      });
      const existing = existingResult.rows?.[0];
      let existingMetadata = {};
      if (existing?.extraction_metadata) {
        try { existingMetadata = JSON.parse(String(existing.extraction_metadata)); } catch { existingMetadata = {}; }
      }

      // Never replace a conference already published by ConferenceGate's own discovery pipeline.
      // The Apify row is useful only when it is the record that introduced this conference.
      if (
        existing &&
        existingMetadata?.origin === "discovery_engine" &&
        existingMetadata?.import_origin !== "apify_stage7"
      ) {
        preserved += 1;
        continue;
      }

      await ensurePublishedDiscoveryEvent(db, record, eventId, sourceUrl);
      const sections = buildSections(record, eventId);

      const write = await db.execute({
        sql: `INSERT INTO extracted_conferences (
          source_url, overview, call_for_papers, program_agenda, keynote_speakers,
          technical_committee, sponsors_exhibitors, venue_accommodation, fees_pricing,
          community, extraction_metadata, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview = excluded.overview,
          call_for_papers = excluded.call_for_papers,
          program_agenda = excluded.program_agenda,
          keynote_speakers = excluded.keynote_speakers,
          technical_committee = excluded.technical_committee,
          sponsors_exhibitors = excluded.sponsors_exhibitors,
          venue_accommodation = excluded.venue_accommodation,
          fees_pricing = excluded.fees_pricing,
          community = excluded.community,
          extraction_metadata = excluded.extraction_metadata,
          updated_at = datetime('now')`,
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

      if (existing) updated += 1;
      else if (Number(write.rowsAffected || 0) > 0) inserted += 1;
    }

    console.log(
      `[apify-import] target=${tursoUrl ? "Turso" : "local SQLite"} categorized=true inserted=${inserted} updated=${updated} preserved=${preserved}`
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[apify-import] failed; ConferenceGate will still start:", error?.stack || error?.message || error);
  process.exitCode = 0;
});