import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const OVERRIDES = path.join(process.cwd(), 'data', 'sources', 'launch-record-overrides.json');

function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function normalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b20\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function availabilityOf(section, fallback = 'not_announced') {
  if (!section) return fallback;
  return section.availability === 'stated' || section.availability === 'not_announced' || section.availability === 'unread'
    ? section.availability
    : fallback;
}
function people(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    name: item.name || item.full_name || null,
    full_name: item.full_name || item.name || null,
    role: item.role || null,
    title: item.title || null,
    organization: item.organization || item.org || null,
    org: item.org || item.organization || null,
    topic: item.topic || null,
    photo_url: item.photo_url || null,
  })).filter((item) => item.name);
}
function sponsors(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    name: item.name || null,
    tier: item.tier || item.sponsorship_level || null,
    logo_url: item.logo_url || item.logoUrl || null,
  })).filter((item) => item.name);
}
function fees(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    category: item.category || item.name || null,
    amount: item.amount ?? null,
    currency: item.currency || null,
    deadline: item.deadline || null,
    notes: item.notes || null,
  })).filter((item) => item.category || item.amount != null);
}

async function main() {
  if (!fs.existsSync(OVERRIDES)) {
    console.log('[curated-overrides] no override file; skipping');
    return;
  }
  const doc = safeJson(fs.readFileSync(OVERRIDES, 'utf8'), {});
  const overrides = Array.isArray(doc?.records) ? doc.records : [];
  if (!overrides.length) {
    console.log('[curated-overrides] no records; skipping');
    return;
  }

  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: 'file:' + localPath });

  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if ((tables.rows || []).length < 2) {
      console.log('[curated-overrides] schema unavailable; skipping');
      return;
    }

    let applied = 0;
    for (const override of overrides) {
      const normalized = normalizeTitle(override.title);
      const eventRows = await db.execute({
        sql: `SELECT * FROM discovery_events
              WHERE normalized_title=? OR official_url=? OR canonical_url=?
              ORDER BY CASE WHEN normalized_title=? THEN 0 ELSE 1 END LIMIT 1`,
        args: [normalized, override.officialUrl || '', override.officialUrl || '', normalized],
      });
      const event = eventRows.rows?.[0];
      if (!event) continue;

      const officialUrl = String(override.officialUrl || event.official_url || event.canonical_url || '').trim();
      if (!officialUrl) continue;
      const sourceUrl = String(override.sourceUrl || officialUrl);
      const details = override.details || {};

      await db.execute({
        sql: `UPDATE discovery_events SET
              description=COALESCE(?,description),
              venue=COALESCE(?,venue),
              organizer=COALESCE(?,organizer),
              official_url=?,
              canonical_url=?,
              source_url=?,
              last_checked=?,
              last_verified=?
              WHERE id=?`,
        args: [
          override.description || null,
          override.venue || null,
          override.organization || null,
          officialUrl,
          officialUrl,
          sourceUrl,
          new Date().toISOString(),
          new Date().toISOString(),
          event.id,
        ],
      });

      const existingRows = await db.execute({
        sql: 'SELECT * FROM extracted_conferences WHERE source_url IN (?,?,?) LIMIT 1',
        args: [sourceUrl, officialUrl, String(event.canonical_url || officialUrl)],
      });
      const existing = existingRows.rows?.[0] || null;
      const existingOverview = safeJson(existing?.overview, {});
      const existingMeta = safeJson(existing?.extraction_metadata, {});

      const cfpInfo = details.callForPapers || null;
      const cfpDeadline = cfpInfo?.abstractDeadline || null;
      const cfpStatus =
        cfpInfo
          ? (cfpInfo.status || (cfpDeadline && cfpDeadline < new Date().toISOString().slice(0, 10) ? 'Closed' : 'Published'))
          : null;

      const overview = {
        ...existingOverview,
        conference_name: override.title || event.title,
        acronym: override.acronym || existingOverview.acronym || null,
        description: override.description || existingOverview.description || null,
        start_date: event.start_date || existingOverview.start_date || null,
        end_date: event.end_date || existingOverview.end_date || null,
        dates_text: event.dates_text || existingOverview.dates_text || null,
        city: event.city || existingOverview.city || null,
        region: event.region || existingOverview.region || null,
        country: event.country || existingOverview.country || null,
        venue: details.venueName || override.venue || event.venue || existingOverview.venue || null,
        location_text: [
          details.venueName || override.venue || event.venue,
          event.city,
          event.region,
          event.country,
        ].filter(Boolean).join(', ') || existingOverview.location_text || null,
        format: event.format || existingOverview.format || null,
        organizer: override.organization || event.organizer || existingOverview.organizer || null,
        official_url: officialUrl,
        source_url: sourceUrl,
        logo_url: override.organizerLogoUrl || existingOverview.logo_url || null,
        logo_source: override.organizerLogoUrl ? 'organiser' : (existingOverview.logo_source || null),
        topics: Array.isArray(override.topics) ? override.topics : (existingOverview.topics || []),
        keywords: Array.isArray(override.keywords) ? override.keywords : (existingOverview.keywords || []),
      };

      const callForPapers = cfpInfo ? {
        status: cfpStatus,
        abstract_submission_deadline: cfpDeadline,
        submission_email: cfpInfo.submissionEmail || null,
        length_limit: cfpInfo.lengthLimit || null,
        submission_guidelines: cfpInfo.text || null,
        submission_url: cfpInfo.url || null,
        topics_tracks: Array.isArray(details.schedule?.themes) ? details.schedule.themes : [],
      } : {};

      const program = {
        sessions: Array.isArray(details.schedule?.sessions) ? details.schedule.sessions : [],
        themes: Array.isArray(details.schedule?.themes) ? details.schedule.themes : [],
        overview: availabilityOf(details.program, 'unread') === 'stated' ? (details.program?.text || null) : null,
      };

      const keynote = availabilityOf(details.keynotes) === 'stated' ? people(details.keynotes?.items) : [];
      const committee = availabilityOf(details.committee) === 'stated' ? people(details.committee?.items) : [];
      const sponsorRows = availabilityOf(details.sponsors) === 'stated' ? sponsors(details.sponsors?.items) : [];
      const feeRows = availabilityOf(details.fees) === 'stated' ? fees(details.fees?.items) : [];

      const venue = {
        venue_name: details.venueName || override.venue || event.venue || null,
        address: details.venueAddress || null,
        hotels: [],
        accommodation: details.accommodation || null,
        travel_information: null,
      };
      const feesPricing = {
        registration_url: details.registrationUrl || null,
        registration_fees: feeRows,
        early_bird_deadline: null,
        pricing_text: availabilityOf(details.fees) === 'stated' ? (details.fees?.text || null) : null,
      };
      const community = {
        overview: availabilityOf(details.community, 'unread') === 'stated' ? (details.community?.text || null) : null,
      };

      const availability = {
        overview: 'stated',
        call_for_papers: cfpInfo ? 'stated' : 'not_announced',
        program_agenda: availabilityOf(details.program, 'unread'),
        keynote_speakers: availabilityOf(details.keynotes),
        technical_committee: availabilityOf(details.committee),
        sponsors_exhibitors: availabilityOf(details.sponsors),
        venue_accommodation: (details.venueName || details.venueAddress || override.venue) ? 'stated' : 'not_announced',
        fees_pricing: availabilityOf(details.fees),
        community: availabilityOf(details.community, 'unread'),
      };
      const sectionNotes = {
        call_for_papers: cfpInfo?.text || null,
        program_agenda: details.program?.text || null,
        keynote_speakers: details.keynotes?.text || null,
        technical_committee: details.committee?.text || null,
        sponsors_exhibitors: details.sponsors?.text || null,
        venue_accommodation: details.accommodation || details.venueAddress || null,
        fees_pricing: details.fees?.text || null,
        community: details.community?.text || null,
      };
      const meta = {
        ...existingMeta,
        origin: 'discovery_engine',
        status: 'success',
        discovery_event_id: event.id,
        section_availability: availability,
        section_notes: sectionNotes,
        curated_override_applied_at: new Date().toISOString(),
        curated_override_source: details.source || sourceUrl,
      };

      const key = existing?.source_url || sourceUrl;
      await db.execute({
        sql: `INSERT INTO extracted_conferences (
          source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
          sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview=excluded.overview,
          call_for_papers=excluded.call_for_papers,
          program_agenda=excluded.program_agenda,
          keynote_speakers=excluded.keynote_speakers,
          technical_committee=excluded.technical_committee,
          sponsors_exhibitors=excluded.sponsors_exhibitors,
          venue_accommodation=excluded.venue_accommodation,
          fees_pricing=excluded.fees_pricing,
          community=excluded.community,
          extraction_metadata=excluded.extraction_metadata,
          updated_at=datetime('now')`,
        args: [
          key, JSON.stringify(overview), JSON.stringify(callForPapers), JSON.stringify(program),
          JSON.stringify(keynote), JSON.stringify(committee), JSON.stringify(sponsorRows),
          JSON.stringify(venue), JSON.stringify(feesPricing), JSON.stringify(community), JSON.stringify(meta)
        ],
      });
      applied += 1;
    }
    console.log('[curated-overrides] applied=' + applied);
  } catch (error) {
    console.warn('[curated-overrides] failed:', error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
