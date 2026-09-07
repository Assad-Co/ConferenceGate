// Organisation-first harvesting: read the societies' own announcements.
//
// A society states its annual meeting on a page it controls, months before a search engine ranks
// it. Reading those pages directly is the cheapest and most trustworthy way to learn a conference
// exists — no query spend, no ranking to fight, and the organisation's identity attached from the
// first moment, which is what makes a search for "AAPG" return AAPG's conferences.
//
// This is not a second crawler. It produces `DiscoveryCandidate`s and hands them to the same
// pipeline as every other provider: the same conditional fetch, extraction, event identity,
// validation, deduplication, storage and publication gates. What it adds over the sitemap provider
// is the two things a society site actually offers and a sitemap does not — a feed, and an events
// index whose links are the conferences themselves.

import { fetchRobots, isPathAllowed, type RobotsPolicy } from "../robots";
import { discoveryFetch, setDomainCrawlDelay, type UrlGuard } from "../httpClient";
import { absoluteUrl, attr, byTag, parseHtml, textOf } from "../html";
import { canonicalizeUrl } from "../normalize";
import { discoverSitemapUrls, scoreCandidateUrl } from "../sitemaps";
import {
  normalizeDomain, recordCrawlFailure, recordRobotsPolicy, rememberEventHub,
  selectDomainsDueForCrawl, type DomainRow,
} from "../sourceRegistry";
import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import type { RunLogger } from "../logging";

/** Where a society's events index usually lives, in the order worth trying. */
const EVENT_INDEX_PATHS = [
  "/events", "/conferences", "/meetings", "/calendar", "/events/upcoming",
  "/annual-meeting", "/conferences-events", "/whats-on", "/event-calendar", "/news-events",
];

/** Feeds a site advertises for itself. */
const FEED_TYPES = /application\/(?:rss\+xml|atom\+xml|feed\+json)/i;
const FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/events/feed", "/events.rss"];

/** A link that reads like one conference rather than a section of the site. */
const CONFERENCE_LINK_TEXT =
  /\b(conference|congress|symposium|summit|convention|workshop|forum|meeting|expo|exhibition|colloquium|seminar)\b/i;
const YEAR_IN_TEXT = /\b20\d{2}\b/;

export interface OrganizationProviderOptions {
  logger?: RunLogger;
  urlGuard?: UrlGuard;
  /** Registry organisations visited in one run. */
  maxDomains?: number;
  /** Pages fetched per organisation — the whole per-domain HTTP budget. */
  maxPagesPerDomain?: number;
  /** Candidate conference URLs kept per organisation after scoring. */
  maxCandidatesPerDomain?: number;
  /** Sitemap documents read per organisation. */
  maxSitemapDocuments?: number;
  /** Visit every enabled domain regardless of its crawl schedule. */
  ignoreSchedule?: boolean;
  scheme?: "http" | "https";
  /** Restrict the run to these registry domains, for a measured test of named organisations. */
  onlyDomains?: string[];
  /** Test seam: supply the registry rows directly. */
  domains?: DomainRow[];
}

/** How an organisation's conferences were found, so the next run can go straight there. */
export type EventHubType = "sitemap" | "hub" | "feed" | "subdomain" | "stored_hub";

export interface OrganizationHarvestStats {
  domainsAttempted: number;
  domainsRobotsBlocked: number;
  domainsUnreadable: number;
  pagesFetched: number;
  sitemapsRead: number;
  feedsRead: number;
  indexesRead: number;
  candidatesFound: number;
  uniqueCandidates: number;
  perDomain: Array<{
    domain: string; organization: string; pages: number; candidates: number;
    sourceUrl: string | null; sourceType: EventHubType | null; note: string; errors: string[];
  }>;
}

function emptyStats(): OrganizationHarvestStats {
  return {
    domainsAttempted: 0, domainsRobotsBlocked: 0, domainsUnreadable: 0, pagesFetched: 0,
    sitemapsRead: 0, feedsRead: 0, indexesRead: 0, candidatesFound: 0, uniqueCandidates: 0, perDomain: [],
  };
}

