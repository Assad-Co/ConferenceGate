// Phase 30 — automated coverage-gap closure and quality promotion.
//
// Phase 29 answers "where is the catalogue thin?". This module turns that answer into bounded
// work: first improve accepted conferences already sitting in those cells, then discover only in
// the same deficient cells, verify/enrich the resulting records, optionally move eligible records
// through the existing publication audit gate, and finally measure whether the gap actually moved.
//
// Publication remains fail-closed. Nothing in this file bypasses publish_ready, the official-source
// requirements, review-queue exclusions, or the 10-record controlled publication audit.

import { dbAll } from "../db";
import { auditPublishReady, latestPassingPublicationAudit } from "./controlledPublish";
import { buildCoveragePlan, coverageTargets, type CoveragePlan } from "./coveragePlanner";
import { COUNTRIES } from "./countries";
import { reclassifyAllPublishReadiness, runEnrichment, type EnrichmentReport } from "./enrichment";
import { runDiscovery } from "./pipeline";
import { isPublishEnabled, publishDiscoveredConferences, type PublishResult } from "./publish";
import type { CoverageSearchTarget } from "./providers/searchProvider";

const countryRegion = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country.region]));
const DEEP_KEYS = ["program", "speakers", "committee", "sponsors", "community"] as const;

export interface CoverageClosureOptions {
  years?: number[];
  targetRichPerCell?: number;
  targetRichPerCategory?: number;
  gapCells?: number;
  maxCycles?: number;
  promotionLimit?: number;
  maxSearchQueries?: number;
  maxPages?: number;
  maxCandidates?: number;
  maxJinaPages?: number;
  maxAlternateUrls?: number;
  enrichmentLimit?: number;
  enrichmentSearchQueries?: number;
  enrichmentJinaPages?: number;
  maxDeepPages?: number;
  discoveryTimeBudgetMs?: number;
  enrichmentTimeBudgetMs?: number;
  runTimeBudgetMs?: number;
  /** Explicit opt-in. Real writes still require DISCOVERY_PUBLISH_TO_CONFERENCES=1 and a passing audit. */
  publishEligible?: boolean;
  publishLimit?: number;
  quiet?: boolean;
}

export interface CoverageSnapshot {
  coveredCells: number;
  cells: number;
  accepted: number;
  publishReady: number;
  richPublished: number;
  remainingGapUnits: number;
}

export interface CoverageProgress {
  coveredCellsDelta: number;
  acceptedDelta: number;
  publishReadyDelta: number;
  richPublishedDelta: number;
  gapUnitsClosed: number;
  deepSectionsFilled: number;
  moved: boolean;
}

export interface CoverageClosureCycle {
  cycle: number;
  targets: CoverageSearchTarget[];
  existingCandidates: number;
  discoveryRunId: string | null;
  enrichmentRunIds: string[];
  promotion: {
    examined: number;
    deepSectionsFilled: number;
  };
  discovery: {
    eventsAccepted: number;
    created: number;
    updated: number;
  } | null;
  publication: {
    requested: boolean;
    previewEligible: number;
    auditId: string | null;
    auditPassed: boolean | null;
    result: PublishResult | null;
  };
  before: CoverageSnapshot;
  after: CoverageSnapshot;
  progress: CoverageProgress;
}

export interface CoverageClosureResult {
  status: "already_covered" | "completed" | "stalled" | "budget_exhausted";
  cycles: CoverageClosureCycle[];
  startedAt: string;
  finishedAt: string;
  before: CoverageSnapshot;
  after: CoverageSnapshot;
  publicationRequested: boolean;
}

export function coverageSnapshot(plan: CoveragePlan): CoverageSnapshot {
  return {
    coveredCells: plan.coveredCells,
    cells: plan.cells,
    accepted: plan.accepted,
    publishReady: plan.publishReady,
    richPublished: plan.richPublished,
    remainingGapUnits: plan.topGaps.reduce((sum, cell) => sum + cell.gap, 0),
  };
}

