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
import { scoreCandidateUrl } from "../sitemaps";
import {
  normalizeDomain, recordCrawlFailure, recordRobotsPolicy, selectDomainsDueForCrawl, type DomainRow,
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
  /** Registry domains visited in one run. */
  maxDomains?: number;
  /** Index/feed pages read per domain — the whole per-domain fetch budget. */
  maxPagesPerDomain?: number;
  /** Candidate conference URLs kept per domain after scoring. */
  maxCandidatesPerDomain?: number;
  /** Visit every enabled domain regardless of its crawl schedule. */
  ignoreSchedule?: boolean;
  scheme?: "http" | "https";
  /** Test seam: supply the registry rows directly. */
  domains?: DomainRow[];
}

export interface OrganizationHarvestStats {
  domainsAttempted: number;
  domainsRobotsBlocked: number;
  domainsUnreadable: number;
  pagesFetched: number;
  feedsRead: number;
  indexesRead: number;
  candidatesFound: number;
  uniqueCandidates: number;
  perDomain: Array<{ domain: string; organization: string; pages: number; candidates: number; note: string }>;
}

function emptyStats(): OrganizationHarvestStats {
  return {
    domainsAttempted: 0, domainsRobotsBlocked: 0, domainsUnreadable: 0, pagesFetched: 0,
    feedsRead: 0, indexesRead: 0, candidatesFound: 0, uniqueCandidates: 0, perDomain: [],
  };
}

/** The society's short form, when its name carries one: "American Association of Petroleum
 *  Geologists (AAPG)" or a name that is already an acronym. Never invented from initials. */
export function organizationAcronym(name: string): string | null {
  const parenthesised = name.match(/\(([A-Z][A-Za-z0-9&.-]{1,12})\)/);
  if (parenthesised) return parenthesised[1];
  const first = name.trim().split(/\s+/)[0] || "";
  return /^[A-Z]{2,10}$/.test(first) ? first : null;
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

    const text = textOf(anchor).replace(/\s+/g, " ").trim().slice(0, 200);
    const sameHost = target.hostname.replace(/^www\./, "") === origin.hostname.replace(/^www\./, "");
    // A society's conference often lives on its own domain (icra2027.org) rather than under the
    // society's path, so an off-host link is kept when the link text names an event. What is never
    // kept is a link that names nothing: that is navigation.
    const namesEvent = CONFERENCE_LINK_TEXT.test(text) || CONFERENCE_LINK_TEXT.test(target.pathname);
    const hasYear = YEAR_IN_TEXT.test(text) || YEAR_IN_TEXT.test(target.pathname);
    if (!namesEvent && !hasYear) continue;
    if (!sameHost && !namesEvent) continue;

    seen.add(key);
    const score = scoreCandidateUrl(target.href, targetYears).score + (namesEvent ? 0.2 : 0) + (hasYear ? 0.2 : 0);
    found.push({ url: target.href, title: text, score });
  }
  return found.sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Feed URLs a page advertises, plus the conventional ones. */
