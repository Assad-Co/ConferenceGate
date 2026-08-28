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
const CONFERENCE_KEYWORDS = /\b(conference|summit|symposium|convention|congress|workshop|expo|meeting)\b/i;
const YEAR_IN_QUERY_RE = /\b20\d{2}\b/;
function toConferenceQuery(query: string): string {
  const withKeyword = CONFERENCE_KEYWORDS.test(query) ? query : `${query} conference`;
  const withYear = YEAR_IN_QUERY_RE.test(withKeyword)
    ? withKeyword
    : `${withKeyword} ${new Date().getFullYear()}`;

  // Ask for the event's own information pages and explicitly down-rank roundup vocabulary.
  // This improves the candidate pool before the strict server-side filter below is applied.
  return `${withYear} official website registration program speakers -calendar -directory -"list of conferences" -"top conferences" -"best conferences"`;
}

// Discovery must link to one conference's own page, never a directory, calendar, roundup,
// ticket marketplace, or article that happens to list conferences. Titles are checked separately
// from snippets because roundup pages often use a singular phrase such as "Every Tech Conference"
// while describing dozens of events in the body.
const LISTING_TITLE_RE =
  /\b(?:top|best|every|all|upcoming|popular|must[-\s]?attend|biggest|leading)\b.{0,60}\b(?:conferences?|events?|summits?|symposia|conventions?|congress(?:es)?|expos?|trade shows?)\b|\b\d+\s+(?:top\s+|best\s+)?(?:conferences?|events?|summits?|trade shows?)\b|\b(?:conference|event|trade show)\s+(?:calendar|directory|list|roundup|round-up)\b|\b(?:conferences?|events?)\s+(?:near me|around the world|in the|by country|by month)\b|\b(?:find|search|browse|discover)\s+(?:a\s+)?(?:conference|event)\b/i;
const LISTING_SNIPPET_RE =
  /\b(?:browse|search|discover|compare|find)\s+(?:hundreds?|thousands?|upcoming|all)\s+(?:of\s+)?(?:conferences?|events?)\b|\b(?:calendar|directory|database|listing)\s+of\s+(?:conferences?|events?)\b|\b(?:conferences?|events?)\s+across\s+(?:the\s+)?(?:world|country|industries)\b/i;
const PLURAL_CONFERENCES_RE = /\bconferences\b/i;

const DIRECTORY_DOMAINS = new Set([
  "10times.com",
  "allevents.in",
  "allconferencealert.com",
  "allconferences.com",
  "conferencealerts.com",
  "internationalconferencealerts.com",
  "clocate.com",
  "conferenceindex.org",
  "conference-next.com",
  "dev.events",
  "eventbrite.com",
  "eventsget.com",
  "eventseye.com",
  "meetup.com",
  "conferenceseries.com",
  "myconferencetimes.com",
  "techconferences.co",
]);

function normalizedHost(link: string, displayLink: string): string {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return displayLink.toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}

