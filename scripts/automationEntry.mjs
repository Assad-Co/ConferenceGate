import { spawn } from 'node:child_process';

if (String(process.env.AUTOMATION_DISABLED || '').trim() === '1') {
  console.log('[automation] disabled for this Render service; authoritative automation runs elsewhere.');
  process.exit(0);
}

// Keep the authoritative 8-hour job focused on real catalogue gaps. Curated verified events are
// synchronized first, then the coverage harvester looks at the production database and spends its
// crawl budget only on categories that remain below the rich-card or sponsorship target. The
// bounded limits prevent a thin category from turning one scheduled run into an unbounded crawl.
const coverageEnv = {
  POPULAR_CATEGORY_RICH_TARGET: process.env.POPULAR_CATEGORY_RICH_TARGET || '25',
  POPULAR_CATEGORY_SPONSOR_TARGET: process.env.POPULAR_CATEGORY_SPONSOR_TARGET || '12',
  CATEGORY_HARVEST_MAX_DOMAINS: process.env.CATEGORY_HARVEST_MAX_DOMAINS || '32',
  CATEGORY_HARVEST_MAX_PAGES: process.env.CATEGORY_HARVEST_MAX_PAGES || '220',
  CATEGORY_HARVEST_PAGES_PER_DOMAIN: process.env.CATEGORY_HARVEST_PAGES_PER_DOMAIN || '6',
};

const steps = [
  ['node', ['scripts/patchImportedPublicationGuards.mjs']],
  ['node', ['scripts/repairApifyDiscoveryEvidence.mjs']],
  ['node', ['scripts/syncRequestedCategoryExpansion.mjs']],
  ['node', ['scripts/syncPhase13GlobalDepth.mjs']],
  ['node', ['scripts/coverageDrivenCategoryHarvest.mjs'], coverageEnv, true],
  ['node', ['scripts/enrichConferenceImages.mjs'], { IMAGE_ENRICH_LIMIT: '250' }, true],
  ['npx', ['tsx', 'server/discovery/cli.ts', 'automate', '--target', '5000', '--published-target', '5000', '--batch-pages', '500', '--enrichment-limit', '600', '--max-search-queries', '14', '--enrichment-search-queries', '6', '--max-jina-pages', '100', '--enrichment-jina-pages', '50', '--schedule-hours', '8', '--run-time-budget-ms', '3300000', '--repeat-for-ms', '25200000', '--quiet']],
  ['node', ['scripts/popularCategoryCoverageReport.mjs'], coverageEnv, true],
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

for (const [command, args, extraEnv = {}, allowFailure = false] of steps) {
  await run(command, args, extraEnv, allowFailure);
}
