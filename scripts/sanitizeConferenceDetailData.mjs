import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function eventYear(event) {
  const fromDate = Number(String(event?.start_date || '').slice(0, 4));
  if (Number.isFinite(fromDate) && fromDate >= 2000) return fromDate;
  const fromTitle = /\b(20\d{2})\b/.exec(String(event?.title || ''))?.[1];
  return fromTitle ? Number(fromTitle) : null;
}
function yearCounts(text) {
  const counts = new Map();
  for (const match of String(text || '').matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(match[1]);
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  return counts;
}
function navNoise(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  const hits = (value.match(/\b(home|join|login|calendar|albums?|register now|learn more|contact us|about us|meetings?|events?|schedule|venue|sponsor|exhibitor)\b/gi) || []).length;
  return value.length > 260 && hits >= 4;
}
function staleEdition(text, year) {
  if (!text || !year) return false;
  const counts = yearCounts(text);
  if (!counts.size) return false;
  const current = counts.get(year) || 0;
  const others = [...counts.entries()].filter(([candidate]) => candidate !== year);
  if (!others.length) return false;
  const [otherYear, otherCount] = others.sort((a,b) => b[1] - a[1])[0];
  if (current === 0 && otherYear < year) return true;
  if (otherCount >= 2 && otherCount > current && otherYear < year) return true;
  return false;
}
function badText(text, year) {
  return typeof text === 'string' && (navNoise(text) || staleEdition(text, year));
}
function hasContent(value) {
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === 'object') return Object.values(value).some(hasContent);
  if (typeof value === 'string') return value.trim().length > 2 && !/^(not found|not retrieved|unknown|n\/a|tbd|tba)$/i.test(value.trim());
  return typeof value === 'number' || value === true;
}
function filterYearDatedRows(rows, year) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const text = JSON.stringify(row || {});
    return !staleEdition(text, year);
  });
}
function sectionHasContent(key, value) {
  if (!value || typeof value !== 'object') return false;
  if (key === 'fees') {
    return (Array.isArray(value.registration_fees) && value.registration_fees.some(hasContent))
      || hasContent(value.pricing_text)
      || hasContent(value.early_bird_deadline);
  }
  if (key === 'cfp') {
    return [
      value.status, value.abstract_submission_deadline, value.notification_date,
      value.submission_guidelines, value.submission_format, value.length_limit,
      value.review_process, value.publication_information,
      ...(Array.isArray(value.topics_tracks) ? value.topics_tracks : []),
    ].some(hasContent);
  }
  if (key === 'agenda') {
    return (Array.isArray(value.sessions) && value.sessions.some(hasContent))
      || (Array.isArray(value.themes) && value.themes.some(hasContent))
      || hasContent(value.overview);
  }
  if (key === 'venue') {
    return [
      value.venue_name, value.address, value.accommodation, value.travel_information,
      ...(Array.isArray(value.hotels) ? value.hotels : []),
    ].some(hasContent);
  }
  if (key === 'community') {
    return hasContent(value.overview)
      || (Array.isArray(value.social_media) && value.social_media.some(hasContent));
  }
  return Array.isArray(value) ? value.some(hasContent) : hasContent(value);
}

