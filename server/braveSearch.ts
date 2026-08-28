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

// Drops any page that reads as a directory/roundup of multiple conferences rather than a
// single real event's own page. Plural "conferences" is the tell: a real event names itself
// "... Conference" (singular) when talking about itself — nobody's own event page refers to
// itself in the plural. Any occurrence of "conferences" anywhere in the title or snippet is
// treated as a listing page and dropped outright, whatever the surrounding wording ("Top 10
// Conferences", "Best IT/Tech Conferences & Events", "Conferences in the United States", etc.)
// — this is intentionally blanket rather than pattern-specific, so new listicle phrasings don't
// require a new regex each time.
const LISTICLE_RE = /\bconferences\b|\blist of\b|\bround[\s-]?up\b/i;

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

// Drops results that only mention a past date and never mention the current-or-future date.
// A bare year alone is ambiguous within the current year (e.g. "2026" gives no signal about
// whether that's before or after today), so a specific month is checked first whenever the text
// states one — "April 2026" is genuinely outdated once today is August 2026, even though the
// bare year alone would look current. Never excludes purely for lacking a date at all.
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_NAMES.join("|")})\\b[^.]{0,20}?\\b(20\\d{2})\\b`, "gi");
const ALL_YEARS_RE = /\b20\d{2}\b/g;

function extractMonthYearDates(text: string): Array<{ year: number; monthIndex: number }> {
  return Array.from(text.toLowerCase().matchAll(MONTH_YEAR_RE), (m) => ({
    monthIndex: MONTH_NAMES.indexOf(m[1]),
    year: parseInt(m[2], 10),
  }));
}

function looksOutdated(title: string, snippet: string): boolean {
  const text = `${title} ${snippet}`;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const monthYearDates = extractMonthYearDates(text);
  if (monthYearDates.length > 0) {
    const hasCurrentOrFuture = monthYearDates.some(
      ({ year, monthIndex }) => year > currentYear || (year === currentYear && monthIndex >= currentMonth)
    );
    const hasPast = monthYearDates.some(
      ({ year, monthIndex }) => year < currentYear || (year === currentYear && monthIndex < currentMonth)
    );
    return hasPast && !hasCurrentOrFuture;
  }

  const years = Array.from(text.matchAll(ALL_YEARS_RE), (m) => parseInt(m[0], 10));
  if (years.length === 0) return false;
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

/** A plain web search, used when a conference's own site can't be read and its details have to be
 *  gathered from whatever else on the web covers it.
 *
 *  Deliberately skips the two filters the Discover search applies. `toConferenceQuery` is not
 *  applied because callers pass their own precise query, and the listicle filter is not applied
 *  because a directory or listing page is exactly what's wanted here — those aggregators are
 *  usually readable when the official site isn't, and they carry the dates, venue and programme. */
export async function searchWebForConferenceFacts(query: string, count = 8): Promise<LiveSearchResult[]> {
  if (!isConfigured()) return [];
  const cacheKey = `raw:${count}:${query.trim().toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(count, 1), 20)));

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    const results: LiveSearchResult[] = (body.web?.results || []).map((item: any) => ({
      title: stripHtml(item.title || ""),
      link: item.url || "",
      snippet: stripHtml(item.description || ""),
      displayLink: item.meta_url?.hostname || item.profile?.name || "",
      thumbnail: item.thumbnail?.src || null,
      favicon: item.meta_url?.favicon || item.profile?.img || null,
    }));
    cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
    return results;
  } catch {
    // A failed corroboration search must never take down the extraction that asked for it.
    return [];
  }
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
