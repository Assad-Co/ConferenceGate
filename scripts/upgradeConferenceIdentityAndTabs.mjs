import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 ConferenceGate/1.0';
const TIMEOUT_MS = Math.max(4000, Number(process.env.CONFERENCE_IDENTITY_TIMEOUT_MS || 9000));
const MAX_FETCHES = Math.max(0, Number(process.env.CONFERENCE_IDENTITY_MAX_FETCHES || 120)); // 0 = all

function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function absoluteUrl(value, base) {
  try {
    const u = new URL(String(value || '').trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}
function stripTags(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function eventYear(event) {
  const y = Number(String(event?.start_date || '').slice(0, 4));
  if (Number.isFinite(y) && y >= 2000) return y;
  const m = /\b(20\d{2})\b/.exec(String(event?.title || ''));
  return m ? Number(m[1]) : null;
}
function yearCounts(text) {
  const map = new Map();
  for (const m of String(text || '').matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    map.set(y, (map.get(y) || 0) + 1);
  }
  return map;
}
function pageMatchesEdition(html, event) {
  const year = eventYear(event);
  if (!year) return true;
  const text = stripTags(html);
  const counts = yearCounts(text);
  if (!counts.size) return true;
  const current = counts.get(year) || 0;
  const others = [...counts.entries()].filter(([y]) => y !== year).sort((a,b) => b[1] - a[1]);
  if (!others.length) return true;
  const [otherYear, otherCount] = others[0];
  if (current === 0 && otherYear < year) return false;
  if (otherYear < year && otherCount >= 2 && otherCount > current) return false;
  return true;
}
function navNoise(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const hits = (value.match(/\b(home|join|login|calendar|albums?|register now|learn more|contact us|about us|meetings?|events?|schedule|venue|sponsor|exhibitor)\b/gi) || []).length;
  return value.length > 260 && hits >= 4;
}
function cleanNote(value, year) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || navNoise(text)) return null;
  const counts = yearCounts(text);
  if (year && counts.size) {
    const current = counts.get(year) || 0;
    const old = [...counts.entries()].filter(([y]) => y < year).sort((a,b)=>b[1]-a[1])[0];
    if (old && current === 0) return null;
    if (old && old[1] >= 2 && old[1] > current) return null;
  }
  return text.slice(0, 700);
}
function metaContent(html, names) {
  const wanted = new Set(names.map((x) => x.toLowerCase()));
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key && wanted.has(key) && content) return content.trim();
  }
  return null;
}
function linkIcons(html, base) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() || '';
    if (!/(?:^|\s)(?:icon|shortcut icon|apple-touch-icon)(?:\s|$)/i.test(rel)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const url = absoluteUrl(href, base);
    if (url) out.push({ url, score: /apple-touch-icon/.test(rel) ? 5 : 3, source: 'organiser' });
  }
  return out;
}
function jsonLdLogos(html, base, title) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]);
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
        const type = String(node['@type'] || '').toLowerCase();
        const name = String(node.name || '');
        const logoRaw = typeof node.logo === 'string' ? node.logo : node.logo?.url;
        const imageRaw = typeof node.image === 'string' ? node.image : Array.isArray(node.image) ? node.image[0] : node.image?.url;
        const logo = absoluteUrl(logoRaw, base);
        const image = absoluteUrl(imageRaw, base);
        const titleWords = String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
        const nameMatch = titleWords.some((w) => name.toLowerCase().includes(w));
        if (logo) out.push({ url: logo, score: type.includes('event') || nameMatch ? 12 : 7, source: type.includes('event') || nameMatch ? 'stated' : 'organiser' });
        if (image && type.includes('event')) out.push({ url: image, score: 4, source: 'image' });
      }
    } catch {}
  }
  return out;
}
function imageCandidates(html, base, title) {
  const tokens = String(title || '').toLowerCase().replace(/\b20\d{2}\b/g,' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(conference|annual|meeting|summit|symposium|workshop|international)$/.test(w));
  const out = [];
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const srcRaw = /(?:src|data-src|data-lazy-src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean);
    const url = absoluteUrl(srcRaw, base);
    if (!url) continue;
    const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
    const cls = /class\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
    const hay = (alt + ' ' + cls + ' ' + url).toLowerCase();
    let score = /conference-logo|event-logo|event-mark/.test(hay) ? 14 : /\blogo\b|brand/.test(hay) ? 6 : 0;
    let tokenMatches = 0;
    for (const token of tokens) if (hay.includes(token)) { score += 3; tokenMatches += 1; }
    if (/sponsor|speaker|avatar|footer/.test(hay)) score -= 8;
    if (score > 0) out.push({ url, score, source: tokenMatches > 0 ? 'stated' : 'organiser' });
  }
  return out;
}
function bestIdentity(html, base, title) {
  const candidates = [
    ...jsonLdLogos(html, base, title),
    ...imageCandidates(html, base, title),
    ...linkIcons(html, base),
  ].filter((x) => x.source !== 'image');
  candidates.sort((a,b) => b.score - a.score);
  const top = candidates[0] || null;
  const hero = absoluteUrl(metaContent(html, ['og:image','twitter:image']), base)
    || jsonLdLogos(html, base, title).find((x) => x.source === 'image')?.url
    || null;
  return { logo: top?.url || null, logoSource: top?.source || null, hero };
}
async function read(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html && html.length > 200 ? { html, finalUrl: res.url || url } : null;
  } catch { return null; }
}
function hasUseful(value) {
  if (Array.isArray(value)) return value.some(hasUseful);
  if (value && typeof value === 'object') return Object.values(value).some(hasUseful);
  if (typeof value === 'string') return value.trim().length > 2 && !/^(not announced|not yet announced|unknown|n\/a|tbd|tba)$/i.test(value.trim());
  return typeof value === 'number' || value === true;
}
function sectionState(key, value) {
  if (key === 'fees') {
    return value && ((Array.isArray(value.registration_fees) && value.registration_fees.some(hasUseful)) || hasUseful(value.pricing_text) || hasUseful(value.early_bird_deadline)) ? 'stated' : null;
  }
  if (key === 'cfp') {
    return value && [value.status,value.abstract_submission_deadline,value.notification_date,value.submission_guidelines,value.submission_format,value.length_limit,value.review_process,value.publication_information,...(Array.isArray(value.topics_tracks)?value.topics_tracks:[])].some(hasUseful) ? 'stated' : null;
  }
  if (key === 'program') return value && ((Array.isArray(value.sessions)&&value.sessions.some(hasUseful)) || (Array.isArray(value.themes)&&value.themes.some(hasUseful)) || hasUseful(value.overview)) ? 'stated' : null;
  if (key === 'venue') return value && [value.venue_name,value.address,value.accommodation,value.travel_information,...(Array.isArray(value.hotels)?value.hotels:[])].some(hasUseful) ? 'stated' : null;
  if (key === 'community') return value && (hasUseful(value.overview) || (Array.isArray(value.social_media)&&value.social_media.some(hasUseful))) ? 'stated' : null;
  return hasUseful(value) ? 'stated' : null;
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
      console.log('[conference-power] schema unavailable; skipping');
      return;
    }
    const rows = await db.execute(`SELECT id,title,start_date,end_date,description,organizer,official_url,canonical_url,
      venue,venue_address,city,region,country,format,image_url,status
      FROM discovery_events
      WHERE status='published' AND COALESCE(official_url,canonical_url) IS NOT NULL
      ORDER BY CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,start_date,title`);
    let fetched=0, identities=0, updated=0, strong=0;
    for (const event of rows.rows || []) {
      const url = String(event.official_url || event.canonical_url || '').trim();
      if (!url) continue;
      const ex = await db.execute({sql:'SELECT * FROM extracted_conferences WHERE source_url IN (?,?) LIMIT 1',args:[url,String(event.canonical_url||url)]});
      const existing = ex.rows?.[0] || null;
      const overview = safeJson(existing?.overview,{});
      const cfp = safeJson(existing?.call_for_papers,{});
      const program = safeJson(existing?.program_agenda,{sessions:[],themes:[],overview:null});
      const speakers = safeJson(existing?.keynote_speakers,[]);
      const committee = safeJson(existing?.technical_committee,[]);
      const sponsors = safeJson(existing?.sponsors_exhibitors,[]);
      const venue = safeJson(existing?.venue_accommodation,{});
      const fees = safeJson(existing?.fees_pricing,{});
      const community = safeJson(existing?.community,{});
      const meta = safeJson(existing?.extraction_metadata,{});
      const year = eventYear(event);

      let readResult = null;
      if (MAX_FETCHES === 0 || fetched < MAX_FETCHES) {
        readResult = await read(url);
        fetched += 1;
      }
      let identity = {logo:null,logoSource:null,hero:null};
      let pageVerified = false;
      if (readResult && pageMatchesEdition(readResult.html,event)) {
        pageVerified = true;
        identity = bestIdentity(readResult.html,readResult.finalUrl,event.title);
      }
      if (identity.logo) identities += 1;

      const nextOverview = {
        ...overview,
        conference_name: overview.conference_name || event.title,
        description: overview.description || event.description || null,
        start_date: overview.start_date || event.start_date || null,
        end_date: overview.end_date || event.end_date || null,
        dates_text: overview.dates_text || (event.start_date && event.end_date ? event.start_date + ' – ' + event.end_date : event.start_date || null),
        organizer: overview.organizer || event.organizer || null,
        venue: overview.venue || event.venue || null,
        city: overview.city || event.city || null,
        region: overview.region || event.region || null,
        country: overview.country || event.country || null,
        location_text: overview.location_text || [event.venue,event.city,event.region,event.country].filter(Boolean).join(', ') || null,
        format: overview.format || event.format || null,
        official_url: url,
        source_url: overview.source_url || url,
        logo_url: identity.logo || overview.logo_url || absoluteUrl('/favicon.ico',url),
        logo_source: identity.logoSource || overview.logo_source || 'organiser',
        image_url: identity.hero || overview.image_url || event.image_url || null,
      };

      const nextVenue = {
        ...venue,
        venue_name: venue.venue_name || event.venue || null,
        address: venue.address || event.venue_address || null,
      };

      const notes = {...(meta.section_notes||{})};
      for (const [k,v] of Object.entries(notes)) notes[k]=cleanNote(v,year);
      const availability = {...(meta.section_availability||{}),overview:'stated'};
      const states = {
        call_for_papers: sectionState('cfp',cfp),
        fees_pricing: sectionState('fees',fees),
        program_agenda: sectionState('program',program),
        keynote_speakers: sectionState('speakers',speakers),
        technical_committee: sectionState('committee',committee),
        sponsors_exhibitors: sectionState('sponsors',sponsors),
        venue_accommodation: sectionState('venue',nextVenue),
        community: sectionState('community',community),
      };
      for (const [k,v] of Object.entries(states)) {
        availability[k] = v || (pageVerified ? 'not_announced' : 'unread');
      }
      const filled = Object.values(states).filter(Boolean).length + 1;
      if (filled >= 6) strong += 1;
      const nextMeta = {
        ...meta,
        section_notes: notes,
        section_availability: availability,
        quality_gate: 'edition-aware-v2',
        identity_checked_at: new Date().toISOString(),
        identity_page_verified: pageVerified,
        tabs_filled: filled,
        tabs_total: 9,
        visual_identity: identity.logo ? identity.logoSource : (nextOverview.logo_url ? 'organiser-fallback' : 'generated-mark'),
      };
      const key = existing?.source_url || url;
      await db.execute({
        sql:`INSERT INTO extracted_conferences(source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
             ON CONFLICT(source_url) DO UPDATE SET overview=excluded.overview,call_for_papers=excluded.call_for_papers,program_agenda=excluded.program_agenda,keynote_speakers=excluded.keynote_speakers,technical_committee=excluded.technical_committee,sponsors_exhibitors=excluded.sponsors_exhibitors,venue_accommodation=excluded.venue_accommodation,fees_pricing=excluded.fees_pricing,community=excluded.community,extraction_metadata=excluded.extraction_metadata,updated_at=datetime('now')`,
        args:[key,JSON.stringify(nextOverview),JSON.stringify(cfp),JSON.stringify(program),JSON.stringify(speakers),JSON.stringify(committee),JSON.stringify(sponsors),JSON.stringify(nextVenue),JSON.stringify(fees),JSON.stringify(community),JSON.stringify(nextMeta)]
      });
      if (identity.hero) await db.execute({sql:'UPDATE discovery_events SET image_url=COALESCE(?,image_url),last_checked=? WHERE id=?',args:[identity.hero,new Date().toISOString(),event.id]});
      updated += 1;
    }
    console.log('[conference-power] records='+updated+' fetched='+fetched+' real_logos='+identities+' strong_6plus_tabs='+strong);
  } catch (error) {
    console.warn('[conference-power] failed:',error?.message||error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