async function main() {
  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: 'file:' + localPath });

  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if ((tables.rows || []).length < 2) {
      console.log('[conference-sanitize] schema unavailable; skipping');
      return;
    }

    const result = await db.execute(`SELECT id,title,start_date,official_url,canonical_url
      FROM discovery_events
      WHERE status='published' AND COALESCE(official_url,canonical_url) IS NOT NULL`);

    let cleaned = 0, staleFields = 0;
    for (const event of result.rows || []) {
      const url = String(event.official_url || event.canonical_url || '').trim();
      if (!url) continue;
      const found = await db.execute({
        sql: 'SELECT * FROM extracted_conferences WHERE source_url IN (?,?) LIMIT 1',
        args: [url, String(event.canonical_url || url)],
      });
      const row = found.rows?.[0];
      if (!row) continue;

      const year = eventYear(event);
      const overview = safeJson(row.overview, {});
      const cfp = safeJson(row.call_for_papers, {});
      const program = safeJson(row.program_agenda, { sessions: [], themes: [], overview: null });
      const speakers = safeJson(row.keynote_speakers, []);
      const committee = safeJson(row.technical_committee, []);
      const sponsors = safeJson(row.sponsors_exhibitors, []);
      const venue = safeJson(row.venue_accommodation, {});
      const fees = safeJson(row.fees_pricing, {});
      const community = safeJson(row.community, {});
      const meta = safeJson(row.extraction_metadata, {});
      let changed = false;

      const clear = (obj, key) => {
        if (obj && obj[key] != null) {
          obj[key] = null;
          staleFields += 1;
          changed = true;
        }
      };

      for (const key of ['description','overview']) {
        if (badText(overview[key], year)) clear(overview, key);
      }
      for (const key of ['submission_guidelines','publication_information']) {
        if (badText(cfp[key], year)) clear(cfp, key);
      }
      if (cfp.abstract_submission_deadline && staleEdition(String(cfp.abstract_submission_deadline), year)) clear(cfp, 'abstract_submission_deadline');
      if (cfp.notification_date && staleEdition(String(cfp.notification_date), year)) clear(cfp, 'notification_date');

      if (badText(program.overview, year)) clear(program, 'overview');
      const nextSessions = filterYearDatedRows(program.sessions, year);
      if (JSON.stringify(nextSessions) !== JSON.stringify(program.sessions || [])) {
        program.sessions = nextSessions; changed = true; staleFields += 1;
      }

      if (badText(fees.pricing_text, year)) clear(fees, 'pricing_text');
      if (fees.early_bird_deadline && staleEdition(String(fees.early_bird_deadline), year)) clear(fees, 'early_bird_deadline');
      const nextFees = filterYearDatedRows(fees.registration_fees, year);
      if (JSON.stringify(nextFees) !== JSON.stringify(fees.registration_fees || [])) {
        fees.registration_fees = nextFees; changed = true; staleFields += 1;
      }

      for (const key of ['accommodation','travel_information']) {
        if (badText(venue[key], year)) clear(venue, key);
      }
      if (badText(community.overview, year)) clear(community, 'overview');

      const notes = { ...(meta.section_notes || {}) };
      const availability = { ...(meta.section_availability || {}), overview: 'stated' };
      const aliasGroups = {
        cfp: ['cfp','call_for_papers'],
        fees: ['fees','fees_pricing'],
        agenda: ['agenda','program_agenda'],
        speakers: ['speakers','keynote_speakers'],
        committee: ['committee','technical_committee'],
        sponsors: ['sponsors','sponsors_exhibitors'],
        venue: ['venue','venue_accommodation'],
        community: ['community'],
      };
      for (const aliases of Object.values(aliasGroups)) {
        for (const alias of aliases) {
          if (badText(notes[alias], year)) {
            notes[alias] = null; changed = true; staleFields += 1;
          }
        }
      }

      const values = { cfp, fees, agenda: program, speakers, committee, sponsors, venue, community };
      for (const [key, aliases] of Object.entries(aliasGroups)) {
        const state = sectionHasContent(key, values[key]) ? 'stated' : 'unread';
        for (const alias of aliases) availability[alias] = state;
      }

      if (!changed) {
        // Availability may still need correction when a URL alone used to count as a full section.
        const oldAvailability = JSON.stringify(meta.section_availability || {});
        const newAvailability = JSON.stringify(availability);
        if (oldAvailability !== newAvailability) changed = true;
      }
      if (!changed) continue;

      const nextMeta = {
        ...meta,
        section_notes: notes,
        section_availability: availability,
        sanitized_at: new Date().toISOString(),
        sanitizer: 'edition-aware-v1',
      };

      await db.execute({
        sql: `UPDATE extracted_conferences
              SET overview=?,call_for_papers=?,program_agenda=?,keynote_speakers=?,technical_committee=?,
                  sponsors_exhibitors=?,venue_accommodation=?,fees_pricing=?,community=?,extraction_metadata=?,
                  updated_at=datetime('now')
              WHERE source_url=?`,
        args: [
          JSON.stringify(overview), JSON.stringify(cfp), JSON.stringify(program), JSON.stringify(speakers),
          JSON.stringify(committee), JSON.stringify(sponsors), JSON.stringify(venue), JSON.stringify(fees),
          JSON.stringify(community), JSON.stringify(nextMeta), row.source_url
        ],
      });
      cleaned += 1;
    }
    console.log('[conference-sanitize] cleaned_records=' + cleaned + ' stale_fields=' + staleFields);
  } catch (error) {
    console.warn('[conference-sanitize] failed:', error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
