// Sitemap discovery: ask a site for its own index of itself.
//
// A sitemap is the only free, complete, permission-granted way to learn what pages a site has.
// It reaches the conference pages nothing links to from the front page — an archived programme, a
// separate committee page, a regional event buried three levels down — which is exactly the
// content a link-following crawl never sees.
//
// Nested sitemap indexes are followed. The URL-prioritisation words below are *signals*, not
// requirements: a URL without any of them still enters the candidate list, just lower down,
// because plenty of real conference pages are at /2027/ or /annual/ and say nothing else.

import { discoveryFetch, type UrlGuard } from "./httpClient";
import type { DiscoveryCandidate } from "./types";

/** Strong signals: a URL containing one of these is very likely to be about an event. */
const STRONG_EVENT_TERMS = [
  "conference", "conferences", "congress", "symposium", "symposia", "summit", "summits",
  "convention", "annual-meeting", "annualmeeting", "scientific-meeting", "colloquium",
];
/** Weaker signals: real, but they also appear on listings, news posts and calendars. */
const WEAK_EVENT_TERMS = [
  "event", "events", "meeting", "meetings", "workshop", "workshops", "forum", "forums",
  "expo", "exhibition", "seminar", "webinar", "session", "programme", "program",
];
/** Paths that are almost never one conference's page. Demoted, never excluded outright. */
const NEGATIVE_TERMS = [
  "/news/", "/blog/", "/press", "/tag/", "/tags/", "/category/", "/categories/", "/author/",
  "/login", "/signin", "/register-account", "/privacy", "/terms", "/cookie", "/sitemap",
  "/search", "/feed", "/rss", "/archive/", "/past-", "/jobs", "/careers", "/shop", "/cart",
];

const NON_PAGE_EXT_RE = /\.(jpe?g|png|gif|svg|webp|ico|css|js|zip|pptx?|xlsx?|docx?|mp4|mp3|avi|woff2?|ttf)(\?|#|$)/i;

export interface SitemapEntry {
  url: string;
  lastModified: string | null;
}

export interface SitemapCrawlResult {
  /** Sitemap documents that were actually read. */
  sitemapsRead: string[];
  /** Sitemap URLs that were declared but could not be read. */
  sitemapsFailed: string[];
  entries: SitemapEntry[];
}

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const URL_BLOCK_RE = /<url\b[\s\S]*?<\/url>/gi;
const SITEMAP_BLOCK_RE = /<sitemap\b[\s\S]*?<\/sitemap>/gi;
const LASTMOD_RE = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function firstLoc(block: string): string | null {
  LOC_RE.lastIndex = 0;
  const match = LOC_RE.exec(block);
  return match ? decodeXmlEntities(match[1]) : null;
}

/** Splits one sitemap document into its child sitemaps and its page URLs. */
export function parseSitemapXml(xml: string): { isIndex: boolean; children: string[]; entries: SitemapEntry[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const children: string[] = [];
  const entries: SitemapEntry[] = [];

  if (isIndex) {
    for (const block of xml.match(SITEMAP_BLOCK_RE) || []) {
      const loc = firstLoc(block);
      if (loc) children.push(loc);
    }
    // Some sitemap indexes omit the <sitemap> wrapper; fall back to bare <loc> entries.
    if (children.length === 0) {
      LOC_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = LOC_RE.exec(xml))) children.push(decodeXmlEntities(match[1]));
    }
    return { isIndex, children, entries };
  }

  const blocks = xml.match(URL_BLOCK_RE) || [];
  if (blocks.length > 0) {
    for (const block of blocks) {
      const loc = firstLoc(block);
      if (!loc) continue;
      const lastmod = LASTMOD_RE.exec(block);
      entries.push({ url: loc, lastModified: lastmod ? lastmod[1] : null });
    }
  } else {
    LOC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LOC_RE.exec(xml))) entries.push({ url: decodeXmlEntities(match[1]), lastModified: null });
  }
  return { isIndex, children, entries };
}

export interface SitemapDiscoveryOptions {
  /** Sitemaps robots.txt declared; tried before the conventional locations. */
  declaredSitemaps?: string[];
  maxSitemapDocuments?: number;
  maxEntries?: number;
  /** Keep to this host. Cross-host sitemap entries are dropped, not followed. */
  restrictToHost?: boolean;
  urlGuard?: UrlGuard;
  onSitemapRead?: (url: string, entryCount: number) => void;
  onSitemapFailed?: (url: string, reason: string) => void;
}