export function coverageProgress(
  before: CoverageSnapshot,
  after: CoverageSnapshot,
  deepSectionsFilled = 0
): CoverageProgress {
  const progress = {
    coveredCellsDelta: after.coveredCells - before.coveredCells,
    acceptedDelta: after.accepted - before.accepted,
    publishReadyDelta: after.publishReady - before.publishReady,
    richPublishedDelta: after.richPublished - before.richPublished,
    gapUnitsClosed: before.remainingGapUnits - after.remainingGapUnits,
    deepSectionsFilled: Math.max(0, deepSectionsFilled),
    moved: false,
  };
  progress.moved = progress.coveredCellsDelta > 0 || progress.acceptedDelta > 0 ||
    progress.publishReadyDelta > 0 || progress.richPublishedDelta > 0 ||
    progress.gapUnitsClosed > 0 || progress.deepSectionsFilled > 0;
  return progress;
}

function deepFilled(report: EnrichmentReport | null): number {
  if (!report) return 0;
  return DEEP_KEYS.reduce((sum, key) => {
    const section = report.deepSections[key];
    return sum + Math.max(0, Number(section?.after || 0) - Number(section?.before || 0));
  }, 0);
}

function regionOf(row: Record<string, any>): string | null {
  const stored = String(row.region || "").trim();
  if (stored) return stored;
  return countryRegion.get(String(row.country || "").trim().toLowerCase()) || null;
}

function yearOf(row: Record<string, any>): number | null {
  const direct = Number(row.start_year);
  if (Number.isInteger(direct) && direct > 2000) return direct;
  const parsed = Number(String(row.start_date || "").slice(0, 4));
  return Number.isInteger(parsed) && parsed > 2000 ? parsed : null;
}

function missingDeepCount(row: Record<string, any>): number {
  const empty = (value: unknown) => value == null || String(value).trim() === "" || ["[]", "{}"].includes(String(value).trim());
  return [row.program_agenda, row.keynote_speakers, row.technical_committee, row.sponsors_exhibitors, row.community]
    .filter(empty).length;
}

/**
 * Accepted conferences in the selected gap cells deserve attention before finding more records.
 * This keeps a cell with two nearly-complete conferences from triggering endless discovery simply
 * because those two records are missing one programme or speaker page.
 */
export async function existingGapCandidateIds(
  targets: CoverageSearchTarget[],
  limit = 250
): Promise<string[]> {
  if (!targets.length) return [];
  const targetSet = new Set(targets.map((target) => `${target.subject}|${target.region}|${target.year}`));
  const targetCategories = [...new Set(targets.map((target) => target.subject))];
  const targetYears = [...new Set(targets.map((target) => target.year))];
  const categoryPlaceholders = targetCategories.map(() => "?").join(",");
  const yearPlaceholders = targetYears.map(() => "?").join(",");
  const rows = await dbAll<Record<string, any>>(`
    SELECT DISTINCT e.id,e.country,e.region,e.start_year,e.start_date,e.publish_readiness,e.official_url,
           e.last_checked,e.confidence_score,e.program_agenda,e.keynote_speakers,e.technical_committee,
           e.sponsors_exhibitors,e.community,c.category
      FROM discovery_events e
      JOIN discovery_event_categories c ON c.event_id=e.id
     WHERE e.status IN ('validated','published','needs_review')
       AND e.official_url IS NOT NULL AND trim(e.official_url)<>''
       AND c.category IN (${categoryPlaceholders || "NULL"})
       AND (e.start_year IN (${yearPlaceholders || "NULL"})
            OR CAST(substr(coalesce(e.start_date,''),1,4) AS INTEGER) IN (${yearPlaceholders || "NULL"}))
  `, [...targetCategories, ...targetYears, ...targetYears]);

  const eligible = rows.filter((row) => {
    const region = regionOf(row);
    const year = yearOf(row);
    return !!region && !!year && targetSet.has(`${row.category}|${region}|${year}`);
  });

  eligible.sort((a, b) => {
    const readinessRank = (value: string) => value === "publish_ready" ? 0 : value === "needs_enrichment" ? 1 : 2;
    const rank = readinessRank(String(a.publish_readiness)) - readinessRank(String(b.publish_readiness));
    if (rank) return rank;
    const deep = missingDeepCount(b) - missingDeepCount(a);
    if (deep) return deep;
    const checkedA = a.last_checked ? Date.parse(String(a.last_checked)) : 0;
    const checkedB = b.last_checked ? Date.parse(String(b.last_checked)) : 0;
    if (checkedA !== checkedB) return checkedA - checkedB;
    return Number(b.confidence_score || 0) - Number(a.confidence_score || 0);
  });

  return [...new Set(eligible.map((row) => String(row.id)))].slice(0, Math.max(1, Math.min(limit, 2000)));
}

