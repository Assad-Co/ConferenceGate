from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Phase 30 patch target not found: {label}")
    if text.count(old) != 1:
        raise SystemExit(f"Phase 30 patch target not unique: {label} ({text.count(old)})")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "server/discovery/enrichment.ts",
    '''  /** Restrict a batch pass to events attributed to one discovery run. */
  runId?: string;
  /** Prefer a durable readiness backlog instead of repeatedly re-reading already-ready rows. */
''',
    '''  /** Restrict a batch pass to events attributed to one discovery run. */
  runId?: string;
  /** Restrict a pass to an explicit accepted-event set. Useful for coverage-gap promotion where
   * records already exist and therefore do not belong to the new discovery run. */
  eventIds?: string[];
  /** Prefer a durable readiness backlog instead of repeatedly re-reading already-ready rows. */
''',
    "enrichment eventIds option",
)

replace_once(
    "server/discovery/enrichment.ts",
    '''    const runJoin = options.runId
      ? " JOIN discovery_run_events re ON re.event_id=e.id AND re.run_id=?"
      : "";
    const readinessFilter = options.readiness?.length ? options.readiness : null;
''',
    '''    const runJoin = options.runId
      ? " JOIN discovery_run_events re ON re.event_id=e.id AND re.run_id=?"
      : "";
    const eventIds = [...new Set((options.eventIds || []).map(String).filter(Boolean))];
    const eventIdClause = options.eventIds
      ? eventIds.length ? ` AND e.id IN (${eventIds.map(() => "?").join(",")})` : " AND 1=0"
      : "";
    const readinessFilter = options.readiness?.length ? options.readiness : null;
''',
    "enrichment eventIds normalization",
)

replace_once(
    "server/discovery/enrichment.ts",
    '''      ${readinessClause}${deepClause}${officialUrlClause}${hostClause}
      ORDER BY e.last_checked IS NOT NULL, e.last_checked ASC,
               e.last_verified IS NOT NULL, e.last_verified ASC,
               e.confidence_score DESC, e.date_discovered ASC LIMIT ?`,
      // Placeholder order follows the clause order above: the run join, then readiness, then
      // the host scope, then the limit.
      [...(options.runId ? [options.runId] : []), ...(readinessFilter || []), ...hostParams, limit]);
''',
    '''      ${readinessClause}${deepClause}${officialUrlClause}${hostClause}${eventIdClause}
      ORDER BY e.last_checked IS NOT NULL, e.last_checked ASC,
               e.last_verified IS NOT NULL, e.last_verified ASC,
               e.confidence_score DESC, e.date_discovered ASC LIMIT ?`,
      // Placeholder order follows the clause order above: the run join, then readiness, then
      // the host scope, then the explicit event ids, then the limit.
      [...(options.runId ? [options.runId] : []), ...(readinessFilter || []), ...hostParams, ...eventIds, limit]);
''',
    "enrichment eventIds query",
)

replace_once(
    "server/discovery/publish.ts",
    '''  /** Restrict publication to events attributed to one discovery batch. */
  runId?: string;
  /** Tests may disable the production audit gate explicitly; production defaults to required. */
''',
    '''  /** Restrict publication to events attributed to one discovery batch. */
  runId?: string;
  /** Restrict publication to an explicit event set. Intersects with runId when both are present. */
  eventIds?: string[];
  /** Tests may disable the production audit gate explicitly; production defaults to required. */
''',
    "publish eventIds option",
)

replace_once(
    "server/discovery/publish.ts",
    '''  const runJoin = options.runId
    ? " JOIN discovery_run_events re ON re.event_id=e.id AND re.run_id=?"
    : "";

  const rows = await dbAll<Record<string, any>>(
''',
    '''  const runJoin = options.runId
    ? " JOIN discovery_run_events re ON re.event_id=e.id AND re.run_id=?"
    : "";
  const eventIds = [...new Set((options.eventIds || []).map(String).filter(Boolean))];
  const eventIdClause = options.eventIds
    ? eventIds.length ? ` AND e.id IN (${eventIds.map(() => "?").join(",")})` : " AND 1=0"
    : "";

  const rows = await dbAll<Record<string, any>>(
''',
    "publish eventIds normalization",
)

replace_once(
    "server/discovery/publish.ts",
    '''        AND e.confidence_score >= ?
        AND e.title IS NOT NULL AND e.title <> ''
''',
    '''        AND e.confidence_score >= ?${eventIdClause}
        AND e.title IS NOT NULL AND e.title <> ''
''',
    "publish eventIds clause",
)

