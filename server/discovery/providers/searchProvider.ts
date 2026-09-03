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
  /**
   * The three states Phase 1.2 could not tell apart, now separate.
   *
   * Its benchmark reported "Serper: 0 queries" and there was no way to know whether Serper was
   * unconfigured, asked and silent, or asked and failing — because the metric was incremented
   * only when a provider returned at least one RESULT, so a provider that answered nothing was
   * indistinguishable from one that was never called. That is the root cause of the zero, and
   * counting at the point of issue is the fix.
   */
  braveZeroResultQueries: number;
  serperZeroResultQueries: number;
  braveFailedQueries: number;
  serperFailedQueries: number;
  /** Why Serper was or was not used. The whole point of the gate is that this is legible. */
  serperDecision: string;
  /** Which matrix cells Brave left thin, and therefore what Serper was actually sent at. */
  coverageGaps: Array<{ cell: string; braveStrong: number }>;
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
    braveZeroResultQueries: 0,
    serperZeroResultQueries: 0,
    braveFailedQueries: 0,
    serperFailedQueries: 0,
    serperDecision: "not evaluated",
    coverageGaps: [],
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
  /** Share of queries that must name the priority year. Defaults to 0.6 for a 2027-first run. */
  priorityYearShare?: number;
}): PlannedQuery[] {
  const subjects = context.topics?.length ? context.topics : subjectPhrases();
  const regions = Object.keys(QUERY_COUNTRIES_BY_REGION);
  const years = context.targetYears.length > 0 ? context.targetYears : [new Date().getUTCFullYear() + 1];
  const priorityYear = context.priorityYear ?? (years.includes(2027) ? 2027 : years[Math.floor(years.length / 2)]);
  const otherYears = years.filter((year) => year !== priorityYear);
  const priorityShare = context.priorityYearShare ?? 0.6;
  const priorityBudget = Math.round(context.maxQueries * priorityShare);

  const planned: PlannedQuery[] = [];
  const seen = new Set<string>();
  let priorityUsed = 0;

  // Five dimensions rotated on co-prime-ish strides, so consecutive queries differ in all of
  // them and the matrix is swept evenly rather than marching through one axis at a time. The
  // year is chosen by remaining budget, which is what actually enforces the 2027 priority
  // instead of merely hoping the rotation lands there.
  for (let index = 0; planned.length < context.maxQueries && index < context.maxQueries * 12; index += 1) {
    const region = regions[index % regions.length];
    const countries = QUERY_COUNTRIES_BY_REGION[region];
    const country = countries[Math.floor(index / regions.length) % countries.length];
    const subject = subjects[(index * 3) % subjects.length];
    const eventWord = EVENT_WORDS[(index * 2) % EVENT_WORDS.length];

    const priorityRemaining = priorityBudget - priorityUsed;
    const otherRemaining = context.maxQueries - planned.length - priorityRemaining;
    const year =
      otherYears.length === 0 || priorityRemaining > 0 && (otherRemaining <= 0 || index % 5 !== 4)
        ? priorityYear
        : otherYears[Math.floor(index / 5) % otherYears.length];

    const key = `${subject}|${country}|${year}|${eventWord}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (year === priorityYear) priorityUsed += 1;

    // Intent words bias towards a conference's own site; the negatives keep roundups and
    // directory pages out of results we are paying for.
    const query = `${subject} ${eventWord} ${year} ${country} call for papers registration -"top conferences" -"list of conferences" -"upcoming conferences"`;
    planned.push({ query, subject, country, region, year });
  }

  return planned;
}

/** One cell of the discovery matrix: a region, a subject and a year. Coverage is measured per
 *  cell rather than in aggregate, because "600 candidates" can still mean nothing at all for
 *  Africa in 2027. */
export function cellKey(item: PlannedQuery): string {
  return `${item.region}|${item.subject}|${item.year}`;
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
  /**
   * A matrix cell (one region × category × year) is a COVERAGE GAP when Brave produced fewer
   * than this many strong candidates for it. Serper is sent at the gaps rather than at
   * everything, which is what makes it complementary instead of merely a second bill.
   */
  gapThresholdPerCell?: number;
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
          // Counted here, before anything is known about the answer: a query that returned
          // nothing was still a query that was issued and billed.
          this.accounting.braveQueries += 1;
          const metric = metricFor("brave");
          metric.queriesIssued += 1;
          const results = await braveSearch(item.query, perQuery, "low");
          this.accounting.braveRawResults += results.length;
          metric.rawResults += results.length;
          if (results.length === 0) this.accounting.braveZeroResultQueries += 1;
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
          this.accounting.braveFailedQueries += 1;
          if (this.accounting.braveErrors.length < 5) this.accounting.braveErrors.push(message);
          this.options.logger?.log("error", { detail: `brave query failed: ${message}` });
        }
      }
    } else {
      this.accounting.braveErrors.push("BRAVE_SEARCH_API_KEY is not set");
    }

    // ---- Serper: complementary, not duplicative.
    //
    // Phase 1.2 queried both engines on every query, which measures overlap beautifully and pays
    // twice for it. Phase 1.2's benchmark then reported zero Serper queries, which measured
    // nothing at all. Neither is what we want. Serper now runs at the specific matrix cells Brave
    // left thin — a region/category/year with too few strong candidates is a real coverage gap,
    // and a second index is exactly the right tool for it.
    const gapThreshold = this.options.gapThresholdPerCell ?? 2;
    const threshold = this.options.serperYieldThreshold ?? maxQueries * 4;

    // Strong candidates Brave found, per matrix cell.
    const braveStrongByCell = new Map<string, number>();
    for (const item of planned) {
      const executed = this.accounting.queriesExecuted.find((q) => q.provider === "brave" && q.query === item.query);
      const cell = cellKey(item);
      braveStrongByCell.set(cell, (braveStrongByCell.get(cell) ?? 0) + (executed?.strong ?? 0));
    }
    const gapCells = new Set(
      [...braveStrongByCell.entries()].filter(([, strong]) => strong < gapThreshold).map(([cell]) => cell)
    );
    // A cell Brave never reached at all is a gap too — that is "Brave query coverage exhausted".
    for (const item of planned) {
      const executed = this.accounting.queriesExecuted.find((q) => q.provider === "brave" && q.query === item.query);
      if (!executed) gapCells.add(cellKey(item));
    }
    this.accounting.coverageGaps = [...gapCells]
      .map((cell) => ({ cell, braveStrong: braveStrongByCell.get(cell) ?? 0 }))
      .sort((a, b) => a.braveStrong - b.braveStrong)
      .slice(0, 40);

    const braveStrong = this.accounting.braveStrongCandidates;
    if (!isSerperConfigured()) {
      // Said plainly, and separately from "asked and got nothing", because Phase 1.2 could not.
      this.accounting.serperDecision = "skipped: SERPER_API_KEY is not set, so Serper was never called";
    } else if (this.accounting.braveQueries === 0) {
      this.accounting.serperDecision = "used: Brave issued no queries at all (unconfigured or failing)";
    } else if (gapCells.size === 0 && braveStrong >= threshold) {
      this.accounting.serperDecision = `skipped: Brave covered every matrix cell to at least ${gapThreshold} strong candidates and returned ${braveStrong} overall — nothing left for a second index to add`;
    } else {
      this.accounting.serperDecision = `used: ${gapCells.size} of ${braveStrongByCell.size} matrix cells came back under ${gapThreshold} strong candidates from Brave`;
    }

    if (this.accounting.serperDecision.startsWith("used")) {
      // Only the gap cells, and within them the queries Brave answered worst — so Serper spend
      // goes where Brave demonstrably did not reach, including the 2027 cells specifically.
      const weakQueries = planned
        .filter((item) => gapCells.size === 0 || gapCells.has(cellKey(item)))
        .sort((left, right) => {
          const strongOf = (item: PlannedQuery) =>
            this.accounting.queriesExecuted.find((q) => q.provider === "brave" && q.query === item.query)?.strong ?? -1;
          // Thinnest first, and among equals the priority year first.
          return strongOf(left) - strongOf(right) || (right.year === 2027 ? 1 : 0) - (left.year === 2027 ? 1 : 0);
        });
      for (const item of weakQueries) {
        if (context.signal?.aborted) break;
        if (candidates.length >= context.maxCandidates) break;
        if (this.accounting.braveStrongCandidates + this.accounting.serperStrongCandidates >= threshold) {
          this.accounting.serperDecision += `; stopped early once the combined yield reached ${threshold}`;
          break;
        }
        try {
          this.accounting.serperQueries += 1;
          const metric = metricFor("serper");
          metric.queriesIssued += 1;
          const results = await serperSearch(item.query, perQuery);
          this.accounting.serperRawResults += results.length;
          metric.rawResults += results.length;
          // serperSearch returns [] when unconfigured and throws on a real failure, so an empty
          // answer here means the index genuinely had nothing — worth knowing, and worth keeping
          // apart from a query that was never sent.
          if (results.length === 0) this.accounting.serperZeroResultQueries += 1;
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
          this.accounting.serperFailedQueries += 1;
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
