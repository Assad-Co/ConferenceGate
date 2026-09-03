// The provider registry.
//
// The pipeline asks this for "every provider that can run right now" and never names one
// directly. Adding an RSS feed, a calendar feed or another search API means writing a class that
// implements DiscoveryProvider and adding it here.

import type { DiscoveryProvider } from "../types";
import { SitemapDiscoveryProvider, type SitemapProviderOptions } from "./sitemapProvider";
import { SearchDiscoveryProvider, type SearchAccounting, type SearchProviderOptions } from "./searchProvider";
import { CommonCrawlProvider, OpenAlexProvider } from "./phase2Providers";

export { SitemapDiscoveryProvider, SearchDiscoveryProvider, CommonCrawlProvider, OpenAlexProvider };
export type { SearchAccounting };

export interface ProviderSetOptions {
  sitemap?: SitemapProviderOptions;
  search?: SearchProviderOptions;
}

/** Every provider the engine knows about, enabled or not. */
export function allProviders(options: ProviderSetOptions = {}): DiscoveryProvider[] {
  return [
    new SitemapDiscoveryProvider(options.sitemap),
    new SearchDiscoveryProvider(options.search),
    new CommonCrawlProvider(),
    new OpenAlexProvider(),
  ];
}

/** Their availability, for the status endpoint and the run log. */
export function providerStatus(options: ProviderSetOptions = {}): Array<{
  name: string;
  kind: string;
  enabled: boolean;
  reason: string | null;
}> {
  return allProviders(options).map((provider) => ({
    name: provider.name,
    kind: provider.kind,
    enabled: provider.isEnabled(),
    reason: provider.unavailableReason(),
  }));
}
