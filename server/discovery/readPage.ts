// The page-reading chain: direct fetch first, the hosted reader only when it has to be.
//
// Order and gating, matching the cost discipline the rest of the engine follows:
//
//   1. A plain HTTPS fetch. Free, and the only route that returns real HTML — which matters
//      enormously, because JSON-LD lives in a <script> tag and survives nothing else.
//   2. Jina's hosted reader, but ONLY when the direct fetch either failed outright or came back
//      with too little text to extract anything from (the signature of a JavaScript-rendered
//      shell). It is capped per run, so a crawl of four hundred pages cannot quietly become four
//      hundred reader calls.
//
// Jina returns markdown, not HTML, so its output is wrapped into a minimal document before it
// reaches the extractors. That is not cosmetic: the deterministic extractor reads labels out of a
// parsed tree and needs a title element to find a conference's name. Structured data is
// unavailable on this route by definition — markdown has no <script> — which is exactly why it is
// second and not first.

import { alternateUrlsFor, MAX_ALTERNATES_PER_URL } from "./alternateUrl";
import { classifyFailure, failurePolicy, type FailureClass } from "./failureClass";
import { pageText } from "./htmlExtract";
import { discoveryFetch, isHtmlLike, type FetchOptions, type FetchResult } from "./httpClient";
import { isJinaFallbackEnabled, readWithJina } from "./jinaFetch";

/** Below this much readable text, a page has not really been read: almost always a JS shell. */
export const MIN_EXTRACTABLE_TEXT_CHARS = 500;

/** Which route finally produced usable text. `alternate_url` means a different URL on the same
 *  site answered after the requested one did not. */
export type ReadRoute = "direct" | "jina" | "alternate_url" | "none";

export interface PageRead {
  route: ReadRoute;
  html: string;
  /** The direct fetch's result, kept whatever the outcome: its ETag, status and content hash are
   *  what incremental crawling records, even when Jina supplied the text. */
  direct: FetchResult;
  textLength: number;
  /** True when the direct fetch alone was too thin and the reader was tried. */
  usedFallback: boolean;
  /** Why a hosted-reader attempt failed, kept separately from the direct-fetch failure. */
  fallbackFailureReason: string | null;
  /** True when the fallback actually rescued a page the direct fetch could not deliver. */
  recovered: boolean;
  failureReason: string | null;
  /** Exactly why the direct fetch did not suffice, from the taxonomy. Null when it did. */
  failureClass: FailureClass | null;
  /** The URL that actually answered, when it was not the one asked for. */
  resolvedUrl: string | null;
}

export interface ReadBudget {
  /** Reader calls still available this run. */
  jinaRemaining: number;
  jinaUsed: number;
  jinaRecovered: number;
  jinaSkippedForCap: number;
  directReads: number;
  directUsable: number;
  /** Alternate-URL attempts still available this run, and what they achieved. */
  alternateRemaining: number;
  alternateAttempted: number;
  alternateRecovered: number;
  /** Failure classes seen, so a run can report the taxonomy without a database round-trip. */
  failureClasses: Record<string, number>;
}

export function newReadBudget(maxJinaPages: number, maxAlternateUrls = 60): ReadBudget {
  return {
    jinaRemaining: Math.max(0, maxJinaPages),
    jinaUsed: 0,
    jinaRecovered: 0,
    jinaSkippedForCap: 0,
    directReads: 0,
    directUsable: 0,
    alternateRemaining: Math.max(0, maxAlternateUrls),
    alternateAttempted: 0,
    alternateRecovered: 0,
    failureClasses: {},
  };
}

// The markdown conversion lives with the Jina route itself (jinaFetch.ts), so there is one
// implementation rather than one per call site. Re-exported here because this is where callers
// of the read chain expect to find it.
export { markdownToDocument } from "./jinaFetch";

/**
 * Reads one page through the cascade:
 *
 *   1. direct fetch
 *   2. the hosted reader, if the direct read failed or was too thin (capped, opt-in)
 *   3. an alternate URL on the same site, if the failure class says one could help
 *
 * Stage 3 exists because Phase 1.2 discarded a reachable conference every time a deep link had
 * gone stale. It never guesses at a domain and never spends search quota: the alternates come
 * from the failed URL itself, and each is subject to the same robots, SSRF and politeness rules.
 *
 * `allowFallback` lets the caller withhold the paid stages for pages it does not care enough
 * about — a low-priority candidate is not worth a reader call.
 */
