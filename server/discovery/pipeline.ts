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
import { classifyCategories } from "./categories";
import { classifyRelevance } from "./classify";
import { extractFromHtml, pageText as readablePageText } from "./htmlExtract";
import { discoveryFetch, hashContent, isHtmlLike, type UrlGuard } from "./httpClient";
import { canonicalLink, documentTitle, parseHtml } from "./html";
import { RunLogger } from "./logging";
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
} from "./normalize";
import { isPathAllowed, type RobotsPolicy } from "./robots";
import { allProviders } from "./providers";
import { SitemapDiscoveryProvider } from "./providers/sitemapProvider";
import { getDomain, newId, recordCrawlSuccess, TRUST_BY_SOURCE_TYPE } from "./sourceRegistry";
import { eventIdForUrl, getUrlState, recordUrlVisit, rememberUrl, storeEvent, type StoreOutcome } from "./store";
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
  /** Subject terms, for query-driven providers only. */
  topics?: string[];
  maxCandidates?: number;
  /** Pages actually fetched and read. The real cost ceiling of a run. */
  maxPages?: number;
  /** Hard wall-clock limit. */
  timeBudgetMs?: number;
  /** Model calls permitted. 0 (the default) means the run is entirely free. */
  maxAiCalls?: number;
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
  pagesFetched: number;
  pagesUnchanged: number;
  pagesFailed: number;
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
  providers: Array<{ name: string; enabled: boolean; reason: string | null; candidates: number }>;
  counters: Record<string, number>;
  /** The accepted events, in memory, so a caller can export a CSV without re-reading the DB. */
  events: NormalizedEvent[];
  errors: string[];
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

  const summary: RunSummary = {
    runId,
    startedAt,
    finishedAt: startedAt,
    targetYears,
    domains: options.domains ?? [],
    candidatesDiscovered: 0,
    pagesFetched: 0,
    pagesUnchanged: 0,
    pagesFailed: 0,
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
    providers: [],
    counters: {},
    events: [],
    errors: [],
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
    const providers = [sitemapProvider, ...allProviders().filter((p) => p.name !== "sitemap")];

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
    summary.skippedDomains = sitemapProvider.skipped;
    summary.candidatesDiscovered = candidates.length;

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
    let pagesRead = 0;
    const domainTrust = new Map<string, { trust: number; type: SourceType }>();

    for (const candidate of candidates) {
      if (options.signal?.aborted) break;
      if (pagesRead >= maxPages) break;
      if (Date.now() > deadline) {
        logger.log("run_finished", { detail: "time budget reached" });
        break;
      }

      const policy = sitemapProvider.policies.get(candidate.sourceDomain);
      if (policy && !isPathAllowed(policy, candidate.url)) {
        logger.log("url_skipped", { url: candidate.url, detail: "disallowed by robots.txt" });
        continue;
      }

      if (!domainTrust.has(candidate.sourceDomain)) {
        const row = await getDomain(candidate.sourceDomain);
        domainTrust.set(candidate.sourceDomain, {
          trust: row?.trust_score ?? TRUST_BY_SOURCE_TYPE.unknown,
          type: (row?.source_type as SourceType) ?? "unknown",
        });
      }
      const trust = domainTrust.get(candidate.sourceDomain)!;

      const previous = await getUrlState(candidate.url);
      const response = await discoveryFetch(candidate.url, {
        etag: previous?.etag ?? null,
        lastModified: previous?.last_modified ?? null,
        urlGuard: options.urlGuard,
      });

      if (response.notModified) {
        summary.pagesUnchanged += 1;
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
        continue;
      }

      if (!response.ok || !response.body) {
        summary.pagesFailed += 1;
        logger.log(response.error === "timeout" ? "page_timeout" : "page_failed", {
          url: candidate.url,
          detail: response.error || `http_${response.status}`,
        });
        await recordUrlVisit({
          url: candidate.url,
          domain: candidate.sourceDomain,
          provider: candidate.provider,
          status: response.status,
          etag: null,
          lastModified: null,
          contentHash: null,
          failureReason: response.error,
          recheckHours: 168,
        });
        continue;
      }

      pagesRead += 1;
      summary.pagesFetched += 1;
      logger.log("page_fetched", { url: candidate.url });

      if (!isHtmlLike(response)) {
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
        continue;
      }

      const contentHash = response.contentHash || hashContent(response.body);
      const unchangedBody = !!previous?.content_hash && previous.content_hash === contentHash;
      if (unchangedBody && previous?.is_event !== null && previous?.is_event !== undefined) {
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
        continue;
      }

      const outcome = await processPage({
        html: response.body,
        pageUrl: response.finalUrl || candidate.url,
        candidate,
        contentHash,
        trust,
        targetYears,
        logger,
        summary,
        options,
        maxAiCalls,
        robotsPolicy: policy,
      });

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
        recheckHours: recheckHoursFor(outcome.isEvent, !unchangedBody),
      });
    }

    for (const domain of new Set(candidates.map((candidate) => candidate.sourceDomain))) {
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

  await dbRun(
    `UPDATE discovery_runs SET finished_at = datetime('now'), status = ?, counters = ?, log = ?, error = ? WHERE id = ?`,
    [
      summary.errors.length > 0 ? "completed_with_errors" : "completed",
      JSON.stringify({
        candidatesDiscovered: summary.candidatesDiscovered,
        pagesFetched: summary.pagesFetched,
        pagesUnchanged: summary.pagesUnchanged,
        pagesFailed: summary.pagesFailed,
        eventsDetected: summary.eventsDetected,
        eventsRejected: summary.eventsRejected,
        created: summary.created,
        updated: summary.updated,
        merged: summary.merged,
        reviewQueued: summary.reviewQueued,
        aiCalls: summary.aiCalls,
        extractionMethods: summary.extractionMethods,
        rejectionReasons: summary.rejectionReasons,
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
}

/** One page: extract, normalize, classify, validate, store. Exported shape kept internal. */
async function processPage(input: ProcessPageInput): Promise<{ isEvent: boolean | null; eventId: string | null }> {
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
    return { isEvent: false, eventId: null };
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
  const officialUrl =
    raw.officialUrl ||
    canonicalLink(parsedDoc, pageUrl) ||
    (input.trust.type === "conference_directory" ? null : pageUrl);

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
    for (const reason of validation.errors) {
      summary.rejectionReasons[reason] = (summary.rejectionReasons[reason] || 0) + 1;
    }
    logger.log("event_rejected", { url: pageUrl, detail: validation.errors.join(", ") });
    return { isEvent: false, eventId: null };
  }

  // --- Deduplication and storage.
  const stored = await storeEvent(event, {
    status: validation.status,
    sourceTrust: input.trust.trust,
    sourceType: input.trust.type,
    provider: candidate.provider,
    isOfficial: input.trust.type !== "conference_directory" && officialUrl === pageUrl,
  });

  countOutcome(summary, stored.outcome);
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

  return { isEvent: true, eventId: stored.eventId };
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