/** The society's short form, when its name carries one. Never invented from initials. */
export function organizationAcronym(name: string): string | null {
  const parenthesised = name.match(/\(([A-Z][A-Za-z0-9&.-]{1,12})\)/);
  if (parenthesised) return parenthesised[1];
  const first = name.trim().split(/\s+/)[0] || "";
  return /^[A-Z]{2,10}$/.test(first) ? first : null;
}

/** Event vocabulary in a URL path — the cheap filter applied before any page is fetched. */
const EVENT_URL_TERM =
  /\b(conferences?|events?|meetings?|congress(?:es)?|symposi(?:um|a)|summits?|workshops?|conventions?|expo|exhibitions?|annual|calendar|program(?:me)?|sessions?)\b/i;
const YEAR_TERM = /\b20(2[5-9]|3\d)\b/;

/** A sitemap document worth reading before the others. */
export function scoreSitemapDocument(url: string): number {
  const lower = url.toLowerCase();
  if (/(image|video|media|photo|gallery|attachment)/.test(lower)) return -1;
  let score = 0;
  if (/(event|conference|meeting|congress|symposium|summit|calendar)/.test(lower)) score += 3;
  if (/(post|news|article|blog)/.test(lower)) score += 0.5;
  if (YEAR_TERM.test(lower)) score += 1;
  return score;
}

/**
 * Whether a sitemap entry is worth turning into a candidate.
 *
 * Applied to the URL alone, before anything is fetched. A society sitemap can carry a thousand
 * URLs and a page budget of ten, so the filtering has to happen on the cheap side of the request.
 */
export function scoreSitemapEntry(url: string, targetYears: number[]): number | null {
  let path: string;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  if (/\.(pdf|docx?|pptx?|xlsx?|zip|ics|jpe?g|png|gif|svg|webp|mp4|mp3|css|js)$/i.test(path)) return null;
  const hasEventTerm = EVENT_URL_TERM.test(path);
  const yearMatch = path.match(YEAR_TERM);
  const targetYear = !!yearMatch && (targetYears.length === 0 || targetYears.includes(Number(yearMatch[0])));
  if (!hasEventTerm && !yearMatch) return null;
  const base = scoreCandidateUrl(url, targetYears).score;
  // Event vocabulary AND a target year together is the strongest signal a URL can give.
  return base + (hasEventTerm ? 0.25 : 0) + (targetYear ? 0.25 : 0);
}

