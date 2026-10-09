import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function stableId(value) {
  return 'phase52_' + createHash('sha1').update(String(value)).digest('hex').slice(0, 24);
}
function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function favicon(url) {
  try { return new URL('/favicon.ico', url).href; } catch { return null; }
}
function sectionAvailability(event) {
  return {
    overview: 'stated',
    call_for_papers: event.cfp ? 'stated' : 'not_announced',
    fees_pricing: event.fees ? 'stated' : 'not_announced',
    program_agenda: event.program ? 'stated' : 'not_announced',
    keynote_speakers: Array.isArray(event.speakers) && event.speakers.length ? 'stated' : 'not_announced',
    technical_committee: Array.isArray(event.committee) && event.committee.length ? 'stated' : 'not_announced',
    sponsors_exhibitors: Array.isArray(event.sponsors) && event.sponsors.length ? 'stated' : 'not_announced',
    venue_accommodation: event.venueInfo ? 'stated' : 'not_announced',
    community: event.community ? 'stated' : 'not_announced',
  };
}

const events = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data', 'phase52-major-conference-expansion.json'), 'utf8')
);

const localPath = path.join(process.cwd(), 'data', 'app.db');
fs.mkdirSync(path.dirname(localPath), { recursive: true });
const db = process.env.TURSO_DATABASE_URL?.trim()
  ? createClient({
      url: process.env.TURSO_DATABASE_URL.trim(),
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    })
  : createClient({ url: 'file:' + localPath });

