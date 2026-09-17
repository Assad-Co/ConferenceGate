import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.APIFY_TOKEN?.trim() || '';
const ACTOR = process.env.CONFERENCE_APIFY_ACTOR?.trim() || 'apify~website-content-crawler';
const MAX_RUNS = Math.max(0, Number(process.env.DEEP_ENRICH_APIFY_MAX_RUNS || 20));
const MAX_PAGES = Math.max(3, Number(process.env.DEEP_ENRICH_APIFY_MAX_PAGES || 8));
const MIN_TABS = Math.max(3, Math.min(9, Number(process.env.DEEP_ENRICH_MIN_TABS || 6)));
const REFRESH_DAYS = Math.max(1, Number(process.env.DEEP_ENRICH_APIFY_REFRESH_DAYS || 7));
const TIMEOUT_MS = Math.max(30000, Number(process.env.DEEP_ENRICH_APIFY_TIMEOUT_MS || 120000));

const SECTION_PATTERNS = {
  cfp: /\b(call for (?:papers|abstracts)|abstract submissions?|submit (?:an )?abstract|abstract deadline|poster submissions?|paper submissions?)\b/i,
  fees: /\b(registration fees?|registration rates?|pricing|early[- ]bird|member rate|non[- ]member rate|register now)\b/i,
  agenda: /\b(program(?:me)?|agenda|schedule|technical program|technical sessions?|scientific program|conference program)\b/i,
  speakers: /\b(keynote(?: speakers?)?|plenary(?: speakers?)?|invited speakers?|featured speakers?|speakers?)\b/i,
  committee: /\b(technical committee|program(?:me)? committee|scientific committee|organizing committee|advisory committee|co[- ]?chairs?|session chairs?)\b/i,
  sponsors: /\b(sponsors?|sponsorship|exhibitors?|exhibition|partners?)\b/i,
  venue: /\b(venue|location|hotel|lodging|accommodation|travel|getting there|conference center|convention center)\b/i,
  community: /\b(networking|community|social events?|reception|students?|young professionals?|mentoring|career development)\b/i,
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeJson(value, fallback) { try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }
function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function absoluteUrl(value, base) { try { const u = new URL(String(value || '').trim(), base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } }
function stripTags(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function textLines(value = '') { return stripTags(value).split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 2); }
function metaContent(html, names) {
  const wanted = new Set(names.map((x) => x.toLowerCase()));
  const re = /<meta\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (key && wanted.has(key) && content) return content.trim();
  }
  return null;
}
function extractAnchors(html, base) {
  const out = []; const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const hrefRaw = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(m[1])?.slice(1).find(Boolean);
    const href = absoluteUrl(hrefRaw, base); if (!href) continue;
    out.push({ href, label: stripTags(m[2]).replace(/\s+/g, ' ').trim() });
  }
  return out;
}
function titleTokens(title) {
  const stop = new Set(['the','and','for','with','from','conference','congress','symposium','summit','workshop','meeting','annual','international','2026','2027','2028']);
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((x) => x.length >= 4 && !stop.has(x)).slice(0, 8);
}
function extractBestLogo(html, base, title) {
  const tokens = titleTokens(title); let best = null; let bestScore = 0; const re = /<img\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const srcRaw = /(?:src|data-src|data-lazy-src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean);
    const src = absoluteUrl(srcRaw, base); if (!src) continue;
    const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
    const cls = /class\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
    const hay = `${alt} ${cls} ${src}`.toLowerCase();
    let score = /\blogo\b|brand|event-mark|conference-logo/.test(hay) ? 5 : 0;
    for (const token of tokens) if (hay.includes(token)) score += 2;
    if (/header|footer|speaker|sponsor|exhibitor|avatar/.test(hay)) score -= 3;
    if (score > bestScore) { bestScore = score; best = src; }
  }
  return bestScore >= 5 ? best : null;
}
function sectionExcerpt(lines, pattern, maxChars = 3200) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    const text = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 11)).join('\n').trim();
    if (text.length >= 30) hits.push(text);
    if (hits.join('\n').length >= maxChars) break;
  }
  return [...new Set(hits)].join('\n').slice(0, maxChars).trim() || null;
}
function countStated(meta) { return Object.values(meta?.section_availability || {}).filter((v) => v === 'stated').length; }
function attemptedRecently(meta) {
  const t = Date.parse(meta?.apify_tab_fill_at || '');
  return Number.isFinite(t) && Date.now() - t < REFRESH_DAYS * 86400000;
}
function mergeObject(oldValue, newValue) {
  return { ...(oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue) ? oldValue : {}), ...(newValue && typeof newValue === 'object' ? newValue : {}) };
}
function pageUrl(item, fallback) {
  return item?.url || item?.loadedUrl || item?.metadata?.url || item?.metadata?.sourceURL || item?.metadata?.sourceUrl || fallback;
}
function itemBody(item) {
  const markdown = typeof item?.markdown === 'string' ? item.markdown : typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : '';
  const html = typeof item?.html === 'string' ? item.html : typeof item?.rawHtml === 'string' ? item.rawHtml : '';
  return { markdown, html };
}
function relevantGlobs(url) {
  const host = hostOf(url); if (!host) return [];
  const base = `https://${host}/**`;
  return ['program','agenda','schedule','register','registration','fee','pricing','venue','hotel','lodging','accommodation','speaker','keynote','committee','chair','sponsor','exhibit','abstract','paper','poster','network','community']
    .map((word) => `${base}*${word}*`);
}

