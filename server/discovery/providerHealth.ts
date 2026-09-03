// "Which of our providers actually work from this machine?"
//
// Preflight answers that for conference websites; this answers it for the paid and hosted
// services the engine leans on. The distinction that matters is the one a bare failure hides:
// a key that is wrong, a plan that is exhausted, and a network that will not let the request out
// are three completely different problems with three completely different fixes, and all three
// look identical in a log that only says "search failed".
//
// Nothing here prints, returns, or logs a key. Each check reports only the classification, the
// HTTP status, and whether a credential was configured at all.

import { braveSearch, isBraveConfigured } from "../braveSearch";
import { dbGet } from "../db";
import { isJinaConfigured, hasJinaKey, jinaReadPage } from "../jinaReader";
import { isSerperConfigured, serperSearch } from "../serperSearch";
import { looksLikeLocalEgressBlock } from "./httpClient";

/** The vocabulary every check answers in. */
export type ProviderStatus =
  | "reachable"
  | "blocked"
  | "authentication_failed"
  | "rate_limited"
  | "timeout"
  | "not_configured"
  | "other";

export interface ProviderCheck {
  provider: string;
  status: ProviderStatus;
  /** Whether a credential is present. Never the credential itself. */
  credentialConfigured: boolean;
  httpStatus: number | null;
  elapsedMs: number;
  detail: string;
}

/** Removes anything key-shaped from a third-party error before it is stored or shown.
 *  Provider errors quote request URLs and headers back at you often enough that this is not a
 *  theoretical concern. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(/(key|token|secret|password|authorization|subscription)[=:"\s]+\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}

/** Reads an arbitrary provider failure and decides which of the six answers it is. */
function classify(error: unknown, elapsedMs: number): { status: ProviderStatus; httpStatus: number | null; detail: string } {
  const message = redactSecrets(String((error as any)?.message ?? error ?? ""));
  const statusMatch = /\b(4\d{2}|5\d{2})\b/.exec(message);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;

  if (/timeout|timed out|abort/i.test(message)) {
    return { status: "timeout", httpStatus, detail: `no response within the deadline (${elapsedMs}ms)` };
  }
  if (httpStatus === 401 || httpStatus === 403 || /unauthori[sz]ed|invalid (api )?key|forbidden|subscription/i.test(message)) {
    // A 403 here is ambiguous between "your key is wrong" and "your network blocked it"; the
    // egress signature is checked first by the callers that can see a body.
    return {
      status: "authentication_failed",
      httpStatus,
      detail: `the provider rejected the credential (HTTP ${httpStatus ?? "?"}) — check the key and the plan, not the code`,
    };
  }
  if (httpStatus === 429 || /rate.?limit|too many requests|quota/i.test(message)) {
    return { status: "rate_limited", httpStatus, detail: "the provider's plan limit was hit — the key works, the quota does not" };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(message)) {
    return { status: "blocked", httpStatus, detail: `the request never reached the provider: ${message}` };
  }
  return { status: "other", httpStatus, detail: message || "unknown failure" };
}