export function feedUrlsFrom(html: string, pageUrl: string): string[] {
  const root = parseHtml(html);
  const urls = new Set<string>();
  for (const link of byTag(root, "link")) {
    const type = attr(link, "type") || "";
    const rel = (attr(link, "rel") || "").toLowerCase();
    if (!FEED_TYPES.test(type) && rel !== "alternate") continue;
    if (!FEED_TYPES.test(type)) continue;
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
    const maxPages = Math.max(1, this.options.maxPagesPerDomain ?? 6);
    const maxCandidates = Math.max(1, this.options.maxCandidatesPerDomain ?? 25);
    const rows = this.options.domains
      ?? await selectDomainsDueForCrawl(maxDomains);

    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();

    for (const row of rows.slice(0, maxDomains)) {
      if (context.signal?.aborted) break;
      const domain = normalizeDomain(row.domain);
      const origin = `${scheme}://${domain}`;
      const organization = String(row.source_name || domain);
      const acronym = organizationAcronym(organization);
      this.stats.domainsAttempted += 1;
      let pages = 0;
      let produced = 0;
      let note = "";

      const policy: RobotsPolicy = await fetchRobots(origin, { urlGuard: this.options.urlGuard, timeoutMs: 10_000 });
      await recordRobotsPolicy(domain, {
        allowed: !policy.blanketDisallow, crawlDelayMs: policy.crawlDelayMs, sitemaps: policy.sitemaps,
      });
      if (policy.crawlDelayMs) setDomainCrawlDelay(domain, policy.crawlDelayMs);
      if (policy.blanketDisallow) {
        this.stats.domainsRobotsBlocked += 1;
        this.stats.perDomain.push({ domain, organization, pages: 0, candidates: 0, note: "robots_disallow_all" });
        continue;
      }

      const read = async (url: string): Promise<string | null> => {
        if (pages >= maxPages || !isPathAllowed(policy, url)) return null;
        pages += 1;
        this.stats.pagesFetched += 1;
        const response = await discoveryFetch(url, { urlGuard: this.options.urlGuard, timeoutMs: 15_000 });
        return response.ok && response.body ? response.body : null;
      };

      const add = (url: string, title: string, priority: number, reason: string) => {
        const key = canonicalizeUrl(url) || url;
        if (seen.has(key) || produced >= maxCandidates) return;
        seen.add(key);
        produced += 1;
        this.stats.candidatesFound += 1;
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

      // 1. The society's own front page: its feeds and its events index live there.
      const home = await read(`${origin}/`);
      if (home) {
        for (const feedUrl of feedUrlsFrom(home, `${origin}/`).slice(0, 2)) {
          const xml = await read(feedUrl);
          if (!xml) continue;
          this.stats.feedsRead += 1;
          for (const entry of feedEntries(xml, feedUrl, maxCandidates)) {
            if (!CONFERENCE_LINK_TEXT.test(entry.title) && !YEAR_IN_TEXT.test(entry.title)) continue;
            add(entry.url, entry.title, 0.72, `announced in ${organization}'s feed`);
          }
        }
      } else {
        this.stats.domainsUnreadable += 1;
        note = "home_unreadable";
        await recordCrawlFailure(domain, "organization home page unreadable");
      }

      // 2. Conventional feed paths, for sites that publish one without advertising it.
      if (produced === 0) {
        for (const path of FEED_PATHS) {
          if (pages >= maxPages) break;
          const xml = await read(`${origin}${path}`);
          if (!xml || !/<(?:rss|feed|item|entry)[\s>]/i.test(xml)) continue;
          this.stats.feedsRead += 1;
          for (const entry of feedEntries(xml, `${origin}${path}`, maxCandidates)) {
            if (!CONFERENCE_LINK_TEXT.test(entry.title) && !YEAR_IN_TEXT.test(entry.title)) continue;
            add(entry.url, entry.title, 0.7, `announced in ${organization}'s feed`);
          }
          break;
        }
      }

      // 3. The events index itself, and the conferences it links to. This is the step a sitemap
      //    cannot do: a sitemap lists the index page, the index page lists the conferences.
      const indexPaths = home ? EVENT_INDEX_PATHS : EVENT_INDEX_PATHS.slice(0, 4);
      for (const path of indexPaths) {
        if (pages >= maxPages || produced >= maxCandidates) break;
        const url = `${origin}${path}`;
        const body = await read(url);
        if (!body) continue;
        this.stats.indexesRead += 1;
        add(url, `${organization} events`, 0.55, `${organization}'s own events index`);
        for (const link of conferenceLinksFrom(body, url, maxCandidates, context.targetYears ?? [])) {
          add(link.url, link.title, 0.78, `linked from ${organization}'s events index`);
        }
      }

      if (!note) note = produced > 0 ? "harvested" : "no_conference_links_found";
      this.stats.perDomain.push({ domain, organization, pages, candidates: produced, note });
      this.options.logger?.log("urls_discovered", {
        detail: `organization ${domain}: ${produced} candidates from ${pages} pages (${note})`,
        count: produced,
      });
    }

    this.stats.uniqueCandidates = seen.size;
    return candidates;
  }
}
