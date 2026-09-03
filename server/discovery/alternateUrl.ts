// When a URL fails, is there a different URL that carries the same conference?
//
// Phase 1.2's benchmark had 203 terminal failures against 121 successful fetches, and treated
// every one as the end of the road. Many were not. A conference site that 404s on
// `/events/2027/water-congress` is usually alive at `/`; a host that fails DNS on `example.org`
// often resolves as `www.example.org`. Those are the same conference, one hop away.
//
// This is deliberately conservative. It generates a SMALL number of candidates from the failed
// URL itself — no guessing at paths, no inventing domains, no search spend — and each one still
// goes through robots.txt, the SSRF guard and per-domain politeness like any other fetch. The
// point is to stop discarding reachable conferences, not to brute-force a site.

import { failurePolicy, type FailureClass } from "./failureClass";

export interface AlternateCandidate {
  url: string;
  /** Why this is worth one request, in words, for the run log. */
  reason: string;
}

/** How many alternates a single failed URL may ever justify. */
export const MAX_ALTERNATES_PER_URL = 2;

function withHost(url: URL, host: string): string {
  const next = new URL(url.href);
  next.hostname = host;
  return next.href;
}

/**
 * Alternates worth trying for a failed URL, best first.
 *
 * Returns [] when the failure class says an alternate cannot help — a 429 is the same site
 * saying "slower", not "elsewhere", and a local egress block is not about the site at all.
 */
export function alternateUrlsFor(failedUrl: string, failureClass: FailureClass): AlternateCandidate[] {
  if (!failurePolicy(failureClass).tryAlternateUrl) return [];

  let url: URL;
  try {
    url = new URL(failedUrl);
  } catch {
    return [];
  }

  const out: AlternateCandidate[] = [];
  const seen = new Set<string>([url.href, `${url.href}/`]);
  const push = (candidate: string, reason: string) => {
    // Never downgrade the scheme to reach a page: an http fallback would defeat the point of
    // having verified the certificate in the first place.
    if (!candidate.startsWith("https://") && url.protocol === "https:") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push({ url: candidate, reason });
  };

  const host = url.hostname;
  const hasWww = host.startsWith("www.");

  // A host that will not resolve or will not present a valid certificate is not going to do
  // either for a different path on itself. The only thing worth trying is the other www form.
  if (failureClass === "dns_failure" || failureClass === "tls_failure") {
    push(withHost(url, hasWww ? host.slice(4) : `www.${host}`), `${failureClass}: trying the ${hasWww ? "bare" : "www"} hostname`);
    return out.slice(0, MAX_ALTERNATES_PER_URL);
  }

  // A stale or refused deep link on a live site: the site's own front page is the best next
  // guess, and is where a conference's current edition almost always is.
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "/") {
    push(`${url.origin}/`, "the site root, in case only this path is stale");

    // One level up is worth a try when the path is deep: /events/2027/x → /events/2027
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 2) {
      push(`${url.origin}/${segments.slice(0, -1).join("/")}`, "the parent path, in case the leaf moved");
    }
  } else {
    // The root itself failed. The other www form is all that is left.
    push(withHost(url, hasWww ? host.slice(4) : `www.${host}`), `trying the ${hasWww ? "bare" : "www"} hostname`);
  }

  return out.slice(0, MAX_ALTERNATES_PER_URL);
}

/**
 * A per-domain circuit breaker.
 *
 * "Do not repeatedly hammer blocked domains" is not just politeness — a host that has refused us
 * three times is going to refuse the next two hundred candidates too, and every one of those
 * requests is page budget spent on a certainty. This trips per run, counts only the failure
 * classes that actually indicate refusal (a 404 does not), and records why so the run can report
 * which domains it gave up on and after how many attempts.
 */
export class DomainCircuitBreaker {
  private readonly refusals = new Map<string, { count: number; lastClass: FailureClass }>();
  private readonly tripped = new Map<string, { afterAttempts: number; failureClass: FailureClass }>();

  constructor(private readonly threshold = 3) {}

  /** Records a failure. Returns true when this failure trips the breaker for the domain. */
  record(domain: string, failureClass: FailureClass): boolean {
    if (!failurePolicy(failureClass).countsAsDomainRefusal) return false;
    const state = this.refusals.get(domain) ?? { count: 0, lastClass: failureClass };
    state.count += 1;
    state.lastClass = failureClass;
    this.refusals.set(domain, state);
    if (state.count >= this.threshold && !this.tripped.has(domain)) {
      this.tripped.set(domain, { afterAttempts: state.count, failureClass });
      return true;
    }
    return false;
  }

  /** A success clears the tally: a site that answers is not refusing us. */
  recordSuccess(domain: string): void {
    this.refusals.delete(domain);
  }

  isOpen(domain: string): boolean {
    return this.tripped.has(domain);
  }

  reasonFor(domain: string): string | null {
    const state = this.tripped.get(domain);
    return state
      ? `stopped after ${state.afterAttempts} consecutive refusals (${state.failureClass})`
      : null;
  }

  /** For the run report: which domains were given up on, and why. */
  summary(): Array<{ domain: string; afterAttempts: number; failureClass: FailureClass }> {
    return [...this.tripped.entries()].map(([domain, state]) => ({ domain, ...state }));
  }
}
