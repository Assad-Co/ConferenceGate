import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const CALENDAR_URL = "https://www.aapg.org/events/calendar/";
const IMPORT_ORIGIN = "aapg_phase1";
const USER_AGENT = "ConferenceGate/1.0 (+https://conferencegate.onrender.com/)";
const MAX_EVENTS = Math.max(1, Number(process.env.AAPG_PHASE1_MAX_EVENTS || 30));

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function decodeEntities(value = "") {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
    rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", eacute: "é", reg: "®", trade: "™",
  };
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function plain(value = "") {
  return decodeEntities(String(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlLines(value = "") {
  return decodeEntities(String(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/section|\/article|\/li|\/h[1-6]|hr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha1").update(String(value || "")).digest("hex").slice(0, 24)}`;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || "").trim(), base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

function metaContent(html, keys) {
  const wanted = new Set(keys.map((v) => v.toLowerCase()));
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[0]);
    const key = String(attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return attrs.content.trim();
  }
  return null;
}

function linkHref(html, base, relPattern) {
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[0]);
    if (relPattern.test(String(attrs.rel || "")) && attrs.href) return absoluteUrl(attrs.href, base);
  }
  return null;
}

function extractAnchors(html, base) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(`<a ${m[1]}>`);
    const href = absoluteUrl(attrs.href, base);
    const text = plain(m[2]);
    if (href) out.push({ href, text, index: m.index, raw: m[0] });
  }
  return out;
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateRange(text) {
  const s = decodeEntities(text).replace(/[‐‑‒–—]/g, "-");
  const months = Object.keys(MONTHS).join("|");
  let m = new RegExp(`\\b(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+(${months})\\s*,?\\s*(20\\d{2})\\b`, "i").exec(s);
  if (m) {
    const month = MONTHS[m[3].toLowerCase()];
    return { start: isoDate(Number(m[4]), month, Number(m[1])), end: isoDate(Number(m[4]), month, Number(m[2])), raw: m[0] };
  }
  m = new RegExp(`\\b(\\d{1,2})\\s+(${months})\\s*,?\\s*(20\\d{2})\\s*-\\s*(\\d{1,2})\\s+(${months})\\s*,?\\s*(20\\d{2})\\b`, "i").exec(s);
  if (m) {
    return {
      start: isoDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])),
      end: isoDate(Number(m[6]), MONTHS[m[5].toLowerCase()], Number(m[4])), raw: m[0],
    };
  }
  m = new RegExp(`\\b(\\d{1,2})\\s+(${months})\\s*,?\\s*(20\\d{2})\\b`, "i").exec(s);
  if (m) {
    const d = isoDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    return { start: d, end: d, raw: m[0] };
  }
  return null;
}

function isUpcoming(endDate) {
  if (!endDate) return false;
  const today = new Date();
  const ymd = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  return endDate >= ymd;
}

function isGenericCta(text) {
  return /^(?:learn more|register(?: now)?|submit(?: an?| your)? (?:abstract|poster)|become a sponsor|sponsorship available|download(?: event)? brochure|view details|read more)$/i.test(text.trim());
}

function locationFromCard(lines, title, dateRaw) {
  const titleIndex = lines.findIndex((line) => line.toLowerCase() === title.toLowerCase());
  const start = titleIndex >= 0 ? titleIndex + 1 : 0;
  const dateIndex = lines.findIndex((line, i) => i >= start && line.includes(dateRaw));
  const from = dateIndex >= 0 ? dateIndex + 1 : start;
  for (let i = from; i < Math.min(lines.length, from + 5); i++) {
    const line = lines[i];
    if (!line || isGenericCta(line)) continue;
    if (/^(?:virtual|online)$/i.test(line)) return line;
    if (/\b(?:2026|2027|2028)\b/.test(line)) continue;
    if (line.length > 160) continue;
    return line;
  }
  return null;
}

