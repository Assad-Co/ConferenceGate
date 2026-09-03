// Search-engine discovery, using the two providers Conference Gate already pays for.
//
// This is the layer that reaches conferences no sitemap in our registry lists: a first-time
// event on its own domain, a regional congress nobody has indexed, an organiser who never
// publishes a sitemap at all. It calls `braveSearch` and `serperSearch` from the existing
// server/braveSearch.ts and server/serperSearch.ts — the same clients, the same rate-limit queue,
// the same keys. Nothing about Discover's own behaviour changes.
//
// The cost discipline is the interesting part, and it is deliberate:
//
//   * Brave goes first, always. It is the cheaper plan of the two.
//   * Serper is NOT called just because it is configured. It runs only when Brave's actual yield
//     — distinct, strong, not-already-known candidates — falls short of what the run asked for,
//     or when Brave failed or is not configured at all. A run where Brave delivers spends nothing
//     on Serper, and says so in its accounting.
//   * Every query is counted, per provider, so "conferences per query" is a real measured number
//     rather than an impression.
//
// Queries are built as a matrix over the platform's own category taxonomy × a spread of countries
// covering all seven regions × the target years, weighted towards the priority year. That is what
// stops search discovery quietly becoming a North-America-and-Europe engine: the countries are an
// explicit input, not whatever the search index happens to rank.

import { braveSearch, isBraveConfigured, isDirectoryHost, type LiveSearchResult } from "../../braveSearch";
import { isSerperConfigured, serperSearch } from "../../serperSearch";
import { CATEGORY_RULES } from "../categories";
import { canonicalizeUrl } from "../normalize";
import { scoreCandidateUrl } from "../sitemaps";
import type { DiscoveryCandidate, DiscoveryContext, DiscoveryProvider } from "../types";
import type { RunLogger } from "../logging";

/** Everything spent and everything gained, per provider. Read straight into the run report. */
export interface SearchAccounting {
  queriesPlanned: number;
  braveConfigured: boolean;
  serperConfigured: boolean;
  braveQueries: number;
  serperQueries: number;
  braveRawResults: number;
  serperRawResults: number;
  /** Distinct candidate URLs contributed, after cross-provider de-duplication. */
  braveCandidates: number;
  serperCandidates: number;
  /** Candidates that look like a single conference's own page, which is what we are paying for. */
  braveStrongCandidates: number;
  serperStrongCandidates: number;
  duplicateUrlsDropped: number;
  directoryUrlsDemoted: number;
  braveErrors: string[];
  serperErrors: string[];
  /** Why Serper was or was not used. The whole point of the gate is that this is legible. */
  serperDecision: string;
  queriesExecuted: Array<{ provider: "brave" | "serper"; query: string; results: number; strong: number }>;
}

function emptyAccounting(): SearchAccounting {
  return {
    queriesPlanned: 0,
    braveConfigured: isBraveConfigured(),
    serperConfigured: isSerperConfigured(),
    braveQueries: 0,
    serperQueries: 0,
    braveRawResults: 0,
    serperRawResults: 0,
    braveCandidates: 0,
    serperCandidates: 0,
    braveStrongCandidates: 0,
    serperStrongCandidates: 0,
    duplicateUrlsDropped: 0,
    directoryUrlsDemoted: 0,
    braveErrors: [],
    serperErrors: [],
    serperDecision: "not evaluated",
    queriesExecuted: [],
  };
}

/** Countries chosen to force spread across every region, not to be exhaustive. */
const QUERY_COUNTRIES_BY_REGION: Record<string, string[]> = {
  Europe: ["Germany", "United Kingdom", "Spain", "Italy", "Netherlands", "Poland", "Portugal", "Sweden"],
  "North America": ["United States", "Canada", "Mexico"],
  "South America": ["Brazil", "Chile", "Colombia", "Argentina", "Peru"],
  "Middle East": ["United Arab Emirates", "Saudi Arabia", "Qatar", "Jordan", "Turkey"],
  Africa: ["South Africa", "Kenya", "Egypt", "Nigeria", "Morocco", "Ghana"],
  Asia: ["Singapore", "Japan", "India", "South Korea", "Malaysia", "China", "Indonesia", "Thailand"],
  Oceania: ["Australia", "New Zealand"],
};

