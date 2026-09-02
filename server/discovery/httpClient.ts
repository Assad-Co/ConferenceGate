// The one way this engine talks to the open web.
//
// Everything a crawler owes the sites it reads is enforced here rather than left to each call
// site: a per-domain request interval and concurrency ceiling, a timeout, bounded retries with
// exponential backoff, an honest User-Agent that says what this is and how to contact us, and a
// response-size cap so one enormous page cannot exhaust the process.
//
// Security note. This client fetches arbitrary URLs that came off the open web, so every hop is
// checked: redirects are followed MANUALLY, and each hop is revalidated against the SSRF guard in
// ../urlSafety. Handing `redirect: "follow"` to fetch would check only the first URL and let a
// remote page redirect us into the private network or a cloud metadata endpoint. The guard itself
// is reused, never relaxed — tests inject their own guard rather than weakening the real one.

import crypto from "crypto";
import { isSafeExternalUrl } from "../urlSafety";

export const DISCOVERY_USER_AGENT =
  process.env.DISCOVERY_USER_AGENT ||
  `ConferenceGateBot/1.0 (+conference discovery; ${
    process.env.DISCOVERY_CONTACT_EMAIL || "contact not configured"
  })`;

const DEFAULT_TIMEOUT_MS = Number(process.env.DISCOVERY_FETCH_TIMEOUT_MS || 15000);
const DEFAULT_MAX_BYTES = Number(process.env.DISCOVERY_MAX_PAGE_BYTES || 3_000_000);
const MAX_REDIRECTS = 5;
/** The 3xx codes that actually mean "go somewhere else". 304 is deliberately not one of them. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type UrlGuard = (url: string) => Promise<boolean>;

export interface FetchOptions {
  /** Conditional-request validators from the last time we read this URL. */
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  signal?: AbortSignal;
  /** Overridable only so the fixture harness can point at its own local server; production always
   *  uses the real SSRF guard. */
  urlGuard?: UrlGuard;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  /** True when the server answered 304: the page has not changed since we last read it. */
  notModified: boolean;
  body: string;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  redirects: string[];
  error: string | null;
  /** True when the failure was our own network refusing to reach the host, not the host
   *  refusing us. Callers must not hold the domain responsible for this. */
  blockedByLocalPolicy: boolean;
  elapsedMs: number;
}

/**
 * Recognises a block imposed by OUR OWN network rather than by the site.
 *
 * Corporate egress filters, cloud VPC allowlists and sandboxed CI networks all answer a request
 * for a host they do not permit with a short 403 or 407 whose body says so. That is a completely
 * different fact from the conference's own server refusing us, and confusing the two is
 * expensive: it makes a perfectly willing site look hostile, and it makes the registry back that
 * domain off for a week over a problem that has nothing to do with the domain at all.
 *
 * Deliberately evidence-based rather than status-based: a bare 403 stays a bare 403. Only a
 * response that actually names an allowlist, an egress policy or a proxy denial is reclassified.
 */
const LOCAL_EGRESS_BLOCK_RE =
  /\b(?:not in (?:the )?allowlist|host not allowed|egress (?:policy|settings|rules?)|blocked by (?:network|proxy|policy|firewall)|proxy denied|denied by (?:the )?proxy|access denied by network|forbidden by egress|network policy (?:denial|denied)|not permitted by (?:your )?(?:network|organization|organisation))\b/i;

export function looksLikeLocalEgressBlock(status: number, body: string, headers?: Headers | null): boolean {
  if (status !== 403 && status !== 407 && status !== 502) return false;
  // A real site's 403 page is a page: navigation, styling, a brand. These are a sentence.
  if (body.length > 2000) return false;
  if (!LOCAL_EGRESS_BLOCK_RE.test(body)) return false;
  // A response the origin actually produced normally carries at least one origin-ish header.
  const server = headers?.get("server") || "";
  return !/cloudflare|nginx|apache|akamai|cloudfront|iis|litespeed|envoy|gse/i.test(server);
}

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------------------------
// Per-domain politeness
// ---------------------------------------------------------------------------------------------

