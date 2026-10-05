import { dbAll, dbGet } from "./db";
import { buildCoveragePlan, type CoverageCell } from "./discovery/coveragePlanner";

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { return (JSON.parse(value) ?? fallback) as T; } catch { return fallback; }
}

async function tableExists(name: string): Promise<boolean> {
  const row = await dbGet<{ ok: number }>(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    [name]
  );
  return Boolean(row?.ok);
}

function host(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/^www\./, "");
}

function delta(after: Record<string, any>, before: Record<string, any>, key: string): number {
  return n(after?.[key]) - n(before?.[key]);
}

function actionForGap(gap: CoverageCell) {
  if (gap.publishReady > 0) {
    return {
      action: "publish_and_deepen",
      label: "Publish + deepen existing",
      rationale: `${gap.publishReady} publish-ready record${gap.publishReady === 1 ? "" : "s"} can close this gap faster than new discovery.`,
    };
  }
  if (gap.accepted >= Math.max(4, gap.targetRich * 3)) {
    return {
      action: "promote_existing",
      label: "Promote existing inventory",
      rationale: `${gap.accepted} accepted records already exist; spend the cycle on verification, deep sections and visual identity.`,
    };
  }
  if (gap.accepted > 0) {
    return {
      action: "discover_and_promote",
      label: "Discover + promote",
      rationale: `${gap.accepted} accepted records exist, but more first-party inventory is still needed to reach the rich target.`,
    };
  }
  return {
    action: "discover_new",
    label: "Discover new official sources",
    rationale: "No accepted inventory exists in this cell, so targeted first-party discovery has the highest expected value.",
  };
}

function allocateBudget(gaps: CoverageCell[]) {
  const chosen = gaps.slice(0, 10);
  const weights = chosen.map((gap, index) => Math.max(1, n(gap.priority)) * (1 - Math.min(0.45, index * 0.035)));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let assigned = 0;
  return chosen.map((gap, index) => {
    const isLast = index === chosen.length - 1;
    const share = isLast ? Math.max(0, 100 - assigned) : Math.max(1, Math.round((weights[index] / total) * 100));
    assigned += share;
    const strategy = actionForGap(gap);
    return {
      rank: index + 1,
      category: gap.category,
      region: gap.region,
      year: gap.year,
      accepted: gap.accepted,
      publishReady: gap.publishReady,
      richPublished: gap.richPublished,
      targetRich: gap.targetRich,
      gap: gap.gap,
      priority: gap.priority,
      automationSharePct: share,
      ...strategy,
    };
  });
}