async function timed<T>(work: () => Promise<T>): Promise<{ value?: T; error?: unknown; elapsedMs: number }> {
  const startedAt = Date.now();
  try {
    return { value: await work(), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { error, elapsedMs: Date.now() - startedAt };
  }
}

/** One cheap Brave query. Costs a single unit of the monthly quota. */
export async function checkBrave(): Promise<ProviderCheck> {
  const configured = isBraveConfigured();
  if (!configured) {
    return {
      provider: "brave_search",
      status: "not_configured",
      credentialConfigured: false,
      httpStatus: null,
      elapsedMs: 0,
      detail: "BRAVE_SEARCH_API_KEY is not set — Brave discovery is simply skipped",
    };
  }
  const { value, error, elapsedMs } = await timed(() => braveSearch("conference 2027 call for papers", 3, "high"));
  if (error) {
    const { status, httpStatus, detail } = classify(error, elapsedMs);
    return { provider: "brave_search", status, credentialConfigured: true, httpStatus, elapsedMs, detail };
  }
  return {
    provider: "brave_search",
    status: "reachable",
    credentialConfigured: true,
    httpStatus: 200,
    elapsedMs,
    detail: `answered with ${value?.length ?? 0} results`,
  };
}

/** One cheap Serper query. */
export async function checkSerper(): Promise<ProviderCheck> {
  const configured = isSerperConfigured();
  if (!configured) {
    return {
      provider: "serper_search",
      status: "not_configured",
      credentialConfigured: false,
      httpStatus: null,
      elapsedMs: 0,
      detail: "SERPER_API_KEY is not set — Serper is simply skipped",
    };
  }
  const { value, error, elapsedMs } = await timed(() => serperSearch("conference 2027 call for papers", 3));
  if (error) {
    const { status, httpStatus, detail } = classify(error, elapsedMs);
    return { provider: "serper_search", status, credentialConfigured: true, httpStatus, elapsedMs, detail };
  }
  return {
    provider: "serper_search",
    status: "reachable",
    credentialConfigured: true,
    httpStatus: 200,
    elapsedMs,
    detail: `answered with ${value?.length ?? 0} results`,
  };
}

/** Jina's reader, against a page whose content is stable and uncontroversial. */
export async function checkJina(): Promise<ProviderCheck> {
  if (!isJinaConfigured()) {
    return {
      provider: "jina_reader",
      status: "not_configured",
      credentialConfigured: false,
      httpStatus: null,
      elapsedMs: 0,
      detail: "JINA_READER_DISABLED=1 — the hosted reader is turned off",
    };
  }
  const { value, error, elapsedMs } = await timed(() => jinaReadPage("https://example.com/"));
  if (error) {
    const { status, httpStatus, detail } = classify(error, elapsedMs);
    return { provider: "jina_reader", status, credentialConfigured: hasJinaKey(), httpStatus, elapsedMs, detail };
  }
  // jinaReadPage swallows its own failures and returns null, so an empty answer is the failure.
  if (!value) {
    return {
      provider: "jina_reader",
      status: "other",
      credentialConfigured: hasJinaKey(),
      httpStatus: null,
      elapsedMs,
      detail: hasJinaKey()
        ? "the reader returned nothing — it may be rate limiting this key, or unreachable"
        : "the reader returned nothing — the keyless tier is heavily rate limited; set JINA_API_KEY to raise it",
    };
  }
  return {
    provider: "jina_reader",
    status: "reachable",
    credentialConfigured: hasJinaKey(),
    httpStatus: 200,
    elapsedMs,
    detail: `read ${value.length} characters${hasJinaKey() ? "" : " (keyless tier — low rate limit)"}`,
  };
}

/** The database the engine writes to. A local SQLite file is a working answer, but a distinctly
 *  different one from a Turso database, and worth saying out loud on a host with no disk. */
export async function checkTurso(): Promise<ProviderCheck> {
  const configured = !!process.env.TURSO_DATABASE_URL;
  const { error, elapsedMs } = await timed(() => dbGet<{ one: number }>("SELECT 1 AS one"));
  if (error) {
    const { status, httpStatus, detail } = classify(error, elapsedMs);
    return { provider: "turso_database", status, credentialConfigured: configured, httpStatus, elapsedMs, detail };
  }
  return {
    provider: "turso_database",
    status: "reachable",
    credentialConfigured: configured,
    httpStatus: null,
    elapsedMs,
    detail: configured
      ? "connected to the Turso database"
      : "TURSO_DATABASE_URL is not set: writing to a local SQLite file, which does not survive a restart on a host without a persistent disk",
  };
}

/** Gemini, used only for the capped AI fallback. Its absence costs nothing. */
export async function checkGemini(): Promise<ProviderCheck> {
  const configured = !!process.env.GEMINI_API_KEY;
  if (!configured) {
    return {
      provider: "gemini_ai_fallback",
      status: "not_configured",
      credentialConfigured: false,
      httpStatus: null,
      elapsedMs: 0,
      detail: "GEMINI_API_KEY is not set — the AI fallback is unavailable, which only matters for pages the free routes cannot read",
    };
  }
  const startedAt = Date.now();
  try {
    // A models.list call: the cheapest way to prove the key and the network without generating.
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! },
      signal: AbortSignal.timeout(10000),
    });
    const elapsedMs = Date.now() - startedAt;
    const body = await res.text().catch(() => "");
    if (looksLikeLocalEgressBlock(res.status, body, res.headers)) {
      return {
        provider: "gemini_ai_fallback",
        status: "blocked",
        credentialConfigured: true,
        httpStatus: res.status,
        elapsedMs,
        detail: "this machine's network refused the connection — the provider was never contacted",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: "gemini_ai_fallback", status: "authentication_failed", credentialConfigured: true, httpStatus: res.status, elapsedMs, detail: "the provider rejected the credential" };
    }
    if (res.status === 429) {
      return { provider: "gemini_ai_fallback", status: "rate_limited", credentialConfigured: true, httpStatus: 429, elapsedMs, detail: "quota exhausted" };
    }
    return {
      provider: "gemini_ai_fallback",
      status: res.ok ? "reachable" : "other",
      credentialConfigured: true,
      httpStatus: res.status,
      elapsedMs,
      detail: res.ok ? "the model API answered" : `HTTP ${res.status}`,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const { status, httpStatus, detail } = classify(error, elapsedMs);
    return { provider: "gemini_ai_fallback", status, credentialConfigured: true, httpStatus, elapsedMs, detail };
  }
}

export async function checkAllProviders(): Promise<ProviderCheck[]> {
  // Sequential rather than parallel: each is one request, and a burst against a rate-limited
  // plan is a silly way to fail a health check.
  return [await checkTurso(), await checkBrave(), await checkSerper(), await checkJina(), await checkGemini()];
}