interface DomainState {
  nextAllowedAt: number;
  active: number;
  queue: Array<() => void>;
  minIntervalMs: number;
  maxConcurrent: number;
}

const domainStates = new Map<string, DomainState>();

const DEFAULT_MIN_INTERVAL_MS = Number(process.env.DISCOVERY_MIN_REQUEST_INTERVAL_MS || 1200);
const DEFAULT_MAX_CONCURRENT = Number(process.env.DISCOVERY_MAX_CONCURRENT_PER_DOMAIN || 1);

function stateFor(domain: string): DomainState {
  let state = domainStates.get(domain);
  if (!state) {
    state = {
      nextAllowedAt: 0,
      active: 0,
      queue: [],
      minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
    };
    domainStates.set(domain, state);
  }
  return state;
}

/** Applies a Crawl-delay the site itself asked for. A site asking for more space always wins;
 *  a site asking for less never lowers our own floor. */
export function setDomainCrawlDelay(domain: string, delayMs: number | null): void {
  if (!delayMs || !Number.isFinite(delayMs)) return;
  stateFor(domain).minIntervalMs = Math.max(DEFAULT_MIN_INTERVAL_MS, delayMs);
}

export function domainCrawlDelay(domain: string): number {
  return stateFor(domain).minIntervalMs;
}

/** Test seam: lets the fixture harness run at full speed against its own local server. */
export function configureDomainLimits(
  domain: string,
  limits: { minIntervalMs?: number; maxConcurrent?: number }
): void {
  const state = stateFor(domain);
  if (limits.minIntervalMs !== undefined) state.minIntervalMs = limits.minIntervalMs;
  if (limits.maxConcurrent !== undefined) state.maxConcurrent = Math.max(1, limits.maxConcurrent);
}

export function resetDomainLimits(): void {
  domainStates.clear();
}

function pump(domain: string): void {
  const state = stateFor(domain);
  while (state.active < state.maxConcurrent && state.queue.length > 0) {
    const wait = Math.max(0, state.nextAllowedAt - Date.now());
    const run = state.queue.shift()!;
    state.active += 1;
    state.nextAllowedAt = Date.now() + wait + state.minIntervalMs;
    setTimeout(run, wait);
  }
}

function withDomainSlot<T>(domain: string, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const state = stateFor(domain);
    state.queue.push(() => {
      work()
        .then(resolve, reject)
        .finally(() => {
          state.active -= 1;
          pump(domain);
        });
    });
    pump(domain);
  });
}

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    chunks.push(value);
  }
  // Stop the transfer rather than draining a page we've already decided is too big.
  try {
    await reader.cancel();
  } catch {
    /* the stream is already finished */
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk.subarray(0, Math.min(chunk.byteLength, total - offset)), offset);
    offset += chunk.byteLength;
    if (offset >= total) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/** One request, redirects followed by hand with the SSRF guard applied to every hop. */
