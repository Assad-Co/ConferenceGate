// The pipeline.
//
//   providers → candidate URLs → fetch (conditional) → structured data → deterministic HTML →
//   AI fallback (only if still thin) → normalize → classify → categorize → validate → deduplicate
//   → store
//
// Each stage is a module of its own and is unit-tested on fixtures; this file is only the
// sequencing, the budgets, and the bookkeeping that turns a run into a row in discovery_runs.
//
// The extraction order is the cost order (section 42): the free, first-hand route runs first and
// the paid one runs only for pages the free routes left incomplete.

import { dbRun } from "../db";
import type { AiJsonCaller } from "./aiExtract";
import { extractWithAi, needsAiFallback } from "./aiExtract";
import { DomainCircuitBreaker } from "./alternateUrl";
import { classifyCategories } from "./categories";
import { classifyRelevance } from "./classify";
import { extractFromHtml, pageText as readablePageText } from "./htmlExtract";
import { hashContent, isHtmlLike, setDomainCrawlDelay, type UrlGuard } from "./httpClient";
import { newReadBudget, readPage, type ReadBudget } from "./readPage";
import { canonicalLink, documentTitle, parseHtml } from "./html";
import { RunLogger } from "./logging";
import { classifySource, isEligibleOfficialSource } from "./sourceClassification";
import {
  canonicalizeUrl,
  cleanDescription,
  extractAcronym,
  extractEdition,
  normalizeDates,
  normalizeDeadlines,
  normalizeEventType,
  normalizeFormat,
  normalizeLocation,
  normalizeNavigableUrl,
} from "./normalize";
import { classifyFailure, failurePolicy, type FailureClass } from "./failureClass";
import {
  findOfficialCandidates,
  newDirectoryResolutionStats,
  resolutionRate,
  type DirectoryResolutionStats,
} from "./officialResolution";
import { fetchRobots, isPathAllowed, type RobotsPolicy } from "./robots";
import { limitPerDomain } from "./sitemaps";
import { allProviders } from "./providers";
import { SearchDiscoveryProvider, type SearchAccounting } from "./providers/searchProvider";
import { SitemapDiscoveryProvider } from "./providers/sitemapProvider";
import { getDomain, newId, recordCrawlSuccess, TRUST_BY_SOURCE_TYPE } from "./sourceRegistry";
import {
  eventIdForUrl,
  getUrlState,
  queueForReview,
  recordChange,
  recordUrlVisit,
  rememberUrl,
  storeEvent,
  type StoreOutcome,
} from "./store";
import { extractStructuredEvents } from "./structuredData";
import { validateEvent } from "./validate";
import {
  emptyRawExtraction,
  type DiscoveryCandidate,
  type FieldProvenance,
  type NormalizedEvent,
  type RawEventExtraction,
  type SourceType,
} from "./types";

export interface RunOptions {
  /** Years the run is about. Defaults to the remainder of this year plus the next two. */
  targetYears?: number[];
  /** Registry domains to visit. Empty means "whichever are due". */
  domains?: string[];
  /** Subject terms, for query-driven providers only. Left empty, the search provider builds its
   *  own matrix from the platform's category taxonomy and a global country spread. */
  topics?: string[];
  /** Total search queries the run may spend across Brave and Serper together. */
  maxSearchQueries?: number;
  /** Explicitly enable or disable paid search discovery for this run. */
  enableSearchDiscovery?: boolean;
  maxCandidates?: number;
  /** Candidate pages attempted, including failed and unchanged fetches. The real cost ceiling. */
  maxPages?: number;
  /** Hard wall-clock limit. */
  timeBudgetMs?: number;
  /** Model calls permitted. 0 (the default) means the run is entirely free. */
  maxAiCalls?: number;
  /** Hosted-reader calls permitted. Only pages the direct fetch could not read consume these. */
  maxJinaPages?: number;
  /** Alternate-URL retries permitted across the run. */
  maxAlternateUrls?: number;
  /** How many DIFFERENT domains may be read at once. Each domain is still read one request at a
   *  time, at its own polite interval — this only stops one slow site holding up the others. */
  domainConcurrency?: number;
  /** Stop once this many conferences have been accepted. 0 means "use the page budget". */
  acceptedTarget?: number;
  /** Candidates any one domain may contribute, so a single large site cannot crowd out the rest. */
  maxCandidatesPerDomain?: number;
  /** Consecutive refusals from one host before the run stops asking it. */
  domainRefusalThreshold?: number;
  ai?: AiJsonCaller | null;
  /** Let high-confidence records from trusted official sources publish automatically. Off for
   *  Phase 1: everything coherent is validated and held. */
  allowAutoPublish?: boolean;
  quiet?: boolean;
  urlGuard?: UrlGuard;
  scheme?: "http" | "https";
  trigger?: string;
  signal?: AbortSignal;
  /** Test seam: skips the per-domain politeness delay for the local fixture server. */
  fastFixtureMode?: boolean;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  targetYears: number[];
  domains: string[];
  candidatesDiscovered: number;
  pagesAttempted: number;
  pagesFetched: number;
  pagesUnchanged: number;
  pagesFailed: number;
  terminalOutcomes: Record<string, number>;
  /** How each page that was read got read, and how well each route did. */
  reads: {
    directPages: number;
    directUsablePages: number;
    jinaPages: number;
    jinaRecoveredPages: number;
    jinaSkippedForCap: number;
    /** Pages read by direct fetch that produced an accepted conference. */
    directExtractionSuccesses: number;
    /** Same, for pages the hosted reader rescued. */
    jinaExtractionSuccesses: number;
  };
  /** Domains whose robots.txt was fetched on demand because they came from search, not the
   *  registry — proof that a search-discovered host is checked before it is crawled. */
  robotsCheckedOnDemand: number;
  robotsDisallowedUrls: number;
  eventsDetected: number;
  eventsRejected: number;
  created: number;
  updated: number;
  merged: number;
  reviewQueued: number;
  aiCalls: number;
  extractionMethods: Record<string, number>;
  rejectionReasons: Record<string, number>;
  skippedDomains: Array<{ domain: string; reason: string }>;
  /** Domains this machine's own network refused to reach. An infrastructure problem to fix, not
   *  a property of the domains — listed separately so it can never be read as "these sites
   *  blocked us". */
  egressBlockedDomains: string[];
  providers: Array<{ name: string; enabled: boolean; reason: string | null; candidates: number }>;
  /** Queries spent and candidates gained, per search engine. Null when search was not used. */
  search: SearchAccounting | null;
  /** How many domains were in play, how many were read at once, and how long reading took. */
  concurrency: { domains: number; workers: number; readElapsedMs: number };
  /** Why the read phase ended, when it ended early. */
  stopReason: string | null;
  /** Candidates never requested because their host had already refused us enough times. Not an
   *  attempt, so deliberately outside `terminalOutcomes`. */
  skippedForDomainRefusal: number;
  /** Candidates skipped because this run had already read that exact page — usually a site
   *  directory resolution reached first. Also not an attempt. */
  alreadyReadThisRun: number;
  /** Known URLs whose persisted recheck time has not arrived; they consume no page budget. */
  scheduledUrlsSkipped: number;
  /** Every fetch failure, by class — the taxonomy, not one number. */
  failureClasses: Record<string, number>;
  /** The same, per domain, so a bad host is visible rather than averaged away. */
  failuresByDomain: Record<string, Record<string, number>>;
  /** Domains the run stopped asking, and after how many refusals. */
  circuitBrokenDomains: Array<{ domain: string; afterAttempts: number; failureClass: string }>;
  /** Alternate-URL retries: attempted, and how many rescued a conference. */
  alternateUrls: { attempted: number; recovered: number };
  /** Directory leads and how many were resolved to the conference's own site. */
  directoryResolution: DirectoryResolutionStats & { resolutionRate: number };
  /** Which retrieval route produced each accepted conference. */
  recoveryMethods: Record<string, number>;
  /** Candidates dropped by the per-domain diversity cap, and which domains hit it. */
  diversity: { candidatesDropped: number; domainsAtCap: string[] };
  counters: Record<string, number>;
  /** The accepted events, in memory, so a caller can export a CSV without re-reading the DB. */
  events: NormalizedEvent[];
  errors: string[];
  qualityByProvider: Record<string, ProviderQuality>;
  searchProviderMetrics: Record<string, { queriesIssued: number; rawResults: number; uniqueUrls: number; sharedUrls: number }>;
}

