// The three legacy live-crawl endpoints, closed to customer traffic.
//
// Discover and the conference detail page read stored records only — nothing the shipped UI does
// starts a crawl. But `POST /api/ai/extract-conference`, its `/prefetch` and its `/focus` predate
// that change and were left reachable by anyone who knew the paths, with no authentication at
// all. One direct request could start a full site crawl and a Gemini extraction: precisely the
// customer-time crawling the pipeline was moved off, only without a customer.
//
// They are not deleted, because preparing a single conference by hand is still occasionally worth
// doing. They are closed instead, and closed by default: with no operator token configured they
// answer as though they do not exist, so an anonymous request can never reach a crawler, a search
// provider, a hosted reader, a browser, or the model. The read-only `/cached` and `/status` routes
// are deliberately left open — they only ever return what is already stored or already in memory.

import type { NextFunction, Request, Response } from "express";

/** The same header the discovery admin API uses, so operators have one token rather than two. */
export const INTERNAL_CRAWL_HEADER = "x-discovery-admin-token";

/** What a caller without the token sees. Says what to use instead rather than only refusing, and
 *  does not hint that a token would change the answer. */
export const LEGACY_CRAWL_UNAVAILABLE = {
  error:
    "Live conference extraction is not available. Conference details are served from stored Conference Gate records.",
} as const;

/** Comparison without an early exit. The token is not derived from user data, so this is not
 *  strictly required — it just costs nothing and removes a timing signal on the prefix. */
function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * True only for a caller presenting the configured operator token.
 *
 * Fail-closed in both directions that matter: an unset `DISCOVERY_ADMIN_TOKEN` authorizes nobody
 * (so the endpoints are simply off until an operator deliberately turns them on), and an empty or
 * absent header never matches an empty expected value.
 */
export function hasInternalCrawlAuthorization(
  headerValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = env.DISCOVERY_ADMIN_TOKEN;
  if (!expected) return false;
  return tokensMatch(headerValue || "", expected);
}

/** Express guard for the routes that can start a crawl. */
export function requireInternalCrawlAuthorization(req: Request, res: Response, next: NextFunction): void {
  if (!hasInternalCrawlAuthorization(req.get(INTERNAL_CRAWL_HEADER))) {
    res.status(404).json(LEGACY_CRAWL_UNAVAILABLE);
    return;
  }
  next();
}
