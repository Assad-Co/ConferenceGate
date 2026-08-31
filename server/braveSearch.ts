import { Router } from "express";
import { asyncHandler } from "./asyncHandler";
import { isSerperConfigured, serperSearch } from "./serperSearch";
import { dbAll } from "./db";

export interface LiveSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: string | null;
  favicon: string | null;
  /** True when Conference Gate already has a completed structured extraction in its database. */
  prepared?: boolean;
}

interface CacheEntry {
  data: LiveSearchResult[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — keeps us well within Brave's free 2,000 queries/month quota
const cache = new Map<string, CacheEntry>();

function isBraveConfigured() {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}

/** Live search works as long as ANY provider is configured — Brave alone, Serper alone, or both. */
function isConfigured() {
  return isBraveConfigured() || isSerperConfigured();
}

/** Raw Brave results, rate-limit-queued. Throws on any request failure so the caller can decide
 *  whether a fallback provider should answer instead. */
async function braveSearch(
  query: string,
  count: number,
  priority: "high" | "low"
): Promise<LiveSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(Math.max(count, 1), 20)));

  const res = await scheduleBraveRequest(
    () =>
      fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
        },
        signal: AbortSignal.timeout(10000),
      }),
    priority
  );

  const rawText = await res.text();
  let body: any = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`Live search failed (unexpected response, HTTP ${res.status}). Please try again.`);
  }
  if (!res.ok) {
    throw new Error(body?.error?.detail || body?.error?.message || `Brave Search API error (${res.status})`);
  }

  return (body.web?.results || []).map((item: any) => ({
    title: stripHtml(item.title || ""),
    link: item.url || "",
    snippet: stripHtml(item.description || ""),
    displayLink: item.meta_url?.hostname || item.profile?.name || "",
    thumbnail: item.thumbnail?.src || null,
    favicon: item.meta_url?.favicon || item.profile?.img || null,
  }));
}

/** Raw results from whichever provider can answer.
 *
 *  Brave is tried first when configured: its plan is the cheaper of the two and it returns the
 *  thumbnail/favicon that Serper's organic results don't carry. Serper is the fallback rather than
 *  a replacement, because the failure being absorbed here is specifically Brave's per-second and
 *  monthly ceiling — a burst of region/subject queries can exhaust it and return "Request rate
 *  limit exceeded for plan" for every one of them, leaving Discover empty even though the web
 *  plainly has answers.
 *
 *  Only throws when every configured provider failed; a provider that isn't configured is skipped
 *  rather than counted as a failure. */
async function providerSearch(
  query: string,
  count: number,
  priority: "high" | "low"
): Promise<LiveSearchResult[]> {
  let braveError: unknown = null;

  if (isBraveConfigured()) {
    try {
      return await braveSearch(query, count, priority);
    } catch (error) {
      // Held rather than rethrown: if Serper can answer, the reader gets results instead of an
      // error, and this only resurfaces when there's no working fallback either.
      braveError = error;
    }
  }

  if (isSerperConfigured()) {
    try {
      return await serperSearch(query, count);
    } catch (serperError) {
      throw braveError || serperError;
    }
  }

  if (braveError) throw braveError;
  return [];
}

// Brave's plan also caps requests per second, separate from (and much stricter than) the monthly
// quota above — a burst of calls fired together (e.g. Discover's default view searching several
// subjects at once) hits that ceiling immediately and every one of them comes back as "Request
// rate limit exceeded for plan", not just the ones past some soft threshold. Every outbound Brave
// request goes through this queue so a burst is spread out instead of sent all at once, the same
// pattern already used for Firecrawl's own per-second limit.
//
// Two lanes, not one FIFO line: Discover's default (nothing-typed) view fires ten background
// subject searches at once, and a person who then actually types a search shouldn't have their
// one real query sit behind all ten of those — especially since the background batch's own
// results will just be thrown away the moment a newer search supersedes them. High-priority
// (a real, specific search) always jumps ahead of whatever background work is still waiting for
// its turn; only a request already dispatched to Brave can't be preempted.
const BRAVE_MIN_START_INTERVAL_MS = 1100;
const highPriorityQueue: Array<() => void> = [];
const lowPriorityQueue: Array<() => void> = [];
let dispatcherRunning = false;
let nextBraveStartAt = 0;

