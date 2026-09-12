#!/usr/bin/env node
/**
 * Find each conference's real logo and banner, and admit only the rows that earn it.
 *
 * This does the part that cannot be done from a sandbox with no outbound network: it fetches each
 * event's own page, reads the images the page actually declares, checks that each candidate really
 * is an image, and writes the rows that pass. Run it anywhere with ordinary internet access:
 *
 *   node tools/enrich-conference-images.mjs <input.csv> [output.csv]
 *
 * Nothing is guessed. A URL is only kept after a HEAD (or ranged GET) comes back with an
 * `image/*` content type, so a path that 404s is never written into the file.
 */
import { readFile, writeFile } from "node:fs/promises";

const [, , INPUT, OUTPUT = "ConferenceGate_AI_FINAL_CLAUDE_ENRICHED.csv"] = process.argv;
if (!INPUT) {
  console.error("usage: node tools/enrich-conference-images.mjs <input.csv> [output.csv]");
  process.exit(1);
}

const COLUMNS = [
  "conference_name", "start_date", "end_date", "city", "country", "venue", "accommodation",
  "organizer", "overview", "official_url", "source_url", "call_for_papers", "cfp_deadline",
  "cfp_url", "fees_and_pricing", "registration_url", "program_agenda", "keynote_speakers",
  "technical_committee", "sponsors", "logo_url", "banner_url",
];

const TABS = [
  ["Overview", "overview"], ["Call for Papers", "call_for_papers"],
  ["Fees & Pricing", "fees_and_pricing"], ["Program Agenda", "program_agenda"],
  ["Keynote Speakers", "keynote_speakers"], ["Technical Committee", "technical_committee"],
  ["Sponsors", "sponsors"], ["Venue", "venue"], ["Accommodation", "accommodation"],
];

const FILLER = /^(?:|-|—|n\/?a|tbd|tba|none|null|not\s+(?:yet\s+)?announced|not\s+announced|not\s+(?:yet\s+)?published|to\s+be\s+(?:announced|confirmed|determined)|see\s+(?:the\s+)?website|see\s+official\s+site|refer\s+to\s+website|check\s+website|available\s+on\s+(?:the\s+)?website|coming\s+soon|details\s+(?:to\s+follow|soon)|unknown|not\s+specified|not\s+available|pending)\.?$/i;

/** Hosts that render somebody else's icon rather than publishing their own. */
const ICON_SERVICE = /(?:^|\.)(?:google\.com|gstatic\.com|duckduckgo\.com|clearbit\.com|logo\.dev|besticon[^/]*)$/i;
/** Hosts that are not where a production asset lives. */
const NON_PRODUCTION = /(?:^|\.)(?:staging|stage|test|dev|preview|sandbox|demo|ifdemo)[.-]|\.(?:local|test|invalid)$/i;

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const q = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

// ---------- network ----------
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
async function getText(url, ms = 20000) {
  const stop = AbortSignal.timeout(ms);
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: stop, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error(`not html: ${type}`);
  return { html: await res.text(), finalUrl: res.url };
}

/** Whether a URL really serves an image. This is what makes "no guessed paths" enforceable. */
const imageChecks = new Map();
async function isRealImage(url) {
  if (imageChecks.has(url)) return imageChecks.get(url);
  const verdict = await (async () => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return false;
      if (ICON_SERVICE.test(u.hostname) || NON_PRODUCTION.test(u.hostname)) return false;
      let res = await fetch(url, { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!res.ok || !/^image\//i.test(res.headers.get("content-type") ?? "")) {
        // Some CDNs refuse HEAD; ask for the first byte instead.
        res = await fetch(url, { headers: { "user-agent": UA, range: "bytes=0-511" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
        if (!res.ok) return false;
      }
      return /^image\//i.test(res.headers.get("content-type") ?? "");
    } catch { return false; }
  })();
  imageChecks.set(url, verdict);
  return verdict;
}

// ---------- extraction ----------
const abs = (src, base) => { try { return new URL(src, base).toString(); } catch { return null; } };
const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;

function metaContent(html, keys) {
  const found = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (keys.includes(key)) { const c = attr(tag, "content"); if (c) found.push(c); }
  }
  return found;
}

/** Every image the page declares, in document order, with the attributes that hint at its role. */
function imagesIn(html, base) {
  const out = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src") ?? attr(tag, "data-src") ?? attr(tag, "data-lazy-src");
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    const hint = `${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""} ${src ?? ""}`.toLowerCase();
    const widest = srcset
      ? srcset.split(",").map((p) => p.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] ?? "0") - parseInt(a[1] ?? "0"))[0]?.[0]
      : null;
    for (const candidate of [widest, src]) {
      const url = candidate && abs(candidate, base);
      if (url) out.push({ url, hint });
    }
  }
  for (const tag of html.match(/<source\b[^>]*>/gi) ?? []) {
    const set = attr(tag, "srcset");
    const first = set?.split(",")[0]?.trim().split(/\s+/)[0];
    const url = first && abs(first, base);
    if (url) out.push({ url, hint: (attr(tag, "media") ?? "").toLowerCase() });
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) {
    const url = abs(m[2], base);
    if (url) out.push({ url, hint: "background hero" });
  }
  for (const tag of html.match(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi) ?? []) {
    const url = attr(tag, "href") && abs(attr(tag, "href"), base);
    if (url) out.push({ url, hint: "icon favicon" });
  }
  return out;
}

