import { Router } from "express";
import { asyncHandler } from "./asyncHandler";

export interface LiveSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: string | null;
  favicon: string | null;
}

interface CacheEntry {
  data: LiveSearchResult[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — keeps us well within Brave's free 2,000 queries/month quota
const cache = new Map<string, CacheEntry>();

function isConfigured() {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}

// Brave highlights matched keywords with <strong> tags and HTML-escapes entities in the
// title/description fields — strip that markup so plain text reaches the client.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function stripHtml(text: string): string {
  return decodeHtmlEntities(text.replace(/<[^>]*>/g, ""));
}

// Nudges the underlying web search toward actual conference/event listings rather than
// generic informational pages about the topic — this panel is "search the web for a
// conference we haven't added yet", not a general-purpose search box. Also nudges toward
// current/upcoming editions by adding the current year when the query doesn't already name one.
const CONFERENCE_KEYWORDS = /\b(conference|summit|symposium|convention|congress|workshop|expo)\b/i;
const YEAR_IN_QUERY_RE = /\b20\d{2}\b/;
function toConferenceQuery(query: string): string {
  const withKeyword = CONFERENCE_KEYWORDS.test(query) ? query : `${query} conference`;
  return YEAR_IN_QUERY_RE.test(withKeyword) ? withKeyword : `${withKeyword} ${new Date().getFullYear()}`;
}

// Drops generic "list of conferences" roundup/directory pages — a page enumerating many
// events isn't itself a single real conference, which is what a search result here is meant
// to represent. Plural "conferences" is the key tell: a real single event is named
// "... Conference" (singular) — "Conferences" (plural) almost always means a directory/roundup
// of many events, e.g. "Upcoming Technology Conferences in USA 2026", "Top IT Conferences in
// the United States", "The Best IT/Tech Conferences & Events of 2026", or "Top Ten Tech
// Conferences 2026". The "top"/"best" clause allows an arbitrary gap before "conferences" since
// real titles interpose all sorts of words/punctuation ("Best IT/Tech Conferences", "Top Ten
// Tech Conferences") rather than a bare number.
const LISTICLE_RE = new RegExp(
  [
    "\\b(top|best)\\b[\\s\\S]{0,40}?\\bconferences\\b",
    "\\d+\\s+conferences\\b",
    "\\blist of\\b",
    "\\bround[\\s-]?up\\b",
    "\\bconferences?\\s+to\\s+attend\\b",
    "\\bupcoming conferences\\b",
    "\\bconferences\\s+in\\b",
    "\\bconferences\\s+20\\d{2}\\s*[\\/\\-]\\s*20\\d{2}\\b",
  ].join("|"),
  "i"
);

// Domains that are themselves conference directories/aggregators rather than a single event's
// own site — every result from these hosts is a listing page, regardless of title wording.
const LISTICLE_DOMAINS = new Set([
  "10times.com",
  "allconferencealert.com",
  "allconferences.com",
  "conferencealerts.com",
  "clocate.com",
  "conferenceindex.org",
  "dev.events",
  "eventseye.com",
  "conferenceseries.com",
  "myconferencetimes.com",
  "techconferences.co",
]);

function looksLikeListicle(title: string, snippet: string, displayLink: string): boolean {
  if (LISTICLE_RE.test(title) || LISTICLE_RE.test(snippet)) return true;
  const host = displayLink.toLowerCase().replace(/^www\./, "");
  return LISTICLE_DOMAINS.has(host);
}

// Drops results that only mention a past year (e.g. a leftover page for a prior edition) and
// never mention the current or a future year. Never excludes purely for lacking a year at all —
// plenty of legitimate current pages just don't put one in the title/snippet.
const ALL_YEARS_RE = /\b20\d{2}\b/g;
function looksOutdated(title: string, snippet: string): boolean {
  const text = `${title} ${snippet}`;
  const years = Array.from(text.matchAll(ALL_YEARS_RE), (m) => parseInt(m[0], 10));
  if (years.length === 0) return false;
  const currentYear = new Date().getFullYear();
  const hasCurrentOrFuture = years.some((y) => y >= currentYear);
  const hasPast = years.some((y) => y < currentYear);
  return hasPast && !hasCurrentOrFuture;
}

async function searchConferences(query: string): Promise<LiveSearchResult[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", toConferenceQuery(query));
  url.searchParams.set("count", "20");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
    },
  });
  const rawText = await res.text();
  let body: any = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`Live search failed (unexpected response, HTTP ${res.status}). Please try again.`);
  }

  if (!res.ok) {
    const message = body?.error?.detail || body?.error?.message || `Brave Search API error (${res.status})`;
    throw new Error(message);
  }

  const items: any[] = body.web?.results || [];
  const results: LiveSearchResult[] = items
    .map((item) => ({
      title: stripHtml(item.title || ""),
      link: item.url || "",
      snippet: stripHtml(item.description || ""),
      displayLink: item.meta_url?.hostname || item.profile?.name || "",
      thumbnail: item.thumbnail?.src || null,
      favicon: item.meta_url?.favicon || item.profile?.img || null,
    }))
    .filter((r) => !looksLikeListicle(r.title, r.snippet, r.displayLink) && !looksOutdated(r.title, r.snippet));

  cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
  return results;
}

export const braveSearchRouter = Router();

braveSearchRouter.get(
  "/conferences",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Provide a search query of at least 2 characters." });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        error: "Live search is not configured on the server. Set BRAVE_SEARCH_API_KEY.",
      });
    }

    try {
      const results = await searchConferences(query);
      res.json({ results });
    } catch (error: any) {
      console.error("Brave Search error:", error);
      res.status(502).json({ error: error.message || "Live search failed. Please try again." });
    }
  })
);