function runBraveDispatcher() {
  if (dispatcherRunning) return;
  const next = highPriorityQueue.shift() || lowPriorityQueue.shift();
  if (!next) return;
  dispatcherRunning = true;
  const waitMs = Math.max(0, nextBraveStartAt - Date.now());
  setTimeout(() => {
    nextBraveStartAt = Date.now() + BRAVE_MIN_START_INTERVAL_MS;
    next();
    dispatcherRunning = false;
    runBraveDispatcher();
  }, waitMs);
}

function scheduleBraveRequest<T>(request: () => Promise<T>, priority: "high" | "low" = "high"): Promise<T> {
  return new Promise((resolve, reject) => {
    (priority === "high" ? highPriorityQueue : lowPriorityQueue).push(() => {
      request().then(resolve, reject);
    });
    runBraveDispatcher();
  });
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
// conference we haven't added yet", not a general-purpose search box.
function toConferenceQuery(query: string): string {
  // One provider request can cover every event label. A subject search such as "geoscience"
  // therefore includes conventions, congresses, symposia, summits, workshops, and scientific
  // meetings instead of only pages that happen to call themselves a conference.
  const eventTypes =
    '("conference" OR "convention" OR "congress" OR "symposium" OR "summit" OR "workshop" OR "meeting")';

  // Do not force one year here: recurring and biennial events may publish their next edition in a
  // later year. The date filter below removes genuinely old editions after results come back.
  return `${query} ${eventTypes} official website registration program speakers -calendar -directory -"list of conferences" -"top conferences" -"best conferences"`;
}

/**
 * Searches Conference Gate's completed extraction database before spending external provider
 * quota. These results are especially valuable because their tab data is already prepared, so a
 * visitor can open the conference immediately even when Brave/Serper has reached its plan limit.
 */
async function searchPreparedConferences(query: string): Promise<LiveSearchResult[]> {
  const rows = await dbAll<{
    source_url: string;
    overview: string;
    call_for_papers: string;
    program_agenda: string;
    keynote_speakers: string;
    technical_committee: string;
    sponsors_exhibitors: string;
    venue_accommodation: string;
    fees_pricing: string;
    community: string;
    extraction_metadata: string;
    updated_at: string;
  }>(
    `SELECT source_url, overview, call_for_papers, program_agenda, keynote_speakers,
              technical_committee, sponsors_exhibitors, venue_accommodation, fees_pricing,
              community, extraction_metadata, updated_at
       FROM extracted_conferences
      WHERE overview IS NOT NULL
        AND overview <> '{}'
      ORDER BY updated_at DESC
      LIMIT 500`
  );

  const stopWords = new Set([
    "conference", "conferences", "official", "website", "registration", "program", "speakers",
    "from", "until", "upcoming", "current", "and", "the", "in", "of", "for", "worldwide",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
  ]);
  const queryTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token) && !/^20\d{2}$/.test(token));

  const ranked: Array<{ result: LiveSearchResult; score: number }> = [];
  for (const row of rows) {
    let overview: Record<string, any>;
    let metadata: Record<string, any>;
    try {
      overview = JSON.parse(row.overview || "{}");
      metadata = JSON.parse(row.extraction_metadata || "{}");
    } catch {
      continue;
    }
    if (metadata.status && metadata.status !== "success") continue;

    const title =
      typeof overview.conference_name === "string" && overview.conference_name.trim()
        ? overview.conference_name.trim()
        : "";
    if (!title) continue;

    const haystack = [
      title,
      overview.acronym,
      overview.description,
      overview.city,
      overview.country,
      overview.format,
      overview.organizer,
      ...(Array.isArray(overview.topics) ? overview.topics : []),
    ]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();

    const normalizedTitle = title.toLowerCase();
    const matchedTokens = queryTokens.filter((token) => haystack.includes(token));
    if (queryTokens.length > 0 && matchedTokens.length === 0) continue;

    let host = "";
    try {
      host = new URL(row.source_url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }

    const parseSection = (value: string, fallback: any) => {
      try { return JSON.parse(value || ""); } catch { return fallback; }
    };
    const hasContent = (value: any): boolean => {
      if (Array.isArray(value)) return value.some(hasContent);
      if (value && typeof value === "object") {
        return Object.entries(value).some(
          ([key, nested]) => !["source_url", "source_urls", "status"].includes(key) && hasContent(nested)
        );
      }
      return typeof value === "string"
        ? value.trim().length > 2 && !/^(not found|not retrieved|unknown|n\/a)$/i.test(value.trim())
        : typeof value === "number" || value === true;
    };
    const sections = [
      parseSection(row.call_for_papers, {}),
      parseSection(row.program_agenda, {}),
      parseSection(row.keynote_speakers, []),
      parseSection(row.technical_committee, []),
      parseSection(row.sponsors_exhibitors, []),
      parseSection(row.venue_accommodation, {}),
      parseSection(row.fees_pricing, {}),
      parseSection(row.community, {}),
    ];
    const populatedSections = sections.filter(hasContent).length;
    const pagesCrawled = Number(metadata.pages_crawled) || 0;
    const detailsReady = populatedSections >= 3 && (pagesCrawled >= 3 || populatedSections >= 5);

    let score = matchedTokens.length * 100;
    if (queryTokens.some((token) => normalizedTitle.includes(token))) score += 300;
    if (queryTokens.length > 0 && matchedTokens.length === queryTokens.length) score += 200;
    ranked.push({
      score,
      result: {
        title,
        link: row.source_url,
        snippet:
          typeof overview.description === "string"
            ? overview.description
            : [overview.dates_text, overview.city, overview.country].filter(Boolean).join(" · "),
        displayLink: host,
        thumbnail: null,
        favicon: null,
        prepared: detailsReady,
      },
    });
  }

  return ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, 20)
    .map(({ result }) => result);
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

