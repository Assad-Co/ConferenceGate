import { spawn } from 'node:child_process';

if (String(process.env.AUTOMATION_DISABLED || '').trim() === '1') {
  console.log('[automation] disabled for this Render service; authoritative automation runs elsewhere.');
  process.exit(0);
}

// Keep Conference Gate forward-looking without another manual year bump. Every automation run
// covers the current calendar year plus the next three years, so events announced two or three
// years early can enter the catalogue as soon as an official organizer publishes them.
const currentYear = new Date().getUTCFullYear();
const rollingYears = Array.from({ length: 4 }, (_, index) => currentYear + index).join(',');

// The authoritative worker starts with worldwide source registration and coverage-specific
// production intelligence. It continuously explores weaker categories/regions instead of only
// revisiting already-strong organizers, then hands the expanded inventory to the normal bounded
// verification/enrichment/publication pipeline.
const coverageEnv = {
  POPULAR_CATEGORY_RICH_TARGET: process.env.POPULAR_CATEGORY_RICH_TARGET || '40',
  POPULAR_CATEGORY_SPONSOR_TARGET: process.env.POPULAR_CATEGORY_SPONSOR_TARGET || '18',
  CATEGORY_HARVEST_MAX_DOMAINS: process.env.CATEGORY_HARVEST_MAX_DOMAINS || '48',
  CATEGORY_HARVEST_MAX_PAGES: process.env.CATEGORY_HARVEST_MAX_PAGES || '320',
  CATEGORY_HARVEST_PAGES_PER_DOMAIN: process.env.CATEGORY_HARVEST_PAGES_PER_DOMAIN || '8',
};

const phase31Env = {
  ...coverageEnv,
  PHASE31_YEARS: process.env.PHASE31_YEARS || rollingYears,
  PHASE31_GAP_CELLS: process.env.PHASE31_GAP_CELLS || '24',
  PHASE31_MAX_PROVEN_DOMAINS: process.env.PHASE31_MAX_PROVEN_DOMAINS || '24',
  PHASE31_HARVEST_MAX_PAGES: process.env.PHASE31_HARVEST_MAX_PAGES || '160',
  PHASE31_HARVEST_PAGES_PER_DOMAIN: process.env.PHASE31_HARVEST_PAGES_PER_DOMAIN || '6',
  PHASE31_CLOSURE_RUNTIME_MS: process.env.PHASE31_CLOSURE_RUNTIME_MS || '1500000',
  PHASE31_DISCOVERY_MS: process.env.PHASE31_DISCOVERY_MS || '480000',
  PHASE31_ENRICHMENT_MS: process.env.PHASE31_ENRICHMENT_MS || '720000',
  PHASE31_PROMOTION_LIMIT: process.env.PHASE31_PROMOTION_LIMIT || '240',
  PHASE31_PUBLISH: process.env.PHASE31_PUBLISH || '1',
};

const phase32Env = {
  ...phase31Env,
  PHASE32_YEARS: process.env.PHASE32_YEARS || process.env.PHASE31_YEARS || rollingYears,
  PHASE32_GAP_CELLS: process.env.PHASE32_GAP_CELLS || '28',
  PHASE32_MAX_DOMAINS: process.env.PHASE32_MAX_DOMAINS || '24',
  PHASE32_MAX_PAGES: process.env.PHASE32_MAX_PAGES || '120',
  PHASE32_PAGES_PER_DOMAIN: process.env.PHASE32_PAGES_PER_DOMAIN || '5',
  // Preserve a substantial exploration budget for new organizers, new countries, and fields that
  // have not yet proven themselves. The rest still exploits sources with strong acceptance/richness.
  PHASE32_EXPLORATION_SHARE: process.env.PHASE32_EXPLORATION_SHARE || '0.35',
  PHASE32_EWMA_ALPHA: process.env.PHASE32_EWMA_ALPHA || '0.32',
  PHASE32_COOLDOWN_NO_GAIN: process.env.PHASE32_COOLDOWN_NO_GAIN || '3',
};

const steps = [
  ['node', ['scripts/patchImportedPublicationGuards.mjs']],
  ['node', ['scripts/repairApifyDiscoveryEvidence.mjs']],
  // Re-register the full global organizer universe every cycle so database restores or newly added
  // registry sources are picked up automatically without waiting for a deploy or manual command.
  ['node', ['scripts/syncMegaOrganizerRegistry.mjs'], {}, true],
  ['node', ['scripts/seedPopularCategoryHardCrawl.mjs'], coverageEnv, true],
  ['node', ['scripts/syncRequestedCategoryExpansion.mjs']],
  ['node', ['scripts/syncPhase13GlobalDepth.mjs']],
  ['node', ['scripts/sourcePerformanceLearning.mjs'], phase32Env, true],
  ['node', ['scripts/adaptiveCoverageExecution.mjs'], phase31Env, true],
  // Long-tail organizer rotation: continuously scan a broad slice of the worldwide registry across
  // the rolling four-year window. Candidates still pass robots, first-party verification, dedupe,
  // readiness and publication gates before they can become customer-visible.
  ['npx', ['tsx', 'server/discovery/cli.ts', 'harvest', '--max-org-domains', String(process.env.GLOBAL_ORG_DOMAINS_PER_CYCLE || 120), '--max-pages', String(process.env.GLOBAL_ORG_MAX_PAGES || 900), '--org-pages', String(process.env.GLOBAL_ORG_PAGES_PER_DOMAIN || 8), '--years', rollingYears, '--quiet'], {}, true],
  ['node', ['scripts/coverageDrivenCategoryHarvest.mjs'], coverageEnv, true],
  ['node', ['scripts/enrichConferenceImages.mjs'], { IMAGE_ENRICH_LIMIT: '350' }, true],
  // Keep the normal production engine running for most of the eight-hour Render window. A four-hour
  // internal cadence lets one scheduled worker complete an early cycle and then refresh again before
  // the next Render cron invocation, while the durable DB lease prevents overlapping heavy workers.
  ['npx', ['tsx', 'server/discovery/cli.ts', 'automate', '--target', '10000', '--published-target', '10000', '--batch-pages', '700', '--enrichment-limit', '800', '--max-search-queries', '24', '--enrichment-search-queries', '10', '--max-jina-pages', '140', '--enrichment-jina-pages', '70', '--schedule-hours', '4', '--run-time-budget-ms', '3300000', '--repeat-for-ms', '25200000', '--quiet']],
  ['node', ['scripts/popularCategoryCoverageReport.mjs'], coverageEnv, true],
  ['node', ['scripts/megaConferenceCoverageReport.mjs'], phase31Env, true],
];

function run(command, args, extraEnv = {}, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      shell: false,
    });
    child.on('error', (error) => allowFailure ? resolve() : reject(error));
    child.on('exit', (code, signal) => {
      if (code === 0 || allowFailure) return resolve();
      reject(new Error(`${command} exited with code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`));
    });
  });
}

console.log(`[automation] rolling conference horizon ${rollingYears}; global organizer rotation enabled.`);
for (const [command, args, extraEnv = {}, allowFailure = false] of steps) {
  await run(command, args, extraEnv, allowFailure);
}