/** Links worth a second fetch: the kits organisers hide their assets in. */
function kitLinks(html, base) {
  const wanted = /media[-\s]?kit|press[-\s]?kit|brand(?:ing)?[-\s]?kit|marketing[-\s]?kit|exhibitor[-\s]?kit|logos?\b|brand\b|press\b|media\b|about\b/i;
  const links = new Set();
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, "href");
    if (!href) continue;
    const text = `${href} ${attr(tag, "title") ?? ""}`;
    if (!wanted.test(text)) continue;
    const url = abs(href, base);
    if (!url) continue;
    try { if (new URL(url).hostname !== new URL(base).hostname) continue; } catch { continue; }
    if (/\.(pdf|zip|docx?|pptx?)$/i.test(url)) continue;
    links.add(url);
  }
  return [...links].slice(0, 4);
}

const LOGO_HINT = /logo|brand|wordmark|identity/i;
const WHITE_ONLY = /white|reverse|reversed|light[-_]?(?:version|bg)|knockout|mono[-_]?white/i;
const BANNER_HINT = /banner|hero|header|masthead|cover|splash|key[-_]?visual|og[-_]?image|share/i;
const NOISE = /sponsor|partner|exhibitor|avatar|speaker|headshot|profile|icon-|favicon|placeholder|spinner|loader|pixel|tracking|1x1|blank/i;

async function pickImages(pages) {
  const all = [];
  for (const { html, url } of pages) {
    for (const c of metaContent(html, ["og:image", "og:image:secure_url"])) { const u = abs(c, url); if (u) all.push({ url: u, hint: "og:image", rank: "og" }); }
    for (const c of metaContent(html, ["twitter:image", "twitter:image:src"])) { const u = abs(c, url); if (u) all.push({ url: u, hint: "twitter:image", rank: "tw" }); }
    for (const img of imagesIn(html, url)) all.push({ ...img, rank: "img" });
  }
  const seen = new Set();
  const unique = all.filter((c) => !seen.has(c.url) && seen.add(c.url) && !NOISE.test(c.hint) && !NOISE.test(c.url));

  // Logo: an asset that says it is one, colour before white, then any brand-looking image.
  const logoOrder = [
    (c) => LOGO_HINT.test(c.hint + c.url) && !WHITE_ONLY.test(c.url) && !/favicon|icon/i.test(c.url),
    (c) => LOGO_HINT.test(c.hint + c.url) && !/favicon/i.test(c.url),
    (c) => /apple-touch-icon/i.test(c.url),
  ];
  // Banner: the page's declared share image first, then anything hero-shaped.
  const bannerOrder = [
    (c) => BANNER_HINT.test(c.hint + c.url) && c.rank === "img",
    (c) => c.rank === "og",
    (c) => c.rank === "tw",
    (c) => /\.(jpe?g|png|webp|avif)$/i.test(c.url),
  ];

  const firstReal = async (tests) => {
    for (const test of tests) {
      for (const c of unique.filter(test)) if (await isRealImage(c.url)) return c.url;
    }
    return "";
  };
  const logo = await firstReal(logoOrder);
  const banner = await firstReal(bannerOrder.map((t) => (c) => t(c) && c.url !== logo));
  return { logo, banner };
}

