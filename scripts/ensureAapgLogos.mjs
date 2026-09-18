import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK = '/aapg-organizer.svg';

function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function isAapg(event, overview) {
  const hay = [
    event?.title, event?.organizer, event?.official_url, event?.canonical_url, event?.source_url, event?.source_domain,
    overview?.conference_name, overview?.organizer, overview?.official_url, overview?.source_url
  ].filter(Boolean).join(' ').toLowerCase();
  return /\baapg\b|american association of petroleum geologists|iceevent\.org|rms-aapg|esaapg|swsaapg/.test(hay);
}

async function main() {
  const localPath = path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim() || undefined})
    : createClient({url:'file:'+localPath});

  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if ((tables.rows || []).length < 2) {
      console.log('[aapg-logo-guard] schema unavailable; skipping');
      return;
    }

    const rows = await db.execute(`SELECT de.id,de.title,de.organizer,de.official_url,de.canonical_url,de.source_url,de.source_domain,
      ec.source_url AS ec_source,ec.overview,ec.extraction_metadata
      FROM discovery_events de
      LEFT JOIN extracted_conferences ec
        ON ec.source_url=de.official_url OR ec.source_url=de.canonical_url
      WHERE de.status='published'`);

    let matched=0, fallbackApplied=0, preservedEventLogo=0, created=0;
    for (const row of rows.rows || []) {
      const overview=safeJson(row.overview,{});
      if (!isAapg(row,overview)) continue;
      matched += 1;

      const currentLogo=overview.logo_url ? String(overview.logo_url) : null;
      const currentSource=overview.logo_source ? String(overview.logo_source) : null;
      const hasEventLogo=currentLogo && currentSource === 'stated' && currentLogo !== FALLBACK;

      const nextOverview={
        ...overview,
        conference_name:overview.conference_name || row.title || null,
        organizer:overview.organizer || row.organizer || 'American Association of Petroleum Geologists (AAPG)',
        official_url:overview.official_url || row.official_url || row.canonical_url || null,
        source_url:overview.source_url || row.source_url || row.official_url || row.canonical_url || null,
        logo_url:hasEventLogo ? currentLogo : FALLBACK,
        logo_source:hasEventLogo ? 'stated' : 'organiser',
      };
      if (hasEventLogo) preservedEventLogo += 1;
      else fallbackApplied += 1;

      const meta=safeJson(row.extraction_metadata,{});
      const nextMeta={
        ...meta,
        aapg_logo_guard_at:new Date().toISOString(),
        aapg_logo_guard:hasEventLogo ? 'preserved-event-logo' : 'fallback-organiser-mark',
      };

      const key=String(row.ec_source || row.official_url || row.canonical_url || '').trim();
      if (!key) continue;
      if (!row.ec_source) created += 1;

      await db.execute({
        sql:`INSERT INTO extracted_conferences(
          source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
          sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
        ) VALUES(?,?,'{}','{"sessions":[],"themes":[],"overview":null}','[]','[]','[]','{}','{}','{}',?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview=excluded.overview,
          extraction_metadata=excluded.extraction_metadata,
          updated_at=datetime('now')`,
        args:[key,JSON.stringify(nextOverview),JSON.stringify(nextMeta)]
      });
    }

    console.log('[aapg-logo-guard] matched='+matched+' fallback_applied='+fallbackApplied+' preserved_event_logo='+preservedEventLogo+' created='+created);
  } catch (error) {
    console.warn('[aapg-logo-guard] failed:',error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