export async function searchConferences(
  query: string,
  priority: "high" | "low" = "high",
  force = false
): Promise<LiveSearchResult[]> {
  const cacheKey = `official-v4:${query.trim().toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const prepared = (await searchPreparedConferences(query)).filter(isLikelyOfficialConferencePage);
  let candidates: LiveSearchResult[] = [];
  try {
    candidates = (
      await providerSearch(toConferenceQuery(query), 20, priority)
    ).filter((result) => isLikelyOfficialConferencePage(result));
  } catch (error) {
    // A provider plan limit must not empty Discover when Conference Gate already has relevant,
    // official conference records. Only surface the provider error when no prepared result can help.
    if (prepared.length === 0) throw error;
  }

  // Prepared records come first: they open instantly and cost no external-search quota. The same
  // identity/date deduplication still prevents a cached event and its live result appearing twice.
  const results = deduplicateUpcomingConferences([...prepared, ...candidates]);

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

  try {
    const results = await providerSearch(query, count, "high");
    cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
    return results;
  } catch {
    // A failed corroboration search must never take down the extraction that asked for it.
    return [];
  }
}

export const braveSearchRouter = Router();

// The directory harvest needs the AI client, which lives in server.ts's closure. Rather than
// export that client (or move the router), server.ts registers the harvester at startup and this
// module stays unaware of how it's built.
type DirectoryHarvester = (topic: string, force: boolean) => Promise<LiveSearchResult[]>;
let directoryHarvester: DirectoryHarvester | null = null;

export function registerDirectoryHarvester(harvester: DirectoryHarvester): void {
  directoryHarvester = harvester;
}

// A separate endpoint rather than part of /conferences on purpose: a typed search fans out across
// seven world regions, and harvesting the same directories seven times for one search term would
// be seven times the work for identical results. The client calls this once per search instead.
braveSearchRouter.get(
  "/conferences/directories",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const force = req.query.force === "true";
    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Provide a search query of at least 2 characters." });
    }
    if (!directoryHarvester) return res.json({ results: [] });

    try {
      res.json({ results: await directoryHarvester(query, force) });
    } catch (error) {
      // Directory results are a supplement to Discover, never the thing it depends on — a failure
      // here returns nothing rather than failing the search the reader actually ran.
      console.error("Directory harvest failed:", error);
      res.json({ results: [] });
    }
  })
);

braveSearchRouter.get(
  "/conferences",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    // Discover's default (nothing-typed) view fires several background subject searches at once
    // and marks them low priority so a person's actual typed search always jumps the queue ahead
    // of them, rather than waiting behind background work whose results may already be moot.
    const priority = req.query.priority === "low" ? "low" : "high";
    // Results are cached per query for an hour to stay well within the monthly quota. A manual
    // "Search Again" click means the reader specifically wants a fresh look, not the same answer
    // replayed — bypasses that cache read (a fresh result still gets cached normally afterward).
    const force = req.query.force === "true";

    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Provide a search query of at least 2 characters." });
    }

    // Even with no external provider configured, the completed extraction database remains a
    // useful, zero-quota search source. searchConferences handles that path transparently.
    try {
      const results = await searchConferences(query, priority, force);
      res.json({ results });
    } catch (error: any) {
      console.error("Live search error:", error);
      res.status(502).json({ error: error.message || "Live search failed. Please try again." });
    }
  })
);