function isDirectoryHost(host: string): boolean {
  return [...DIRECTORY_DOMAINS].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isLikelyOfficialConferencePage(result: LiveSearchResult): boolean {
  const title = result.title.trim();
  const snippet = result.snippet.trim();
  const host = normalizedHost(result.link, result.displayLink);
  if (!result.link || !title || isDirectoryHost(host)) return false;
  if (PLURAL_CONFERENCES_RE.test(title) || PLURAL_CONFERENCES_RE.test(snippet)) return false;
  if (LISTING_TITLE_RE.test(title) || LISTING_SNIPPET_RE.test(snippet)) return false;

  const combined = `${title} ${snippet}`;
  // Plain "meeting" matters here, not just "annual meeting" — many real academic/scientific
  // conferences (e.g. IMOG, the International Meeting on Organic Geochemistry) call themselves
  // a "meeting" and never use the word "conference" anywhere on their own site.
  const namesAnEvent = /\b(conference|summit|symposium|convention|congress|workshop|expo|forum|meeting)\b/i.test(combined);
  const hasEventDetail =
    /\b20\d{2}\b|\b(?:register|registration|program|programme|agenda|speakers?|venue|call for papers|submit)\b/i.test(combined);
  return namesAnEvent && hasEventDetail;
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

// A result without a visible current/future year is not allowed into Discovery. This is stricter
// than merely rejecting known-old pages: if the search snippet gives no date evidence, Conference
// Gate cannot honestly present it as an upcoming event.
function currentOrUpcomingTime(title: string, snippet: string): number | null {
  const text = `${title} ${snippet}`;
  if (looksOutdated(title, snippet)) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const dated = extractMonthYearDates(text)
    .filter(({ year, monthIndex }) => year > currentYear || (year === currentYear && monthIndex >= currentMonth))
    .map(({ year, monthIndex }) => Date.UTC(year, monthIndex, 1));
  if (dated.length > 0) return Math.min(...dated);

  const futureYears = Array.from(text.matchAll(ALL_YEARS_RE), (m) => parseInt(m[0], 10))
    .filter((year) => year >= currentYear);
  if (futureYears.length === 0) return null;
  const year = Math.min(...futureYears);
  return Date.UTC(year, year === currentYear ? currentMonth : 0, 1);
}

// Association, publisher, and university hosts can legitimately operate many different events.
// Dedicated conference hosts, however, identify a conference reliably enough to collapse its
// home/program/speaker pages into one Discovery card.
const SHARED_ORGANIZER_DOMAINS = new Set([
  "acm.org",
  "asme.org",
  "ieee.org",
  "springer.com",
  "elsevier.com",
  "nature.com",
  "who.int",
  "un.org",
]);

function isSharedOrganizerHost(host: string): boolean {
  if (/\.edu(?:\.[a-z]{2})?$|\.ac\.[a-z]{2}$/i.test(host)) return true;
  return [...SHARED_ORGANIZER_DOMAINS].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Removes dates, edition labels, and page-section boilerplate so "IMOG 2026", "IMOG 2027",
// and "Speakers | IMOG 2026" resolve to the same conference identity.
function conferenceIdentity(title: string): string {
  const parts = title
    .split(/\s+[|–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const meaningful = parts
    .filter((part) => !/^(home|program|programme|agenda|speakers?|registration|about|official site)$/i.test(part))
    .sort((a, b) => b.length - a.length)[0] || title;

  return meaningful
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\b/g, " ")
    .replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|annual|edition|official|website|home)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// currentOrUpcomingTime returns null for two very different situations — a page with clear proof
// of being outdated, and a page that simply mentions no date at all (a redesigned homepage, a
// "coming soon" teaser, a snippet Brave truncated before the date). Treating both as "exclude"
// meant a real, current official page dropped out of Discovery entirely just because its search
// snippet happened not to state a year — which is how a specific, real, upcoming conference could
// return zero results even though it plainly exists. Only the first case is honest grounds for
// exclusion; the second is unknown timing, not proof of anything, and per the same rule
// looksOutdated already follows ("never exclude purely for lacking a date"), unknown-timing
// results are kept — just ranked after ones we could actually confirm are upcoming.
function deduplicateUpcomingConferences(results: LiveSearchResult[]): LiveSearchResult[] {
  const dated: Array<{ result: LiveSearchResult; time: number }> = [];
  const undated: LiveSearchResult[] = [];

  for (const result of results) {
    if (looksOutdated(result.title, result.snippet)) continue; // the one real exclusion: proof of being stale
    const time = currentOrUpcomingTime(result.title, result.snippet);
    if (time !== null) dated.push({ result, time });
    else undated.push(result);
  }
  dated.sort((a, b) => a.time - b.time);

  const seenIdentities = new Set<string>();
  const seenDedicatedHosts = new Set<string>();
  const unique: LiveSearchResult[] = [];

  // Confirmed-upcoming results are deduplicated first, so if the same conference also turns up
  // in the undated batch (e.g. its program page mentions a date but its homepage doesn't), the
  // dated instance wins the identity/host slot and the undated duplicate is the one dropped.
  const consider = (result: LiveSearchResult) => {
    const host = normalizedHost(result.link, result.displayLink);
    const identity = conferenceIdentity(result.title);
    if (identity && seenIdentities.has(identity)) return;
    if (host && !isSharedOrganizerHost(host) && seenDedicatedHosts.has(host)) return;

    if (identity) seenIdentities.add(identity);
    if (host && !isSharedOrganizerHost(host)) seenDedicatedHosts.add(host);
    unique.push(result);
  };

  for (const { result } of dated) consider(result);
  for (const result of undated) consider(result);
  return unique;
}

export async function searchConferences(query: string): Promise<LiveSearchResult[]> {
  const cacheKey = `official-v3:${query.trim().toLowerCase()}`;
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
  const candidates: LiveSearchResult[] = items
    .map((item) => ({
      title: stripHtml(item.title || ""),
      link: item.url || "",
      snippet: stripHtml(item.description || ""),
      displayLink: item.meta_url?.hostname || item.profile?.name || "",
      thumbnail: item.thumbnail?.src || null,
      favicon: item.meta_url?.favicon || item.profile?.img || null,
    }))
    .filter((r) => isLikelyOfficialConferencePage(r));

  // Nearest upcoming edition first; duplicate pages and older/future duplicate editions removed.
  const results = deduplicateUpcomingConferences(candidates);

  cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
  return results;
}

/** A plain web search, used when a conference's own site can't be read and its details have to be
 *  gathered from whatever else on the web covers it.
 *
 *  Deliberately skips the Discover search's official-site and date filters. `toConferenceQuery`
 *  is not applied because callers pass their own precise query, and the directory filter is not applied
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
