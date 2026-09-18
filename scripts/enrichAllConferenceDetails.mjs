import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 ConferenceGate/1.0';
const MAX_EVENTS = Math.max(0, Number(process.env.DEEP_ENRICH_MAX_EVENTS || 0)); // 0 = all
const MAX_DEEP_LINKS = Math.max(3, Number(process.env.DEEP_ENRICH_MAX_LINKS || 16));
const REFRESH_DAYS = Math.max(1, Number(process.env.DEEP_ENRICH_REFRESH_DAYS || 3));
const FIRECRAWL_MAX_PAGES = Math.max(0, Number(process.env.DEEP_ENRICH_FIRECRAWL_MAX_PAGES || 250));
const DIRECT_TIMEOUT_MS = Math.max(4000, Number(process.env.DEEP_ENRICH_DIRECT_TIMEOUT_MS || 10000));
const FIRECRAWL_TIMEOUT_MS = Math.max(10000, Number(process.env.DEEP_ENRICH_FIRECRAWL_TIMEOUT_MS || 45000));
let firecrawlPagesUsed = 0;

const SECTION_PATTERNS = {
  cfp: /\b(call for (?:papers|abstracts)|abstract submissions?|submit (?:an )?abstract|abstract deadline|poster submissions?|paper submissions?)\b/i,
  fees: /\b(registration fees?|registration rates?|registration cost|pricing|early[- ]bird|member rate|non[- ]member rate|student rate|fee schedule)\b|(?:[$€£]|USD|EUR|GBP|BHD|SAR|AED)\s?\d/i,
  agenda: /\b(program(?:me)?|agenda|schedule|technical program|technical sessions?|scientific program|conference program)\b/i,
  speakers: /\b(keynote(?: speakers?)?|plenary(?: speakers?)?|invited speakers?|featured speakers?|speakers?)\b/i,
  committee: /\b(technical committee|program(?:me)? committee|scientific committee|organizing committee|advisory committee|co[- ]?chairs?|session chairs?)\b/i,
  sponsors: /\b(sponsors?|sponsorship|exhibitors?|exhibition|partners?)\b/i,
  venue: /\b(venue|location|hotel|lodging|accommodation|travel|getting there|conference center|convention center)\b/i,
  community: /\b(networking|community|social events?|reception|students?|young professionals?|mentoring|career development)\b/i,
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function absoluteUrl(value, base) {
  try {
    const u = new URL(String(value || '').trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function stripTags(value = '') {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function textLines(value = '') {
  return stripTags(value).split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 2);
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
function extractAnchors(html, base) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const hrefRaw = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(m[1])?.slice(1).find(Boolean);
    const href = absoluteUrl(hrefRaw, base);
    if (!href) continue;
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    out.push({ href, label });
  }
  return out;
}
function titleTokens(title) {
  const stop = new Set(['the','and','for','with','from','conference','congress','symposium','summit','workshop','meeting','annual','international','2026','2027','2028']);
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((x) => x.length >= 4 && !stop.has(x)).slice(0, 8);
}
function extractBestLogo(html, base, title) {
  const tokens = titleTokens(title);
  let best = null;
  let bestScore = 0;
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const srcRaw = /(?:src|data-src|data-lazy-src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag)?.slice(1).find(Boolean);
    const src = absoluteUrl(srcRaw, base);
    if (!src) continue;
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
function relevantLinkScore(anchor, eventUrl) {
  const hay = `${anchor.label} ${anchor.href}`.toLowerCase();
  let score = 0;
  for (const p of Object.values(SECTION_PATTERNS)) if (p.test(hay)) score += 5;
  if (/learn more|details|event details|read more/.test(hay)) score += 3;
  if (/\.pdf(?:$|\?)/i.test(anchor.href)) score += 2;
  if (hostOf(anchor.href) === hostOf(eventUrl)) score += 2;
  if (/facebook|instagram|linkedin|youtube|twitter|x\.com|mailto:|javascript:/i.test(anchor.href)) score -= 10;
  return score;
}
function chooseDeepLinks(html, eventUrl) {
  const seen = new Set([eventUrl.replace(/\/$/, '')]);
  return extractAnchors(html, eventUrl)
    .map((a) => ({ ...a, score: relevantLinkScore(a, eventUrl) }))
    .filter((a) => a.score >= 5)
    .sort((a, b) => b.score - a.score)
    .filter((a) => {
      const key = a.href.replace(/#.*$/, '').replace(/\/$/, '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_DEEP_LINKS);
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
    const year = Number(match[1]);
    counts.set(year, (counts.get(year) || 0) + 1);
  }
  return counts;
}
/**
 * Reject an old-edition page even when its footer says © current-year.
 *
 * A generic "Register Now" page can stay live for years. ESAAPG's current site is a real example:
 * the page footer is 2026 while the registration body repeatedly says 2021. The old implementation
 * saw the link label, copied that whole page into Fees, and presented 2021 prices as 2026 data.
 */
function pageMatchesEventEdition(page, event) {
  const year = eventYear(event);
  if (!year) return true;
  const body = stripTags(page?.markdown || page?.html || '');
  const counts = yearCounts(body);
  if (!counts.size) return true;
  const currentCount = counts.get(year) || 0;
  const others = [...counts.entries()].filter(([candidate]) => candidate !== year);
  if (!others.length) return true;
  const [dominantOtherYear, dominantOtherCount] = others.sort((a, b) => b[1] - a[1])[0];
  // No mention of this edition but a different edition is named: do not borrow it.
  if (currentCount === 0) return false;
  // One copyright/footer mention cannot rescue a page whose body repeatedly names an older edition.
  if (dominantOtherCount >= 2 && dominantOtherCount > currentCount && dominantOtherYear < year) return false;
  return true;
}
function navNoise(line) {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  const navHits = (text.match(/\b(home|join|login|calendar|albums?|register now|learn more|contact us|about us|meetings?|events?|schedule|venue|sponsor|exhibitor)\b/gi) || []).length;
  return text.length > 260 && navHits >= 4;
}
function cleanExcerptLines(lines) {
  const clean = [];
  for (const raw of lines) {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (line.length < 3 || navNoise(line)) continue;
    if (/^(home|about|events|news|resources|membership|join|login)$/i.test(line)) continue;
    if (!clean.includes(line)) clean.push(line);
    if (clean.join('\n').length >= 900) break;
  }
  return clean.join('\n').slice(0, 900).trim() || null;
}

function sectionExcerpt(lines, pattern, maxChars = 900) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    const from = Math.max(0, i - 1);
    const to = Math.min(lines.length, i + 5);
    const text = cleanExcerptLines(lines.slice(from, to));
    if (text && text.length >= 20) hits.push(text);
    if (hits.join('\n').length >= maxChars) break;
  }
  return [...new Set(hits)].join('\n').slice(0, maxChars).trim() || null;
}
function mergeObject(oldValue, newValue) {
  return { ...(oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue) ? oldValue : {}), ...(newValue && typeof newValue === 'object' ? newValue : {}) };
}
function uniqueStatedTabs(meta) {
  const availability = meta?.section_availability || {};
  const groups = [
    ['overview'],
    ['cfp','call_for_papers'],
    ['fees','fees_pricing'],
    ['agenda','program_agenda'],
    ['speakers','keynote_speakers'],
    ['committee','technical_committee'],
    ['sponsors','sponsors_exhibitors'],
    ['venue','venue_accommodation'],
    ['community'],
  ];
  return groups.filter((aliases) => aliases.some((key) => availability[key] === 'stated')).length;
}
function recentEnough(meta) {
  // Thin records stay eligible even when a previous pass touched them; otherwise a two-tab result
  // could sit unchanged for three days while the section-specific pages were available.
  if (uniqueStatedTabs(meta) < 6) return false;
  const raw = meta?.deep_enriched_at;
  if (!raw) return false;
  const t = Date.parse(raw);
  return Number.isFinite(t) && Date.now() - t < REFRESH_DAYS * 86400000;
}

async function directRead(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status, html: '', markdown: '', finalUrl: res.url || url, via: 'direct' };
    const type = res.headers.get('content-type') || '';
    const body = await res.text();
    if (/text\/html|application\/xhtml/i.test(type) || /<html|<body|<main|<div/i.test(body)) {
      return { ok: body.trim().length >= 250, status: res.status, html: body, markdown: '', finalUrl: res.url || url, via: 'direct' };
    }
    return { ok: body.trim().length >= 250, status: res.status, html: '', markdown: body, finalUrl: res.url || url, via: 'direct' };
  } catch (error) {
    return { ok: false, status: 0, html: '', markdown: '', finalUrl: url, via: 'direct', error: String(error?.message || error) };
  }
}

async function firecrawlRead(url) {
  if (!process.env.FIRECRAWL_API_KEY || firecrawlPagesUsed >= FIRECRAWL_MAX_PAGES) return null;
  firecrawlPagesUsed += 1;
  try {
    const base = process.env.FIRECRAWL_API_BASE || 'https://api.firecrawl.dev';
    const res = await fetch(`${base}/v1/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['html','markdown'], onlyMainContent: false, timeout: 30000 }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return null;
    const data = body?.data ?? body ?? {};
    const html = typeof data.html === 'string' ? data.html : typeof data.rawHtml === 'string' ? data.rawHtml : '';
    const markdown = typeof data.markdown === 'string' ? data.markdown : typeof data.content === 'string' ? data.content : '';
    if (!html && !markdown) return null;
    return { ok: true, status: res.status, html, markdown, finalUrl: data?.metadata?.sourceURL || url, via: 'firecrawl' };
  } catch { return null; }
}

async function readPage(url) {
  const direct = await directRead(url);
  if (direct.ok) return direct;
  const fallback = await firecrawlRead(url);
  return fallback || direct;
}

function sectionFromPages(pages, section, event) {
  const pattern = SECTION_PATTERNS[section];
  const parts = [];
  for (const page of pages) {
    if (!pageMatchesEventEdition(page, event)) continue;
    const body = page.markdown || page.html || '';
    const lines = textLines(body);
    const excerpt = sectionExcerpt(lines, pattern);
    if (excerpt) parts.push(excerpt);
  }
  return [...new Set(parts)].join('\n\n').slice(0, 1200).trim() || null;
}

function findLinkByPattern(pages, pattern) {
  for (const page of pages) {
    if (!page.html) continue;
    const hit = extractAnchors(page.html, page.finalUrl).find((a) => pattern.test(`${a.label} ${a.href}`));
    if (hit) return hit.href;
  }
  return null;
}

async function enrichEvent(db, event) {
  const url = String(event.official_url || event.canonical_url || '').trim();
  if (!url) return { skipped: true, reason: 'no-url' };

  const existingRows = await db.execute({ sql: `SELECT * FROM extracted_conferences WHERE source_url IN (?, ?) LIMIT 1`, args: [url, String(event.canonical_url || url)] });
  const existing = existingRows.rows?.[0] || null;
  const oldMeta = safeJson(existing?.extraction_metadata, {});
  if (recentEnough(oldMeta)) return { skipped: true, reason: 'fresh' };

  const main = await readPage(url);
  if (!main.ok) {
    const meta = { ...oldMeta, deep_enriched_at: new Date().toISOString(), deep_enrich_status: 'unread', deep_enrich_http_status: main.status || null };
    if (existing) {
      await db.execute({ sql: `UPDATE extracted_conferences SET extraction_metadata=?, updated_at=datetime('now') WHERE source_url=?`, args: [JSON.stringify(meta), existing.source_url] });
    }
    return { skipped: false, unread: true, status: main.status };
  }

  const pages = [main];
  const deepLinks = main.html ? chooseDeepLinks(main.html, main.finalUrl) : [];
  for (const link of deepLinks) {
    await sleep(250);
    const page = await readPage(link.href);
    if (page.ok && pageMatchesEventEdition(page, event)) pages.push(page);
  }

  const mainHtml = main.html || '';
  const description = metaContent(mainHtml, ['og:description','description']) || textLines(main.markdown || mainHtml).slice(0, 5).join(' ').slice(0, 1200) || null;
  const logo = mainHtml ? extractBestLogo(mainHtml, main.finalUrl, event.title) : null;
  const hero = mainHtml ? absoluteUrl(metaContent(mainHtml, ['og:image','twitter:image']), main.finalUrl) : null;

  const notes = {};
  const availability = { ...(oldMeta?.section_availability || {}) };
  for (const section of Object.keys(SECTION_PATTERNS)) {
    const note = sectionFromPages(pages, section, event);
    notes[section] = note || null;
    availability[section] = note ? 'stated' : 'not_announced';
  }
  availability.overview = 'stated';

  const oldOverview = safeJson(existing?.overview, {});
  const oldCfp = safeJson(existing?.call_for_papers, {});
  const oldProgram = safeJson(existing?.program_agenda, { sessions: [], themes: [], overview: null });
  const oldSpeakers = safeJson(existing?.keynote_speakers, []);
  const oldCommittee = safeJson(existing?.technical_committee, []);
  const oldSponsors = safeJson(existing?.sponsors_exhibitors, []);
  const oldVenue = safeJson(existing?.venue_accommodation, {});
  const oldFees = safeJson(existing?.fees_pricing, {});
  const oldCommunity = safeJson(existing?.community, {});

  const registrationUrl = findLinkByPattern(pages, /\b(register|registration)\b/i);
  const submissionUrl = findLinkByPattern(pages, /\b(submit|abstract|call for papers|call for abstracts)\b/i);

  const overview = mergeObject(oldOverview, {
    conference_name: oldOverview.conference_name || event.title,
    organizer: oldOverview.organizer || event.organizer || null,
    official_url: url,
    description: description || oldOverview.description || null,
    logo_url: logo || oldOverview.logo_url || null,
    logo_source: logo ? 'stated' : (oldOverview.logo_source || null),
    image_url: hero || oldOverview.image_url || null,
  });
  const cfp = mergeObject(oldCfp, submissionUrl ? { submission_url: submissionUrl } : {});
  const program = mergeObject(oldProgram, { overview: notes.agenda || null });
  if (!Array.isArray(program.sessions)) program.sessions = [];
  if (!Array.isArray(program.themes)) program.themes = [];
  const venue = mergeObject(oldVenue, { accommodation: notes.venue || oldVenue.accommodation || null });
  const fees = mergeObject(oldFees, {
    ...(registrationUrl ? { registration_url: registrationUrl } : {}),
    pricing_text: notes.fees || null,
  });
  const community = mergeObject(oldCommunity, { overview: notes.community || null });

  const meta = {
    ...oldMeta,
    origin: oldMeta.origin || 'discovery_engine',
    deep_enriched_at: new Date().toISOString(),
    deep_enrich_status: 'success',
    deep_pages_read: pages.length,
    deep_page_urls: pages.map((p) => p.finalUrl),
    deep_reader_routes: [...new Set(pages.map((p) => p.via))],
    section_availability: availability,
    section_notes: { ...(oldMeta?.section_notes || {}), ...notes },
  };

  const key = existing?.source_url || url;
  await db.execute({
    sql: `INSERT INTO extracted_conferences (
      source_url, overview, call_for_papers, program_agenda, keynote_speakers, technical_committee,
      sponsors_exhibitors, venue_accommodation, fees_pricing, community, extraction_metadata, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_url) DO UPDATE SET
      overview=excluded.overview, call_for_papers=excluded.call_for_papers, program_agenda=excluded.program_agenda,
      keynote_speakers=excluded.keynote_speakers, technical_committee=excluded.technical_committee,
      sponsors_exhibitors=excluded.sponsors_exhibitors, venue_accommodation=excluded.venue_accommodation,
      fees_pricing=excluded.fees_pricing, community=excluded.community,
      extraction_metadata=excluded.extraction_metadata, updated_at=datetime('now')`,
    args: [key, JSON.stringify(overview), JSON.stringify(cfp), JSON.stringify(program), JSON.stringify(oldSpeakers), JSON.stringify(oldCommittee), JSON.stringify(oldSponsors), JSON.stringify(venue), JSON.stringify(fees), JSON.stringify(community), JSON.stringify(meta)],
  });

  if (hero) {
    await db.execute({ sql: `UPDATE discovery_events SET image_url=COALESCE(?, image_url), last_checked=? WHERE id=?`, args: [hero, new Date().toISOString(), event.id] });
  }

  const stated = Object.values(availability).filter((v) => v === 'stated').length;
  return { skipped: false, pages: pages.length, stated, logo: Boolean(logo), via: [...new Set(pages.map((p) => p.via))].join('+') };
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
      console.log('[deep-enrich] schema unavailable; skipping');
      return;
    }

    const result = await db.execute(`SELECT id,title,organizer,official_url,canonical_url,start_date,end_date,status,relevance_reason FROM discovery_events WHERE status='published' AND COALESCE(official_url,canonical_url) IS NOT NULL ORDER BY CASE WHEN relevance_reason='popular_category_priority' THEN 0 ELSE 1 END, CASE WHEN start_date IS NULL THEN 1 ELSE 0 END, start_date ASC, title ASC`);
    let events = result.rows || [];
    if (MAX_EVENTS > 0) events = events.slice(0, MAX_EVENTS);
    console.log(`[deep-enrich] starting universal detail sweep events=${events.length} max_links=${MAX_DEEP_LINKS} firecrawl_budget=${FIRECRAWL_MAX_PAGES}`);

    let enriched = 0, fresh = 0, unread = 0, failed = 0;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      try {
        const out = await enrichEvent(db, event);
        if (out.skipped && out.reason === 'fresh') { fresh += 1; continue; }
        if (out.unread) {
          unread += 1;
          console.log(`[deep-enrich] unread ${event.title} http=${out.status || 0}`);
        } else {
          enriched += 1;
          console.log(`[deep-enrich] enriched ${event.title} pages=${out.pages} tabs=${out.stated}/9 logo=${out.logo ? 'event' : 'preserved/fallback'} via=${out.via}`);
        }
      } catch (error) {
        failed += 1;
        console.warn(`[deep-enrich] failed ${event.title}: ${error?.message || error}`);
      }
      await sleep(350);
    }
    console.log(`[deep-enrich] complete enriched=${enriched} fresh=${fresh} unread=${unread} failed=${failed} firecrawl_pages=${firecrawlPagesUsed}`);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