/** Conference-looking links on an events index, scored by the existing URL heuristic. */
export function conferenceLinksFrom(
  html: string, pageUrl: string, limit: number, targetYears: number[] = []
): Array<{ url: string; title: string; score: number }> {
  let origin: URL;
  try { origin = new URL(pageUrl); } catch { return []; }
  const root = parseHtml(html);
  const seen = new Set<string>();
  const found: Array<{ url: string; title: string; score: number }> = [];

  for (const anchor of byTag(root, "a")) {
    const href = attr(anchor, "href");
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (!absolute) continue;
    let target: URL;
    try { target = new URL(absolute); } catch { continue; }
    if (/\.(pdf|docx?|pptx?|xlsx?|zip|ics|jpe?g|png|gif|svg|webp)$/i.test(target.pathname)) continue;
    const key = canonicalizeUrl(target.href) || target.href;
    if (seen.has(key) || key === (canonicalizeUrl(pageUrl) || pageUrl)) continue;

    // The anchor plus its immediate context: a listing often puts the name in the link and the
    // word "Conference" in the heading beside it.
    const text = textOf(anchor).replace(/\s+/g, " ").trim().slice(0, 200);
    const context = anchor.parent ? textOf(anchor.parent).replace(/\s+/g, " ").trim().slice(0, 300) : text;
    const sameHost = target.hostname.replace(/^www\./, "") === origin.hostname.replace(/^www\./, "");
    const namesEvent = CONFERENCE_LINK_TEXT.test(text) || CONFERENCE_LINK_TEXT.test(context)
      || CONFERENCE_LINK_TEXT.test(target.pathname);
    const hasYear = YEAR_IN_TEXT.test(text) || YEAR_IN_TEXT.test(context) || YEAR_IN_TEXT.test(target.pathname);
    if (!namesEvent && !hasYear) continue;
    // A society's conference often owns its own domain, so an off-host link is kept when the text
    // names an event. A link that names nothing is navigation, wherever it points.
    if (!sameHost && !namesEvent) continue;

    seen.add(key);
    const score = scoreCandidateUrl(target.href, targetYears).score + (namesEvent ? 0.2 : 0) + (hasYear ? 0.2 : 0);
    found.push({ url: target.href, title: text, score });
  }
  return found.sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Feed URLs a page advertises. */
export function feedUrlsFrom(html: string, pageUrl: string): string[] {
  const root = parseHtml(html);
  const urls = new Set<string>();
  for (const link of byTag(root, "link")) {
    if (!FEED_TYPES.test(attr(link, "type") || "")) continue;
    const href = absoluteUrl(attr(link, "href"), pageUrl);
    if (href) urls.add(href);
  }
  return [...urls];
}

/** Entries in an RSS or Atom document, read as plain XML rather than with a parser dependency. */
export function feedEntries(xml: string, baseUrl: string, limit: number): Array<{ url: string; title: string }> {
  const entries: Array<{ url: string; title: string }> = [];
  const items = xml.split(/<(?:item|entry)[\s>]/i).slice(1);
  for (const item of items) {
    if (entries.length >= limit) break;
    const link = item.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1]
      || item.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1]
      || item.match(/<guid[^>]*>([^<]+)<\/guid>/i)?.[1];
    const title = item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "";
    const absolute = link ? absoluteUrl(link.trim(), baseUrl) : null;
    if (!absolute) continue;
    entries.push({ url: absolute, title: title.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200) });
  }
  return entries;
}

/** Hosts worth trying for one organisation, in order: its own name, www, then event subdomains. */
export function candidateHosts(domain: string): string[] {
  const bare = domain.replace(/^www\./, "");
  return [bare, `www.${bare}`, `events.${bare}`, `meetings.${bare}`, `conferences.${bare}`];
}

export class OrganizationDiscoveryProvider implements DiscoveryProvider {
  readonly name = "organization";
  readonly kind = "feed" as const;
  readonly rateLimit = { requestsPerMinute: 60, maxConcurrent: 1 };
  // Higher than search: this URL came from the organisation's own index of its own events.
  readonly baseConfidence = 0.75;
  readonly stats: OrganizationHarvestStats = emptyStats();

  constructor(private readonly options: OrganizationProviderOptions = {}) {}

  isEnabled(): boolean { return true; }
  unavailableReason(): string | null { return null; }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const scheme = this.options.scheme ?? "https";
    const maxDomains = Math.max(1, this.options.maxDomains ?? 40);
    const maxPages = Math.max(2, this.options.maxPagesPerDomain ?? 10);
    const maxCandidates = Math.max(1, this.options.maxCandidatesPerDomain ?? 40);
    const maxSitemapDocuments = Math.max(1, this.options.maxSitemapDocuments ?? 8);
    const targetYears = context.targetYears ?? [];

    let rows = this.options.domains ?? await selectDomainsDueForCrawl(maxDomains * 4);
    if (this.options.onlyDomains?.length) {
      const wanted = new Set(this.options.onlyDomains.map((entry) => normalizeDomain(entry)));
      rows = rows.filter((row) => wanted.has(normalizeDomain(row.domain)));
    }

    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();