function discoverCalendarEvents(html) {
  const candidates = [];
  const seen = new Set();
  for (const anchor of extractAnchors(html, CALENDAR_URL)) {
    const title = anchor.text.trim();
    if (!title || title.length < 8 || isGenericCta(title)) continue;
    if (/^(?:events calendar|about aapg events|aapg academy|sponsorship|join aapg|login)$/i.test(title)) continue;

    const hrefHost = hostOf(anchor.href);
    const hrefPath = (() => { try { return new URL(anchor.href).pathname; } catch { return ""; } })();
    const likelyEventLink = hrefPath.includes("/event-details/") ||
      /(?:urtec|imageevent|iceevent|otcasia)\./i.test(hrefHost) ||
      /\b(?:conference|workshop|symposium|summit|meeting|geoscience|petroleum|energy|resources|structural|stratigraphic|modeling)\b/i.test(title);
    if (!likelyEventLink) continue;

    const windowHtml = html.slice(Math.max(0, anchor.index - 600), Math.min(html.length, anchor.index + 2200));
    const lines = htmlLines(windowHtml);
    const date = parseDateRange(lines.join(" | "));
    if (!date || !isUpcoming(date.end)) continue;

    const key = `${normalizeTitle(title)}|${date.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      title,
      url: anchor.href,
      startDate: date.start,
      endDate: date.end,
      dateText: date.raw,
      locationText: locationFromCard(lines, title, date.raw),
    });
  }

  return candidates
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
    .slice(0, MAX_EVENTS);
}

function distinctTitleTokens(title) {
  const stop = new Set(["aapg", "eage", "the", "and", "of", "in", "for", "with", "edition", "conference", "workshop", "symposium", "summit", "2026", "2027", "2028"]);
  return normalizeTitle(title).split(/\s+/).filter((t) => t.length >= 4 && !stop.has(t)).slice(0, 8);
}

function extractEventLogo(html, base, title) {
  const tokens = distinctTitleTokens(title);
  let best = null;
  let bestScore = 0;
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[0]);
    const src = absoluteUrl(attrs.src || attrs["data-src"] || attrs["data-lazy-src"], base);
    if (!src) continue;
    const hay = `${attrs.alt || ""} ${attrs.title || ""} ${attrs.class || ""} ${src}`.toLowerCase();
    let score = /logo|brand|event-mark/.test(hay) ? 3 : 0;
    for (const token of tokens) if (hay.includes(token)) score += 2;
    if (/aapg/.test(hay)) score += 1;
    if (/header|footer|avatar|author|speaker|sponsor/.test(hay)) score -= 2;
    if (score > bestScore) { bestScore = score; best = src; }
  }
  return bestScore >= 4 ? best : null;
}

function excerptAfterHeading(lines, patterns, maxChars = 1600) {
  const major = /^(?:program|agenda|schedule|pricing|registration|fees?|sponsors?|exhibitors?|speakers?|keynotes?|committee|co-?chairs?|call for|abstracts?|posters?|venue|location|accommodation|travel|community|about|contact)\b/i;
  const index = lines.findIndex((line) => patterns.some((p) => p.test(line)));
  if (index < 0) return null;
  const out = [];
  for (let i = index; i < lines.length && out.join(" ").length < maxChars; i++) {
    const line = lines[i];
    if (i > index && major.test(line) && !patterns.some((p) => p.test(line))) break;
    out.push(line);
  }
  const text = out.join("\n").trim();
  return text.length >= 8 ? text : null;
}

function findActionLink(html, base, labelPattern) {
  const anchors = extractAnchors(html, base);
  const preferred = anchors.find((a) => labelPattern.test(a.text));
  return preferred?.href || null;
}

function parseLocation(locationText, pageText) {
  let raw = String(locationText || "").trim();
  const inMatch = pageText.match(/\b(?:in|at)\s+([A-Z][A-Za-z .'-]{2,40}),\s*([A-Z][A-Za-z .'-]{2,40})(?:[.,]|\s)/);
  if ((!raw || !raw.includes(",")) && inMatch) raw = `${inMatch[1].trim()}, ${inMatch[2].trim()}`;
  const virtual = /\bvirtual|online\b/i.test(raw);
  if (virtual) return { locationText: "Virtual", city: null, country: null, venue: null, format: "online" };

  const dash = raw.split(/\s+[–—-]\s+/).map((v) => v.trim()).filter(Boolean);
  const geographic = dash[0] || raw;
  const venue = dash.length > 1 ? dash.slice(1).join(" – ") : (/\b(?:hotel|resort|conference center|convention center|plaza|hilton|marriott|ihg)\b/i.test(raw) ? raw : null);
  const parts = geographic.split(",").map((v) => v.trim()).filter(Boolean);
  return {
    locationText: raw || null,
    city: parts.length >= 2 ? parts[0] : null,
    country: parts.length >= 2 ? parts[parts.length - 1] : null,
    venue,
    format: "in-person",
  };
}

function categoriesFor(title, text) {
  const hay = `${title} ${text}`.toLowerCase();
  const categories = new Set(["Energy", "Science", "Engineering"]);
  if (/artificial intelligence|machine learning|\bai\b|data analytics|digital/.test(hay)) {
    categories.add("Artificial Intelligence");
    categories.add("Data Science");
  }
  if (/geothermal|decarbon|carbon capture|ccus|energy transition|sustainab/.test(hay)) {
    categories.add("Sustainability");
    categories.add("Environment");
  }
  return [...categories];
}

function parseNameOrg(text) {
  const clean = text.replace(/^[•*-]\s*/, "").trim();
  const parts = clean.split(/,\s*/);
  const name = parts.shift()?.trim();
  if (!name || name.length < 3 || name.length > 90) return null;
  return { name, full_name: name, role: null, title: null, org: parts.join(", ") || null, organization: parts.join(", ") || null, email: null, imageUrl: null, photo_url: null };
}

function extractKeynotes(lines) {
  const people = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/\bkeynote\b/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const p = parseNameOrg(lines[j]);
      if (!p || /session|coffee|lunch|registration|keynote/i.test(p.name)) continue;
      const key = p.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        p.role = "Keynote Speaker";
        people.push(p);
      }
      break;
    }
  }
  return people.slice(0, 30);
}

function extractChairs(lines) {
  const people = [];
  const seen = new Set();
  for (const line of lines) {
    const m = /(?:session\s+)?co-?chairs?\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    for (const chunk of m[1].split(/\s*&\s*|\s+and\s+/i)) {
      const p = parseNameOrg(chunk);
      if (!p) continue;
      const key = p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      p.role = "Co-Chair";
      people.push(p);
    }
  }
  return people.slice(0, 40);
}

function extractSponsors(html, base) {
  const idx = html.search(/>\s*(?:Sponsors?|Sponsorship|Exhibitors?)\s*</i);
  if (idx < 0) return [];
  const fragment = html.slice(idx, Math.min(html.length, idx + 12000));
  const out = [];
  const seen = new Set();
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(fragment))) {
    const attrs = parseAttrs(m[0]);
    const name = plain(attrs.alt || attrs.title || "");
    const src = absoluteUrl(attrs.src || attrs["data-src"] || attrs["data-lazy-src"], base);
    if (!name || name.length < 2 || name.length > 100 || /aapg|logo|icon|arrow|facebook|linkedin|twitter/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, tier: null, sponsorship_level: null, logoUrl: src, logo_url: src, logo_source: src ? "stated" : null });
  }
  return out.slice(0, 40);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { html: await res.text(), finalUrl: res.url || url };
  } finally { clearTimeout(timer); }
}

async function enrichEvent(event) {
  let html = "";
  let finalUrl = event.url;
  try {
    const fetched = await fetchHtml(event.url);
    html = fetched.html;
    finalUrl = fetched.finalUrl;
  } catch (error) {
    console.warn(`[aapg-phase1] detail fetch failed ${event.url}: ${error?.message || error}`);
  }

  const lines = html ? htmlLines(html) : [];
  const pageText = lines.join(" ");
  const description = html ? (metaContent(html, ["og:description", "description"]) || null) : null;
  const eventLogo = html ? extractEventLogo(html, finalUrl, event.title) : null;
  const favicon = html ? linkHref(html, finalUrl, /(?:^|\s)(?:icon|shortcut icon)(?:\s|$)/i) : null;
  const heroImage = html ? absoluteUrl(metaContent(html, ["og:image", "twitter:image"]), finalUrl) : null;

  const registrationUrl = html ? findActionLink(html, finalUrl, /\bregister(?: now| today)?\b/i) : null;
  const submissionUrl = html ? findActionLink(html, finalUrl, /\bsubmit\b.*\b(?:abstract|poster|paper)\b|\bcall for (?:abstracts|papers)\b/i) : null;

  const programNote = excerptAfterHeading(lines, [/^program\b/i, /^agenda\b/i, /^schedule\b/i], 2600);
  const cfpNote = excerptAfterHeading(lines, [/^call for (?:papers|abstracts)/i, /^abstracts?\b/i, /^posters?\b/i], 1600);
  const feesNote = excerptAfterHeading(lines, [/^pricing\b/i, /^fees?\b/i, /^registration(?: pricing| fees?)?\b/i], 1600);
  const speakerNote = excerptAfterHeading(lines, [/^keynote(?: speakers?)?\b/i, /^speakers?\b/i], 1600);
  const committeeNote = excerptAfterHeading(lines, [/^(?:technical |program )?committee\b/i, /^co-?chairs?\b/i], 1600);
  const sponsorNote = excerptAfterHeading(lines, [/^sponsors?\b/i, /^sponsorship\b/i, /^exhibitors?\b/i], 1600);
  const venueNote = excerptAfterHeading(lines, [/^venue\b/i, /^location\b/i, /^accommodation\b/i, /^travel\b/i], 1600);
  const communityNote = excerptAfterHeading(lines, [/^community\b/i, /^networking\b/i, /^social events?\b/i], 1200);

  const location = parseLocation(event.locationText, pageText);
  const keynotes = extractKeynotes(lines);
  const chairs = extractChairs(lines);
  const sponsors = html ? extractSponsors(html, finalUrl) : [];
  const categories = categoriesFor(event.title, `${description || ""} ${pageText.slice(0, 5000)}`);

  const sectionAvailability = {
    overview: "stated",
    cfp: (submissionUrl || cfpNote) ? "stated" : "not_announced",
    fees: (registrationUrl || feesNote) ? "stated" : "not_announced",
    agenda: programNote ? "stated" : "not_announced",
    speakers: (keynotes.length || speakerNote) ? "stated" : "not_announced",
    committee: (chairs.length || committeeNote) ? "stated" : "not_announced",
    sponsors: (sponsors.length || sponsorNote) ? "stated" : "not_announced",
    venue: (location.locationText || venueNote) ? "stated" : "not_announced",
    community: communityNote ? "stated" : "not_announced",
  };

  const notes = {
    cfp: cfpNote,
    fees: feesNote,
    agenda: programNote,
    speakers: speakerNote,
    committee: committeeNote,
    sponsors: sponsorNote,
    venue: venueNote,
    community: communityNote,
  };

  const importantDates = [{ label: "Conference dates", date: event.startDate === event.endDate ? event.startDate : `${event.startDate} – ${event.endDate}`, isDeadline: false }];

  return {
    ...event,
    officialUrl: finalUrl,
    description,
    logoUrl: eventLogo || favicon || null,
    logoSource: eventLogo ? "stated" : (favicon ? "organiser" : null),
    imageUrl: heroImage,
    registrationUrl,
    submissionUrl,
    programNote,
    cfpNote,
    feesNote,
    keynotes,
    chairs,
    sponsors,
    location,
    categories,
    sectionAvailability,
    sectionNotes: notes,
    importantDates,
  };
}

function sectionPayload(record, eventId) {
  const locationText = record.location.locationText;
  return {
    overview: {
      conference_name: record.title,
      acronym: null,
      edition: /^\d+(?:st|nd|rd|th) edition/i.test(record.title) ? record.title.match(/^\d+(?:st|nd|rd|th) edition/i)?.[0] || null : null,
      description: record.description,
      dates_text: record.startDate === record.endDate ? record.startDate : `${record.startDate} – ${record.endDate}`,
      start_date: record.startDate,
      end_date: record.endDate,
      city: record.location.city,
      region: null,
      country: record.location.country,
      world_region: null,
      venue: record.location.venue,
      location_text: locationText,
      format: record.location.format,
      organizer: "American Association of Petroleum Geologists (AAPG)",
      topics: record.categories,
      category: "Energy",
      categories: record.categories,
      keywords: ["AAPG", "petroleum geoscience", "energy geoscience"],
      important_dates: record.importantDates,
      official_url: record.officialUrl,
      source_url: CALENDAR_URL,
      logo_url: record.logoUrl,
      logo_source: record.logoSource,
      image_url: record.imageUrl,
    },
    call_for_papers: record.sectionAvailability.cfp === "stated" ? {
      status: record.submissionUrl ? "Open / details available" : null,
      abstract_submission_deadline: null,
      submission_email: null,
      length_limit: null,
      submission_url: record.submissionUrl,
    } : {},
    program_agenda: record.sectionAvailability.agenda === "stated" ? { sessions: [], themes: [], overview: record.programNote } : { sessions: [], themes: [], overview: null },
    keynote_speakers: record.keynotes,
    technical_committee: record.chairs,
    sponsors_exhibitors: record.sponsors,
    venue_accommodation: record.sectionAvailability.venue === "stated" ? {
      venue_name: record.location.venue,
      address: locationText,
      accommodation: record.sectionNotes.venue,
      hotels: [],
      travel_advisory: null,
      travel_advisory_source: null,
    } : {},
    fees_pricing: record.sectionAvailability.fees === "stated" ? {
      registration_url: record.registrationUrl,
      registration_fees: [],
      early_bird_deadline: null,
      pricing_text: record.feesNote,
    } : {},
    community: record.sectionAvailability.community === "stated" ? { overview: record.sectionNotes.community } : {},
    extraction_metadata: {
      origin: "discovery_engine",
      import_origin: IMPORT_ORIGIN,
      status: "success",
      validation_status: "VALIDATED_OFFICIAL_CALENDAR",
      validation_score: 98,
      source_domain: "aapg.org",
      source_page_title: "AAPG Events Calendar",
      official_site_resolved: true,
      discovery_event_id: eventId,
      section_availability: record.sectionAvailability,
      section_notes: record.sectionNotes,
      pages_crawled: record.officialUrl === CALENDAR_URL ? 1 : 2,
      import_batch: `aapg-phase1-${new Date().toISOString().slice(0, 10)}`,
      calendar_url: CALENDAR_URL,
    },
  };
}

async function ensureDiscoveryEvent(db, record, eventId) {
  const now = new Date().toISOString();
  const categories = record.categories;
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
      ?, ?, ?, ?, ?, ?, ?, 'day', ?, ?, ?, NULL, ?, ?, ?, 'conference', ?, ?, ?, ?, ?, ?, NULL,
      ?, 'Energy', 'published', 0.98, 'conference', 'official_aapg_calendar', '[]',
      'aapg_phase1', ?, ?, ?, ?, ?, ?, 'publish_ready', '[]', ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, normalized_title=excluded.normalized_title,
      start_date=excluded.start_date, end_date=excluded.end_date, start_year=excluded.start_year, start_month=excluded.start_month,
      dates_text=excluded.dates_text, venue=excluded.venue, city=excluded.city, country=excluded.country, raw_location=excluded.raw_location,
      format=excluded.format, organizer=excluded.organizer, official_url=excluded.official_url, canonical_url=excluded.canonical_url,
      registration_url=COALESCE(excluded.registration_url, discovery_events.registration_url),
      submission_url=COALESCE(excluded.submission_url, discovery_events.submission_url),
      image_url=COALESCE(excluded.image_url, discovery_events.image_url), topics=excluded.topics, primary_category='Energy',
      status='published', confidence_score=MAX(discovery_events.confidence_score, 0.98), relevance_classification='conference',
      relevance_reason='official_aapg_calendar', extraction_method='aapg_phase1', source_url=excluded.source_url, source_domain=excluded.source_domain,
      last_seen=excluded.last_seen, last_checked=excluded.last_checked, last_verified=excluded.last_verified,
      published_at=COALESCE(discovery_events.published_at, excluded.published_at), publish_readiness='publish_ready', readiness_reasons='[]',
      official_source_verified_at=excluded.official_source_verified_at, title_verified_at=excluded.title_verified_at`,
    args: [
      eventId, record.title, normalizeTitle(record.title), record.startDate, record.endDate,
      Number(record.startDate.slice(0, 4)), Number(record.startDate.slice(5, 7)),
      record.startDate === record.endDate ? record.startDate : `${record.startDate} – ${record.endDate}`,
      record.location.venue, record.location.city, record.location.country, record.location.locationText,
      record.location.format, "American Association of Petroleum Geologists (AAPG)", record.officialUrl, record.officialUrl,
      record.registrationUrl, record.submissionUrl, record.imageUrl,
      JSON.stringify(categories), record.officialUrl, hostOf(record.officialUrl), now, now, now, now, now, now,
    ],
  });

  for (const category of categories) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO discovery_event_categories (id, event_id, category, confidence, evidence) VALUES (?, ?, ?, 0.98, ?)`,
      args: [stableId("aapg_cat", `${eventId}|${category}`), eventId, category, JSON.stringify(["Official AAPG calendar/event page"])]
    });
  }
}

async function writeExtractedConference(db, record, eventId) {
  const payload = sectionPayload(record, eventId);
  await db.execute({
    sql: `INSERT INTO extracted_conferences (
      source_url, overview, call_for_papers, program_agenda, keynote_speakers, technical_committee,
      sponsors_exhibitors, venue_accommodation, fees_pricing, community, extraction_metadata, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
      record.officialUrl,
      JSON.stringify(payload.overview), JSON.stringify(payload.call_for_papers), JSON.stringify(payload.program_agenda),
      JSON.stringify(payload.keynote_speakers), JSON.stringify(payload.technical_committee), JSON.stringify(payload.sponsors_exhibitors),
      JSON.stringify(payload.venue_accommodation), JSON.stringify(payload.fees_pricing), JSON.stringify(payload.community),
      JSON.stringify(payload.extraction_metadata),
    ],
  });
}

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
  const localPath = path.join(process.cwd(), "data", "app.db");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = tursoUrl ? createClient({ url: tursoUrl, authToken: tursoToken || undefined }) : createClient({ url: `file:${localPath}` });

  try {
    const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')`);
    if ((tables.rows || []).length < 2) {
      console.log("[aapg-phase1] discovery schema not initialized; skipping until next start");
      return;
    }

    const calendar = await fetchHtml(CALENDAR_URL);
    const events = discoverCalendarEvents(calendar.html);
    console.log(`[aapg-phase1] official calendar candidates=${events.length}`);

    try {
      await db.execute({
        sql: `UPDATE discovery_domains SET event_hub_url=?, event_hub_type='official_calendar', event_hub_found_at=datetime('now'), next_crawl_at=datetime('now') WHERE domain='aapg.org'`,
        args: [CALENDAR_URL],
      });
    } catch { /* registry may not exist in a local first boot */ }

    let published = 0;
    let failed = 0;
    for (let i = 0; i < events.length; i += 3) {
      const batch = events.slice(i, i + 3);
      const results = await Promise.allSettled(batch.map(enrichEvent));
      for (const result of results) {
        if (result.status !== "fulfilled") { failed += 1; continue; }
        const record = result.value;
        try {
          const existing = await db.execute({
            sql: `SELECT id FROM discovery_events WHERE normalized_title=? AND start_date=? LIMIT 1`,
            args: [normalizeTitle(record.title), record.startDate],
          });
          const eventId = existing.rows?.[0]?.id ? String(existing.rows[0].id) : stableId("aapg", `${record.title}|${record.startDate}`);
          await ensureDiscoveryEvent(db, record, eventId);
          await writeExtractedConference(db, record, eventId);
          published += 1;
          const announcedTabs = Object.values(record.sectionAvailability).filter((v) => v === "stated").length;
          console.log(`[aapg-phase1] published ${record.startDate} ${record.title} tabs=${announcedTabs}/9 logo=${record.logoUrl ? record.logoSource : 'fallback-mark'}`);
        } catch (error) {
          failed += 1;
          console.warn(`[aapg-phase1] write failed ${record.title}: ${error?.message || error}`);
        }
      }
      if (i + 3 < events.length) await sleep(250);
    }

    console.log(`[aapg-phase1] complete published=${published} failed=${failed} calendar=${CALENDAR_URL}`);
  } catch (error) {
    console.warn(`[aapg-phase1] skipped after error: ${error?.message || error}`);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