export async function readPage(
  url: string,
  options: FetchOptions & {
    budget: ReadBudget;
    allowFallback?: boolean;
    /** Test seam proving the cascade without reaching a third-party service. */
    jinaReader?: typeof readWithJina;
  } = { budget: newReadBudget(0) }
): Promise<PageRead> {
  const { budget, allowFallback = true, jinaReader = readWithJina, ...fetchOptions } = options;
  const direct = await discoveryFetch(url, fetchOptions);

  if (direct.notModified) {
    return {
      route: "direct", html: "", direct, textLength: 0, usedFallback: false,
      recovered: false, failureReason: null, fallbackFailureReason: null, failureClass: null, resolvedUrl: null,
    };
  }

  const directUsable = direct.ok && !!direct.body && isHtmlLike(direct);
  const directText = directUsable ? pageText(direct.body, 30000) : "";
  budget.directReads += 1;

  if (directUsable && directText.length >= MIN_EXTRACTABLE_TEXT_CHARS) {
    budget.directUsable += 1;
    return {
      route: "direct", html: direct.body, direct, textLength: directText.length,
      usedFallback: false, recovered: false, failureReason: null, fallbackFailureReason: null, failureClass: null, resolvedUrl: null,
    };
  }

  // The direct read was not enough. Name exactly why, once, and let the policy for that class
  // decide which of the remaining stages are even worth attempting.
  const failureClass: FailureClass = direct.ok && directUsable
    ? "empty_response"
    : classifyFailure({
        status: direct.status,
        error: direct.error,
        blockedByLocalPolicy: direct.blockedByLocalPolicy,
        contentType: direct.contentType,
      });
  budget.failureClasses[failureClass] = (budget.failureClasses[failureClass] || 0) + 1;
  const policy = failurePolicy(failureClass);

  let jinaAttempted = false;
  let jinaFailureReason: string | null = null;
  const asDirect = (reason: string | null): PageRead => ({
    route: directUsable ? "direct" : "none",
    html: directUsable ? direct.body : "",
    direct,
    textLength: directText.length,
    usedFallback: jinaAttempted,
    recovered: false,
    failureReason: directUsable ? null : reason,
    fallbackFailureReason: jinaFailureReason,
    failureClass,
    resolvedUrl: null,
  });

  // ---- Stage 2: the hosted reader.
  // A local network block is not something a hosted reader can fix, and neither is a response
  // that was never HTML. Neither is worth a paid call.
  const worthReader =
    allowFallback &&
    isJinaFallbackEnabled() &&
    !direct.blockedByLocalPolicy &&
    failureClass !== "unsupported_content" &&
    failureClass !== "blocked_by_url_guard";

  if (worthReader && budget.jinaRemaining <= 0) {
    budget.jinaSkippedForCap += 1;
  } else if (worthReader) {
    budget.jinaRemaining -= 1;
    budget.jinaUsed += 1;
    jinaAttempted = true;
    const jina = await jinaReader(url);
    if (jina.ok) {
      const text = pageText(jina.html, 30000);
      if (text.length >= MIN_EXTRACTABLE_TEXT_CHARS || text.length > directText.length) {
        budget.jinaRecovered += 1;
        return {
          route: "jina", html: jina.html, direct, textLength: text.length,
          usedFallback: true, recovered: true, failureReason: null, fallbackFailureReason: null, failureClass, resolvedUrl: null,
        };
      }
      jinaFailureReason = "reader_returned_too_little_for_extraction";
    } else {
      jinaFailureReason = jina.error || "reader_returned_nothing";
    }
  }

  // ---- Stage 3: a different URL for the same conference.
  if (allowFallback && policy.tryAlternateUrl && budget.alternateRemaining > 0 && !direct.blockedByLocalPolicy) {
    for (const alternate of alternateUrlsFor(url, failureClass).slice(0, MAX_ALTERNATES_PER_URL)) {
      if (budget.alternateRemaining <= 0) break;
      budget.alternateRemaining -= 1;
      budget.alternateAttempted += 1;
      // Deliberately without the conditional-request validators: they belong to the URL that
      // failed, not to this one.
      const retry = await discoveryFetch(alternate.url, { ...fetchOptions, etag: null, lastModified: null });
      if (!retry.ok || !retry.body || !isHtmlLike(retry)) continue;
      const retryText = pageText(retry.body, 30000);
      if (retryText.length < MIN_EXTRACTABLE_TEXT_CHARS) continue;
      budget.alternateRecovered += 1;
      return {
        route: "alternate_url",
        html: retry.body,
        // The alternate's own response becomes the record's fetch state: its ETag and content
        // hash are what incremental crawling should remember, not the dead URL's.
        direct: retry,
        textLength: retryText.length,
        usedFallback: true,
        recovered: true,
        failureReason: null,
        fallbackFailureReason: jinaFailureReason,
        failureClass,
        resolvedUrl: retry.finalUrl || alternate.url,
      };
    }
  }

  return asDirect(
    budget.jinaSkippedForCap > 0 && worthReader ? `${failureClass} (reader budget exhausted)` : failureClass
  );
}