    for (const row of rows.slice(0, maxDomains)) {
      if (context.signal?.aborted) break;
      const domain = normalizeDomain(row.domain);
      const organization = String(row.source_name || domain);
      const acronym = organizationAcronym(organization);
      const errors: string[] = [];
      this.stats.domainsAttempted += 1;

      let pages = 0;
      let produced = 0;
      let sourceUrl: string | null = null;
      let sourceType: EventHubType | null = null;

      const policy: RobotsPolicy = await fetchRobots(`${scheme}://${domain}`, {
        urlGuard: this.options.urlGuard, timeoutMs: 10_000,
      });
      await recordRobotsPolicy(domain, {
        allowed: !policy.blanketDisallow, crawlDelayMs: policy.crawlDelayMs, sitemaps: policy.sitemaps,
      });
      if (policy.crawlDelayMs) setDomainCrawlDelay(domain, policy.crawlDelayMs);
      if (policy.blanketDisallow) {
        this.stats.domainsRobotsBlocked += 1;
        this.stats.perDomain.push({
          domain, organization, pages: 0, candidates: 0, sourceUrl: null, sourceType: null,
          note: "robots_disallow_all", errors,
        });
        continue;
      }

      const read = async (url: string): Promise<string | null> => {
        if (pages >= maxPages) return null;
        if (!isPathAllowed(policy, url)) return null;
        pages += 1;
        this.stats.pagesFetched += 1;
        try {
          const response = await discoveryFetch(url, { urlGuard: this.options.urlGuard, timeoutMs: 15_000 });
          if (response.ok && response.body) return response.body;
          errors.push(`${url}: HTTP ${response.status}${response.error ? ` ${response.error}` : ""}`);
          return null;
        } catch (error: any) {
          errors.push(`${url}: ${String(error?.message || error).slice(0, 120)}`);
          return null;
        }
      };

      const add = (url: string, title: string, priority: number, reason: string, via: EventHubType) => {
        const key = canonicalizeUrl(url) || url;
        if (seen.has(key) || produced >= maxCandidates) return;
        seen.add(key);
        produced += 1;
        this.stats.candidatesFound += 1;
        if (!sourceType) { sourceType = via; }
        candidates.push({
          url,
          sourceDomain: (() => { try { return normalizeDomain(new URL(url).hostname); } catch { return domain; } })(),
          provider: this.name,
          priority: Math.min(0.99, priority),
          reason,
          hints: {
            title: title || null,
            // The organisation's identity travels with the candidate, so a conference announced by
            // AAPG is stored as AAPG's — which is what a customer searching "AAPG" is asking for.
            organization,
            organizationAcronym: acronym,
            organizationDomain: domain,
          } as DiscoveryCandidate["hints"],
        });
      };

      // ---- 1. SITEMAPS FIRST. They cost one request per document and can yield hundreds of
      // candidates without fetching a single conference page — and a society that blocks its
      // homepage with a bot challenge usually still serves its sitemap.
      const declared = [...policy.sitemaps];
      if (declared.length === 0) declared.push(`${scheme}://${domain}/sitemap.xml`);
      const ranked = declared
        .map((url) => ({ url, score: scoreSitemapDocument(url) }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, maxSitemapDocuments)
        .map((entry) => entry.url);

      if (ranked.length > 0) {
        try {
          const crawl = await discoverSitemapUrls(`${scheme}://${domain}`, {
            declaredSitemaps: ranked,
            maxSitemapDocuments,
            maxEntries: 5_000,
            urlGuard: this.options.urlGuard,
          });
          this.stats.sitemapsRead += crawl.sitemapsRead.length;
          const scored = crawl.entries
            .map((entry) => ({ url: entry.url, score: scoreSitemapEntry(entry.url, targetYears) }))
            .filter((entry): entry is { url: string; score: number } => entry.score !== null)
            .sort((left, right) => right.score - left.score)
            .slice(0, maxCandidates);
          for (const entry of scored) {
            add(entry.url, "", 0.7, `${organization}'s sitemap lists this as an event page`, "sitemap");
          }
          if (produced > 0) sourceUrl = crawl.sitemapsRead[0] || ranked[0];
        } catch (error: any) {
          errors.push(`sitemap: ${String(error?.message || error).slice(0, 120)}`);
        }
      }

      // ---- 2. A hub a previous run already proved productive: go straight to it.
      const storedHub = typeof row.event_hub_url === "string" ? row.event_hub_url : null;
      if (produced < maxCandidates && storedHub) {
        const body = await read(storedHub);
        if (body) {
          this.stats.indexesRead += 1;
          for (const link of conferenceLinksFrom(body, storedHub, maxCandidates, targetYears)) {
            add(link.url, link.title, 0.8, `linked from ${organization}'s known events hub`, "stored_hub");
          }
          if (produced > 0 && !sourceUrl) sourceUrl = storedHub;
        }
      }

      // ---- 3. The events index, tried across the hosts an organisation actually uses. A root
      // homepage that answers 403 says nothing about whether /events does.
      const hosts = candidateHosts(domain);
      outer: for (const host of hosts) {
        for (const path of EVENT_INDEX_PATHS) {
          if (pages >= maxPages || produced >= maxCandidates) break outer;
          const url = `${scheme}://${host}${path}`;
          const body = await read(url);
          if (!body) continue;
          this.stats.indexesRead += 1;
          const links = conferenceLinksFrom(body, url, maxCandidates, targetYears);
          if (links.length === 0) continue;
          add(url, `${organization} events`, 0.55, `${organization}'s own events index`,
            host === domain ? "hub" : "subdomain");
          for (const link of links) {
            add(link.url, link.title, 0.82, `linked from ${organization}'s events index`,
              host === domain ? "hub" : "subdomain");
          }
          if (!sourceUrl || sourceType === "sitemap") sourceUrl ??= url;
          sourceUrl ??= url;
          // A productive hub is worth remembering; the rest of this organisation's paths are not
          // worth spending the budget on now that one has answered.
          await rememberEventHub(domain, url, host === domain ? "hub" : "subdomain");
          break outer;
        }
      }

      // ---- 4. Feeds, last: they are the least common of the three and the easiest to waste a
      // budget probing for. Only advertised feeds are followed; conventional paths are not guessed
      // at one request at a time.
      if (produced === 0 && pages < maxPages) {
        const home = await read(`${scheme}://${domain}/`) ?? await read(`${scheme}://www.${domain}/`);
        if (home) {
          for (const feedUrl of feedUrlsFrom(home, `${scheme}://${domain}/`).slice(0, 2)) {
            const xml = await read(feedUrl);
            if (!xml) continue;
            this.stats.feedsRead += 1;
            for (const entry of feedEntries(xml, feedUrl, maxCandidates)) {
              if (!CONFERENCE_LINK_TEXT.test(entry.title) && !YEAR_IN_TEXT.test(entry.title)) continue;
              add(entry.url, entry.title, 0.72, `announced in ${organization}'s feed`, "feed");
            }
            if (produced > 0) { sourceUrl ??= feedUrl; break; }
          }
          // The homepage itself sometimes links the conferences directly.
          if (produced === 0) {
            for (const link of conferenceLinksFrom(home, `${scheme}://${domain}/`, maxCandidates, targetYears)) {
              add(link.url, link.title, 0.6, `linked from ${organization}'s home page`, "hub");
            }
            if (produced > 0) sourceUrl ??= `${scheme}://${domain}/`;
          }
        } else {
          this.stats.domainsUnreadable += 1;
          await recordCrawlFailure(domain, errors[0] || "organization pages unreadable");
        }
      }

      const note = produced > 0
        ? `harvested_via_${sourceType}`
        : pages === 0 ? "no_page_could_be_requested"
        : errors.length > 0 ? "all_sources_failed"
        : "no_conference_links_found";
      this.stats.perDomain.push({
        domain, organization, pages, candidates: produced, sourceUrl, sourceType, note,
        errors: errors.slice(0, 5),
      });
      this.options.logger?.log("urls_discovered", {
        detail: `organization ${domain}: ${produced} candidates from ${pages} pages via ${sourceType ?? "none"} (${note})`,
        count: produced,
      });
    }

    this.stats.uniqueCandidates = seen.size;
    return candidates;
  }
}
