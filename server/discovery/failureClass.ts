// A fetch failure is not one thing, and treating it as one thing is expensive.
//
// A 403 means "this site refuses this crawler" and there is nothing to retry. A 429 means "slow
// down" and there is everything to retry. A DNS failure means the host does not exist. A TLS
// failure means it exists but we cannot talk to it safely. A connection reset mid-transfer means
// try again. A 404 on a deep link means the site is probably fine and the URL is stale — which is
// the one case where looking for a different URL on the same site is worth doing.
//
// Phase 1.2 recorded all of these as one string in one column, so "203 terminal failures" could
// not be turned into a plan. This is the taxonomy that makes it actionable, and every class here
// carries the two decisions that follow from it: is it worth retrying, and is it worth looking
// for an alternate URL.

export const FAILURE_CLASSES = [
  "http_401",
  "http_403",
  "http_404",
  "http_406",
  "http_410",
  "http_429",
  "http_451",
  "http_4xx_other",
  "http_5xx",
  "timeout",
  "dns_failure",
  "tls_failure",
  "connection_reset",
  "connection_refused",
  "redirect_failure",
  "response_size_limit",
  "unsupported_content",
  "empty_response",
  "reader_failure",
  "blocked_by_local_egress_policy",
  "blocked_by_url_guard",
  "robots_disallowed",
  "other",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface FailurePolicy {
  /** Worth asking the same URL again, later in this run or a later one. */
  retryable: boolean;
  /** Worth looking for a different URL that might carry the same conference. A stale deep link
   *  is the archetype: the site is healthy, this path is not. */
  tryAlternateUrl: boolean;
  /** Counts towards a domain's "this host is refusing us" tally, which trips the circuit breaker.
   *  A 404 deliberately does not: one missing page says nothing about the next one. */
  countsAsDomainRefusal: boolean;
  /** One line, in plain words, for the diagnosis report. */
  meaning: string;
}

const POLICIES: Record<FailureClass, FailurePolicy> = {
  http_401: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: true, meaning: "the page requires authentication" },
  http_403: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: true, meaning: "the site refuses this crawler outright" },
  http_404: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "the URL is stale or wrong; the site itself may be fine" },
  http_406: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: true, meaning: "the server rejected our Accept header" },
  http_410: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "the page is gone, permanently and deliberately" },
  http_429: { retryable: true, tryAlternateUrl: false, countsAsDomainRefusal: true, meaning: "we are asking too fast — back off, do not give up" },
  http_451: { retryable: false, tryAlternateUrl: false, countsAsDomainRefusal: true, meaning: "withheld for legal reasons" },
  http_4xx_other: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "another client-side rejection" },
  http_5xx: { retryable: true, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "the site is broken or overloaded right now" },
  timeout: { retryable: true, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "no answer in time" },
  dns_failure: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "the hostname does not resolve" },
  tls_failure: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "the certificate could not be verified" },
  connection_reset: { retryable: true, tryAlternateUrl: false, countsAsDomainRefusal: true, meaning: "the connection was cut mid-transfer" },
  connection_refused: { retryable: true, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "nothing is listening on that port" },
  redirect_failure: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "a redirect loop, or a redirect we would not follow" },
  response_size_limit: { retryable: false, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "the page exceeded the size cap" },
  unsupported_content: { retryable: false, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "not a page we extract from (a PDF, an image, a feed)" },
  empty_response: { retryable: true, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "a 200 with nothing in it" },
  reader_failure: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "the hosted reader could not read it either" },
  blocked_by_local_egress_policy: { retryable: false, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "OUR network refused — nothing to do with the site" },
  blocked_by_url_guard: { retryable: false, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "the URL pointed somewhere we must not fetch" },
  robots_disallowed: { retryable: false, tryAlternateUrl: false, countsAsDomainRefusal: false, meaning: "the site asked crawlers not to read this" },
  other: { retryable: false, tryAlternateUrl: true, countsAsDomainRefusal: false, meaning: "unclassified" },
};

export function failurePolicy(failureClass: FailureClass): FailurePolicy {
  return POLICIES[failureClass] ?? POLICIES.other;
}

/**
 * Turns whatever a failed fetch produced into exactly one class.
 *
 * HTTP status wins when there is one, because it is the site's own answer. Otherwise the error
 * string is read for the transport-level signatures Node produces. `other` is a real answer and
 * not a dumping ground: anything landing there should be looked at, which is why the diagnosis
 * report lists its raw messages verbatim.
 */
export function classifyFailure(input: {
  status?: number | null;
  error?: string | null;
  blockedByLocalPolicy?: boolean;
  contentType?: string | null;
}): FailureClass {
  if (input.blockedByLocalPolicy) return "blocked_by_local_egress_policy";

  const error = String(input.error ?? "");
  if (error === "blocked_by_url_guard" || error === "redirect_blocked_by_url_guard") return "blocked_by_url_guard";
  if (error === "robots_disallowed") return "robots_disallowed";
  if (error === "not_html" || error === "unsupported_content") return "unsupported_content";
  if (error === "response_size_limit") return "response_size_limit";
  if (error === "too_many_redirects" || error === "redirect_without_location" || error === "redirect_location_unparseable") {
    return "redirect_failure";
  }
  if (/^reader_|reader returned|reader added|reader_disabled/i.test(error)) return "reader_failure";

  const status = Number(input.status ?? 0);
  if (status >= 500) return "http_5xx";
  if (status === 401) return "http_401";
  if (status === 403) return "http_403";
  if (status === 404) return "http_404";
  if (status === 406) return "http_406";
  if (status === 410) return "http_410";
  if (status === 429) return "http_429";
  if (status === 451) return "http_451";
  if (status >= 400) return "http_4xx_other";

  // No status: a transport failure. Node's error codes and messages are the evidence.
  if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(error)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(error)) return "dns_failure";
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO|certificate|SSL/i.test(error)) return "tls_failure";
  if (/ECONNRESET|socket hang up|premature close|ERR_STREAM/i.test(error)) return "connection_reset";
  if (/ECONNREFUSED/i.test(error)) return "connection_refused";
  if (/EPIPE|EHOSTUNREACH|ENETUNREACH/i.test(error)) return "connection_reset";
  if (status === 200 || /empty/i.test(error)) return "empty_response";
  return "other";
}

/** Groups the classes for a report, so a reader sees "the site refused us" rather than six rows. */
export function failureFamily(failureClass: FailureClass): string {
  if (failureClass.startsWith("http_")) {
    if (failureClass === "http_429") return "rate limited";
    if (failureClass === "http_5xx") return "site error";
    if (failureClass === "http_404" || failureClass === "http_410") return "stale URL";
    return "site refused us";
  }
  if (["timeout", "connection_reset", "connection_refused"].includes(failureClass)) return "transport";
  if (["dns_failure", "tls_failure"].includes(failureClass)) return "host unusable";
  if (["blocked_by_local_egress_policy", "blocked_by_url_guard", "robots_disallowed"].includes(failureClass)) return "we declined or were blocked locally";
  if (["unsupported_content", "response_size_limit"].includes(failureClass)) return "not extractable";
  return "other";
}
