// A discovery provider backed by Conference Gate's EXISTING web-search integration.
//
// This adds nothing new: it calls `searchWebForConferenceFacts` from server/braveSearch.ts, which
// already tries Brave first and falls back to Serper, already queues requests against Brave's
// per-second limit, and already caches for an hour. Nothing about the existing Discover search is
// changed or removed (section 41).
//
// It is off by default. Search quota is paid capacity that Discover's own visitors are using, and
// the sitemap route is free — so this is opt-in, for filling gaps in coverage rather than for
// bulk discovery (section 42).

import { searchWebForConferenceFactsByProvider } from "../../braveSearch";
import { scoreCandidateUrl } from "../sitemaps";
import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import type { RunLogger } from "../logging";

export interface SearchProviderOptions {
  logger?: RunLogger;
  /** Explicitly enable; defaults to the DISCOVERY_SEARCH_PROVIDER env flag. */
  enabled?: boolean;
  /** Results requested per query. Kept small: each one costs quota. */
  resultsPerQuery?: number;
  maxQueries?: number;
}

export class SearchDiscoveryProvider implements DiscoveryProvider {
  readonly name = "search";
  readonly kind = "search" as const;
  readonly rateLimit = { requestsPerMinute: 30, maxConcurrent: 1 };
  readonly baseConfidence = 0.45;
  readonly metrics: Record<string, { queriesIssued: number; rawResults: number; uniqueUrls: number; sharedUrls: number }> = {};

  constructor(private readonly options: SearchProviderOptions = {}) {}

  isEnabled(): boolean {
    if (this.options.enabled !== undefined) return this.options.enabled;
    if (process.env.DISCOVERY_SEARCH_PROVIDER !== "1") return false;
    return !!process.env.BRAVE_SEARCH_API_KEY || !!process.env.SERPER_API_KEY;
  }

  unavailableReason(): string | null {
    if (this.isEnabled()) return null;
    if (process.env.DISCOVERY_SEARCH_PROVIDER !== "1") {
      return "disabled by default to protect search quota; set DISCOVERY_SEARCH_PROVIDER=1 to enable";
    }
    return "no BRAVE_SEARCH_API_KEY or SERPER_API_KEY configured";
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    if (!this.isEnabled()) return [];
    const topics = context.topics ?? [];
    if (topics.length === 0) return [];

    const perQuery = this.options.resultsPerQuery ?? 8;
    const maxQueries = this.options.maxQueries ?? 30;
    const queries: string[] = [];
    const regions = ["Europe", "Asia", "Africa", "Middle East", "North America", "South America", "Oceania"];
    const countries = ["Germany", "Japan", "UAE", "Canada", "Brazil", "Singapore", "South Africa", "Australia"];
    const eventTypes = ["conference", "congress", "symposium", "summit", "annual meeting"];
    const years = [...context.targetYears].sort((a, b) => (a === 2027 ? -1 : b === 2027 ? 1 : a - b));
    outer: for (const year of years) {
      for (let i = 0; i < Math.max(topics.length, regions.length, countries.length); i += 1) {
        const topic = topics[i % topics.length];
        const place = i % 2 === 0 ? regions[i % regions.length] : countries[i % countries.length];
        const kind = eventTypes[i % eventTypes.length];
        queries.push(`${year} ${topic} ${kind} ${place} official`);
        if (queries.length >= maxQueries) break outer;
      }
    }

    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();
    queryLoop: for (const query of queries) {
      if (context.signal?.aborted) break;
      const results = await searchWebForConferenceFactsByProvider(query, perQuery);
      const counts = results.reduce<Record<string, number>>((a, r) => { const p = r.discoveryProvider || "unknown"; a[p] = (a[p] || 0) + 1; return a; }, {});
      for (const provider of ["brave", "serper"]) {
        if (!counts[provider]) continue;
        const metric = this.metrics[provider] ||= { queriesIssued: 0, rawResults: 0, uniqueUrls: 0, sharedUrls: 0 };
        metric.queriesIssued += 1;
        metric.rawResults += counts[provider];
        this.options.logger?.log("search_results", { detail: `${provider}: ${query}`, count: counts[provider] });
      }
      for (const result of results) {
        if (!result.link) continue;
        if (seen.has(result.link)) {
          const existing = candidates.find((candidate) => candidate.url === result.link);
          const provider = result.discoveryProvider || "unknown";
          if (existing && !existing.hints?.discoveryProviders?.includes(provider)) {
            existing.hints?.discoveryProviders?.push(provider);
            existing.provider = existing.hints?.discoveryProviders?.sort().join("+") || existing.provider;
          }
          continue;
        }
        seen.add(result.link);
        let domain: string;
        try {
          domain = new URL(result.link).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          continue;
        }
        const { score, reason } = scoreCandidateUrl(result.link, context.targetYears);
        candidates.push({
          url: result.link,
          sourceDomain: domain,
          provider: result.discoveryProvider || this.name,
          // A search hit that already names an event in its title is a stronger candidate than
          // the URL alone suggests, but never as strong as a domain we chose to trust.
          priority: Math.min(0.85, score + (/\b(conference|congress|symposium|summit)\b/i.test(result.title) ? 0.2 : 0)),
          reason: `${reason}; web search result for "${query}"`,
          hints: { title: result.title, snippet: result.snippet, discoveryProviders: [result.discoveryProvider || "unknown"], discoveryQuery: query },
        });
        if (candidates.length >= context.maxCandidates) break queryLoop;
      }
    }
    for (const provider of Object.keys(this.metrics)) {
      this.metrics[provider].uniqueUrls = candidates.filter((candidate) => candidate.hints?.discoveryProviders?.includes(provider)).length;
      this.metrics[provider].sharedUrls = candidates.filter((candidate) => (candidate.hints?.discoveryProviders?.length || 0) > 1 && candidate.hints?.discoveryProviders?.includes(provider)).length;
    }
    return candidates;
  }
}