async function apifyCrawl(event) {
  const url = String(event.official_url || event.canonical_url || '').trim();
  if (!url || !TOKEN) return [];
  const starts = [url, event.registration_url, event.submission_url].filter(Boolean).map((u) => ({ url: String(u) }));
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR)}/run-sync-get-dataset-items?token=${encodeURIComponent(TOKEN)}`;
  const input = {
    startUrls: starts,
    crawlerType: 'playwright:adaptive',
    includeUrlGlobs: relevantGlobs(url),
    maxCrawlDepth: 1,
    maxCrawlPages: MAX_PAGES,
    useSitemaps: false,
    respectRobotsTxtFile: true,
    proxyConfiguration: { useApifyProxy: true },
    saveMarkdown: true,
    saveHtml: true,
    summarize: false,
    htmlTransformer: 'readableTextIfPossible',
  };
  const res = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
  const data = await res.json().catch(() => []);
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return items.slice(0, MAX_PAGES).map((item) => {
    const body = itemBody(item);
    return { ...body, finalUrl: pageUrl(item, url), via: 'apify' };
  }).filter((p) => (p.markdown || p.html).trim().length >= 80);
}

function sectionFromPages(pages, section) {
  const pattern = SECTION_PATTERNS[section]; const parts = [];
  for (const page of pages) {
    const excerpt = sectionExcerpt(textLines(page.markdown || page.html || ''), pattern);
    if (excerpt) parts.push(excerpt);
  }
  return [...new Set(parts)].join('\n\n').slice(0, 4000).trim() || null;
}
function findLinkByPattern(pages, pattern) {
  for (const page of pages) {
    if (!page.html) continue;
    const hit = extractAnchors(page.html, page.finalUrl).find((a) => pattern.test(`${a.label} ${a.href}`));
    if (hit) return hit.href;
  }
  return null;
}

async function enrichOne(db, event) {
  const url = String(event.official_url || event.canonical_url || '').trim();
  if (!url) return { skip: 'no-url' };
  const rows = await db.execute({ sql: `SELECT * FROM extracted_conferences WHERE source_url IN (?,?) LIMIT 1`, args: [url, String(event.canonical_url || url)] });
  const existing = rows.rows?.[0] || null;
  const oldMeta = safeJson(existing?.extraction_metadata, {});
  if (countStated(oldMeta) >= MIN_TABS) return { skip: 'already-rich' };
  if (attemptedRecently(oldMeta)) return { skip: 'recent-attempt' };

  const pages = await apifyCrawl(event);
  if (!pages.length) {
    const meta = { ...oldMeta, apify_tab_fill_at: new Date().toISOString(), apify_tab_fill_status: 'empty' };
    if (existing) await db.execute({ sql: `UPDATE extracted_conferences SET extraction_metadata=?, updated_at=datetime('now') WHERE source_url=?`, args: [JSON.stringify(meta), existing.source_url] });
    return { empty: true };
  }

  const oldOverview = safeJson(existing?.overview, {});
  const oldCfp = safeJson(existing?.call_for_papers, {});
  const oldProgram = safeJson(existing?.program_agenda, { sessions: [], themes: [], overview: null });
  const oldSpeakers = safeJson(existing?.keynote_speakers, []);
  const oldCommittee = safeJson(existing?.technical_committee, []);
  const oldSponsors = safeJson(existing?.sponsors_exhibitors, []);
  const oldVenue = safeJson(existing?.venue_accommodation, {});
  const oldFees = safeJson(existing?.fees_pricing, {});
  const oldCommunity = safeJson(existing?.community, {});

  const notes = { ...(oldMeta?.section_notes || {}) };
  const availability = { ...(oldMeta?.section_availability || {}), overview: 'stated' };
  for (const section of Object.keys(SECTION_PATTERNS)) {
    const note = sectionFromPages(pages, section);
    if (note) { notes[section] = note; availability[section] = 'stated'; }
    else if (availability[section] !== 'stated') availability[section] = 'not_announced';
  }

  const main = pages[0];
  const mainHtml = main?.html || '';
  const mainText = textLines(main?.markdown || mainHtml).slice(0, 8).join(' ');
  const description = metaContent(mainHtml, ['og:description','description']) || (mainText.length > 80 ? mainText.slice(0, 1200) : null);
  const logo = mainHtml ? extractBestLogo(mainHtml, main.finalUrl, event.title) : null;
  const hero = mainHtml ? absoluteUrl(metaContent(mainHtml, ['og:image','twitter:image']), main.finalUrl) : null;
  const registrationUrl = findLinkByPattern(pages, /\b(register|registration)\b/i) || event.registration_url || null;
  const submissionUrl = findLinkByPattern(pages, /\b(submit|abstract|call for papers|call for abstracts)\b/i) || event.submission_url || null;

  const overview = mergeObject(oldOverview, {
    conference_name: oldOverview.conference_name || event.title,
    organizer: oldOverview.organizer || event.organizer || null,
    official_url: url,
    description: oldOverview.description || description || null,
    logo_url: logo || oldOverview.logo_url || null,
    logo_source: logo ? 'stated' : (oldOverview.logo_source || null),
    image_url: hero || oldOverview.image_url || null,
  });
  const cfp = mergeObject(oldCfp, submissionUrl ? { submission_url: submissionUrl } : {});
  const program = mergeObject(oldProgram, notes.agenda ? { overview: oldProgram.overview || notes.agenda } : {});
  if (!Array.isArray(program.sessions)) program.sessions = [];
  if (!Array.isArray(program.themes)) program.themes = [];
  const venue = mergeObject(oldVenue, notes.venue ? { accommodation: oldVenue.accommodation || notes.venue } : {});
  const fees = mergeObject(oldFees, {
    ...(registrationUrl ? { registration_url: registrationUrl } : {}),
    ...(notes.fees ? { pricing_text: oldFees.pricing_text || notes.fees } : {}),
  });
  const community = mergeObject(oldCommunity, notes.community ? { overview: oldCommunity.overview || notes.community } : {});

  const meta = {
    ...oldMeta,
    origin: oldMeta.origin || 'discovery_engine',
    apify_tab_fill_at: new Date().toISOString(),
    apify_tab_fill_status: 'success',
    apify_actor: ACTOR.replace('~','/'),
    apify_pages_read: pages.length,
    apify_page_urls: pages.map((p) => p.finalUrl),
    section_availability: availability,
    section_notes: notes,
  };
  const key = existing?.source_url || url;
  await db.execute({
    sql: `INSERT INTO extracted_conferences (source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
          ON CONFLICT(source_url) DO UPDATE SET overview=excluded.overview,call_for_papers=excluded.call_for_papers,program_agenda=excluded.program_agenda,keynote_speakers=excluded.keynote_speakers,technical_committee=excluded.technical_committee,sponsors_exhibitors=excluded.sponsors_exhibitors,venue_accommodation=excluded.venue_accommodation,fees_pricing=excluded.fees_pricing,community=excluded.community,extraction_metadata=excluded.extraction_metadata,updated_at=datetime('now')`,
    args: [key,JSON.stringify(overview),JSON.stringify(cfp),JSON.stringify(program),JSON.stringify(oldSpeakers),JSON.stringify(oldCommittee),JSON.stringify(oldSponsors),JSON.stringify(venue),JSON.stringify(fees),JSON.stringify(community),JSON.stringify(meta)],
  });
  if (hero) await db.execute({ sql: `UPDATE discovery_events SET image_url=COALESCE(?,image_url), last_checked=? WHERE id=?`, args: [hero,new Date().toISOString(),event.id] });
  return { pages: pages.length, tabs: countStated(meta), logo: Boolean(logo) };
}

async function main() {
  if (!TOKEN) { console.log('[apify-tab-fill] APIFY_TOKEN not configured; skipping'); return; }
  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: `file:${localPath}` });
  try {
    const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')`);
    if ((tables.rows || []).length < 2) { console.log('[apify-tab-fill] schema unavailable; skipping'); return; }
    const result = await db.execute(`SELECT id,title,organizer,official_url,canonical_url,registration_url,submission_url,start_date,status FROM discovery_events WHERE status='published' AND COALESCE(official_url,canonical_url) IS NOT NULL ORDER BY CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,start_date ASC,title ASC`);
    let runs = 0, enriched = 0, skipped = 0, empty = 0, failed = 0;
    console.log(`[apify-tab-fill] starting candidates=${result.rows?.length || 0} max_runs=${MAX_RUNS} max_pages=${MAX_PAGES} min_tabs=${MIN_TABS} actor=${ACTOR.replace('~','/')}`);
    for (const event of result.rows || []) {
      if (MAX_RUNS > 0 && runs >= MAX_RUNS) break;
      try {
        const out = await enrichOne(db, event);
        if (out.skip) { skipped += 1; continue; }
        runs += 1;
        if (out.empty) { empty += 1; console.log(`[apify-tab-fill] empty ${event.title}`); }
        else { enriched += 1; console.log(`[apify-tab-fill] enriched ${event.title} pages=${out.pages} tabs=${out.tabs}/9 logo=${out.logo ? 'event' : 'preserved/fallback'}`); }
      } catch (error) {
        runs += 1; failed += 1;
        console.warn(`[apify-tab-fill] failed ${event.title}: ${error?.message || error}`);
      }
      await sleep(500);
    }
    console.log(`[apify-tab-fill] complete runs=${runs} enriched=${enriched} skipped=${skipped} empty=${empty} failed=${failed}`);
  } finally { try { db.close(); } catch {} }
}

await main();