/** Subject phrases taken from the platform's OWN category taxonomy, so a query and the category
 *  it will eventually be filed under come from the same vocabulary. */
function subjectPhrases(): string[] {
  return CATEGORY_RULES.map((rule) => {
    // "Artificial Intelligence & Machine Learning" → "Artificial Intelligence": the first half is
    // the searchable subject, the ampersand form is a shelf label.
    const head = rule.category.split("&")[0].trim();
    return head || rule.category;
  });
}

const EVENT_WORDS = ["conference", "congress", "symposium", "summit"];

export interface PlannedQuery {
  query: string;
  subject: string;
  country: string;
  region: string;
  year: number;
}

/**
 * Builds the query matrix.
 *
 * Rotates subject × country × event word so consecutive queries differ in every dimension, and
 * weights the priority year: for target years [2026, 2027, 2028] roughly half the queries name
 * 2027. Deterministic, so two runs with the same inputs ask the same questions and their yields
 * are comparable.
 */
export function planSearchQueries(context: {
  targetYears: number[];
  priorityYear?: number;
  topics?: string[];
  maxQueries: number;
}): PlannedQuery[] {
  const subjects = context.topics?.length ? context.topics : subjectPhrases();
  const regions = Object.keys(QUERY_COUNTRIES_BY_REGION);
  const years = context.targetYears.length > 0 ? context.targetYears : [new Date().getUTCFullYear() + 1];
  const priorityYear = context.priorityYear ?? (years.includes(2027) ? 2027 : years[Math.floor(years.length / 2)]);

  const planned: PlannedQuery[] = [];
  const seen = new Set<string>();

  for (let index = 0; planned.length < context.maxQueries && index < context.maxQueries * 8; index += 1) {
    const subject = subjects[index % subjects.length];
    const region = regions[index % regions.length];
    const countries = QUERY_COUNTRIES_BY_REGION[region];
    const country = countries[Math.floor(index / regions.length) % countries.length];
    const eventWord = EVENT_WORDS[index % EVENT_WORDS.length];
    // Every other query asks about the priority year; the rest rotate through the others.
    const year = index % 2 === 0 ? priorityYear : years.filter((y) => y !== priorityYear)[Math.floor(index / 2) % Math.max(1, years.length - 1)] ?? priorityYear;

    // Negatives keep roundups and directory pages out of the results we pay for; the intent words
    // bias towards a conference's own site rather than an article about it.
    const query = `${subject} ${eventWord} ${year} ${country} call for papers registration -"top conferences" -"list of conferences" -"upcoming conferences"`;
    const key = `${subject}|${country}|${year}|${eventWord}`;
    if (seen.has(key)) continue;
    seen.add(key);
    planned.push({ query, subject, country, region, year });
  }

  return planned;
}

/** A candidate looks like one conference's own page rather than a listing or an article. */
function isStrongCandidate(result: LiveSearchResult, host: string, urlScore: number): boolean {
  if (isDirectoryHost(host)) return false;
  const text = `${result.title} ${result.snippet}`;
  if (/\bconferences\b/i.test(result.title)) return false; // plural in a title is a listing
  const namesEvent = /\b(conference|congress|symposium|summit|convention|workshop|forum|expo|meeting)\b/i.test(text);
  const hasYear = /\b20\d{2}\b/.test(text);
  return namesEvent && hasYear && urlScore >= 0.35;
}

export interface SearchProviderOptions {
  logger?: RunLogger;
  enabled?: boolean;
  /** Total queries the run may spend across both providers. */
  maxQueries?: number;
  /** Results requested per query. */
  resultsPerQuery?: number;
  /**
   * How many strong candidates Brave must produce before Serper is considered unnecessary.
   * Defaults to `maxQueries * 4` — roughly four usable conference pages per query asked.
   */
  serperYieldThreshold?: number;
  /** Known URLs, so "new candidate" means new to the database and not just new to this run. */
  isKnownUrl?: (url: string) => Promise<boolean>;
}

export class SearchDiscoveryProvider implements DiscoveryProvider {
  readonly name = "search";
  readonly kind = "search" as const;
  readonly rateLimit = { requestsPerMinute: 30, maxConcurrent: 1 };
  readonly baseConfidence = 0.45;
  readonly metrics: Record<string, { queriesIssued: number; rawResults: number; uniqueUrls: number; sharedUrls: number }> = {};

