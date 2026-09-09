// Exa, used for exactly one job: finding a conference's own website.
//
// PredictHQ knows an event happens; it does not know its homepage. Keyword search is bad at this —
// "International Conference on Water 2027" returns directories that rank for those words. Exa's
// search is embeddings-based, so it can be given the conference as a description and asked for the
// page that IS that conference.
//
// The guards matter more than the call. A resolver that returns its best guess would attach wrong
// websites to real conferences, which is worse than attaching none:
//
//   * A listing host is never accepted, whatever it ranks.
//   * The candidate has to actually name the conference — its acronym, or enough of its distinctive
//     words — in the URL, the title, or the host. Adjacency in a result list is not evidence.
//   * Nothing passes those checks, nothing is returned. Null is a correct answer here.
//
// Paid, so it is opt-in and capped: no key means the resolver is simply off and the events it would
// have resolved stay unresolved rather than the run failing.

import { isDirectoryHost, isReferenceHost } from "../../directoryHosts";

const SEARCH_URL = "https://api.exa.ai/search";

export interface ExaResult {
  id?: string;
  url?: string;
  title?: string | null;
  publishedDate?: string | null;
  score?: number;
  text?: string | null;
}

export interface ExaSearchResponse {
  requestId?: string;
  results?: ExaResult[];
}

export function isExaConfigured(): boolean {
  return Boolean(process.env.EXA_API_KEY?.trim());
}

export interface ExaSearchOptions {
  query: string;
  numResults?: number;
  /** "auto" lets Exa pick between its neural and keyword paths; the default here. */
  type?: "auto" | "neural" | "keyword" | "fast";
  includeDomains?: string[];
  excludeDomains?: string[];
  fetchImpl?: typeof fetch;
}

export async function exaSearch(options: ExaSearchOptions): Promise<ExaResult[]> {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) throw new Error("EXA_API_KEY is not set");
  const doFetch = options.fetchImpl || fetch;

  const response: Response = await doFetch(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, Accept: "application/json" },
    body: JSON.stringify({
      query: options.query,
      numResults: Math.min(Math.max(1, options.numResults ?? 8), 25),
      type: options.type ?? "auto",
      ...(options.includeDomains ? { includeDomains: options.includeDomains } : {}),
      ...(options.excludeDomains ? { excludeDomains: options.excludeDomains } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Exa responded ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = (await response.json()) as ExaSearchResponse;
  return Array.isArray(payload.results) ? payload.results : [];
}

const NAME_NOISE = new Set([
  "the", "and", "of", "for", "in", "at", "on", "a", "an",
  "international", "national", "annual", "world", "global", "european", "asian",
  "conference", "conferences", "congress", "symposium", "summit", "meeting", "workshop",
  "expo", "exposition", "exhibition", "convention", "forum", "edition",
]);

/** The words that actually identify this conference rather than describe its type. */
export function distinctiveTokens(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length > 2 &&
            !NAME_NOISE.has(token) &&
            // A year and an edition ordinal say which edition, never which conference.
            !/^(19|20)\d\d$/.test(token) &&
            !/^\d+(st|nd|rd|th)?$/.test(token)
        )
    ),
  ];
}

export interface ResolveOptions {
  title: string;
  year: number;
  city?: string | null;
  country?: string | null;
  acronym?: string | null;
  numResults?: number;
  fetchImpl?: typeof fetch;
}

export interface ResolvedUrl {
  url: string;
  host: string;
  matchedOn: string;
  resultTitle: string | null;
  score: number | null;
}

/**
 * True when a candidate page plausibly IS this conference rather than merely mentioning it.
 *
 * Deliberately strict. The acronym or at least half the conference's distinctive words must appear
 * in the URL, the page title or the host — an ordinary search hit does not qualify.
 */
export function candidateNamesConference(
  candidate: { url: string; title?: string | null },
  options: { title: string; acronym?: string | null }
): string | null {
  let host: string;
  try {
    host = new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (isDirectoryHost(host) || isReferenceHost(host)) return null;

  const haystack = `${candidate.url} ${candidate.title || ""}`.toLowerCase();
  const acronym = options.acronym?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (acronym && acronym.length >= 3) {
    const hostCompact = host.replace(/[^a-z0-9]/g, "");
    if (hostCompact.includes(acronym)) return `acronym in host: ${acronym}`;
    if (new RegExp(`(?:^|[^a-z0-9])${acronym}(?:[^a-z0-9]|$)`).test(haystack)) return `acronym: ${acronym}`;
  }

  const tokens = distinctiveTokens(options.title);
  if (tokens.length === 0) return null;
  const present = tokens.filter((token) => haystack.includes(token));

  // A name with only one distinctive word ("EAGE Annual Conference & Exhibition" reduces to
  // "eage") can never clear a two-word bar, so the single word has to land somewhere stronger:
  // the host itself. Matching it in a page title alone would accept any article about the event.
  if (tokens.length === 1) {
    const hostCompact = host.replace(/[^a-z0-9]/g, "");
    return hostCompact.includes(tokens[0]) ? `name word in host: ${tokens[0]}` : null;
  }

  if (present.length * 2 >= tokens.length && present.length >= 2) {
    return `name words: ${present.slice(0, 4).join(", ")}`;
  }
  return null;
}

/**
 * Finds the conference's own website, or returns null.
 *
 * Null is a correct, common answer: many events genuinely have no findable homepage, and a wrong
 * link is worse than an absent one.
 */
export async function resolveOfficialUrl(options: ResolveOptions): Promise<ResolvedUrl | null> {
  if (!isExaConfigured()) return null;
  const query = [options.title, options.year, options.city, options.country, "official conference website"]
    .filter(Boolean)
    .join(" ");

  const results = await exaSearch({
    query,
    numResults: options.numResults ?? 8,
    type: "auto",
    fetchImpl: options.fetchImpl,
  });

  for (const result of results) {
    if (!result.url) continue;
    const matchedOn = candidateNamesConference(
      { url: result.url, title: result.title },
      { title: options.title, acronym: options.acronym }
    );
    if (!matchedOn) continue;
    return {
      url: result.url,
      host: new URL(result.url).hostname.toLowerCase().replace(/^www\./, ""),
      matchedOn,
      resultTitle: result.title ?? null,
      score: typeof result.score === "number" ? result.score : null,
    };
  }
  return null;
}
