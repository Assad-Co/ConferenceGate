// Conference directories as a SEED source.
//
// A directory is the fastest way to learn that a conference exists and the worst way to learn
// anything about it. This provider treats it accordingly: it produces candidate URLs, marks every
// one as a directory lead so the existing official-site resolution runs on it, and never lets a
// listing host be promoted to authoritative. Everything after "this conference may exist" —
// extraction, event identity, validation, deduplication, publication — is the pipeline's existing
// work, unchanged.
//
// ACCESS IS CHECKED AT RUNTIME, NOT ASSUMED. Each source is gated on its own robots.txt before a
// single listing is requested: a blanket disallow skips the source, a disallowed path is never
// fetched, and a 401 or 403 stops that source rather than provoking a retry. Nothing here spoofs a
// user agent, rotates an identity, solves a challenge or works around a paywall. A source that
// says no is recorded as having said no, and Serper covers the gap — which is what the fallback
// exists for.
//
// The page structure of these sites is deliberately NOT hard-coded. Candidates come from the same
// two readers used everywhere else: schema.org first, then the link extractor. A directory that
// changes its markup degrades to "found nothing" and says so, rather than silently yielding
// nonsense from stale selectors.

import { fetchRobots, isPathAllowed, type RobotsPolicy } from "../robots";
import { discoveryFetch, setDomainCrawlDelay, type UrlGuard } from "../httpClient";
import { absoluteUrl, attr, byTag, parseHtml, textOf } from "../html";
import { canonicalizeUrl } from "../normalize";
import { extractStructuredEvents } from "../structuredData";
import { conferenceLinksFrom } from "./organizationProvider";
import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import type { RunLogger } from "../logging";

export interface DirectorySource {
  key: string;
  host: string;
  /** Listing pages to start from. Pagination is followed from the pages themselves. */
  listingPaths: string[];
}

/** The two sources this was built for. Adding another is a row here, not new code. */
export const DIRECTORY_SOURCES: DirectorySource[] = [
  {
    key: "conflists",
    host: "conflists.com",
    listingPaths: ["/", "/conferences", "/upcoming-conferences"],
  },
  {
    key: "iconf",
    host: "iconf.org",
    listingPaths: ["/", "/conferences", "/call-for-papers", "/cfp"],
  },
];

export type DirectoryOutcome =
  | "harvested"
  | "robots_blanket_disallow"
  | "robots_path_disallowed"
  | "access_controlled"
  | "unreachable"
  | "no_candidates_found";

export interface DirectorySourceReport {
  source: string;
  host: string;
  outcome: DirectoryOutcome;
  /** Verbatim, so a refusal is auditable rather than inferred. */
  detail: string;
  listingsFetched: number;
  candidates: number;
  errors: string[];
}

export interface DirectoryIngestStats {
  sources: DirectorySourceReport[];
  totalCandidates: number;
  uniqueCandidates: number;
}

export interface DirectoryProviderOptions {
  logger?: RunLogger;
  urlGuard?: UrlGuard;
  /** Which sources to run. Defaults to all of DIRECTORY_SOURCES. */
  sources?: DirectorySource[];
  /** Listing pages fetched per source. */
  maxListingsPerSource?: number;
  /** Candidate conference URLs kept per source. */
  maxCandidatesPerSource?: number;
  scheme?: "http" | "https";
}

/** Pagination links a listing offers about itself. */
export function paginationLinks(html: string, pageUrl: string, limit: number): string[] {
  const root = parseHtml(html);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const anchor of byTag(root, "a")) {
    if (found.length >= limit) break;
    const rel = (attr(anchor, "rel") || "").toLowerCase();
    const text = textOf(anchor).replace(/\s+/g, " ").trim().toLowerCase();
    const looksLikeNext = rel === "next" || /^(next|older|more|›|»|\d{1,3})$/.test(text);
    if (!looksLikeNext) continue;
    const href = absoluteUrl(attr(anchor, "href"), pageUrl);
    if (!href) continue;
    let target: URL;
    try { target = new URL(href); } catch { continue; }
    if (target.hostname.replace(/^www\./, "") !== new URL(pageUrl).hostname.replace(/^www\./, "")) continue;
    const key = canonicalizeUrl(target.href) || target.href;
    if (seen.has(key) || key === (canonicalizeUrl(pageUrl) || pageUrl)) continue;
    seen.add(key);
    found.push(target.href);
  }
  return found;
}

/** A response that means "you may not have this", as distinct from "this is broken". */
function isAccessControlled(status: number): boolean {
  return status === 401 || status === 403 || status === 407 || status === 451;
}

export class DirectoryDiscoveryProvider implements DiscoveryProvider {
  readonly name = "directory";
  readonly kind = "dataset" as const;
  readonly rateLimit = { requestsPerMinute: 40, maxConcurrent: 1 };
  // A seed, not a source of truth: lower than the organisation harvest and than search, because a
  // listing's claim about a conference is second-hand by construction.
  readonly baseConfidence = 0.4;
  readonly stats: DirectoryIngestStats = { sources: [], totalCandidates: 0, uniqueCandidates: 0 };

  constructor(private readonly options: DirectoryProviderOptions = {}) {}