async function fetchOnce(url: string, options: FetchOptions): Promise<FetchResult> {
  const startedAt = Date.now();
  const guard = options.urlGuard || isSafeExternalUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const redirects: string[] = [];

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await guard(current))) {
      return {
        url,
        finalUrl: current,
        status: 0,
        ok: false,
        notModified: false,
        body: "",
        contentType: null,
        etag: null,
        lastModified: null,
        contentHash: null,
        redirects,
        error: hop === 0 ? "blocked_by_url_guard" : "redirect_blocked_by_url_guard",
        blockedByLocalPolicy: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const headers: Record<string, string> = {
      "User-Agent": DISCOVERY_USER_AGENT,
      Accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en",
    };
    // Conditional request: a 304 costs the site almost nothing and costs us no parsing at all.
    if (options.etag) headers["If-None-Match"] = options.etag;
    if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;

    let response: Response;
    try {
      response = await fetch(current, {
        headers,
        redirect: "manual",
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (error: any) {
      return {
        url,
        finalUrl: current,
        status: 0,
        ok: false,
        notModified: false,
        body: "",
        contentType: null,
        etag: null,
        lastModified: null,
        contentHash: null,
        redirects,
        error: error?.name === "TimeoutError" || /timeout/i.test(String(error?.message)) ? "timeout" : String(error?.message || error),
        blockedByLocalPolicy: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    // 304 is in the 3xx range but is not a redirect: it means "unchanged since you last read it".
    // Checking it before the redirect branch is what makes conditional requests work at all.
    if (response.status === 304) {
      return {
        url,
        finalUrl: current,
        status: 304,
        ok: true,
        notModified: true,
        body: "",
        contentType: response.headers.get("content-type"),
        etag: response.headers.get("etag") || options.etag || null,
        lastModified: response.headers.get("last-modified") || options.lastModified || null,
        contentHash: null,
        redirects,
        error: null,
        blockedByLocalPolicy: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          url,
          finalUrl: current,
          status: response.status,
          ok: false,
          notModified: false,
          body: "",
          contentType: response.headers.get("content-type"),
          etag: null,
          lastModified: null,
          contentHash: null,
          redirects,
          error: "redirect_without_location",
          blockedByLocalPolicy: false,
          elapsedMs: Date.now() - startedAt,
        };
      }
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        return {
          url,
          finalUrl: current,
          status: response.status,
          ok: false,
          notModified: false,
          body: "",
          contentType: null,
          etag: null,
          lastModified: null,
          contentHash: null,
          redirects,
          error: "redirect_location_unparseable",
          blockedByLocalPolicy: false,
          elapsedMs: Date.now() - startedAt,
        };
      }
      redirects.push(next);
      current = next;
      continue;
    }

    // A failed response's body is read too, but only a little of it: it is the only place a
    // network-level block explains itself, and without it every such block looks like the site
    // saying no.
    const body = await readCapped(response, response.ok ? maxBytes : 4096);
    const locallyBlocked = !response.ok && looksLikeLocalEgressBlock(response.status, body, response.headers);
    return {
      url,
      finalUrl: current,
      status: response.status,
      ok: response.ok,
      notModified: false,
      body: response.ok ? body : "",
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      contentHash: response.ok && body ? hashContent(body) : null,
      redirects,
      error: response.ok ? null : locallyBlocked ? "blocked_by_local_egress_policy" : `http_${response.status}`,
      blockedByLocalPolicy: locallyBlocked,
      elapsedMs: Date.now() - startedAt,
    };
  }

  return {
    url,
    finalUrl: current,
    status: 0,
    ok: false,
    notModified: false,
    body: "",
    contentType: null,
    etag: null,
    lastModified: null,
    contentHash: null,
    redirects,
    error: "too_many_redirects",
    blockedByLocalPolicy: false,
    elapsedMs: Date.now() - startedAt,
  };
}

/** Statuses worth trying again. A 404 or a 403 is the site's answer, not a hiccup — retrying
 *  those is just extra load on someone else's server for the same result. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = Number(process.env.DISCOVERY_FETCH_ATTEMPTS || 3);
const RETRY_BASE_DELAY_MS = Number(process.env.DISCOVERY_RETRY_BASE_MS || 800);

export async function discoveryFetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const domain = hostOf(url);
  return withDomainSlot(domain, async () => {
    let last: FetchResult | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const result = await fetchOnce(url, options);
      last = result;
      const retryable =
        !result.blockedByLocalPolicy &&
        ((result.status === 0 && result.error !== "blocked_by_url_guard" && result.error !== "redirect_blocked_by_url_guard") ||
          RETRYABLE_STATUSES.has(result.status));
      if (result.ok || !retryable || attempt === MAX_ATTEMPTS) return result;
      // Exponential backoff, so a struggling server gets more room each time rather than less.
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
    return last!;
  });
}

export function isHtmlLike(result: FetchResult): boolean {
  const type = (result.contentType || "").toLowerCase();
  if (type.includes("html") || type.includes("xhtml")) return true;
  if (!type && /<html|<!doctype html/i.test(result.body.slice(0, 500))) return true;
  return false;
}