export async function buildSourceIntelligence() {
  const learningReady = await tableExists("discovery_source_learning");
  const runHistoryReady = await tableExists("discovery_source_learning_runs");

  let coverage: Awaited<ReturnType<typeof buildCoveragePlan>> | null = null;
  let coverageError: string | null = null;
  try {
    coverage = await buildCoveragePlan({ top: 40, targetRichPerCell: 2, targetRichPerCategory: 25 });
  } catch (error) {
    coverageError = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
  }

  const coverageState = coverage ? {
    available: true,
    generatedAt: coverage.generatedAt,
    years: coverage.years,
    categories: coverage.categories,
    regions: coverage.regions,
    cells: coverage.cells,
    coveredCells: coverage.coveredCells,
    coveragePct: pct(coverage.coveredCells, coverage.cells),
    accepted: coverage.accepted,
    publishReady: coverage.publishReady,
    richPublished: coverage.richPublished,
    topGaps: coverage.topGaps.slice(0, 20),
    categoryShortfalls: coverage.categoryTotals.slice(0, 15),
    regionTotals: coverage.regionTotals,
    nextAutomationBudget: allocateBudget(coverage.topGaps),
  } : {
    available: false,
    error: coverageError,
    generatedAt: null,
    years: [],
    categories: 0,
    regions: 0,
    cells: 0,
    coveredCells: 0,
    coveragePct: null,
    accepted: 0,
    publishReady: 0,
    richPublished: 0,
    topGaps: [],
    categoryShortfalls: [],
    regionTotals: [],
    nextAutomationBudget: [],
  };

  if (!learningReady) {
    return {
      available: false,
      phase: 33,
      learningStatus: "awaiting_first_phase32_run",
      message: "Phase 32 source-learning tables will appear after the first authoritative source-learning cycle.",
      summary: {
        learnedSources: 0,
        trusted: 0,
        productive: 0,
        learning: 0,
        cooldown: 0,
        sourcesWithRichYield: 0,
      },
      topSources: [],
      weakSources: [],
      cooldownSources: [],
      explorationCandidates: [],
      recentRuns: [],
      latestRun: null,
      coverage: coverageState,
    };
  }

  const [sourceRows, healthRows, runRows] = await Promise.all([
    dbAll<any>(
      `SELECT domain,observations,accepted_count,ready_count,published_count,rich_count,ewma_score,
              consecutive_no_gain,state,last_selected_at,last_gain_at,last_observed_at,details_json
         FROM discovery_source_learning`
    ),
    tableExists("discovery_source_domains")
      ? dbAll<any>(
          `SELECT domain,failure_count,robots_allowed,last_successful_crawl,last_failure_reason,enabled
             FROM discovery_source_domains`
        )
      : Promise.resolve([]),
    runHistoryReady
      ? dbAll<any>(
          `SELECT id,started_at,finished_at,selected_domains,gap_targets,before_json,after_json,
                  gained_domains,no_gain_domains,status
             FROM discovery_source_learning_runs
            ORDER BY started_at DESC
            LIMIT 12`
        )
      : Promise.resolve([]),
  ]);

  const health = new Map(healthRows.map((row) => [host(row.domain), row]));
  const sources = sourceRows.map((row) => {
    const details = safeJson<any>(row.details_json, {});
    const current = details?.current || {};
    const accepted = n(row.accepted_count);
    const ready = n(row.ready_count);
    const published = n(row.published_count);
    const rich = n(row.rich_count);
    const h = health.get(host(row.domain)) || {};
    return {
      domain: host(row.domain),
      state: String(row.state || "learning"),
      observations: n(row.observations),
      score: Math.round(n(row.ewma_score) * 100) / 100,
      accepted,
      publishReady: ready,
      published,
      rich,
      richYieldPct: pct(rich, accepted),
      publishYieldPct: pct(published, accepted),
      readyYieldPct: pct(ready, accepted),
      consecutiveNoGain: n(row.consecutive_no_gain),
      lastSelectedAt: row.last_selected_at || null,
      lastGainAt: row.last_gain_at || null,
      lastObservedAt: row.last_observed_at || null,
      categories: Array.isArray(details?.categories) ? details.categories.slice(0, 12) : [],
      instantScore: details?.instantScore == null ? null : n(details.instantScore),
      lastRun: details?.lastRun || null,
      failures: n(h.failure_count),
      robotsAllowed: h.robots_allowed == null ? null : n(h.robots_allowed) === 1,
      enabled: h.enabled == null ? null : n(h.enabled) === 1,
      lastSuccessfulCrawl: h.last_successful_crawl || null,
      lastFailureReason: h.last_failure_reason || null,
      current,
    };
  });

  const topSources = [...sources]
    .filter((row) => row.accepted > 0)
    .sort((a, b) => b.score - a.score || b.rich - a.rich || b.published - a.published || a.domain.localeCompare(b.domain))
    .slice(0, 15);

  const weakSources = [...sources]
    .filter((row) => row.observations > 0 && (row.consecutiveNoGain > 0 || row.state === "cooldown" || row.failures >= 3))
    .sort((a, b) => {
      if (a.state === "cooldown" && b.state !== "cooldown") return -1;
      if (b.state === "cooldown" && a.state !== "cooldown") return 1;
      return b.consecutiveNoGain - a.consecutiveNoGain || b.failures - a.failures || a.score - b.score;
    })
    .slice(0, 15);

  const cooldownSources = sources
    .filter((row) => row.state === "cooldown" || row.consecutiveNoGain >= 3)
    .sort((a, b) => b.consecutiveNoGain - a.consecutiveNoGain || a.score - b.score);

  const explorationCandidates = sources
    .filter((row) => row.state === "learning" && row.observations <= 1 && row.failures < 8 && row.robotsAllowed !== false)
    .sort((a, b) => b.accepted - a.accepted || b.score - a.score || a.domain.localeCompare(b.domain))
    .slice(0, 15);

  const recentRuns = runRows.map((row) => {
    const before = safeJson<Record<string, any>>(row.before_json, {});
    const after = safeJson<Record<string, any>>(row.after_json, {});
    const selected = safeJson<any[]>(row.selected_domains, []);
    const gains = safeJson<any[]>(row.gained_domains, []);
    const noGain = safeJson<any[]>(row.no_gain_domains, []);
    const gaps = safeJson<any[]>(row.gap_targets, []);
    return {
      id: String(row.id),
      startedAt: row.started_at,
      finishedAt: row.finished_at || null,
      status: String(row.status || "unknown"),
      selectedCount: selected.length,
      selectedDomains: selected.slice(0, 15),
      gainedCount: gains.length,
      gainedDomains: gains.slice(0, 15),
      noGainCount: noGain.length,
      noGainDomains: noGain.slice(0, 15),
      targetGapCount: gaps.length,
      before,
      after,
      delta: {
        accepted: delta(after, before, "accepted"),
        publishReady: delta(after, before, "publishReady"),
        richPublished: delta(after, before, "richPublished"),
        coveredCells: delta(after, before, "coveredCells"),
      },
    };
  });

  const stateCounts = sources.reduce((acc, row) => {
    const key = row.state in acc ? row.state : "learning";
    acc[key] += 1;
    return acc;
  }, { trusted: 0, productive: 0, learning: 0, cooldown: 0 } as Record<string, number>);

  return {
    available: true,
    phase: 33,
    learningStatus: recentRuns.length ? "active" : "initialized_waiting_for_run_history",
    message: recentRuns.length
      ? "Source learning is active and the dashboard is ranking official domains from durable production evidence."
      : "Learning rows exist; run history will populate after the next authoritative Phase 32 cycle.",
    summary: {
      learnedSources: sources.length,
      trusted: stateCounts.trusted || 0,
      productive: stateCounts.productive || 0,
      learning: stateCounts.learning || 0,
      cooldown: stateCounts.cooldown || 0,
      sourcesWithRichYield: sources.filter((row) => row.rich > 0).length,
      sourcesWithNoGainStreak: sources.filter((row) => row.consecutiveNoGain > 0).length,
    },
    topSources,
    weakSources,
    cooldownSources,
    explorationCandidates,
    recentRuns,
    latestRun: recentRuns[0] || null,
    coverage: coverageState,
  };
}
