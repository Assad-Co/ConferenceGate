from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Phase 29 patch target not found: {label}")
    if text.count(old) != 1:
        raise SystemExit(f"Phase 29 patch target not unique: {label} ({text.count(old)})")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "server/discovery/providers/searchProvider.ts",
    '''export interface PlannedQuery {
''',
    '''export interface CoverageSearchTarget {
  /** Conference Gate category/subject to search for. */
  subject: string;
  /** One of the seven search-provider regions. */
  region: string;
  /** Exact upcoming year this gap belongs to. */
  year: number;
}

export interface PlannedQuery {
''',
    "coverage search target type",
)

replace_once(
    "server/discovery/providers/searchProvider.ts",
    '''  topics?: string[];
  maxQueries: number;
''',
    '''  topics?: string[];
  /** Exact category × region × year cells selected from the stored coverage audit. */
  targets?: CoverageSearchTarget[];
  maxQueries: number;
''',
    "plan target option",
)

replace_once(
    "server/discovery/providers/searchProvider.ts",
    '''  const subjects = context.topics?.length ? context.topics : subjectPhrases();
  const regions = Object.keys(QUERY_COUNTRIES_BY_REGION);
  const years = context.targetYears.length > 0 ? context.targetYears : [new Date().getUTCFullYear() + 1];
''',
    '''  const subjects = context.topics?.length ? context.topics : subjectPhrases();
  const regions = Object.keys(QUERY_COUNTRIES_BY_REGION);
  const targets = (context.targets || []).filter((target) =>
    target.subject?.trim() && QUERY_COUNTRIES_BY_REGION[target.region]?.length && Number.isInteger(target.year)
  );
  const years = context.targetYears.length > 0 ? context.targetYears : [new Date().getUTCFullYear() + 1];
''',
    "plan target normalization",
)

replace_once(
    "server/discovery/providers/searchProvider.ts",
    '''    const region = regions[index % regions.length];
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
''',
    '''    const target = targets.length ? targets[index % targets.length] : null;
    const region = target?.region || regions[index % regions.length];
    const countries = QUERY_COUNTRIES_BY_REGION[region];
    const stride = targets.length || regions.length;
    const country = countries[Math.floor(index / stride) % countries.length];
    const subject = target?.subject || subjects[(index * 3) % subjects.length];
    const eventWord = EVENT_WORDS[(index * 2) % EVENT_WORDS.length];

    const priorityRemaining = priorityBudget - priorityUsed;
    const otherRemaining = context.maxQueries - planned.length - priorityRemaining;
    const year = target?.year && years.includes(target.year)
      ? target.year
      : otherYears.length === 0 || priorityRemaining > 0 && (otherRemaining <= 0 || index % 5 !== 4)
        ? priorityYear
        : otherYears[Math.floor(index / 5) % otherYears.length];
''',
    "targeted matrix loop",
)

replace_once(
    "server/discovery/providers/searchProvider.ts",
    '''  /** Known URLs, so "new candidate" means new to the database and not just new to this run. */
  isKnownUrl?: (url: string) => Promise<boolean>;
''',
    '''  /** Exact coverage cells to search instead of the generic global matrix. */
  targets?: CoverageSearchTarget[];
  /** Known URLs, so "new candidate" means new to the database and not just new to this run. */
  isKnownUrl?: (url: string) => Promise<boolean>;
''',
    "search provider target option",
)

replace_once(
    "server/discovery/providers/searchProvider.ts",
    '''      targetYears: context.targetYears,
      topics: context.topics,
      maxQueries,
''',
    '''      targetYears: context.targetYears,
      topics: context.topics,
      targets: this.options.targets,
      maxQueries,
''',
    "search provider targeted planning",
)

replace_once(
    "server/discovery/pipeline.ts",
    '''import { SearchDiscoveryProvider, type SearchAccounting } from "./providers/searchProvider";
''',
    '''import { SearchDiscoveryProvider, type CoverageSearchTarget, type SearchAccounting } from "./providers/searchProvider";
''',
    "pipeline search target import",
)