  isEnabled(): boolean { return true; }
  unavailableReason(): string | null { return null; }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const scheme = this.options.scheme ?? "https";
    const maxListings = Math.max(1, this.options.maxListingsPerSource ?? 25);
    const maxCandidates = Math.max(1, this.options.maxCandidatesPerSource ?? 1_500);
    const sources = this.options.sources ?? DIRECTORY_SOURCES;
    const targetYears = context.targetYears ?? [];

    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();

    for (const source of sources) {
      if (context.signal?.aborted) break;
      const origin = `${scheme}://${source.host}`;
      const report: DirectorySourceReport = {
        source: source.key, host: source.host, outcome: "no_candidates_found", detail: "",
        listingsFetched: 0, candidates: 0, errors: [],
      };

      // ---- The access check, before anything else is requested.
      let policy: RobotsPolicy;
      try {
        policy = await fetchRobots(origin, { urlGuard: this.options.urlGuard, timeoutMs: 12_000 });
      } catch (error: any) {
        report.outcome = "unreachable";
        report.detail = `robots.txt could not be read: ${String(error?.message || error).slice(0, 160)}`;
        this.stats.sources.push(report);
        continue;
      }
      if (policy.blanketDisallow) {
        report.outcome = "robots_blanket_disallow";
        report.detail = `${source.host}/robots.txt disallows this crawler entirely; source skipped and left to Serper.`;
        this.stats.sources.push(report);
        this.options.logger?.log("robots_disallowed", { domain: source.host, detail: report.detail });
        continue;
      }
      if (policy.crawlDelayMs) setDomainCrawlDelay(source.host, policy.crawlDelayMs);

      const queue = source.listingPaths.map((path) => `${origin}${path}`);
      const visited = new Set<string>();
      let produced = 0;
      let blockedPaths = 0;

      while (queue.length > 0 && report.listingsFetched < maxListings && produced < maxCandidates) {
        const url = queue.shift()!;
        const key = canonicalizeUrl(url) || url;
        if (visited.has(key)) continue;
        visited.add(key);

        if (!isPathAllowed(policy, url)) {
          blockedPaths += 1;
          report.errors.push(`${url}: disallowed by robots.txt`);
          continue;
        }

        let body: string | null = null;
        try {
          const response = await discoveryFetch(url, { urlGuard: this.options.urlGuard, timeoutMs: 20_000 });
          report.listingsFetched += 1;
          if (isAccessControlled(response.status)) {
            report.outcome = "access_controlled";
            report.detail = `${url} answered HTTP ${response.status}. Bulk access is not available to this crawler; source skipped and left to Serper.`;
            break;
          }
          if (!response.ok || !response.body) {
            report.errors.push(`${url}: HTTP ${response.status}${response.error ? ` ${response.error}` : ""}`);
            continue;
          }
          body = response.body;
        } catch (error: any) {
          report.errors.push(`${url}: ${String(error?.message || error).slice(0, 160)}`);
          continue;
        }

        const add = (target: string, title: string, reason: string) => {
          const canonical = canonicalizeUrl(target) || target;
          if (seen.has(canonical) || produced >= maxCandidates) return;
          seen.add(canonical);
          produced += 1;
          this.stats.totalCandidates += 1;
          candidates.push({
            url: target,
            sourceDomain: source.host,
            provider: this.name,
            priority: 0.45,
            reason,
            hints: {
              title: title || null,
              // The whole point of a directory: it names an event, and the pipeline then goes and
              // finds the event's own site. This flag is what turns that on.
              directoryLeadEligible: true,
            },
          });
        };

        // schema.org first — a directory that publishes structured listings is telling us exactly
        // what it holds, and it costs nothing to read.
        for (const event of extractStructuredEvents(body, url).events) {
          const target = event.officialUrl || event.registrationUrl;
          if (target) add(target, event.title || "", `${source.key} structured listing`);
        }
        // Then the listing's own links, through the extractor used everywhere else.
        for (const link of conferenceLinksFrom(body, url, maxCandidates - produced, targetYears)) {
          add(link.url, link.title, `${source.key} listing link`);
        }

        for (const next of paginationLinks(body, url, 5)) {
          if (queue.length + report.listingsFetched < maxListings) queue.push(next);
        }
      }

      report.candidates = produced;
      if (report.outcome === "no_candidates_found") {
        if (produced > 0) {
          report.outcome = "harvested";
          report.detail = `${produced} candidates from ${report.listingsFetched} listing pages.`;
        } else if (blockedPaths > 0 && report.listingsFetched === 0) {
          report.outcome = "robots_path_disallowed";
          report.detail = `every listing path is disallowed by ${source.host}/robots.txt; source skipped and left to Serper.`;
        } else if (report.listingsFetched === 0) {
          report.outcome = "unreachable";
          report.detail = `no listing page could be fetched. ${report.errors[0] || ""}`.trim();
        } else {
          report.detail = `${report.listingsFetched} listing pages read, no conference links recognised.`;
        }
      }
      this.stats.sources.push(report);
      this.options.logger?.log("urls_discovered", {
        domain: source.host,
        detail: `${source.key}: ${report.outcome} — ${report.detail}`,
        count: produced,
      });
    }

    this.stats.uniqueCandidates = seen.size;
    return candidates;
  }
}
