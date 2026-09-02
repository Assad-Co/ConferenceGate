// A second web-search provider, used when Brave is unavailable — unset, rate-limited, or erroring.
//
// Brave's free plan caps at roughly one request per second and 2,000 queries a month, which
// Discover can exhaust on its own: a single typed search now fans out across seven world regions,
// and the default view fires ten subject queries. When that ceiling is hit every one of those
// requests comes back as "Request rate limit exceeded for plan" and Discover shows nothing, which
// is the failure this provider exists to absorb.
//
// Serper is a Google-results API: the same index a person would search by hand, which matters here
// because conference organisers' own sites are indexed well by Google and are exactly what
// Discover is trying to surface. Its free allowance (2,500 queries) and per-query price are both
// well clear of what this app generates.
//
// Missing key = this provider is simply skipped, matching every other optional integration here.

import type { LiveSearchResult } from "./braveSearch";

export function isSerperConfigured(): boolean {
  return !!process.env.SERPER_API_KEY;
}

/** Raw Google-backed results for a query. Returns [] rather than throwing when the provider isn't
 *  configured, so a caller can treat "no second provider" the same as "second provider found
 *  nothing" — neither is an error worth failing a search over. Genuine request failures do throw,
 *  so the caller can report that every provider failed rather than silently showing an empty
 *  Discover. */
export async function serperSearch(query: string, count = 20): Promise<LiveSearchResult[]> {
  if (!isSerperConfigured()) return [];

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    // Serper caps `num` at 100; Brave's own ceiling is 20, and the callers here are tuned for that
    // shape, so the same bound is kept rather than silently changing result volume per provider.
    body: JSON.stringify({ q: query, num: Math.min(Math.max(count, 1), 20) }),
    signal: AbortSignal.timeout(10000),
  });

  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Serper search failed (unexpected response, HTTP ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(body?.message || `Serper search error (${res.status})`);
  }

  const organic: any[] = Array.isArray(body.organic) ? body.organic : [];
  return organic.map((item) => {
    let displayLink = "";
    try {
      displayLink = new URL(item.link).hostname;
    } catch {
      // A result without a parseable URL still carries a usable title/snippet; the callers'
      // own filters decide whether to keep it, and they already tolerate an empty host.
    }
    return {
      title: typeof item.title === "string" ? item.title : "",
      link: typeof item.link === "string" ? item.link : "",
      snippet: typeof item.snippet === "string" ? item.snippet : "",
      displayLink,
      // Serper's organic results carry neither of these; null is the honest value, and every
      // consumer already renders a fallback rather than assuming an image exists.
      thumbnail: null,
      favicon: null,
      discoveryProvider: "serper" as const,
    };
  });
}

