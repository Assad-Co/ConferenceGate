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

import { pageText } from "./htmlExtract";
import { discoveryFetch, isHtmlLike, type FetchOptions, type FetchResult } from "./httpClient";
import { isJinaFallbackEnabled, readWithJina } from "./jinaFetch";

/** Below this much readable text, a page has not really been read: almost always a JS shell. */
export const MIN_EXTRACTABLE_TEXT_CHARS = 500;

export type ReadRoute = "direct" | "jina" | "none";

export interface PageRead {
  route: ReadRoute;
  html: string;
  /** The direct fetch's result, kept whatever the outcome: its ETag, status and content hash are
   *  what incremental crawling records, even when Jina supplied the text. */
  direct: FetchResult;
  textLength: number;
  /** True when the direct fetch alone was too thin and the reader was tried. */
  usedFallback: boolean;
  /** True when the fallback actually rescued a page the direct fetch could not deliver. */
  recovered: boolean;
  failureReason: string | null;
}

export interface ReadBudget {
  /** Reader calls still available this run. */
  jinaRemaining: number;
  jinaUsed: number;
  jinaRecovered: number;
  jinaSkippedForCap: number;
  directReads: number;
  directUsable: number;
}

export function newReadBudget(maxJinaPages: number): ReadBudget {
  return {
    jinaRemaining: Math.max(0, maxJinaPages),
    jinaUsed: 0,
    jinaRecovered: 0,
    jinaSkippedForCap: 0,
    directReads: 0,
    directUsable: 0,
  };
}

// The markdown conversion lives with the Jina route itself (jinaFetch.ts), so there is one
// implementation rather than one per call site. Re-exported here because this is where callers
// of the read chain expect to find it.
export { markdownToDocument } from "./jinaFetch";

/**
 * Reads one page through the chain, spending the reader budget only where it is needed.
 *
 * `allowFallback` lets the caller withhold the reader for pages it does not care enough about —
 * a low-priority candidate is not worth a paid read.
 */
export async function readPage(
  url: string,
  options: FetchOptions & { budget: ReadBudget; allowFallback?: boolean } = { budget: newReadBudget(0) }
): Promise<PageRead> {
  const { budget, allowFallback = true, ...fetchOptions } = options;
  const direct = await discoveryFetch(url, fetchOptions);

  if (direct.notModified) {
    return {
      route: "direct", html: "", direct, textLength: 0,
      usedFallback: false, recovered: false, failureReason: null,
    };
  }

  const directUsable = direct.ok && !!direct.body && isHtmlLike(direct);
  const directText = directUsable ? pageText(direct.body, 30000) : "";
  budget.directReads += 1;
  if (directUsable && directText.length >= MIN_EXTRACTABLE_TEXT_CHARS) {
    budget.directUsable += 1;
    return {
      route: "direct", html: direct.body, direct, textLength: directText.length,
      usedFallback: false, recovered: false, failureReason: null,
    };
  }

  // The direct fetch was not enough. Is the reader worth spending here?
  const thinReason = direct.blockedByLocalPolicy
    ? "blocked_by_local_egress_policy"
    : !direct.ok
      ? direct.error || `http_${direct.status}`
      : !isHtmlLike(direct)
        ? "not_html"
        : "too_little_text";

  // A local network block is not something a hosted reader can fix, and neither is a page that
  // simply is not HTML. Neither is worth a paid call.
  const worthFallback =
    allowFallback &&
    isJinaFallbackEnabled() &&
    !direct.blockedByLocalPolicy &&
    thinReason !== "not_html";

  if (!worthFallback) {
    return {
      route: directUsable ? "direct" : "none",
      html: directUsable ? direct.body : "",
      direct,
      textLength: directText.length,
      usedFallback: false,
      recovered: false,
      failureReason: directUsable ? null : thinReason,
    };
  }

  if (budget.jinaRemaining <= 0) {
    budget.jinaSkippedForCap += 1;
    return {
      route: directUsable ? "direct" : "none",
      html: directUsable ? direct.body : "",
      direct,
      textLength: directText.length,
      usedFallback: false,
      recovered: false,
      failureReason: directUsable ? null : `${thinReason} (reader budget exhausted)`,
    };
  }

  budget.jinaRemaining -= 1;
  budget.jinaUsed += 1;
  const jina = await readWithJina(url);
  if (!jina.ok) {
    return {
      route: directUsable ? "direct" : "none",
      html: directUsable ? direct.body : "",
      direct,
      textLength: directText.length,
      usedFallback: true,
      recovered: false,
      failureReason: directUsable ? null : `${thinReason}; ${jina.error ?? "reader returned nothing"}`,
    };
  }

  const html = jina.html;
  const text = pageText(html, 30000);
  if (text.length < MIN_EXTRACTABLE_TEXT_CHARS && directText.length >= text.length) {
    // The reader did no better than the direct fetch; keep whichever had more to say.
    return {
      route: directUsable ? "direct" : "none",
      html: directUsable ? direct.body : "",
      direct,
      textLength: directText.length,
      usedFallback: true,
      recovered: false,
      failureReason: directUsable ? null : `${thinReason}; reader added nothing`,
    };
  }

  budget.jinaRecovered += 1;
  return {
    route: "jina", html, direct, textLength: text.length,
    usedFallback: true, recovered: true, failureReason: null,
  };
}