interface ProviderQuality {
  candidates: number; fetched: number; conferencePositive: number; accepted: number;
  fullyValidated: number; needsReview: number; rejected: number; finished: number; fetchFailures: number; duplicates: number;
}

function providerQuality(summary: RunSummary, provider: string): ProviderQuality {
  return summary.qualityByProvider[provider] ||= { candidates: 0, fetched: 0, conferencePositive: 0, accepted: 0, fullyValidated: 0, needsReview: 0, rejected: 0, finished: 0, fetchFailures: 0, duplicates: 0 };
}

function providerDecisionMetrics(summary: RunSummary): Record<string, Record<string, number>> {
  const shared = summary.qualityByProvider["brave+serper"];
  const out: Record<string, Record<string, number>> = {};
  for (const provider of ["brave", "serper"]) {
    const own = summary.qualityByProvider[provider];
    const search = summary.searchProviderMetrics[provider];
    const add = (field: keyof ProviderQuality) => (own?.[field] || 0) + (shared?.[field] || 0);
    const queries = search?.queriesIssued || 0;
    out[provider] = {
      queriesIssued: queries, rawResults: search?.rawResults || 0, uniqueUrls: search?.uniqueUrls || 0,
      sharedUrls: search?.sharedUrls || 0, fetched: add("fetched"), accepted: add("accepted"),
      fullyValidated: add("fullyValidated"), needsReview: add("needsReview"), rejected: add("rejected"),
      duplicates: add("duplicates"), providerOnlyAccepted: own?.accepted || 0,
      sharedAccepted: shared?.accepted || 0,
      acceptedPerQuery: queries ? Number((add("accepted") / queries).toFixed(4)) : 0,
      uniqueUsefulUrlsPerQuery: queries ? Number((add("conferencePositive") / queries).toFixed(4)) : 0,
    };
  }
  return out;
}

function defaultTargetYears(now = new Date()): number[] {
  const year = now.getUTCFullYear();
  return [year, year + 1, year + 2];
}

/** How long before a page is worth reading again — sooner for pages that are actually events. */
function recheckHoursFor(isEvent: boolean | null, changed: boolean): number {
  if (isEvent === true) return changed ? 72 : 168;
  if (isEvent === false) return 720; // a page that is definitely not an event is rarely worth revisiting
  return 336;
}