  readonly accounting: SearchAccounting = emptyAccounting();

  constructor(private readonly options: SearchProviderOptions = {}) {}

  isEnabled(): boolean {
    if (this.options.enabled !== undefined) return this.options.enabled;
    if (process.env.DISCOVERY_SEARCH_PROVIDER !== "1") return false;
    return isBraveConfigured() || isSerperConfigured();
  }

  unavailableReason(): string | null {
    if (this.isEnabled()) return null;
    if (process.env.DISCOVERY_SEARCH_PROVIDER !== "1") {
      return "disabled by default to protect search quota; set DISCOVERY_SEARCH_PROVIDER=1 to enable";
    }
    return "no BRAVE_SEARCH_API_KEY or SERPER_API_KEY configured";
  }

  async discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    if (!this.isEnabled()) return [];

    const maxQueries = this.options.maxQueries ?? 24;
    const perQuery = this.options.resultsPerQuery ?? 15;
    const planned = planSearchQueries({
      targetYears: context.targetYears,
      topics: context.topics,
      maxQueries,
    });
    this.accounting.queriesPlanned = planned.length;

    const candidates: DiscoveryCandidate[] = [];
    // Canonical form, so "site.org/x", "www.site.org/x/" and "site.org/x?utm=1" are one URL.
    const seenCanonical = new Map<string, DiscoveryCandidate>();

    const metricFor = (provider: string) =>
      (this.metrics[provider] ||= { queriesIssued: 0, rawResults: 0, uniqueUrls: 0, sharedUrls: 0 });

    const absorb = (
      results: LiveSearchResult[],
      provider: "brave" | "serper",
      planItem: PlannedQuery
    ): { added: number; strong: number } => {
      let added = 0;
      let strong = 0;
      for (const result of results) {
        if (!result.link) continue;
        const canonical = canonicalizeUrl(result.link);
        if (!canonical) continue;

        const existing = seenCanonical.get(canonical);
        if (existing) {
          // The same URL from both engines is not waste — it is corroboration, and worth being
          // able to measure. Record the second provider on the candidate rather than discarding
          // it, so overlap can be reported instead of guessed at.
          const providers = existing.hints?.discoveryProviders;
          if (providers && !providers.includes(provider)) {
            providers.push(provider);
            existing.provider = [...providers].sort().join("+");
          }
          this.accounting.duplicateUrlsDropped += 1;
          continue;
        }

        let host: string;
        try {
          host = new URL(result.link).hostname.toLowerCase().replace(/^www\./, "");
        } catch {
          continue;
        }

        const { score, reason } = scoreCandidateUrl(result.link, context.targetYears);
        const isStrong = isStrongCandidate(result, host, score);
        const directory = isDirectoryHost(host);
        if (directory) this.accounting.directoryUrlsDemoted += 1;

        const candidate: DiscoveryCandidate = {
          url: result.link,
          sourceDomain: host,
          // Tagged per search engine, not as one "search" bucket, so the report can attribute
          // accepted conferences to the engine that actually found them.
          provider,
          priority: directory
            ? 0.15
            : Math.min(0.85, score + (isStrong ? 0.2 : 0) + (result.title.includes(String(planItem.year)) ? 0.05 : 0)),
          reason: directory
            ? `${reason}; listing site, kept at low priority`
            : `${reason}; ${provider} result for ${planItem.subject}/${planItem.country}/${planItem.year}`,
          hints: {
            title: result.title,
            snippet: result.snippet,
            discoveryProviders: [provider],
            discoveryQuery: planItem.query,
          },
        };
        seenCanonical.set(canonical, candidate);
        candidates.push(candidate);
        added += 1;
        if (isStrong && !directory) strong += 1;
      }
      return { added, strong };
    };

