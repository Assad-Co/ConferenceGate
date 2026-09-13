import { findSectionPages } from "./deepSections";
import { findFeePages } from "./feePages";
import { decodeEntities } from "./html";
import { candidateUrlBelongsToEvent, pageBelongsToEvent, type EventIdentity } from "./eventIdentity";

export interface SweepPage { html: string; finalUrl: string }
export interface RejectedPage { url: string; stage: string; reason: string }
const SECTION_PATH = /(?:^|[\/_.-])(speakers?|keynotes?|program(?:me)?|agenda|committee|chairs?|sponsors?|partners?|registration|register|fees?|rates?|pricing)(?:$|[\/_.-])/i;

/** Never climb from an event's directory into a society's site-wide pages. */
export function conventionalSectionUrls(identity: EventIdentity): string[] {
  const base = new URL(identity.officialUrl);
  base.search = ""; base.hash = "";
  base.pathname = identity.pathPrefix;
  return ["speakers", "programme", "program", "agenda", "committee", "registration", "fees", "sponsors"]
    .map((suffix) => new URL(suffix, base).href);
}

function canonical(raw: string): string {
  const url = new URL(raw); url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

function sameSite(identity: EventIdentity, raw: string): boolean {
  try {
    const url = new URL(raw), official = new URL(identity.officialUrl);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
      url.hostname.replace(/^www\./, "") === official.hostname.replace(/^www\./, "") &&
      url.port === official.port;
  } catch { return false; }
}

export function sweepUrlVerdict(identity: EventIdentity, raw: string) {
  if (!sameSite(identity, raw)) return { ok: false, reason: "different_host_or_invalid_url" };
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(raw).pathname); }
  catch { return { ok: false, reason: "unparseable_url" }; }
  const years = pathname.match(/\b20\d{2}\b/g)?.map(Number) ?? [];
  if (identity.year && years.length && !years.includes(identity.year)) return { ok: false, reason: "url_states_other_year" };
  return candidateUrlBelongsToEvent(identity, raw);
}

/** Bounded sitemap index traversal. Sitemap fetches are always free and never use Firecrawl. */
export async function sitemapSectionUrls(identity: EventIdentity, readXml: (url: string) => Promise<string>): Promise<string[]> {
  const origin = new URL(identity.officialUrl).origin;
  const pending = [...new Set([new URL("sitemap.xml", origin).href,
    new URL(`${identity.pathPrefix}sitemap.xml`, origin).href])];
  const visited = new Set<string>(), found = new Set<string>();
  while (pending.length && visited.size < 6 && found.size < 40) {
    const url = pending.shift()!;
    if (visited.has(url) || !sameSite(identity, url)) continue;
    visited.add(url);
    try {
      const xml = await readXml(url);
      if (xml.length > 2_000_000) continue;
      const index = /<(?:\w+:)?sitemapindex\b/i.test(xml);
      const locations = [...xml.matchAll(/<(?:\w+:)?loc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?loc>/gi)].slice(0, 10000);
      for (const match of locations) {
        const raw = decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
        let next: string;
        try { next = new URL(raw, url).href; } catch { continue; }
        if (!sameSite(identity, next)) continue;
        if (index) { if (pending.length < 30 && !visited.has(next)) pending.push(next); }
        else if (SECTION_PATH.test(new URL(next).pathname) && sweepUrlVerdict(identity, next).ok) {
          found.add(next);
          if (found.size >= 40) break;
        }
      }
    } catch { /* optional discovery source */ }
  }
  return [...found];
}

/** Linked pages have priority over sitemap entries, which have priority over guesses. */
export async function crawlSweepPages(options: {
  identity: EventIdentity; home: SweepPage;
  readPage: (url: string, guessed: boolean) => Promise<SweepPage>;
  readXml: (url: string) => Promise<string>;
  maxPages?: number;
}): Promise<{ pages: SweepPage[]; rejected: RejectedPage[] }> {
  const { identity, home, readPage, readXml } = options;
  const pages: SweepPage[] = [], rejected: RejectedPage[] = [];
  const pending: Array<{ url: string; depth: number; guessed: boolean; priority: number }> = [];
  const queued = new Set<string>(), visited = new Set<string>();
  const reject = (url: string, stage: string, reason: string) => rejected.push({ url, stage, reason });
  const enqueue = (url: string, depth: number, guessed: boolean, priority: number) => {
    let key: string;
    try { key = canonical(url); } catch { return; }
    if (queued.has(key) || visited.has(key)) return;
    const verdict = sweepUrlVerdict(identity, url);
    if (!verdict.ok) { reject(url, "candidate", verdict.reason); return; }
    queued.add(key); pending.push({ url, depth, guessed, priority });
  };
  const links = (page: SweepPage, depth: number) => {
    for (const candidate of findSectionPages(page.html, page.finalUrl, { perSection: 3, sections: ["program", "speakers", "committee", "sponsors"] })) enqueue(candidate.url, depth, false, 0);
    for (const url of findFeePages(page.html, page.finalUrl, 4)) enqueue(url, depth, false, 0);
  };
  const homeVerdict = sweepUrlVerdict(identity, home.finalUrl);
  const homePageVerdict = pageBelongsToEvent(identity, home.finalUrl, home.html);
  if (!homeVerdict.ok || !homePageVerdict.ok) {
    reject(home.finalUrl, "home", !homeVerdict.ok ? homeVerdict.reason : homePageVerdict.reason);
    return { pages, rejected };
  }
  visited.add(canonical(home.finalUrl)); pages.push(home); links(home, 1);
  for (const url of await sitemapSectionUrls(identity, readXml)) enqueue(url, 1, false, 1);
  for (const url of conventionalSectionUrls(identity)) enqueue(url, 1, true, 2);
  let attempts = 0;
  while (pending.length && attempts < (options.maxPages ?? 24)) {
    pending.sort((a, b) => a.priority - b.priority || a.depth - b.depth);
    const next = pending.shift()!;
    const key = canonical(next.url);
    if (visited.has(key)) continue;
    visited.add(key); attempts++;
    try {
      const page = await readPage(next.url, next.guessed);
      const urlVerdict = sweepUrlVerdict(identity, page.finalUrl);
      const pageVerdict = pageBelongsToEvent(identity, page.finalUrl, page.html);
      if (!urlVerdict.ok || !pageVerdict.ok) {
        reject(page.finalUrl, "page", !urlVerdict.ok ? urlVerdict.reason : pageVerdict.reason); continue;
      }
      const finalKey = canonical(page.finalUrl);
      if (finalKey !== key && visited.has(finalKey)) continue;
      visited.add(finalKey); pages.push(page);
      if (next.depth < 2) links(page, next.depth + 1);
    } catch (error) { reject(next.url, "fetch", (error as Error).message); }
  }
  return { pages, rejected };
}