replace_once(
    "server/discovery/pipeline.ts",
    '''  topics?: string[];
  /** Total search queries the run may spend across Brave and Serper together. */
''',
    '''  topics?: string[];
  /** Exact category × region × year gaps to search. When present, the search provider spends its
   * quota on these cells instead of building the generic global matrix. */
  searchTargets?: CoverageSearchTarget[];
  /** Run only the search provider. Used by gap expansion so unrelated sitemap work cannot consume
   * the page budget reserved for the deficient category/geography cells. */
  searchOnly?: boolean;
  /** Total search queries the run may spend across Brave and Serper together. */
''',
    "pipeline run target options",
)

replace_once(
    "server/discovery/pipeline.ts",
    '''    const searchProvider = new SearchDiscoveryProvider({
      logger,
      enabled: options.enableSearchDiscovery,
      maxQueries: options.maxSearchQueries ?? 24,
    });
''',
    '''    const searchProvider = new SearchDiscoveryProvider({
      logger,
      enabled: options.enableSearchDiscovery,
      maxQueries: options.maxSearchQueries ?? 24,
      targets: options.searchTargets,
    });
''',
    "pipeline provider targets",
)

replace_once(
    "server/discovery/pipeline.ts",
    '''    const providers = options.organizationsOnly
      ? [organizationProvider]
      : [
        ...(options.enableDirectoryIngest ? [directoryProvider] : []),
        ...(options.enableOrganizationHarvest ? [organizationProvider] : []),
        sitemapProvider,
        searchProvider,
        ...allProviders({ search: { logger } }).filter((p) => p.name !== "sitemap" && p.name !== "search"),
      ];
''',
    '''    const providers = options.organizationsOnly
      ? [organizationProvider]
      : options.searchOnly
        ? [searchProvider]
        : [
          ...(options.enableDirectoryIngest ? [directoryProvider] : []),
          ...(options.enableOrganizationHarvest ? [organizationProvider] : []),
          sitemapProvider,
          searchProvider,
          ...allProviders({ search: { logger } }).filter((p) => p.name !== "sitemap" && p.name !== "search"),
        ];
''',
    "pipeline search-only mode",
)

replace_once(
    "server/discovery/cli.ts",
    '''import { runProductionScale } from "./scale";
''',
    '''import { runProductionScale } from "./scale";
import { buildCoveragePlan, coverageTargets } from "./coveragePlanner";
''',
    "cli planner import",
)

replace_once(
    "server/discovery/cli.ts",
    '''  run      [--domains a,b] [--years 2026,2027,2028] [--max-pages 100] [--max-candidates 1000]
           [--time-budget-ms 300000] [--max-ai-calls 0] [--allow-auto-publish] [--quiet]
''',
    '''  coverage-plan [--years 2026,2027] [--target-rich-per-cell 2] [--target-rich-per-category 25]
                [--top 60] [--allow-local-db]
                            Measure upcoming rich-conference coverage by category × region × year,
                            and rank the cells where Conference Gate is thinnest. Reads stored data
                            only; no providers, no writes, no publication.
  coverage-expand [--years 2026,2027] [--gap-cells 12] [--max-search-queries 36]
                  [--max-pages 180] [--enrichment-limit 250] [--allow-local-db] [--quiet]
                            Spend search and enrichment only on the highest-priority category ×
                            geography gaps from coverage-plan. Search results still pass robots,
                            validation, dedupe and first-party enrichment. Never auto-publishes.
  run      [--domains a,b] [--years 2026,2027,2028] [--max-pages 100] [--max-candidates 1000]
           [--time-budget-ms 300000] [--max-ai-calls 0] [--allow-auto-publish] [--quiet]
''',
    "cli help coverage commands",
)

