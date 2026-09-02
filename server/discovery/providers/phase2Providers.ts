// Phase 2 providers: the interface, implemented, deliberately not doing the work yet.
//
// Sections 39 and 40 are explicit that Common Crawl and OpenAlex come after Phase 1 succeeds, and
// that nothing should be downloading Common Crawl segments now. These exist so that adding them
// later is a change inside one file rather than a change to the pipeline: each already reports
// itself as unavailable with a reason, which shows up in `/api/admin/discovery/status` as a
// planned-but-not-yet-enabled source rather than as a silent absence.

import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";

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
 *  The app already talks to OpenAlex for author-paper matching (server/openalex.ts); this would
 *  reuse that account-free API for venue discovery. Optional by design — nothing depends on it. */
export class OpenAlexProvider implements DiscoveryProvider {
  readonly name = "openalex";
  readonly kind = "api" as const;
  readonly rateLimit = { requestsPerMinute: 60, maxConcurrent: 2 };
  readonly baseConfidence = 0.4;

  isEnabled(): boolean {
    return process.env.DISCOVERY_OPENALEX === "1";
  }

  unavailableReason(): string | null {
    return this.isEnabled() ? null : "Phase 2: not implemented yet. Set DISCOVERY_OPENALEX=1 once venue discovery is built.";
  }

  async discover(_context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    return [];
  }
}