export async function runDiscovery(options: RunOptions = {}): Promise<RunSummary> {
  const runId = newId("run");
  const logger = new RunLogger(runId, { quiet: options.quiet });
  const startedAt = new Date().toISOString();
  const targetYears = options.targetYears?.length ? options.targetYears : defaultTargetYears();
  const deadline = Date.now() + (options.timeBudgetMs ?? 10 * 60 * 1000);
  const maxPages = options.maxPages ?? 200;
  const maxAiCalls = options.maxAiCalls ?? 0;
  const acceptedTarget = options.acceptedTarget ?? 0;
  // Buffered rather than written per failure: one insert per failure would triple the database
  // traffic of a run whose whole problem is that fetches fail.
  const failureRows: Array<{ domain: string; failureClass: FailureClass; status: number | null; detail: string | null }> = [];

  const summary: RunSummary = {
    runId,
    startedAt,
    finishedAt: startedAt,
    targetYears,
    domains: options.domains ?? [],
    candidatesDiscovered: 0,
    pagesAttempted: 0,
    pagesFetched: 0,
    pagesUnchanged: 0,
    pagesFailed: 0,
    terminalOutcomes: {},
    reads: {
      directPages: 0,
      directUsablePages: 0,
      jinaPages: 0,
      jinaRecoveredPages: 0,
      jinaSkippedForCap: 0,
      directExtractionSuccesses: 0,
      jinaExtractionSuccesses: 0,
    },
    robotsCheckedOnDemand: 0,
    robotsDisallowedUrls: 0,
    eventsDetected: 0,
    eventsRejected: 0,
    created: 0,
    updated: 0,
    merged: 0,
    reviewQueued: 0,
    aiCalls: 0,
    extractionMethods: {},
    rejectionReasons: {},
    skippedDomains: [],
    egressBlockedDomains: [],
    providers: [],
    search: null,
    concurrency: { domains: 0, workers: 0, readElapsedMs: 0 },
    stopReason: null,
    skippedForDomainRefusal: 0,
    alreadyReadThisRun: 0,
    scheduledUrlsSkipped: 0,
    failureClasses: {},
    failuresByDomain: {},
    circuitBrokenDomains: [],
    alternateUrls: { attempted: 0, recovered: 0 },
    directoryResolution: { ...newDirectoryResolutionStats(), resolutionRate: 0 },
    recoveryMethods: {},
    diversity: { candidatesDropped: 0, domainsAtCap: [] },
    counters: {},
    events: [],
    errors: [],
    qualityByProvider: {},
    searchProviderMetrics: {},
  };

  await dbRun(
    `INSERT INTO discovery_runs (id, status, trigger, target_years, domains) VALUES (?, 'running', ?, ?, ?)`,
    [runId, options.trigger || "manual", JSON.stringify(targetYears), JSON.stringify(options.domains || [])]
  );
  logger.log("run_started", { detail: `years ${targetYears.join(", ")}`, count: 1 });

  try {
    // ---- Stage 1: discovery.
    const sitemapProvider = new SitemapDiscoveryProvider({
      logger,
      urlGuard: options.urlGuard,
      scheme: options.scheme,
      ignoreSchedule: !!options.domains?.length,
    });
    const searchProvider = new SearchDiscoveryProvider({
      logger,
      enabled: options.enableSearchDiscovery,
      maxQueries: options.maxSearchQueries ?? 24,
    });
    const providers = [
      sitemapProvider,
      searchProvider,
      ...allProviders({ search: { logger } }).filter((p) => p.name !== "sitemap" && p.name !== "search"),
    ];

    const candidates: DiscoveryCandidate[] = [];
    for (const provider of providers) {
      const enabled = provider.isEnabled();
      let produced = 0;
      if (enabled) {
        try {
          const found = await provider.discover({
            targetYears,
            maxCandidates: options.maxCandidates ?? 2000,
            domains: options.domains,
            topics: options.topics,
            signal: options.signal,
          });
          produced = found.length;
          candidates.push(...found);
          if (provider.name === "search") summary.searchProviderMetrics = { ...(provider as any).metrics };
        } catch (error: any) {
          // One provider failing is not the run failing.
          summary.errors.push(`${provider.name}: ${error?.message || error}`);
          logger.log("error", { detail: `provider ${provider.name} failed: ${error?.message || error}` });
        }
      }
      summary.providers.push({
        name: provider.name,
        enabled,
        reason: provider.unavailableReason(),
        candidates: produced,
      });
    }
    if (searchProvider.isEnabled()) summary.search = searchProvider.accounting;
    summary.skippedDomains = sitemapProvider.skipped;
    summary.egressBlockedDomains = sitemapProvider.egressBlocked;
    summary.candidatesDiscovered = candidates.length;
    for (const candidate of candidates) providerQuality(summary, candidate.provider).candidates += 1;
    if (summary.egressBlockedDomains.length > 0) {
      summary.errors.push(
        `${summary.egressBlockedDomains.length} domain(s) unreachable from this machine: the local network egress policy refused the connection. This is not the sites refusing us. Allow these hosts, or run the discovery worker where outbound HTTPS is permitted: ${summary.egressBlockedDomains.join(", ")}`
      );
    }

    // Highest-priority candidates first, so a capped run reads the most promising pages.
    candidates.sort((left, right) => right.priority - left.priority);
    for (const candidate of candidates.slice(0, 5000)) {
      await rememberUrl({
        url: candidate.url,
        domain: candidate.sourceDomain,
        provider: candidate.provider,
        priority: candidate.priority,
      });
    }

    // ---- Stage 2..8: read, extract, normalize, classify, validate, deduplicate, store.
    const domainTrust = new Map<string, { trust: number; type: SourceType }>();
    const readBudget: ReadBudget = newReadBudget(options.maxJinaPages ?? 40, options.maxAlternateUrls ?? 60);

    // One trust lookup per domain, shared by the main read path and by directory resolution —
    // which reaches domains the registry has never seen and must still weigh them correctly.
    const trustFor = async (domain: string): Promise<{ trust: number; type: SourceType }> => {
      const cached = domainTrust.get(domain);
      if (cached) return cached;
      const row = await getDomain(domain);
      const resolved = {
        trust: row?.trust_score ?? TRUST_BY_SOURCE_TYPE.unknown,
        type: (row?.source_type as SourceType) ?? "unknown",
      };
      domainTrust.set(domain, resolved);
      return resolved;
    };

    // Candidates from search land on domains the registry has never heard of, so their robots.txt
    // has not been read yet. Fetching it lazily, once per domain, is what keeps the "no page is
    // requested before its site's robots.txt has been read" rule true for every route into the
    // engine and not just the sitemap one.
    const robotsByDomain = new Map<string, RobotsPolicy | null>(sitemapProvider.policies);
    const robotsFor = async (domain: string, origin: string): Promise<RobotsPolicy | null> => {
      if (robotsByDomain.has(domain)) return robotsByDomain.get(domain) ?? null;
      const policy = await fetchRobots(origin, { urlGuard: options.urlGuard });
      summary.robotsCheckedOnDemand += 1;
      if (policy.error === "blocked_by_local_egress_policy") {
        if (!summary.egressBlockedDomains.includes(domain)) summary.egressBlockedDomains.push(domain);
        robotsByDomain.set(domain, null);
        return null;
      }
      setDomainCrawlDelay(domain, policy.crawlDelayMs);
      logger.log("robots_fetched", {
        domain,
        detail: `on demand (search-discovered host); ${policy.rules.length} rules`,
      });
      robotsByDomain.set(domain, policy);
      return policy;
    };

    // ---- Candidate diversity.
    //
    // Phase 1.2 exhausted at 324 candidates with 27 of 51 accepted events coming from
    // directories: the budget went to whichever hosts had the most URLs, not to the widest set of
    // conferences. Capping each domain's contribution spends the same budget across more sites.
    const diversityCap = options.maxCandidatesPerDomain ?? 25;
    const limited = limitPerDomain(candidates, diversityCap);
    summary.diversity = { candidatesDropped: limited.dropped, domainsAtCap: limited.domainsAtCap.slice(0, 40) };
    if (limited.dropped > 0) {
      logger.log("urls_discovered", {
        detail: `per-domain diversity cap of ${diversityCap} dropped ${limited.dropped} lower-priority candidates from ${limited.domainsAtCap.length} domain(s)`,
        count: limited.kept.length,
      });
    }
    candidates.length = 0;
    candidates.push(...limited.kept);

    // A host that has refused us three times will refuse the next two hundred candidates too,
    // and every one of those is page budget spent on a certainty.
    const breaker = new DomainCircuitBreaker(options.domainRefusalThreshold ?? 3);
    const directoryStats = newDirectoryResolutionStats();
    // Every page this run has already extracted, by canonical URL. Directory resolution often
    // points at a site the run crawled directly minutes earlier; fetching it twice costs a
    // request, costs the site a request, and files the same source against the same event twice.
    const processedUrls = new Set<string>();

    const noteFailure = (domain: string, failureClass: FailureClass, detail: string | null, status: number | null) => {
      summary.failureClasses[failureClass] = (summary.failureClasses[failureClass] || 0) + 1;
      const perDomain = (summary.failuresByDomain[domain] ||= {});
      perDomain[failureClass] = (perDomain[failureClass] || 0) + 1;
      failureRows.push({ domain, failureClass, status, detail });
      if (breaker.record(domain, failureClass)) {
        logger.log("domain_skipped", {
          domain,
          detail: `no longer asking this host: ${breaker.reasonFor(domain)}`,
        });
      }
    };

    // ---- Controlled concurrency.
    //
    // Phase 1.2 read one page at a time, so the per-domain politeness delay became a GLOBAL
    // delay: most of a 324-attempt run's wall clock went on a courtesy owed to one site at a
    // time. Domains are independent, though, so several can be in flight at once while each one
    // individually is still read politely, in order, one request at a time.
    //
    // Nothing about validation changes to buy this. The only thing that changes is how many
    // different sites we are waiting on simultaneously.
    const byDomain = new Map<string, DiscoveryCandidate[]>();
    for (const candidate of candidates) {
      const bucket = byDomain.get(candidate.sourceDomain) ?? [];
      bucket.push(candidate);
      byDomain.set(candidate.sourceDomain, bucket);
    }
    // Best-first across domains, so a capped run spends its budget on the most promising sites.
    const domainOrder = [...byDomain.entries()]
      .sort(
        (left, right) =>
          Math.max(...right[1].map((c) => c.priority)) - Math.max(...left[1].map((c) => c.priority))
      )
      .map(([domain]) => domain);
    summary.concurrency.domains = domainOrder.length;

    const stopRequested = (): string | null => {
      if (options.signal?.aborted) return "aborted";
      if (summary.pagesAttempted >= maxPages) return "page budget reached";
      if (Date.now() > deadline) return "time budget reached";
      if (acceptedTarget > 0 && summary.created + summary.updated >= acceptedTarget) {
        return "accepted target reached";
      }
      return null;
    };

    const processCandidate = async (candidate: DiscoveryCandidate): Promise<void> => {

      // Resolution may have already read this exact page a moment ago (it is often a site the
      // run was going to reach anyway). Reading it twice would cost the site a request and file
      // the same source against the same event twice.
      const candidateCanonical = canonicalizeUrl(candidate.url) ?? candidate.url;
      if (processedUrls.has(candidateCanonical)) {
        summary.alreadyReadThisRun += 1;
        return;
      }
      // Claimed before the fetch, not after: this is a mutual exclusion between concurrent
      // workers, and a claim made after the await would be too late to prevent anything.
      processedUrls.add(candidateCanonical);

      // Production batches repeatedly generate the same valuable matrix cells. A URL already
      // checked and not yet due must not consume the next batch's page budget merely because a
      // search engine returned it again.
      const previous = await getUrlState(candidate.url);
      if (previous?.next_check_at && Date.parse(previous.next_check_at) > Date.now()) {
        summary.scheduledUrlsSkipped += 1;
        return;
      }

      if (breaker.isOpen(candidate.sourceDomain)) {
        // Counted separately, not as a terminal outcome: no request was made, so this is not an
        // attempt, and folding it in would break the reconciliation invariant that every attempt
        // ends in exactly one outcome.
        summary.skippedForDomainRefusal += 1;
        return;
      }

      summary.pagesAttempted += 1;
      const terminal = (outcome: string) => { summary.terminalOutcomes[outcome] = (summary.terminalOutcomes[outcome] || 0) + 1; };

      let origin: string;
      try {
        origin = new URL(candidate.url).origin;
      } catch {
        return;
      }
      const policy = await robotsFor(candidate.sourceDomain, origin);
      if (policy?.blanketDisallow) {
        logger.log("robots_disallowed", { domain: candidate.sourceDomain, url: candidate.url });
        summary.robotsDisallowedUrls += 1;
        terminal("robots_disallowed");
        return;
      }
      if (policy && !isPathAllowed(policy, candidate.url)) {
        terminal("robots_disallowed");
        logger.log("url_skipped", { url: candidate.url, detail: "disallowed by robots.txt" });
        summary.robotsDisallowedUrls += 1;
        return;
      }

      if (!domainTrust.has(candidate.sourceDomain)) {
        const row = await getDomain(candidate.sourceDomain);
        domainTrust.set(candidate.sourceDomain, {
          trust: row?.trust_score ?? TRUST_BY_SOURCE_TYPE.unknown,
          type: (row?.source_type as SourceType) ?? "unknown",
        });
      }
      const trust = domainTrust.get(candidate.sourceDomain)!;

      const read = await readPage(candidate.url, {
        etag: previous?.etag ?? null,
        lastModified: previous?.last_modified ?? null,
        urlGuard: options.urlGuard,
        budget: readBudget,
        // The hosted reader is spent only on candidates worth reading twice. A low-priority URL
        // that came back as an empty shell is simply left unread.
        allowFallback: candidate.priority >= 0.35,
      });
      const response = read.direct;

      if (response.notModified) {
        summary.pagesUnchanged += 1;
        terminal("unchanged_304");
        logger.log("url_unchanged", { url: candidate.url });
        await recordUrlVisit({
          url: candidate.url,
          domain: candidate.sourceDomain,
          provider: candidate.provider,
          status: 304,
          etag: response.etag,
          lastModified: response.lastModified,
          contentHash: previous?.content_hash ?? null,
          isEvent: previous?.is_event === null || previous?.is_event === undefined ? null : previous.is_event === 1,
          recheckHours: recheckHoursFor(previous?.is_event === 1 ? true : previous?.is_event === 0 ? false : null, false),
        });
        return;
      }

      if (response.blockedByLocalPolicy) {
        terminal("skipped_local_policy");
        // Same reasoning as for robots.txt above: record nothing against the URL or its domain.
        if (!summary.egressBlockedDomains.includes(candidate.sourceDomain)) {
          summary.egressBlockedDomains.push(candidate.sourceDomain);
        }
        logger.log("url_skipped", {
          url: candidate.url,
          detail: "unreachable from this machine (local network egress policy)",
        });
        return;
      }

      const usedJina = read.route === "jina";
      if (read.usedFallback) {
        logger.log("jina_attempted", { url: candidate.url });
        if (usedJina) logger.log("jina_successful", { url: candidate.url });
        else logger.log("jina_failed", { url: candidate.url, detail: read.fallbackFailureReason || "added nothing" });
      }

      if (!read.html) {
        summary.pagesFailed += 1;
        const failureClass =
          read.failureClass ??
          classifyFailure({
            status: response.status,
            error: response.error,
            blockedByLocalPolicy: response.blockedByLocalPolicy,
            contentType: response.contentType,
          });
        terminal(`fetch_failed:${failureClass}`);
        providerQuality(summary, candidate.provider).fetchFailures += 1;
        noteFailure(candidate.sourceDomain, failureClass, read.failureReason || response.error, response.status || null);
        logger.log(failureClass === "timeout" ? "page_timeout" : "page_failed", {
          url: candidate.url,
          detail: `${failureClass}: ${failurePolicy(failureClass).meaning}`,
        });
        await recordUrlVisit({
          url: candidate.url,
          domain: candidate.sourceDomain,
          provider: candidate.provider,
          status: response.status,
          etag: null,
          lastModified: null,
          contentHash: null,
          failureReason: read.failureReason || response.error,
          failureClass,
          // A class that will not change on a retry is asked again much later than one that might.
          recheckHours: failurePolicy(failureClass).retryable ? 24 : 720,
        });
        return;
      }

      summary.pagesFetched += 1;
      providerQuality(summary, candidate.provider).fetched += 1;
      logger.log("page_fetched", { url: candidate.url, method: read.route });

      // A PDF, an image or a feed is not a page we extract from — and not a failure either.
      // Recorded with a long re-check interval so it is not fetched again any time soon.
      if (response.ok && !isHtmlLike(response)) {
        terminal("skipped_non_html");
        await recordUrlVisit({
          url: candidate.url,
          domain: candidate.sourceDomain,
          provider: candidate.provider,
          status: response.status,
          etag: response.etag,
          lastModified: response.lastModified,
          contentHash: response.contentHash,
          isEvent: false,
          recheckHours: 720,
        });
        return;
      }

      const contentHash = response.contentHash || hashContent(read.html);
      const unchangedBody = !!previous?.content_hash && previous.content_hash === contentHash;
      if (unchangedBody && previous?.is_event !== null && previous?.is_event !== undefined) {
        terminal("unchanged_content_hash");
        // Byte-identical to a page already read. Nothing can have changed, so nothing is
        // re-extracted, re-classified or re-deduplicated — but a known event is still marked as
        // seen and verified today, which is the honest record: we looked, and it still says this.
        summary.pagesUnchanged += 1;
        const knownEventId = previous.is_event === 1 ? await eventIdForUrl(candidate.url) : null;
        if (knownEventId) {
          await dbRun(
            `UPDATE discovery_events SET last_seen = datetime('now'), last_checked = datetime('now'),
               last_verified = datetime('now') WHERE id = ?`,
            [knownEventId]
          );
        }
        logger.log("url_unchanged", { url: candidate.url, detail: "content hash unchanged" });
        await recordUrlVisit({
          url: candidate.url,
          domain: candidate.sourceDomain,
          provider: candidate.provider,
          status: response.status,
          etag: response.etag,
          lastModified: response.lastModified,
          contentHash,
          isEvent: previous.is_event === 1,
          eventId: knownEventId,
          recheckHours: recheckHoursFor(previous.is_event === 1, false),
        });
        return;
      }

      terminal("fetched_processed");
      // A host that answered is not refusing us; its tally resets.
      breaker.recordSuccess(candidate.sourceDomain);
      // A redirect means the page that answered is not the URL we asked for; claim that too.
      processedUrls.add(canonicalizeUrl(response.finalUrl || candidate.url) ?? candidate.url);
      if (read.resolvedUrl) {
        logger.log("page_fetched", {
          url: candidate.url,
          detail: `read from an alternate URL after ${read.failureClass}: ${read.resolvedUrl}`,
        });
      }

      const outcome = await processPage({
        recoveryMethod: read.route === "alternate_url" ? "alternate_url" : read.route === "jina" ? "jina" : "direct",
        html: read.html,
        pageUrl: response.finalUrl || candidate.url,
        candidate,
        contentHash,
        trust,
        targetYears,
        logger,
        summary,
        options,
        maxAiCalls,
        robotsPolicy: policy ?? undefined,
        usedJina,
      });

      // Attribute the accepted conference to the route that actually produced the text, so
      // "direct-fetch extraction success rate" and "reader recovery rate" are measured, not
      // estimated.
      if (outcome.isEvent) {
        const route = read.route === "alternate_url" ? "alternate_url" : usedJina ? "jina" : "direct";
        summary.recoveryMethods[route] = (summary.recoveryMethods[route] || 0) + 1;
        if (usedJina) {
          summary.reads.jinaExtractionSuccesses += 1;
          logger.log("jina_recovered_event", { url: candidate.url });
        } else {
          summary.reads.directExtractionSuccesses += 1;
        }
      }

      // ---- A directory listing is a lead, not a destination.
      //
      // Phase 1.2 took 27 of its 51 accepted events from directories and only 12 from official
      // event sites, which is the wrong way round for a platform whose premise is that the
      // organiser's own word outranks a listing. So a directory that yields an event is read once
      // more for the one thing it uniquely offers: a link to where the event actually lives. The
      // directory stays recorded as the directory; the resolved site is added as a SEPARATE
      // source, and if resolution fails the record keeps its null official URL rather than being
      // quietly promoted.
      if (
        outcome.event &&
        ((outcome.isEvent &&
          (outcome.classification === "directory" || outcome.classification === "aggregator")) ||
          candidate.hints?.directoryLeadEligible === true)
      ) {
        directoryStats.directoryLeads += 1;
        const directoryPageUrl = response.finalUrl || candidate.url;
        const directoryHost = (() => {
          try {
            return new URL(directoryPageUrl).host.toLowerCase().replace(/^www\./, "");
          } catch {
            return "";
          }
        })();
        const declaredOfficial = outcome.event.officialUrl;
        const declaredIsOffHost = (() => {
          if (!declaredOfficial) return false;
          try {
            return new URL(declaredOfficial).host.toLowerCase().replace(/^www\./, "") !== directoryHost;
          } catch {
            return false;
          }
        })();

        // The listing may already name the conference's own site — in its structured data, or in
        // a link the deterministic extractor recognised. When it does, that is the candidate; the
        // scanner is the fallback for listings that bury it. Either way the site is then actually
        // READ, because a URL a directory printed is still only the directory's word for it: the
        // point of the exercise is to end up holding the organiser's own page as a source.
        const officialCandidates = declaredIsOffHost
          ? [{ url: declaredOfficial!, score: 1, reason: "the listing named the conference's own site" }]
          : findOfficialCandidates(read.html, directoryPageUrl, {
              title: outcome.event.title,
              acronym: outcome.event.acronym,
            });

        if (officialCandidates.length === 0) {
          directoryStats.noCandidateFound += 1;
          logger.log("url_skipped", {
            url: candidate.url,
            detail: "directory lead: no plausible link to the conference's own site on the page",
          });
        } else {
          let resolved = false;
          for (const officialCandidate of officialCandidates.slice(0, 2)) {
            if (stopRequested()) break;
            let officialDomain: string;
            let officialOrigin: string;
            try {
              const parsed = new URL(officialCandidate.url);
              officialDomain = parsed.hostname.toLowerCase().replace(/^www\./, "");
              officialOrigin = parsed.origin;
            } catch {
              continue;
            }
            if (breaker.isOpen(officialDomain)) continue;

            // Already read this run: the conference's own page is on file, so the lead is
            // resolved without spending a second request on it.
            const officialCanonical = canonicalizeUrl(officialCandidate.url) ?? officialCandidate.url;
            if (processedUrls.has(officialCanonical)) {
              resolved = true;
              directoryStats.resolutionsAttempted += 1;
              directoryStats.resolutionsSuccessful += 1;
              directoryStats.validatedAfterResolution += 1;
              logger.log("event_updated", {
                url: officialCandidate.url,
                detail: "directory lead resolved to a page this run had already read",
              });
              break;
            }

            // The resolved site is a site like any other: its robots.txt is read first.
            const officialPolicy = await robotsFor(officialDomain, officialOrigin);
            if (officialPolicy?.blanketDisallow || (officialPolicy && !isPathAllowed(officialPolicy, officialCandidate.url))) {
              logger.log("robots_disallowed", { domain: officialDomain, url: officialCandidate.url });
              summary.robotsDisallowedUrls += 1;
              continue;
            }

            directoryStats.resolutionsAttempted += 1;
            summary.pagesAttempted += 1;
            // Same claim-before-fetch rule as the main loop, and for the same reason.
            processedUrls.add(officialCanonical);
            const officialRead = await readPage(officialCandidate.url, {
              urlGuard: options.urlGuard,
              budget: readBudget,
              allowFallback: true,
            });
            if (!officialRead.html) {
              directoryStats.candidateUnreadable += 1;
              const officialFailure =
                officialRead.failureClass ??
                classifyFailure({ status: officialRead.direct.status, error: officialRead.direct.error });
              terminal(`fetch_failed:${officialFailure}`);
              summary.pagesFailed += 1;
              noteFailure(officialDomain, officialFailure, officialRead.failureReason, officialRead.direct.status || null);
              continue;
            }

            terminal("fetched_processed");
            summary.pagesFetched += 1;
            breaker.recordSuccess(officialDomain);
            const officialOutcome = await processPage({
              recoveryMethod: "directory_resolution",
              resolvedFromDirectory: true,
              html: officialRead.html,
              pageUrl: officialRead.direct.finalUrl || officialCandidate.url,
              // Attributed to the domain that actually served it, so source counts stay honest.
              candidate: { ...candidate, url: officialCandidate.url, sourceDomain: officialDomain },
              contentHash: officialRead.direct.contentHash || hashContent(officialRead.html),
              trust: await trustFor(officialDomain),
              targetYears,
              logger,
              summary,
              options,
              maxAiCalls,
              robotsPolicy: officialPolicy ?? undefined,
            });

            await recordUrlVisit({
              url: officialCandidate.url,
              domain: officialDomain,
              provider: `${candidate.provider}+directory_resolution`,
              status: officialRead.direct.status,
              etag: officialRead.direct.etag,
              lastModified: officialRead.direct.lastModified,
              contentHash: officialRead.direct.contentHash,
              isEvent: officialOutcome.isEvent,
              eventId: officialOutcome.eventId,
              recheckHours: recheckHoursFor(officialOutcome.isEvent, true),
            });

            if (officialOutcome.isEvent) {
              resolved = true;
              directoryStats.resolutionsSuccessful += 1;
              summary.recoveryMethods.directory_resolution =
                (summary.recoveryMethods.directory_resolution || 0) + 1;
              // The official page passed the unchanged full validation rules. This also counts
              // when the directory page itself was rejected: it was a lead, never the evidence
              // used to accept the conference.
              directoryStats.validatedAfterResolution += 1;
              logger.log("event_updated", {
                url: officialCandidate.url,
                detail: `resolved from a directory lead (${officialCandidate.reason})`,
              });
              await recordChange(
                officialOutcome.eventId!,
                "official_source_resolved",
                "official_url",
                null,
                officialCandidate.url,
                candidate.url
              );
              break;
            }
          }
          if (!resolved) {
            logger.log("url_skipped", {
              url: candidate.url,
              detail: "directory lead: the conference's own site could not be confirmed",
            });
          }
        }
      }

      await recordUrlVisit({
        url: candidate.url,
        domain: candidate.sourceDomain,
        provider: candidate.provider,
        status: response.status,
        etag: response.etag,
        lastModified: response.lastModified,
        contentHash,
        isEvent: outcome.isEvent,
        eventId: outcome.eventId,
        alternateUrl: read.resolvedUrl,
        recheckHours: recheckHoursFor(outcome.isEvent, !unchangedBody),
      });
    };

    const workerCount = Math.max(1, Math.min(options.domainConcurrency ?? 4, domainOrder.length || 1));
    summary.concurrency.workers = workerCount;
    const readStartedAt = Date.now();
    let stopReason: string | null = null;

    const worker = async (): Promise<void> => {
      while (true) {
        const domain = domainOrder.shift();
        if (!domain) return;
        // Every candidate on one domain is read strictly in sequence, so the per-domain interval
        // and concurrency ceiling in httpClient still mean exactly what they say.
        for (const candidate of byDomain.get(domain) ?? []) {
          const stop = stopRequested();
          if (stop) {
            stopReason ??= stop;
            return;
          }
          try {
            await processCandidate(candidate);
          } catch (error: any) {
            // One bad page must not take down its worker, let alone the run.
            summary.errors.push(`${candidate.url}: ${String(error?.message || error).slice(0, 200)}`);
            logger.log("error", { url: candidate.url, detail: String(error?.message || error) });
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    summary.concurrency.readElapsedMs = Date.now() - readStartedAt;
    if (stopReason) {
      summary.stopReason = stopReason;
      logger.log("run_finished", { detail: stopReason });
    }


    summary.alternateUrls = { attempted: readBudget.alternateAttempted, recovered: readBudget.alternateRecovered };
    summary.directoryResolution = { ...directoryStats, resolutionRate: resolutionRate(directoryStats) };
    summary.circuitBrokenDomains = breaker.summary();
    for (const [failureClass, count] of Object.entries(readBudget.failureClasses)) {
      // The read chain sees failures the pipeline never does — a direct fetch that the reader or
      // an alternate URL then rescued. Those belong in the taxonomy too: they are what the
      // cascade recovered from, and hiding them would flatter the fetch-failure rate.
      summary.failureClasses[`recovered:${failureClass}`] =
        (summary.failureClasses[`recovered:${failureClass}`] || 0) + count;
    }
    summary.reads.directPages = readBudget.directReads;
    summary.reads.directUsablePages = readBudget.directUsable;
    summary.reads.jinaPages = readBudget.jinaUsed;
    summary.reads.jinaRecoveredPages = readBudget.jinaRecovered;
    summary.reads.jinaSkippedForCap = readBudget.jinaSkippedForCap;

    // Only domains we actually reached count as successfully crawled; one we could not get out
    // to must not have its schedule advanced as though it had been read.
    const unreachable = new Set(summary.egressBlockedDomains);
    for (const domain of new Set(candidates.map((candidate) => candidate.sourceDomain))) {
      if (unreachable.has(domain)) continue;
      await recordCrawlSuccess(domain);
    }
  } catch (error: any) {
    summary.errors.push(String(error?.message || error));
    logger.log("error", { detail: String(error?.message || error) });
  }

  summary.finishedAt = new Date().toISOString();
  summary.counters = logger.summary();
  logger.log("run_finished", {
    detail: `${summary.created} created, ${summary.updated} updated, ${summary.merged} merged, ${summary.reviewQueued} for review`,
  });

  // ---- Run-scoped persistence, so the next phase can query this run rather than re-read a log.
  try {
    for (const [provider, metric] of Object.entries(summary.searchProviderMetrics)) {
      const accounting = summary.search;
      const isBrave = provider === "brave";
      const isSerper = provider === "serper";
      await dbRun(
        `INSERT INTO discovery_run_providers (
           id, run_id, provider, configured, queries_planned, queries_issued, queries_zero_results,
           queries_failed, raw_results, candidates, strong_candidates, unique_urls, shared_urls,
           accepted_events, decision, errors
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, provider) DO UPDATE SET
           queries_issued = excluded.queries_issued,
           queries_zero_results = excluded.queries_zero_results,
           queries_failed = excluded.queries_failed,
           raw_results = excluded.raw_results,
           candidates = excluded.candidates,
           strong_candidates = excluded.strong_candidates,
           unique_urls = excluded.unique_urls,
           shared_urls = excluded.shared_urls,
           accepted_events = excluded.accepted_events,
           decision = excluded.decision,
           errors = excluded.errors`,
        [
          newId("dprv"),
          runId,
          provider,
          accounting ? (isBrave ? (accounting.braveConfigured ? 1 : 0) : isSerper ? (accounting.serperConfigured ? 1 : 0) : 1) : 0,
          accounting?.queriesPlanned ?? 0,
          metric.queriesIssued,
          accounting ? (isBrave ? accounting.braveZeroResultQueries : isSerper ? accounting.serperZeroResultQueries : 0) : 0,
          accounting ? (isBrave ? accounting.braveFailedQueries : isSerper ? accounting.serperFailedQueries : 0) : 0,
          metric.rawResults,
          accounting ? (isBrave ? accounting.braveCandidates : isSerper ? accounting.serperCandidates : 0) : 0,
          accounting ? (isBrave ? accounting.braveStrongCandidates : isSerper ? accounting.serperStrongCandidates : 0) : 0,
          metric.uniqueUrls,
          metric.sharedUrls,
          summary.qualityByProvider[provider]?.accepted ?? 0,
          isSerper ? accounting?.serperDecision ?? null : null,
          JSON.stringify(
            accounting ? (isBrave ? accounting.braveErrors : isSerper ? accounting.serperErrors : []) : []
          ),
        ]
      );
    }

    // Serper deserves a row even when it never ran: "no row" and "zero queries" are different
    // facts, and Phase 1.2's benchmark could not tell them apart.
    if (summary.search && !summary.searchProviderMetrics.serper) {
      await dbRun(
        `INSERT INTO discovery_run_providers (id, run_id, provider, configured, queries_planned, decision, errors)
         VALUES (?, ?, 'serper', ?, ?, ?, ?)
         ON CONFLICT(run_id, provider) DO UPDATE SET decision = excluded.decision`,
        [
          newId("dprv"),
          runId,
          summary.search.serperConfigured ? 1 : 0,
          summary.search.queriesPlanned,
          summary.search.serperDecision,
          JSON.stringify(summary.search.serperErrors),
        ]
      );
    }

    const failureTally = new Map<string, { domain: string; failureClass: string; count: number; status: number | null; detail: string | null }>();
    for (const row of failureRows) {
      const key = `${row.domain}|${row.failureClass}`;
      const existing = failureTally.get(key);
      if (existing) {
        existing.count += 1;
        existing.status = row.status ?? existing.status;
        existing.detail = row.detail ?? existing.detail;
      } else {
        failureTally.set(key, { domain: row.domain, failureClass: row.failureClass, count: 1, status: row.status, detail: row.detail });
      }
    }
    for (const row of failureTally.values()) {
      await dbRun(
        `INSERT INTO discovery_run_failures (id, run_id, domain, failure_class, count, last_status, last_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, domain, failure_class) DO UPDATE SET
           count = excluded.count, last_status = excluded.last_status, last_detail = excluded.last_detail`,
        [newId("dfail"), runId, row.domain, row.failureClass, row.count, row.status, (row.detail || "").slice(0, 300)]
      );
    }
  } catch (error: any) {
    // Losing the metrics must not lose the run.
    summary.errors.push(`run metrics persistence: ${String(error?.message || error).slice(0, 200)}`);
  }

  await dbRun(
    `UPDATE discovery_runs SET finished_at = datetime('now'), status = ?, counters = ?, log = ?, error = ? WHERE id = ?`,
    [
      summary.errors.length > 0 ? "completed_with_errors" : "completed",
      JSON.stringify({
        candidatesDiscovered: summary.candidatesDiscovered,
        pagesAttempted: summary.pagesAttempted,
        pagesFetched: summary.pagesFetched,
        pagesUnchanged: summary.pagesUnchanged,
        pagesFailed: summary.pagesFailed,
        terminalOutcomes: summary.terminalOutcomes,
        eventsDetected: summary.eventsDetected,
        eventsRejected: summary.eventsRejected,
        created: summary.created,
        updated: summary.updated,
        merged: summary.merged,
        reviewQueued: summary.reviewQueued,
        aiCalls: summary.aiCalls,
        extractionMethods: summary.extractionMethods,
        rejectionReasons: summary.rejectionReasons,
        failureClasses: summary.failureClasses,
        failuresByDomain: summary.failuresByDomain,
        circuitBrokenDomains: summary.circuitBrokenDomains,
        alternateUrls: summary.alternateUrls,
        directoryResolution: summary.directoryResolution,
        recoveryMethods: summary.recoveryMethods,
        diversity: summary.diversity,
        skippedForDomainRefusal: summary.skippedForDomainRefusal,
        alreadyReadThisRun: summary.alreadyReadThisRun,
        scheduledUrlsSkipped: summary.scheduledUrlsSkipped,
        concurrency: summary.concurrency,
        stopReason: summary.stopReason,
        qualityByProvider: Object.fromEntries(Object.entries(summary.qualityByProvider).map(([provider, q]) => [provider, {
          ...q,
          candidatePrecision: q.fetched ? Number((q.conferencePositive / q.fetched).toFixed(4)) : 0,
          validatedYield: q.fetched ? Number(((q.accepted - q.needsReview) / q.fetched).toFixed(4)) : 0,
        }])),
        searchProviderMetrics: summary.searchProviderMetrics,
        providerMetrics: providerDecisionMetrics(summary),
        ...summary.counters,
      }),
      JSON.stringify(logger.entries.slice(0, 800)),
      summary.errors.length > 0 ? summary.errors.slice(0, 20).join(" | ").slice(0, 2000) : null,
      runId,
    ]
  );

  return summary;
}

interface ProcessPageInput {
  html: string;
  pageUrl: string;
  candidate: DiscoveryCandidate;
  contentHash: string;
  trust: { trust: number; type: SourceType };
  targetYears: number[];
  logger: RunLogger;
  summary: RunSummary;
  options: RunOptions;
  maxAiCalls: number;
  robotsPolicy?: RobotsPolicy;
  /** Which route produced the text, for the record's retrieval provenance. */
  recoveryMethod?: string;
  /** Set when this page is a directory listing whose own site has already been resolved. */
  resolvedFromDirectory?: boolean;
  usedJina?: boolean;
}

/** One page: extract, normalize, classify, validate, store. Exported shape kept internal. */
async function processPage(
  input: ProcessPageInput
): Promise<{
  isEvent: boolean | null;
  eventId: string | null;
  /** The event as normalized, so a caller can look for its official site. Null when the page was
   *  not a conference. */
  event: NormalizedEvent | null;
  /** How this page's source was classified, so a directory lead can be recognised as one. */
  classification: string | null;
}> {
  const { html, pageUrl, candidate, logger, summary, options } = input;

  // --- Extraction, cheapest and most authoritative first.
  const structured = extractStructuredEvents(html, pageUrl);
  const structuredEvent = structured.events[0] ?? null;
  if (structuredEvent) logger.log("extraction_structured", { url: pageUrl, confidence: structuredEvent.confidence });

  let raw: RawEventExtraction = extractFromHtml(html, pageUrl, { seed: structuredEvent });
  // The HTML pass is seeded with the structured values, so the method recorded is the strongest
  // one that actually contributed rather than simply the last one to run.
  if (structuredEvent) raw.method = "structured_data";
  else logger.log("extraction_html", { url: pageUrl, confidence: raw.confidence });

  const text = readablePageText(html, 20000);

  if (needsAiFallback(raw) && options.ai && summary.aiCalls < input.maxAiCalls) {
    summary.aiCalls += 1;
    const parsedDoc = parseHtml(html);
    const aiResult = await extractWithAi(options.ai, text, pageUrl, documentTitle(parsedDoc));
    if (aiResult.extraction) {
      logger.log("extraction_ai", {
        url: pageUrl,
        confidence: aiResult.extraction.confidence,
        detail: aiResult.droppedFields.length > 0 ? `dropped ungrounded: ${aiResult.droppedFields.join(", ")}` : undefined,
      });
      raw = mergeExtractions(raw, aiResult.extraction);
    } else if (aiResult.error) {
      logger.log("error", { url: pageUrl, detail: `ai extraction: ${aiResult.error}` });
    }
  }

  if (!raw.title) {
    logger.log("extraction_empty", { url: pageUrl });
    return { isEvent: false, eventId: null, event: null, classification: null };
  }

  // --- Normalization.
  const dates = normalizeDates(raw);
  const deadlines = normalizeDeadlines(raw, dates.startDate);
  const location = normalizeLocation(raw);
  const format = normalizeFormat(raw.formatText, raw.locationText, raw.title, text.slice(0, 4000));
  const { eventType, originalEventType } = normalizeEventType(raw.eventTypeText, raw.title, raw.schemaType);
  const description = cleanDescription(raw.description);
  const acronym = extractAcronym(raw.title);

  // --- Classification.
  const relevance = classifyRelevance({
    title: raw.title,
    description,
    pageText: text,
    url: pageUrl,
    schemaType: raw.schemaType,
    eventType,
    format,
    hasDate: !!dates.startYear,
    hasLocation: !!(location.city || location.country || location.venue),
    nonProfessionalSchemaTypes: structured.nonProfessionalTypes,
  });

  summary.eventsDetected += 1;
  if (relevance.isRelevantEvent) providerQuality(summary, candidate.provider).conferencePositive += 1;
  logger.log("event_detected", { url: pageUrl, confidence: relevance.confidenceScore, method: raw.method });

  const categories = classifyCategories({
    title: raw.title,
    description,
    topics: raw.topics,
    organizer: raw.organizer,
    pageText: text,
  });

  // --- Official URL: the conference's own page, which is not automatically the page we read.
  // A directory listing's own address is the source, and the organiser's site — when the page
  // names one — is the official URL (section 16).
  const parsedDoc = parseHtml(html);
  const declaredOfficialUrl = normalizeNavigableUrl(raw.officialUrl || canonicalLink(parsedDoc, pageUrl));
  const sourceClass = classifySource({ pageUrl, officialUrl: declaredOfficialUrl, organizerUrl: raw.organizerUrl,
    title: raw.title, organizer: raw.organizer, pageText: text, registryType: input.trust.type });
  const sourceIsOfficial = isEligibleOfficialSource({ pageUrl, title: raw.title, organizerUrl: raw.organizerUrl,
    registryType: input.trust.type, classification: sourceClass.classification, confidence: sourceClass.confidence });

  // A directory sets `<link rel="canonical">` to ITSELF, and its JSON-LD `Event.url` often points
  // at its own listing too — so taking a declared URL at face value quietly promoted directory
  // pages to "official", which is the one thing section 4 forbids. A declared URL is only
  // accepted from a page we already believe is authoritative, or when it points somewhere else
  // entirely (which is the genuine signal: the directory telling us where the event lives).
  const declaredIsSameHost = (() => {
    if (!declaredOfficialUrl) return false;
    try {
      // `host`, not `hostname`: the port is part of a site's identity, and ignoring it makes two
      // genuinely different origins look like one.
      const declared = new URL(declaredOfficialUrl).host.toLowerCase().replace(/^www\./, "");
      const page = new URL(pageUrl).host.toLowerCase().replace(/^www\./, "");
      return declared === page;
    } catch {
      return false;
    }
  })();
  const officialUrl = sourceIsOfficial
    ? declaredOfficialUrl || pageUrl
    : declaredOfficialUrl && !declaredIsSameHost
      ? declaredOfficialUrl
      : null;

  const provenance = buildProvenance(raw, {
    sourceUrl: pageUrl,
    sourceDomain: candidate.sourceDomain,
    confidence: raw.confidence,
    values: {
      title: raw.title,
      startDate: dates.startDate,
      endDate: dates.endDate,
      datesText: dates.rawText || raw.datesText,
      city: location.city,
      country: location.country,
      venue: location.venue,
      format,
      organizer: raw.organizer,
      officialUrl,
      registrationUrl: raw.registrationUrl,
      abstractDeadline: deadlines.abstractDeadline,
      description,
    },
  });
  if (location.countryInference && location.country) {
    provenance.country = {
      value: location.country,
      sourceUrl: pageUrl,
      sourceDomain: candidate.sourceDomain,
      method: "derived",
      confidence: location.countryInference.confidence,
      lastVerified: new Date().toISOString(),
    };
    provenance.countryInference = {
      value: `${location.countryInference.method}:${location.countryInference.city}`,
      sourceUrl: pageUrl,
      sourceDomain: candidate.sourceDomain,
      method: "derived",
      confidence: location.countryInference.confidence,
      lastVerified: new Date().toISOString(),
    };
  }

  const event: NormalizedEvent = {
    title: raw.title,
    acronym,
    description,
    startDate: dates.startDate,
    endDate: dates.endDate,
    startYear: dates.startYear,
    startMonth: dates.startMonth,
    datePrecision: dates.precision,
    datesText: dates.rawText || raw.datesText,
    deadlines,
    venue: location.venue,
    venueAddress: raw.venueAddress,
    city: location.city,
    region: location.region,
    country: location.country,
    countryCode: location.countryCode,
    worldRegion: location.worldRegion,
    rawLocation: location.rawLocation,
    latitude: raw.latitude,
    longitude: raw.longitude,
    format,
    eventType,
    originalEventType,
    organizer: raw.organizer,
    organizerUrl: raw.organizerUrl,
    officialUrl,
    registrationUrl: raw.registrationUrl,
    submissionUrl: raw.submissionUrl,
    imageUrl: raw.imageUrl,
    price: raw.price,
    currency: raw.currency,
    language: raw.language,
    contactName: raw.contactName,
    contactEmail: raw.contactEmail,
    contactPhone: raw.contactPhone,
    topics: raw.topics,
    categories,
    series: {
      name: null,
      acronym,
      edition: extractEdition(raw.title, description),
      year: dates.startYear,
    },
    sourceUrl: pageUrl,
    sourceDomain: candidate.sourceDomain,
    extractionMethod: raw.method,
    // The record's own confidence is the extraction and the classification together: a page read
    // perfectly that is only probably a conference is not a confident conference record.
    confidenceScore: Number((raw.confidence * 0.6 + relevance.confidenceScore * 0.4).toFixed(3)),
    relevance,
    provenance,
    qualityFlags: [],
    contentHash: input.contentHash,
  };

  // --- Validation.
  const validation = validateEvent(event, {
    targetYears: input.targetYears,
    sourceTrust: input.trust.trust,
    allowAutoPublish: options.allowAutoPublish,
  });
  event.qualityFlags = validation.qualityFlags;

  if (!validation.valid) {
    summary.eventsRejected += 1;
    providerQuality(summary, candidate.provider).rejected += 1;
    if (validation.errors.includes("event_already_finished")) providerQuality(summary, candidate.provider).finished += 1;
    for (const reason of validation.errors) {
      summary.rejectionReasons[reason] = (summary.rejectionReasons[reason] || 0) + 1;
    }
    logger.log("event_rejected", { url: pageUrl, detail: validation.errors.join(", ") });
    return { isEvent: false, eventId: null, event, classification: sourceClass.classification };
  }

  // --- Deduplication and storage.
  const stored = await storeEvent(event, {
    status: validation.status,
    sourceTrust: input.trust.trust,
    sourceType: input.trust.type,
    provider: candidate.provider,
    isOfficial: sourceIsOfficial && officialUrl === pageUrl,
    sourceClassification: sourceClass.classification,
    classificationConfidence: sourceClass.confidence,
    classificationEvidence: sourceClass.evidence,
    recoveryMethod: input.recoveryMethod ?? "direct",
    resolvedFromDirectory: input.resolvedFromDirectory ?? false,
  });

  await dbRun(
    `INSERT INTO discovery_run_events (run_id, event_id, outcome, validation_status, provider, source_url, source_classification)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, event_id, source_url) DO UPDATE SET outcome=excluded.outcome, validation_status=excluded.validation_status`,
    [summary.runId, stored.eventId, stored.outcome, validation.status, candidate.provider, pageUrl, sourceClass.classification]
  );

  if (validation.status === "needs_review" && stored.outcome !== "review_queued") {
    await queueForReview({
      eventId: stored.eventId,
      reason: "quality_review",
      payload: { qualityFlags: validation.qualityFlags, sourceUrl: pageUrl },
    });
    summary.reviewQueued += 1;
  }

  countOutcome(summary, stored.outcome);
  providerQuality(summary, candidate.provider).accepted += 1;
  if (validation.status === "needs_review") providerQuality(summary, candidate.provider).needsReview += 1;
  else providerQuality(summary, candidate.provider).fullyValidated += 1;
  if (stored.duplicate) providerQuality(summary, candidate.provider).duplicates += 1;
  summary.extractionMethods[raw.method] = (summary.extractionMethods[raw.method] || 0) + 1;
  summary.events.push(event);

  logger.log(
    stored.outcome === "created" ? "event_created" : stored.outcome === "review_queued" ? "review_queued" : "event_updated",
    {
      url: pageUrl,
      detail: stored.duplicate ? `duplicate score ${stored.duplicate.score}: ${stored.duplicate.reason}` : undefined,
      confidence: event.confidenceScore,
      method: raw.method,
    }
  );
  if (stored.duplicate && stored.duplicate.decision !== "separate") {
    logger.log("duplicate_detected", { url: pageUrl, detail: stored.duplicate.reason, confidence: stored.duplicate.score });
  }

  return { isEvent: true, eventId: stored.eventId, event, classification: sourceClass.classification };
}

function countOutcome(summary: RunSummary, outcome: StoreOutcome): void {
  if (outcome === "created") summary.created += 1;
  else if (outcome === "updated") summary.updated += 1;
  else if (outcome === "merged") summary.merged += 1;
  else if (outcome === "review_queued") summary.reviewQueued += 1;
}

/** Fills only the gaps the earlier, stronger method left empty. A weaker reading never
 *  overwrites a stronger one. */
function mergeExtractions(base: RawEventExtraction, addition: RawEventExtraction): RawEventExtraction {
  const merged: RawEventExtraction = { ...base };
  for (const key of Object.keys(base) as Array<keyof RawEventExtraction>) {
    if (key === "method" || key === "confidence" || key === "filledFields") continue;
    const current = merged[key];
    const incoming = addition[key];
    const currentEmpty = Array.isArray(current) ? current.length === 0 : current === null || current === "";
    const incomingEmpty = Array.isArray(incoming) ? incoming.length === 0 : incoming === null || incoming === "";
    if (currentEmpty && !incomingEmpty) (merged as any)[key] = incoming;
  }
  // The method recorded is the weakest one that actually contributed, so a consumer can tell an
  // AI-assisted record from a purely deterministic one.
  const contributed = Object.keys(base).some((key) => {
    const k = key as keyof RawEventExtraction;
    if (["method", "confidence", "filledFields"].includes(key)) return false;
    const before = base[k];
    const after = merged[k];
    return before !== after;
  });
  merged.method = contributed ? addition.method : base.method;
  merged.confidence = Math.max(base.confidence, contributed ? addition.confidence : 0);
  merged.filledFields = Object.entries(merged)
    .filter(([key, value]) => {
      if (["method", "confidence", "filledFields"].includes(key)) return false;
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== "";
    })
    .map(([key]) => key);
  return merged;
}

function buildProvenance(
  raw: RawEventExtraction,
  input: {
    sourceUrl: string;
    sourceDomain: string;
    confidence: number;
    values: Record<string, unknown>;
  }
): Record<string, FieldProvenance> {
  const now = new Date().toISOString();
  const out: Record<string, FieldProvenance> = {};
  for (const [field, value] of Object.entries(input.values)) {
    if (value === null || value === undefined || value === "") continue;
    out[field] = {
      value: String(value).slice(0, 500),
      sourceUrl: input.sourceUrl,
      sourceDomain: input.sourceDomain,
      method: raw.method,
      confidence: Number(input.confidence.toFixed(3)),
      lastVerified: now,
    };
  }
  return out;
}

export { canonicalizeUrl, emptyRawExtraction };