try {
  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences','discovery_event_categories')"
  );
  if ((tables.rows || []).length < 3) {
    console.log('[phase52-major-conferences] schema unavailable; skipping');
    process.exit(0);
  }

  let synced = 0;
  let updatedExisting = 0;
  let rich = 0;

  for (const event of events) {
    const now = new Date().toISOString();
    const normalized = normalizeTitle(event.title);
    const year = Number(event.start.slice(0, 4));
    const month = Number(event.start.slice(5, 7));
    const found = await db.execute({
      sql: `SELECT id FROM discovery_events
            WHERE official_url=? OR canonical_url=? OR (normalized_title=? AND start_year=?)
            LIMIT 1`,
      args: [event.url, event.url, normalized, year],
    });
    const existingId = found.rows?.[0]?.id ? String(found.rows[0].id) : null;
    const id = existingId || stableId(event.title + '|' + event.url);
    if (existingId) updatedExisting += 1;

    const location = [event.venue, event.city, event.country].filter(Boolean).join(', ');
    const cols = [
      'id','title','normalized_title','description','start_date','end_date','start_year','start_month','date_precision',
      'dates_text','venue','city','country','raw_location','format','event_type','organizer','official_url','canonical_url',
      'topics','primary_category','status','confidence_score','relevance_classification','relevance_reason','quality_flags',
      'extraction_method','source_url','source_domain','last_seen','last_checked','last_verified','published_at','publish_readiness',
      'readiness_reasons','official_source_verified_at','title_verified_at'
    ];
    const args = [
      id,event.title,normalized,event.description,event.start,event.end,year,month,'day',event.start+' – '+event.end,
      event.venue,event.city,event.country,location,event.format,'conference',event.organizer,event.url,event.url,
      JSON.stringify(event.categories),event.categories[0],'published',0.99,'conference','phase52_verified_major_conference_expansion','[]',
      'phase52_verified_major_conference_expansion',event.url,hostOf(event.url),now,now,now,now,'publish_ready','[]',now,now
    ];

    await db.execute({
      sql: `INSERT INTO discovery_events(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,normalized_title=excluded.normalized_title,
        description=excluded.description,start_date=excluded.start_date,end_date=excluded.end_date,
        start_year=excluded.start_year,start_month=excluded.start_month,dates_text=excluded.dates_text,
        venue=excluded.venue,city=excluded.city,country=excluded.country,raw_location=excluded.raw_location,
        format=excluded.format,organizer=excluded.organizer,official_url=excluded.official_url,
        canonical_url=excluded.canonical_url,topics=excluded.topics,primary_category=excluded.primary_category,
        status='published',confidence_score=0.99,relevance_classification='conference',
        relevance_reason='phase52_verified_major_conference_expansion',quality_flags='[]',
        source_url=excluded.source_url,source_domain=excluded.source_domain,last_seen=excluded.last_seen,
        last_checked=excluded.last_checked,last_verified=excluded.last_verified,publish_readiness='publish_ready',
        readiness_reasons='[]',official_source_verified_at=excluded.official_source_verified_at,
        title_verified_at=excluded.title_verified_at`,
      args,
    });

    for (const category of event.categories) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO discovery_event_categories(id,event_id,category,confidence,evidence) VALUES(?,?,?,0.99,?)',
        args: [stableId(id + '|' + category), id, category, JSON.stringify(['Verified official conference sources'])],
      });
    }

    const availability = sectionAvailability(event);
    const filled = Object.values(availability).filter((value) => value === 'stated').length;
    if (filled >= 6) rich += 1;

    const overview = {
      conference_name: event.title,
      description: event.description,
      start_date: event.start,
      end_date: event.end,
      dates_text: event.start + ' – ' + event.end,
      city: event.city,
      country: event.country,
      venue: event.venue,
      location_text: location,
      format: event.format,
      organizer: event.organizer,
      official_url: event.url,
      source_url: event.url,
      logo_url: favicon(event.url),
      logo_source: 'organiser',
      category: event.categories[0],
      categories: event.categories,
      topics: event.categories,
    };
    const venue = event.venueInfo ? { ...event.venueInfo, hotels: event.venueInfo.hotels || [] } : {};
    const metadata = {
      origin: 'discovery_engine',
      status: 'success',
      discovery_event_id: id,
      import_origin: 'phase52_verified_major_conference_expansion',
      validation_status: 'VERIFIED_OFFICIAL_SOURCES',
      validation_score: 0.99,
      hard_crawl_priority: true,
      source_urls: event.sourceUrls || [event.url],
      section_availability: availability,
      section_notes: {
        call_for_papers: event.cfp?.submission_guidelines || null,
        program_agenda: event.program?.overview || null,
        sponsors_exhibitors: event.sponsors?.[0]?.name || null,
        venue_accommodation: event.venueInfo?.accommodation || event.venueInfo?.address || null,
        community: event.community?.overview || null,
      },
      tabs_filled: filled,
      tabs_total: 9,
      verified_at: now,
    };

    await db.execute({
      sql: `INSERT INTO extracted_conferences(source_url,overview,call_for_papers,program_agenda,keynote_speakers,
        technical_committee,sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET overview=excluded.overview,call_for_papers=excluded.call_for_papers,
        program_agenda=excluded.program_agenda,keynote_speakers=excluded.keynote_speakers,
        technical_committee=excluded.technical_committee,sponsors_exhibitors=excluded.sponsors_exhibitors,
        venue_accommodation=excluded.venue_accommodation,fees_pricing=excluded.fees_pricing,community=excluded.community,
        extraction_metadata=excluded.extraction_metadata,updated_at=datetime('now')`,
      args: [
        event.url,
        JSON.stringify(overview),
        JSON.stringify(event.cfp || {}),
        JSON.stringify(event.program ? {
          sessions: event.program.sessions || [],
          themes: event.program.themes || [],
          overview: event.program.overview || null,
        } : { sessions: [], themes: [], overview: null }),
        JSON.stringify(event.speakers || []),
        JSON.stringify(event.committee || []),
        JSON.stringify(event.sponsors || []),
        JSON.stringify(venue),
        JSON.stringify(event.fees || {}),
        JSON.stringify(event.community || {}),
        JSON.stringify(metadata),
      ],
    });
    synced += 1;
  }

  console.log(`[phase52-major-conferences] synced=${synced} updated_existing=${updatedExisting} rich_6plus_tabs=${rich}`);
} catch (error) {
  console.warn('[phase52-major-conferences] failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  try { db.close(); } catch {}
}