// ---------- run ----------
const rows = parseCsv(await readFile(INPUT, "utf8"));
const header = rows[0].map((h) => h.trim());
const body = rows.slice(1).filter((r) => r.some((c) => (c ?? "").trim()));
const at = (n) => header.indexOf(n);
const get = (r, n) => (at(n) >= 0 ? (r[at(n)] ?? "").trim() : "");

const substantive = (v) => {
  const t = (v ?? "").trim();
  if (!t || FILLER.test(t)) return false;
  if (/^https?:\/\/\S+$/i.test(t)) return false;
  return t.replace(/[^a-z0-9]/gi, "").length >= 12;
};

const today = new Date().toISOString().slice(0, 10);
const stats = { input: body.length, past: 0, duplicates: 0, lowTabs: 0, noLogo: 0, noBanner: 0, unreachable: 0 };

const upcoming = body.filter((r) => { const d = get(r, "start_date"); const ok = !d || d >= today; if (!ok) stats.past += 1; return ok; });
const byIdentity = new Map();
for (const r of upcoming) {
  const key = `${get(r, "conference_name").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(19|20)\d\d\b/g, "").trim()}|${get(r, "start_date")}`;
  if (byIdentity.has(key)) { stats.duplicates += 1; continue; }
  byIdentity.set(key, r);
}

const accepted = [];
const distribution = { 7: 0, 8: 0, 9: 0 };
let index = 0;
for (const row of byIdentity.values()) {
  index += 1;
  const name = get(row, "conference_name");
  const score = TABS.filter(([, col]) => substantive(get(row, col))).length;
  if (score < 7) { stats.lowTabs += 1; console.log(`[${index}] ${score}/9  SKIP  ${name}`); continue; }

  let logo = get(row, "logo_url");
  let banner = get(row, "banner_url");
  if (!(logo && await isRealImage(logo))) logo = "";
  if (!(banner && await isRealImage(banner))) banner = "";

  const site = get(row, "official_url");
  if ((!logo || !banner) && /^https?:\/\//i.test(site)) {
    try {
      const home = await getText(site);
      const pages = [{ html: home.html, url: home.finalUrl }];
      for (const link of kitLinks(home.html, home.finalUrl)) {
        try { const kit = await getText(link); pages.push({ html: kit.html, url: kit.finalUrl }); } catch { /* a kit page that will not load is not a failure */ }
      }
      const found = await pickImages(pages);
      logo ||= found.logo;
      banner ||= found.banner;
    } catch (error) {
      stats.unreachable += 1;
      console.log(`[${index}] ${score}/9  UNREACHABLE ${site} — ${error.message}`);
    }
  }

  if (!logo) { stats.noLogo += 1; console.log(`[${index}] ${score}/9  NO LOGO    ${name}`); continue; }
  if (!banner) { stats.noBanner += 1; console.log(`[${index}] ${score}/9  NO BANNER  ${name}`); continue; }

  const out = {};
  for (const col of COLUMNS) out[col] = get(row, col);
  out.logo_url = logo;
  out.banner_url = banner;
  accepted.push(out);
  distribution[score] += 1;
  console.log(`[${index}] ${score}/9  ACCEPT ${name}`);
}

await writeFile(OUTPUT, [COLUMNS.join(","), ...accepted.map((r) => COLUMNS.map((c) => q(r[c])).join(","))].join("\n") + "\n");

console.log(`\n================ REPORT ================`);
console.log(`input rows              ${stats.input}`);
console.log(`past events removed     ${stats.past}`);
console.log(`duplicates removed      ${stats.duplicates}`);
console.log(`removed <7/9 tabs       ${stats.lowTabs}`);
console.log(`removed missing logo    ${stats.noLogo}`);
console.log(`removed missing banner  ${stats.noBanner}`);
console.log(`  (sites unreachable    ${stats.unreachable})`);
console.log(`FINAL ACCEPTED          ${accepted.length}`);
console.log(`   9/9  ${distribution[9]}`);
console.log(`   8/9  ${distribution[8]}`);
console.log(`   7/9  ${distribution[7]}`);
console.log(`written -> ${OUTPUT}`);
