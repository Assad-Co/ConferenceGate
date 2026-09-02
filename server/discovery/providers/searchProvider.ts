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

import { searchWebForConferenceFacts } from "../../braveSearch";
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
    const maxQueries = this.options.maxQueries ?? 10;
    const queries: string[] = [];
    for (const topic of topics) {
      for (const year of context.targetYears) {
        queries.push(`${topic} conference ${year} call for papers registration`);
        if (queries.length >= maxQueries) break;
      }
      if (queries.length >= maxQueries) break;
    }

    const candidates: DiscoveryCandidate[] = [];
    const seen = new Set<string>();
    for (const query of queries) {
      if (context.signal?.aborted) break;
      const results = await searchWebForConferenceFacts(query, perQuery);
      this.options.logger?.log("urls_discovered", { detail: `search "${query}"`, count: results.length });
      for (const result of results) {
        if (!result.link || seen.has(result.link)) continue;
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
          provider: this.name,
          // A search hit that already names an event in its title is a stronger candidate than
          // the URL alone suggests, but never as strong as a domain we chose to trust.
          priority: Math.min(0.85, score + (/\b(conference|congress|symposium|summit)\b/i.test(result.title) ? 0.2 : 0)),
          reason: `${reason}; web search result for "${query}"`,
          hints: { title: result.title, snippet: result.snippet },
        });
        if (candidates.length >= context.maxCandidates) return candidates;
      }
    }
    return candidates;
  }
}