async function runEventIds(runId: string): Promise<string[]> {
  const rows = await dbAll<{ event_id: string }>(
    "SELECT event_id FROM discovery_run_events WHERE run_id=?", [runId]);
  return rows.map((row) => String(row.event_id));
}

async function maybePublish(
  eventIds: string[],
  requested: boolean,
  limit: number
): Promise<CoverageClosureCycle["publication"]> {
  const publication: CoverageClosureCycle["publication"] = {
    requested, previewEligible: 0, auditId: null, auditPassed: null, result: null,
  };
  if (!eventIds.length) return publication;

  const preview = await publishDiscoveredConferences({ eventIds, limit, dryRun: true });
  publication.previewEligible = preview.written;
  if (!requested || preview.written === 0) return publication;

  if (!isPublishEnabled()) {
    throw new Error("Coverage closure publication was requested, but DISCOVERY_PUBLISH_TO_CONFERENCES is not 1.");
  }

  const reusable = await latestPassingPublicationAudit();
  if (reusable) {
    publication.auditId = reusable.id;
    publication.auditPassed = true;
  } else {
    const audit = await auditPublishReady({ sample: 10 });
    publication.auditId = audit.id;
    publication.auditPassed = audit.passed;
    if (!audit.passed) return publication;
  }

  publication.result = await publishDiscoveredConferences({
    eventIds,
    limit,
    requirePassingAudit: true,
  });
  return publication;
}

