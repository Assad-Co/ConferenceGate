// Phase 2 providers.
//
// Common Crawl is still a stub, and says so. OpenAlex is now real: it enumerates conference series
// from a scholarly index, which is the one thing search discovery structurally cannot do — search
// only finds conferences somebody already thought to query for. Since February 2026 that index
// bills per request against a small daily budget, so it wants OPENALEX_API_KEY set.
//
// Sections 39 and 40 are explicit that Common Crawl and OpenAlex come after Phase 1 succeeds, and
// that nothing should be downloading Common Crawl segments now. These exist so that adding them
// later is a change inside one file rather than a change to the pipeline: each already reports
// itself as unavailable with a reason, which shows up in `/api/admin/discovery/status` as a
// planned-but-not-yet-enabled source rather than as a silent absence.

import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import {
  fetchOpenAlexConferenceSeries,
  mapOpenAlexSeries,
  type OpenAlexSource,
} from "../../dataset/sources/openalex";

/** Mass discovery of pages carrying schema.org Event markup, from Common Crawl's index. */
export class CommonCrawlProvider implements DiscoveryProvider {
  readonly name = "common_crawl";
  readonly kind = "dataset" as const;
  readonly rateLimit = { requestsPerMinute: 60, maxConcurrent: 2 };
  readonly baseConfidence = 0.35;

  isEnabled(): boolean {
    // Guarded by an explicit flag AND an index URL, so it cannot start pulling a dataset because
    // someone set one environment variable by accident.
    return process.env.DISCOVERY_COMMON_CRAWL === "1" && !!process.env.COMMON_CRAWL_INDEX_URL;
  }

  unavailableReason(): string | null {
    return this.isEnabled()
      ? null
      : "Phase 2: not implemented yet. Set DISCOVERY_COMMON_CRAWL=1 and COMMON_CRAWL_INDEX_URL once the columnar-index query is built.";
  }

  async discover(_context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    return [];
  }
}

/** Academic and scientific conference ecosystems, from OpenAlex's free scholarly index.
 *
 *  OpenAlex answers the question search discovery cannot: which conference series exist at all.
 *  Search can only find conferences somebody thought to query for; this enumerates them, in every
 *  discipline. Cheap rather than free: about $0.0001 a request against a daily budget that a free
 *  API key raises tenfold.
 *
 *  What it yields is a series' homepage, not a dated edition — OpenAlex is bibliographic and
 *  backward-looking. That is still a strong lead: the homepage of a real recurring conference is
 *  exactly the kind of page the reading cascade is good at turning into this year's edition.
 *  Series with no homepage are skipped rather than guessed at.
 */
export class OpenAlexProvider implements DiscoveryProvider {
  readonly name = "openalex";
  readonly kind = "api" as const;
  readonly rateLimit = { requestsPerMinute: 60, maxConcurrent: 2 };
  readonly baseConfidence = 0.4;

  isEnabled(): boolean {
    return process.env.DISCOVERY_OPENALEX === "1";
  }

  unavailableReason(): string | null {
    return this.isEnabled()
      ? null
      : "Set DISCOVERY_OPENALEX=1 to enumerate conference series from OpenAlex. Set OPENALEX_API_KEY too — the unauthenticated daily budget is spent almost immediately from a shared host.";
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    if (!this.isEnabled()) return [];
    const limit = Math.max(1, context.maxCandidates);

    let sources: OpenAlexSource[];
    try {
      // Asks for more than the ceiling because most series carry no homepage, and only those that
      // do can become candidates.
      sources = await fetchOpenAlexConferenceSeries({ maxSeries: limit * 4, minWorks: 25 });
    } catch {
      // A source that cannot be reached contributes nothing; it never fails the run.
      return [];
    }

    const candidates: DiscoveryCandidate[] = [];
    const seenHosts = new Set<string>();
    for (const source of sources) {
      if (candidates.length >= limit) break;
      const series = mapOpenAlexSeries(source);
      if (!series?.homepageUrl) continue;

      let host: string;
      try {
        host = new URL(series.homepageUrl).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
      // One lead per host: a society's page is the same page however many of its series name it.
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);

      candidates.push({
        url: series.homepageUrl,
        sourceDomain: host,
        provider: this.name,
        // An established series is a better lead than a barely-published one, but this is a
        // homepage rather than a dated edition, so it never scores as highly as a search hit on a
        // conference's own year page.
        priority: series.worksCount >= 500 ? 0.5 : 0.35,
        reason: `OpenAlex conference series with ${series.worksCount} works`,
        hints: {
          title: series.name,
          organization: series.name,
          organizationAcronym: series.acronym,
          organizationDomain: host,
          discoveryProviders: [this.name],
        },
      });
    }
    return candidates;
  }
}
