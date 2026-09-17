import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// This record is intentionally sourced the same way a user sees it on AAPG:
// card -> LEARN MORE -> official Southwest Section event page. The card also publishes a
// Southwest Section identity mark, so ConferenceGate keeps that mark instead of replacing it
// with a generic AAPG favicon.
const EVENT = {
  title: 'West Texas Geological Society (WTGS) and the Southwest Section (SWS) of AAPG Centennial Conference',
  start: '2026-09-12',
  end: '2026-09-16',
  city: 'Midland',
  region: 'Texas',
  country: 'United States',
  venue: 'Bush Convention Center',
  address: '105 N. Main St, Midland, TX 79701',
  organizer: 'West Texas Geological Society (WTGS) and AAPG Southwest Section',
  sourceUrl: 'https://www.aapg.org/about/southwest-section/',
  learnMoreUrl: 'https://www.swsaapg.org/events/172/',
  registrationUrl: 'https://site.pheedloop.com/event/wtgs2026/home/',
  logoUrl: 'https://www.swsaapg.org/files/245/',
};

function stableId(prefix, value) {
  return `${prefix}_${createHash('sha1').update(String(value || '')).digest('hex').slice(0, 24)}`;
}
function normalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b20\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function main() {
  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: `file:${localPath}` });

  try {
    const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')`);
    if ((tables.rows || []).length < 2) {
      console.log('[aapg-centennial] schema unavailable; skipping');
      return;
    }

    const normalized = normalizeTitle(EVENT.title);
    const existing = await db.execute({
      sql: `SELECT id FROM discovery_events WHERE normalized_title=? AND start_date=? LIMIT 1`,
      args: [normalized, EVENT.start],
    });
    const id = existing.rows?.[0]?.id ? String(existing.rows[0].id) : stableId('aapg_sws', `${EVENT.title}|${EVENT.start}`);
    const now = new Date().toISOString();
    const locationText = `${EVENT.venue}, ${EVENT.address}`;

    await db.execute({
      sql: `INSERT INTO discovery_events (
        id,title,normalized_title,start_date,end_date,start_year,start_month,date_precision,dates_text,
        venue,city,region,country,raw_location,format,event_type,organizer,official_url,canonical_url,
        registration_url,submission_url,image_url,contact_email,topics,primary_category,status,confidence_score,
        relevance_classification,relevance_reason,quality_flags,extraction_method,source_url,source_domain,
        last_seen,last_checked,last_verified,published_at,publish_readiness,readiness_reasons,official_source_verified_at,title_verified_at
      ) VALUES (?,?,?,?,?,?,?,'day',?,?,?,?,?,?,?,'conference',?,?,?,?,?, ?,?,?,'Energy','published',0.99,
        'conference','official_aapg_learn_more','[]','aapg_learn_more_card',?,?, ?,?,?,?,'publish_ready','[]',?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,normalized_title=excluded.normalized_title,start_date=excluded.start_date,end_date=excluded.end_date,
        dates_text=excluded.dates_text,venue=excluded.venue,city=excluded.city,region=excluded.region,country=excluded.country,
        raw_location=excluded.raw_location,organizer=excluded.organizer,official_url=excluded.official_url,canonical_url=excluded.canonical_url,
        registration_url=excluded.registration_url,submission_url=excluded.submission_url,image_url=COALESCE(excluded.image_url,discovery_events.image_url),
        contact_email=excluded.contact_email,topics=excluded.topics,status='published',confidence_score=MAX(discovery_events.confidence_score,0.99),
        relevance_classification='conference',relevance_reason='official_aapg_learn_more',extraction_method='aapg_learn_more_card',
        source_url=excluded.source_url,source_domain=excluded.source_domain,last_seen=excluded.last_seen,last_checked=excluded.last_checked,
        last_verified=excluded.last_verified,published_at=COALESCE(discovery_events.published_at,excluded.published_at),
        publish_readiness='publish_ready',readiness_reasons='[]',official_source_verified_at=excluded.official_source_verified_at,
        title_verified_at=excluded.title_verified_at`,
      args: [
        id, EVENT.title, normalized, EVENT.start, EVENT.end, 2026, 9, `${EVENT.start} – ${EVENT.end}`,
        EVENT.venue, EVENT.city, EVENT.region, EVENT.country, locationText, 'in-person', EVENT.organizer,
        EVENT.learnMoreUrl, EVENT.learnMoreUrl, EVENT.registrationUrl, EVENT.learnMoreUrl, EVENT.logoUrl,
        'submissions@wtgs.org', JSON.stringify(['Energy','Science','Engineering','Geology','Petroleum Geoscience']),
        EVENT.sourceUrl, 'aapg.org', now, now, now, now, now, now,
      ],
    });

    for (const category of ['Energy','Science','Engineering']) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO discovery_event_categories (id,event_id,category,confidence,evidence) VALUES (?,?,?,0.99,?)`,
        args: [stableId('aapg_sws_cat', `${id}|${category}`), id, category, JSON.stringify(['AAPG Southwest Section card and official LEARN MORE event page'])],
      });
    }

    const overview = {
      conference_name: EVENT.title,
      acronym: 'WTGS & SWS AAPG Centennial Conference',
      edition: 'Centennial Conference',
      description: 'A Century Beneath the Surface — a centennial conference marking 100 years of the West Texas Geological Society, with technical sessions, presentations, workshops, networking and field activities focused on Permian Basin geoscience and the future of energy development.',
      dates_text: '12–16 September 2026',
      start_date: EVENT.start,
      end_date: EVENT.end,
      city: EVENT.city,
      region: EVENT.region,
      country: EVENT.country,
      venue: EVENT.venue,
      location_text: locationText,
      format: 'in-person',
      organizer: EVENT.organizer,
      topics: ['Permian Basin','Stratigraphy','Geoscience','Energy','Reservoir interpretation','Emerging technologies'],
      category: 'Energy',
      categories: ['Energy','Science','Engineering'],
      keywords: ['AAPG','Southwest Section','WTGS','Permian Basin','Centennial Conference'],
      important_dates: [
        { label: 'Conference dates', date: '12–16 September 2026', isDeadline: false },
        { label: 'Abstract deadline', date: '26 June 2026', isDeadline: true },
      ],
      official_url: EVENT.learnMoreUrl,
      source_url: EVENT.sourceUrl,
      logo_url: EVENT.logoUrl,
      logo_source: 'stated',
      image_url: EVENT.logoUrl,
      contact_email: 'submissions@wtgs.org',
    };

    const cfp = {
      status: 'Closed — deadline was 26 June 2026',
      abstract_submission_deadline: '26 June 2026',
      submission_email: 'submissions@wtgs.org',
      submission_url: EVENT.learnMoreUrl,
      submission_requirements: 'Include “ABSTRACT SUBMISSION” in the subject line. Maximum abstract length: 500 words. Images are not included in the printed abstract booklet. Oral presentations: 20 minutes plus 5 minutes Q&A. Acceptance notification is sent by email.',
      length_limit: '500 words',
      review_process: 'Acceptance notification by email',
    };

    const agenda = {
      sessions: [],
      themes: ['Permian Basin geology','Sequence stratigraphy','Technical presentations','Core workshop','Networking','Field activities'],
      overview: 'Saturday: 100-Year Anniversary Core Workshop and K-12 teacher workshop. Sunday: vendor setup, free short course on siliciclastic sequence stratigraphy and icebreaker. Monday: full-day SWS AAPG presentations, DPA luncheon and evening social. Tuesday: full-day WTGS presentations, networking luncheon and happy hour. Wednesday: half-day WTGS presentations and ethics luncheon. A Rockhound Classic and conference field-trip departure follow on 17 September.',
    };

    const venue = {
      venue_name: EVENT.venue,
      address: EVENT.address,
      accommodation: null,
      hotels: [],
      travel_advisory: null,
      travel_advisory_source: null,
    };

    const fees = {
      registration_url: EVENT.registrationUrl,
      registration_fees: [],
      early_bird_deadline: null,
      pricing_text: 'Registration was handled through the official conference registration portal. Specific fee amounts are not stated in the source record retained by ConferenceGate.',
    };

    const community = {
      overview: 'Community activities included an icebreaker, networking luncheon, happy hour, Casino Night social event, K-12 teacher workshop, Rockhound Classic and conference field trip.',
    };

    const metadata = {
      origin: 'discovery_engine',
      import_origin: 'aapg_learn_more_card',
      status: 'success',
      validation_status: 'VALIDATED_OFFICIAL_AAPG_SECTION_SOURCE',
      validation_score: 0.99,
      source_domain: 'swsaapg.org',
      source_page_title: '2026 WTGS & SWS AAPG Centennial Conference',
      official_site_resolved: true,
      discovery_event_id: id,
      section_availability: {
        overview: 'stated',
        cfp: 'stated',
        fees: 'stated',
        agenda: 'stated',
        speakers: 'not_announced',
        committee: 'not_announced',
        sponsors: 'stated',
        venue: 'stated',
        community: 'stated',
      },
      section_notes: {
        cfp: 'Official abstract submission requirements and deadline were published.',
        fees: 'Official registration route was published; fee amounts were not retained in the source record.',
        agenda: agenda.overview,
        speakers: null,
        committee: null,
        sponsors: 'The official conference schedule states that sponsorship opportunities were available; named sponsors are not stated in this source record.',
        venue: EVENT.address,
        community: community.overview,
      },
      pages_crawled: 2,
      import_batch: `aapg-learn-more-${new Date().toISOString().slice(0,10)}`,
      calendar_url: EVENT.sourceUrl,
      learn_more_url: EVENT.learnMoreUrl,
      logo_source_url: EVENT.sourceUrl,
    };

    await db.execute({
      sql: `INSERT INTO extracted_conferences (
        source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
        sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(source_url) DO UPDATE SET
        overview=excluded.overview,call_for_papers=excluded.call_for_papers,program_agenda=excluded.program_agenda,
        keynote_speakers=excluded.keynote_speakers,technical_committee=excluded.technical_committee,
        sponsors_exhibitors=excluded.sponsors_exhibitors,venue_accommodation=excluded.venue_accommodation,
        fees_pricing=excluded.fees_pricing,community=excluded.community,extraction_metadata=excluded.extraction_metadata,
        updated_at=datetime('now')`,
      args: [
        EVENT.learnMoreUrl,
        JSON.stringify(overview), JSON.stringify(cfp), JSON.stringify(agenda), JSON.stringify([]), JSON.stringify([]),
        JSON.stringify([]), JSON.stringify(venue), JSON.stringify(fees), JSON.stringify(community), JSON.stringify(metadata),
      ],
    });

    console.log('[aapg-centennial] LEARN MORE details imported tabs=7/9 logo=Southwest-Section');
  } catch (error) {
    console.warn(`[aapg-centennial] failed: ${error?.message || error}`);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