export async function runCoverageClosure(options: CoverageClosureOptions = {}): Promise<CoverageClosureResult> {
  const startedAt = new Date().toISOString();
  const maxCycles = Math.max(1, Math.min(options.maxCycles ?? 3, 10));
  const gapCells = Math.max(1, Math.min(options.gapCells ?? 12, 100));
  const promotionLimit = Math.max(1, Math.min(options.promotionLimit ?? 250, 2000));
  const publishLimit = Math.max(1, Math.min(options.publishLimit ?? 250, 1000));
  const deadline = Date.now() + Math.max(60_000, options.runTimeBudgetMs ?? 50 * 60_000);
  const planOptions = {
    years: options.years,
    targetRichPerCell: options.targetRichPerCell ?? 2,
    targetRichPerCategory: options.targetRichPerCategory ?? 25,
    // 500 is the planner's ceiling and is intentionally used here so remainingGapUnits is a
    // catalogue-level measure, not just the visible top-20 slice.
    top: 500,
  };

  let plan = await buildCoveragePlan(planOptions);
  const initial = coverageSnapshot(plan);
  if (!coverageTargets(plan, gapCells).length) {
    return {
      status: "already_covered", cycles: [], startedAt, finishedAt: new Date().toISOString(),
      before: initial, after: initial, publicationRequested: !!options.publishEligible,
    };
  }

  const cycles: CoverageClosureCycle[] = [];
  let stalledCycles = 0;
  let status: CoverageClosureResult["status"] = "completed";

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    if (Date.now() >= deadline) { status = "budget_exhausted"; break; }
    const targets = coverageTargets(plan, gapCells);
    if (!targets.length) break;
    const before = coverageSnapshot(plan);
    const enrichmentRunIds: string[] = [];
    let deepSectionsFilled = 0;

    // 1) Promote records already occupying the deficient cells. This is deliberately first.
    const existingIds = await existingGapCandidateIds(targets, promotionLimit);
    let promotion: EnrichmentReport | null = null;
    if (existingIds.length && Date.now() < deadline) {
      promotion = await runEnrichment({
        eventIds: existingIds,
        limit: existingIds.length,
        maxSearchQueries: options.enrichmentSearchQueries ?? 24,
        maxJinaPages: options.enrichmentJinaPages ?? 80,
        maxDeepPagesPerEvent: options.maxDeepPages ?? 6,
        requireOfficialUrl: true,
        timeBudgetMs: Math.max(1_000, Math.min(options.enrichmentTimeBudgetMs ?? 15 * 60_000, deadline - Date.now())),
        quiet: options.quiet,
      });
      enrichmentRunIds.push(promotion.runId);
      deepSectionsFilled += deepFilled(promotion);
    }

    // 2) Discover only in the same category × region × year gaps.
    let discoverySummary: CoverageClosureCycle["discovery"] = null;
    let discoveryRunId: string | null = null;
    let discoveredIds: string[] = [];
    if (Date.now() < deadline) {
      const discovery = await runDiscovery({
        targetYears: plan.years,
        searchTargets: targets,
        searchOnly: true,
        enableSearchDiscovery: true,
        maxSearchQueries: options.maxSearchQueries ?? Math.max(24, targets.length * 3),
        maxPages: options.maxPages ?? 180,
        maxCandidates: options.maxCandidates ?? 1500,
        maxJinaPages: options.maxJinaPages ?? 50,
        maxAlternateUrls: options.maxAlternateUrls ?? 80,
        domainConcurrency: 4,
        maxCandidatesPerDomain: 12,
        acceptedTarget: 0,
        maxAiCalls: 0,
        timeBudgetMs: Math.max(1_000, Math.min(options.discoveryTimeBudgetMs ?? 12 * 60_000, deadline - Date.now())),
        allowAutoPublish: false,
        quiet: options.quiet,
        trigger: "coverage_gap_closure",
      });
      discoveryRunId = discovery.runId;
      const eventsAccepted = discovery.events.length;
      discoverySummary = {
        eventsAccepted,
        created: Number(discovery.created || 0),
        updated: Number(discovery.updated || 0),
      };
      discoveredIds = await runEventIds(discovery.runId);

      // 3) Verify and enrich only what this targeted discovery just touched.
      if (discoveredIds.length && Date.now() < deadline) {
        const newEnrichment = await runEnrichment({
          runId: discovery.runId,
          limit: Math.min(options.enrichmentLimit ?? 250, Math.max(discoveredIds.length, 1)),
          maxSearchQueries: options.enrichmentSearchQueries ?? 36,
          maxJinaPages: options.enrichmentJinaPages ?? 80,
          maxDeepPagesPerEvent: options.maxDeepPages ?? 6,
          requireOfficialUrl: true,
          timeBudgetMs: Math.max(1_000, Math.min(options.enrichmentTimeBudgetMs ?? 15 * 60_000, deadline - Date.now())),
          quiet: options.quiet,
        });
        enrichmentRunIds.push(newEnrichment.runId);
        deepSectionsFilled += deepFilled(newEnrichment);
      }
    }

    // 4) Recompute readiness from verified evidence before publication is even considered.
    await reclassifyAllPublishReadiness();
    const scopedIds = [...new Set([...existingIds, ...discoveredIds])];
    const publication = await maybePublish(scopedIds, !!options.publishEligible, publishLimit);

    // 5) Measure the catalogue, not activity counts. A busy crawl that closes no gap is a stall.
    const afterPlan = await buildCoveragePlan(planOptions);
    const after = coverageSnapshot(afterPlan);
    const progress = coverageProgress(before, after, deepSectionsFilled);
    cycles.push({
      cycle, targets, existingCandidates: existingIds.length, discoveryRunId, enrichmentRunIds,
      promotion: { examined: promotion?.totalRecordsExamined || 0, deepSectionsFilled: deepFilled(promotion) },
      discovery: discoverySummary, publication, before, after, progress,
    });

    plan = afterPlan;
    if (!coverageTargets(plan, gapCells).length) break;
    stalledCycles = progress.moved ? 0 : stalledCycles + 1;
    // Two no-movement cycles are enough evidence that repeating the same search/enrichment plan is
    // wasting provider budget. Stop and expose the remaining gaps for a source-strategy change.
    if (stalledCycles >= 2) { status = "stalled"; break; }
    if (Date.now() >= deadline) { status = "budget_exhausted"; break; }
  }

  return {
    status,
    cycles,
    startedAt,
    finishedAt: new Date().toISOString(),
    before: initial,
    after: coverageSnapshot(plan),
    publicationRequested: !!options.publishEligible,
  };
}
