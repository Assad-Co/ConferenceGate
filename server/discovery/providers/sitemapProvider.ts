// The Phase 1 discovery provider: registry domains → robots.txt → sitemaps → candidate URLs.
//
// It is free, it asks each site for its own index of itself, and it obeys what that site says
// about being crawled. That is why it is first in the cost order of section 42: no API key, no
// per-page billing, no search quota.

import { fetchRobots, isPathAllowed, type RobotsPolicy } from "../robots";
import { setDomainCrawlDelay, type UrlGuard } from "../httpClient";
import { discoverSitemapUrls, entriesToCandidates, scoreCandidateUrl } from "../sitemaps";
import {
  listDomains,
  normalizeDomain,
  recordCrawlFailure,
  recordRobotsPolicy,
  selectDomainsDueForCrawl,
  type DomainRow,
} from "../sourceRegistry";
import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import type { RunLogger } from "../logging";

export interface SitemapProviderOptions {
  logger?: RunLogger;
  urlGuard?: UrlGuard;
  /** Candidate URLs kept per domain, after scoring. */
  maxUrlsPerDomain?: number;
  /** Sitemap documents read per domain. */
  maxSitemapDocuments?: number;
  /** When true, every enabled domain is visited regardless of its schedule. */
  ignoreSchedule?: boolean;
  /** Extra pages to try when a domain publishes no readable sitemap at all. */
  fallbackPaths?: string[];
  /** http for the fixture harness; https everywhere else. */
  scheme?: "http" | "https";
}

/** Paths worth trying when a site has no sitemap: the places an events index usually lives. */
const DEFAULT_FALLBACK_PATHS = [
  "/events", "/events/", "/conferences", "/conferences/", "/meetings", "/calendar",
  "/events/upcoming", "/news-events", "/whats-on",
];

export class SitemapDiscoveryProvider implements DiscoveryProvider {
  readonly name = "sitemap";
  readonly kind = "sitemap" as const;
  readonly rateLimit = { requestsPerMinute: 50, maxConcurrent: 1 };
  readonly baseConfidence = 0.6;

  /** Domains skipped because their robots.txt said so, with the reason — reported, not hidden. */
  readonly skipped: Array<{ domain: string; reason: string }> = [];
  /** robots policies gathered during the last discover(), so the pipeline can reuse them rather
   *  than fetching robots.txt a second time before reading each page. */
  readonly policies = new Map<string, RobotsPolicy>();

  constructor(private readonly options: SitemapProviderOptions = {}) {}

  isEnabled(): boolean {
    return true;
  }

  unavailableReason(): string | null {
    return null;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const logger = this.options.logger;
    const scheme = this.options.scheme || "https";
    const maxPerDomain = this.options.maxUrlsPerDomain ?? 300;

    let domains: DomainRow[];
    if (context.domains && context.domains.length > 0) {
      const wanted = new Set(context.domains.map(normalizeDomain));
      domains = (await listDomains()).filter((row) => wanted.has(row.domain));
    } else if (this.options.ignoreSchedule) {
      domains = await listDomains({ enabledOnly: true });
    } else {
      domains = await selectDomainsDueForCrawl(50);
    }

    const candidates: DiscoveryCandidate[] = [];

    for (const domain of domains) {
      if (context.signal?.aborted) break;
      if (candidates.length >= context.maxCandidates) break;
      logger?.log("domain_started", { domain: domain.domain });

      const origin = `${scheme}://${domain.domain}`;
      const policy = await fetchRobots(origin, { urlGuard: this.options.urlGuard });
      this.policies.set(domain.domain, policy);
      setDomainCrawlDelay(domain.domain, policy.crawlDelayMs);

      if (policy.blanketDisallow) {
        // The site said no. It is skipped, the reason is recorded, and nothing else is tried.
        await recordRobotsPolicy(domain.domain, { allowed: false, crawlDelayMs: policy.crawlDelayMs, sitemaps: policy.sitemaps });
        this.skipped.push({ domain: domain.domain, reason: "robots_txt_disallows_crawling" });
        logger?.log("robots_disallowed", { domain: domain.domain, detail: "robots.txt disallows this crawler" });
        continue;
      }

      await recordRobotsPolicy(domain.domain, {
        allowed: true,
        crawlDelayMs: policy.crawlDelayMs,
        sitemaps: policy.sitemaps,
      });
      logger?.log("robots_fetched", {
        domain: domain.domain,
        detail: policy.fetched ? `${policy.rules.length} rules, ${policy.sitemaps.length} sitemaps declared` : "no robots.txt",
      });

      const sitemap = await discoverSitemapUrls(origin, {
        declaredSitemaps: policy.sitemaps,
        maxSitemapDocuments: this.options.maxSitemapDocuments ?? 15,
        maxEntries: Math.max(maxPerDomain * 5, 1000),
        urlGuard: this.options.urlGuard,
        onSitemapRead: (url, count) => logger?.log("sitemap_fetched", { domain: domain.domain, url, count }),
        onSitemapFailed: (url, reason) => logger?.log("sitemap_missing", { domain: domain.domain, url, detail: reason }),
      });

      let domainCandidates = entriesToCandidates(sitemap.entries, domain.domain, this.name, context.targetYears)
        .filter((candidate) => {
          if (isPathAllowed(policy, candidate.url)) return true;
          logger?.log("url_skipped", { domain: domain.domain, url: candidate.url, detail: "disallowed by robots.txt" });
          return false;
        })
        .slice(0, maxPerDomain);

      if (domainCandidates.length === 0) {
        // No readable sitemap. Try the handful of conventional index paths — still only pages the
        // site's own robots.txt permits — rather than giving up on the domain entirely.
        const fallbacks = (this.options.fallbackPaths ?? DEFAULT_FALLBACK_PATHS)
          .map((path) => `${origin}${path}`)
          .filter((url) => isPathAllowed(policy, url));
        domainCandidates = fallbacks.map((url) => {
          const { score, reason } = scoreCandidateUrl(url, context.targetYears);
          return {
            url,
            sourceDomain: domain.domain,
            provider: this.name,
            priority: Math.max(score, 0.4),
            reason: `${reason} (conventional index path; no sitemap available)`,
          } satisfies DiscoveryCandidate;
        });
        if (domainCandidates.length === 0) {
          await recordCrawlFailure(domain.domain, "no_sitemap_and_no_index_path_allowed");
        }
      }

      logger?.log("urls_discovered", { domain: domain.domain, count: domainCandidates.length });
      candidates.push(...domainCandidates);
    }

    return candidates.sort((left, right) => right.priority - left.priority).slice(0, context.maxCandidates);
  }
}