export async function discoverSitemapUrls(
  origin: string,
  options: SitemapDiscoveryOptions = {}
): Promise<SitemapCrawlResult> {
  const maxDocuments = options.maxSitemapDocuments ?? 25;
  const maxEntries = options.maxEntries ?? 5000;
  const restrictToHost = options.restrictToHost ?? true;

  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return { sitemapsRead: [], sitemapsFailed: [], entries: [] };
  }

  const base = origin.replace(/\/$/, "");
  const queue: string[] = [
    ...(options.declaredSitemaps || []),
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap-index.xml`,
    `${base}/sitemap/sitemap.xml`,
  ];

  const requested = new Set<string>();
  const seenEntries = new Set<string>();
  const result: SitemapCrawlResult = { sitemapsRead: [], sitemapsFailed: [], entries: [] };

  while (queue.length > 0 && requested.size < maxDocuments && result.entries.length < maxEntries) {
    const sitemapUrl = queue.shift()!;
    if (requested.has(sitemapUrl)) continue;
    requested.add(sitemapUrl);

    const response = await discoveryFetch(sitemapUrl, {
      accept: "application/xml,text/xml,*/*;q=0.8",
      urlGuard: options.urlGuard,
    });
    if (!response.ok || !response.body) {
      result.sitemapsFailed.push(sitemapUrl);
      options.onSitemapFailed?.(sitemapUrl, response.error || `http_${response.status}`);
      continue;
    }
    if (!/<(?:urlset|sitemapindex)[\s>]/i.test(response.body)) {
      // A 200 that is really an HTML "not found" page is a failure, not an empty sitemap.
      result.sitemapsFailed.push(sitemapUrl);
      options.onSitemapFailed?.(sitemapUrl, "not_a_sitemap");
      continue;
    }

    const parsed = parseSitemapXml(response.body);
    let added = 0;
    for (const child of parsed.children) {
      if (requested.size + queue.length >= maxDocuments) break;
      try {
        if (restrictToHost && new URL(child).hostname.toLowerCase() !== host) continue;
      } catch {
        continue;
      }
      if (!requested.has(child)) queue.push(child);
    }
    for (const entry of parsed.entries) {
      if (result.entries.length >= maxEntries) break;
      let absolute: string;
      try {
        const parsedUrl = new URL(entry.url);
        if (restrictToHost && parsedUrl.hostname.toLowerCase() !== host) continue;
        absolute = parsedUrl.href;
      } catch {
        continue;
      }
      if (NON_PAGE_EXT_RE.test(absolute) || seenEntries.has(absolute)) continue;
      seenEntries.add(absolute);
      result.entries.push({ url: absolute, lastModified: entry.lastModified });
      added += 1;
    }
    result.sitemapsRead.push(sitemapUrl);
    options.onSitemapRead?.(sitemapUrl, added);
  }

  return result;
}

/** 0–1 score for how likely a URL is to be one conference's page, from the URL alone. */
export function scoreCandidateUrl(url: string, targetYears: number[]): { score: number; reason: string } {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return { score: 0, reason: "unparseable_url" };
  }

  const reasons: string[] = [];
  let score = 0.2; // every readable URL starts as a possibility, per section 5

  const strong = STRONG_EVENT_TERMS.find((term) => path.includes(term));
  if (strong) {
    score += 0.35;
    reasons.push(`path names "${strong}"`);
  } else {
    const weak = WEAK_EVENT_TERMS.find((term) => path.includes(term));
    if (weak) {
      score += 0.2;
      reasons.push(`path names "${weak}"`);
    }
  }

  const yearMatch = path.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    if (targetYears.includes(year)) {
      score += 0.3;
      reasons.push(`path names target year ${year}`);
    } else if (year < Math.min(...targetYears)) {
      score -= 0.25;
      reasons.push(`path names past year ${year}`);
    }
  }

  const negative = NEGATIVE_TERMS.find((term) => path.includes(term));
  if (negative) {
    score -= 0.3;
    reasons.push(`path looks like "${negative.replace(/\//g, "")}"`);
  }

  // A very deep path is usually an article about an event rather than the event's own page.
  const depth = path.split("/").filter(Boolean).length;
  if (depth > 6) {
    score -= 0.1;
    reasons.push("deeply nested path");
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    reason: reasons.length > 0 ? reasons.join("; ") : "no url signals",
  };
}

export function entriesToCandidates(
  entries: SitemapEntry[],
  domain: string,
  provider: string,
  targetYears: number[]
): DiscoveryCandidate[] {
  return entries
    .map((entry) => {
      const { score, reason } = scoreCandidateUrl(entry.url, targetYears);
      return {
        url: entry.url,
        sourceDomain: domain,
        provider,
        priority: score,
        reason,
        hints: { lastModified: entry.lastModified },
      } satisfies DiscoveryCandidate;
    })
    .sort((left, right) => right.priority - left.priority);
}