replace_once(
    "server/discovery/cli.ts",
    '''    case "run": {
''',
    '''    case "coverage-plan": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error("TURSO_DATABASE_URL is not set. Coverage planning must read the durable production catalogue. Pass --allow-local-db only for an intentional local smoke test.");
        process.exitCode = 3;
        break;
      }
      const years = list(flags.years).map(Number).filter(Number.isInteger);
      const plan = await buildCoveragePlan({
        years,
        targetRichPerCell: numberFlag(flags["target-rich-per-cell"], 2),
        targetRichPerCategory: numberFlag(flags["target-rich-per-category"], 25),
        top: numberFlag(flags.top, 60),
      });
      console.log(JSON.stringify(plan, null, 2));
      break;
    }

    case "coverage-expand": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error("TURSO_DATABASE_URL is not set. Coverage expansion must use the durable production catalogue. Pass --allow-local-db only for an intentional local smoke test.");
        process.exitCode = 3;
        break;
      }
      if (process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1") {
        throw new Error("Coverage expansion discovers and enriches only. Set DISCOVERY_PUBLISH_TO_CONFERENCES=0 so publication remains a separate controlled gate.");
      }
      const years = list(flags.years).map(Number).filter(Number.isInteger);
      const before = await buildCoveragePlan({
        years,
        targetRichPerCell: numberFlag(flags["target-rich-per-cell"], 2),
        targetRichPerCategory: numberFlag(flags["target-rich-per-category"], 25),
        top: Math.max(numberFlag(flags["gap-cells"], 12) * 4, 60),
      });
      const targets = coverageTargets(before, numberFlag(flags["gap-cells"], 12));
      if (targets.length === 0) {
        console.log(JSON.stringify({ status: "already_covered", before }, null, 2));
        break;
      }
      const work = await withPipelineLease("coverage_gap_expansion", async () => {
        const discovery = await runDiscovery({
          targetYears: before.years,
          searchTargets: targets,
          searchOnly: true,
          enableSearchDiscovery: true,
          maxSearchQueries: numberFlag(flags["max-search-queries"], Math.max(24, targets.length * 3)),
          maxPages: numberFlag(flags["max-pages"], 180),
          maxCandidates: numberFlag(flags["max-candidates"], 1500),
          maxJinaPages: numberFlag(flags["max-jina-pages"], 50),
          maxAlternateUrls: numberFlag(flags["max-alternate-urls"], 80),
          domainConcurrency: numberFlag(flags["domain-concurrency"], 4),
          maxCandidatesPerDomain: numberFlag(flags["max-per-domain"], 12),
          acceptedTarget: Number(flags["accepted-target"] ?? 0),
          maxAiCalls: 0,
          timeBudgetMs: numberFlag(flags["time-budget-ms"], 25 * 60 * 1000),
          allowAutoPublish: false,
          quiet: flags.quiet === true,
          trigger: "coverage_gap_expansion",
        });
        const enrichment = await runEnrichment({
          runId: discovery.runId,
          limit: numberFlag(flags["enrichment-limit"], 250),
          maxSearchQueries: numberFlag(flags["enrichment-search-queries"], 60),
          maxJinaPages: numberFlag(flags["enrichment-jina-pages"], 80),
          maxDeepPagesPerEvent: Number(flags["max-deep-pages"] ?? 6),
          missingDeepSectionsOnly: true,
          requireOfficialUrl: true,
          timeBudgetMs: numberFlag(flags["enrichment-time-budget-ms"], 25 * 60 * 1000),
          quiet: flags.quiet === true,
        });
        return { discovery, enrichment };
      });
      const after = await buildCoveragePlan({
        years: before.years,
        targetRichPerCell: before.targetRichPerCell,
        targetRichPerCategory: before.targetRichPerCategory,
        top: 60,
      });
      const { events, ...discoverySummary } = work.discovery;
      console.log(JSON.stringify({
        status: "completed",
        targets,
        discovery: { ...discoverySummary, eventsAccepted: events.length },
        enrichment: work.enrichment,
        coverageBefore: {
          coveredCells: before.coveredCells,
          richPublished: before.richPublished,
          accepted: before.accepted,
          publishReady: before.publishReady,
          topGaps: before.topGaps.slice(0, 20),
        },
        coverageAfter: {
          coveredCells: after.coveredCells,
          richPublished: after.richPublished,
          accepted: after.accepted,
          publishReady: after.publishReady,
          topGaps: after.topGaps.slice(0, 20),
        },
        publication: "not_performed",
      }, null, 2));
      break;
    }

    case "run": {
''',
    "cli coverage commands",
)

print("Phase 29 patch applied")