    // ---- Brave first: the cheaper plan, and the one that carries thumbnails and favicons.
    if (isBraveConfigured()) {
      for (const item of planned) {
        if (context.signal?.aborted) break;
        if (candidates.length >= context.maxCandidates) break;
        try {
          const results = await braveSearch(item.query, perQuery, "low");
          this.accounting.braveQueries += 1;
          this.accounting.braveRawResults += results.length;
          const metric = metricFor("brave");
          metric.queriesIssued += 1;
          metric.rawResults += results.length;
          const { added, strong } = absorb(results, "brave", item);
          this.accounting.braveCandidates += added;
          this.accounting.braveStrongCandidates += strong;
          this.accounting.queriesExecuted.push({ provider: "brave", query: item.query, results: results.length, strong });
          this.options.logger?.log("search_results", {
            detail: `brave: ${item.subject} / ${item.country} / ${item.year}`,
            count: added,
          });
        } catch (error: any) {
          // Held, not thrown: one failed query must not end the run, and a plan limit part-way
          // through is exactly the case Serper exists to absorb.
          const message = String(error?.message || error).slice(0, 200);
          if (this.accounting.braveErrors.length < 5) this.accounting.braveErrors.push(message);
          this.options.logger?.log("error", { detail: `brave query failed: ${message}` });
        }
      }
    } else {
      this.accounting.braveErrors.push("BRAVE_SEARCH_API_KEY is not set");
    }

    // ---- Serper, only if Brave did not already do the job.
    const threshold = this.options.serperYieldThreshold ?? maxQueries * 4;
    const braveStrong = this.accounting.braveStrongCandidates;

    if (!isSerperConfigured()) {
      this.accounting.serperDecision = "skipped: SERPER_API_KEY is not set";
    } else if (this.accounting.braveErrors.length > 0 && this.accounting.braveQueries === 0) {
      this.accounting.serperDecision = "used: Brave could not run at all";
    } else if (braveStrong >= threshold) {
      this.accounting.serperDecision = `skipped: Brave already produced ${braveStrong} strong candidates (threshold ${threshold}) — no reason to spend Serper quota`;
    } else {
      this.accounting.serperDecision = `used: Brave produced ${braveStrong} strong candidates, short of the ${threshold} this run wanted`;
    }

    if (this.accounting.serperDecision.startsWith("used")) {
      // Not a blind repeat of every query: the ones Brave answered well need no second opinion.
      const weakQueries = planned.filter((item) => {
        const executed = this.accounting.queriesExecuted.find((q) => q.provider === "brave" && q.query === item.query);
        return !executed || executed.strong < 3;
      });
      for (const item of weakQueries) {
        if (context.signal?.aborted) break;
        if (candidates.length >= context.maxCandidates) break;
        if (this.accounting.braveStrongCandidates + this.accounting.serperStrongCandidates >= threshold) {
          this.accounting.serperDecision += `; stopped early once the combined yield reached ${threshold}`;
          break;
        }
        try {
          const results = await serperSearch(item.query, perQuery);
          this.accounting.serperQueries += 1;
          this.accounting.serperRawResults += results.length;
          const metric = metricFor("serper");
          metric.queriesIssued += 1;
          metric.rawResults += results.length;
          const { added, strong } = absorb(results, "serper", item);
          this.accounting.serperCandidates += added;
          this.accounting.serperStrongCandidates += strong;
          this.accounting.queriesExecuted.push({ provider: "serper", query: item.query, results: results.length, strong });
          this.options.logger?.log("search_results", {
            detail: `serper: ${item.subject} / ${item.country} / ${item.year}`,
            count: added,
          });
        } catch (error: any) {
          const message = String(error?.message || error).slice(0, 200);
          if (this.accounting.serperErrors.length < 5) this.accounting.serperErrors.push(message);
          this.options.logger?.log("error", { detail: `serper query failed: ${message}` });
        }
      }
    }

    // Unique/shared URL counts per engine, which is what makes overlap reportable.
    for (const provider of Object.keys(this.metrics)) {
      this.metrics[provider].uniqueUrls = candidates.filter(
        (candidate) => candidate.hints?.discoveryProviders?.length === 1 && candidate.hints.discoveryProviders[0] === provider
      ).length;
      this.metrics[provider].sharedUrls = candidates.filter(
        (candidate) =>
          (candidate.hints?.discoveryProviders?.length || 0) > 1 &&
          candidate.hints?.discoveryProviders?.includes(provider)
      ).length;
    }

    return candidates.sort((left, right) => right.priority - left.priority).slice(0, context.maxCandidates);
  }
}