replace_once(
    "server/discovery/publish.ts",
    '''    [...(options.runId ? [options.runId] : []), ...statuses, minConfidence, options.limit ?? 500]
  );
''',
    '''    [...(options.runId ? [options.runId] : []), ...statuses, minConfidence, ...eventIds, options.limit ?? 500]
  );
''',
    "publish eventIds params",
)

replace_once(
    "server/discovery/cli.ts",
    '''import { buildCoveragePlan, coverageTargets } from "./coveragePlanner";
''',
    '''import { buildCoveragePlan, coverageTargets } from "./coveragePlanner";
import { runCoverageClosure } from "./coverageClosure";
''',
    "cli closure import",
)

replace_once(
    "server/discovery/cli.ts",
    '''  coverage-expand [--years 2026,2027] [--gap-cells 12] [--max-search-queries 36]
                  [--max-pages 180] [--enrichment-limit 250] [--allow-local-db] [--quiet]
                            Spend search and enrichment only on the highest-priority category ×
                            geography gaps from coverage-plan. Search results still pass robots,
                            validation, dedupe and first-party enrichment. Never auto-publishes.
  run      [--domains a,b] [--years 2026,2027,2028] [--max-pages 100] [--max-candidates 1000]
''',
    '''  coverage-expand [--years 2026,2027] [--gap-cells 12] [--max-search-queries 36]
                  [--max-pages 180] [--enrichment-limit 250] [--allow-local-db] [--quiet]
                            Spend search and enrichment only on the highest-priority category ×
                            geography gaps from coverage-plan. Search results still pass robots,
                            validation, dedupe and first-party enrichment. Never auto-publishes.
  coverage-close [--years 2026,2027] [--gap-cells 12] [--max-cycles 3]
                 [--promotion-limit 250] [--max-search-queries 36] [--max-pages 180]
                 [--enrichment-limit 250] [--run-time-budget-ms 3000000]
                 [--publish] [--allow-local-db] [--quiet]
                            Close coverage gaps as a bounded feedback loop: improve accepted records
                            already in thin cells, discover only inside those same category × region
                            × year gaps, verify/enrich, recompute readiness, optionally publish only
                            the scoped eligible records through the existing controlled audit gate,
                            then re-measure coverage. Stops after two no-movement cycles.
  run      [--domains a,b] [--years 2026,2027,2028] [--max-pages 100] [--max-candidates 1000]
''',
    "cli help closure",
)

replace_once(
    "server/discovery/cli.ts",
    '''    case "run": {
''',
    '''    case "coverage-close": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error("TURSO_DATABASE_URL is not set. Coverage closure must use the durable production catalogue. Pass --allow-local-db only for an intentional local smoke test.");
        process.exitCode = 3;
        break;
      }
      const result = await withPipelineLease("coverage_gap_closure", () => runCoverageClosure({
        years: list(flags.years).map(Number).filter(Number.isInteger),
        targetRichPerCell: numberFlag(flags["target-rich-per-cell"], 2),
        targetRichPerCategory: numberFlag(flags["target-rich-per-category"], 25),
        gapCells: numberFlag(flags["gap-cells"], 12),
        maxCycles: numberFlag(flags["max-cycles"], 3),
        promotionLimit: numberFlag(flags["promotion-limit"], 250),
        maxSearchQueries: numberFlag(flags["max-search-queries"], 36),
        maxPages: numberFlag(flags["max-pages"], 180),
        maxCandidates: numberFlag(flags["max-candidates"], 1500),
        maxJinaPages: numberFlag(flags["max-jina-pages"], 50),
        maxAlternateUrls: numberFlag(flags["max-alternate-urls"], 80),
        enrichmentLimit: numberFlag(flags["enrichment-limit"], 250),
        enrichmentSearchQueries: numberFlag(flags["enrichment-search-queries"], 36),
        enrichmentJinaPages: numberFlag(flags["enrichment-jina-pages"], 80),
        maxDeepPages: numberFlag(flags["max-deep-pages"], 6),
        discoveryTimeBudgetMs: numberFlag(flags["discovery-time-budget-ms"], 12 * 60 * 1000),
        enrichmentTimeBudgetMs: numberFlag(flags["enrichment-time-budget-ms"], 15 * 60 * 1000),
        runTimeBudgetMs: numberFlag(flags["run-time-budget-ms"], 50 * 60 * 1000),
        publishEligible: flags.publish === true,
        publishLimit: numberFlag(flags["publish-limit"], 250),
        quiet: flags.quiet === true,
      }));
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "run": {
''',
    "cli closure command",
)

print("Phase 30 integration patch applied")
