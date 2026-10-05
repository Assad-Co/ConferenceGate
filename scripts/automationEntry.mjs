import { spawn } from 'node:child_process';

if (String(process.env.AUTOMATION_DISABLED || '').trim() === '1') {
  console.log('[automation] disabled for this Render service; authoritative automation runs elsewhere.');
  process.exit(0);
}

// The authoritative 8-hour worker starts with coverage-specific production intelligence.
// Phase 32 learns which official sources actually create accepted, publish-ready and rich published
// conferences, cools repeated no-gain sources, and keeps a bounded exploration share. Phase 31 then
// applies the live category × region × year closure strategy. The long generic automation pass
// remains afterward so global verification/recovery continues without starving known catalogue gaps.
const coverageEnv = {
  POPULAR_CATEGORY_RICH_TARGET: process.env.POPULAR_CATEGORY_RICH_TARGET || '25',
  POPULAR_CATEGORY_SPONSOR_TARGET: process.env.POPULAR_CATEGORY_SPONSOR_TARGET || '12',
  CATEGORY_HARVEST_MAX_DOMAINS: process.env.CATEGORY_HARVEST_MAX_DOMAINS || '32',
  CATEGORY_HARVEST_MAX_PAGES: process.env.CATEGORY_HARVEST_MAX_PAGES || '220',
  CATEGORY_HARVEST_PAGES_PER_DOMAIN: process.env.CATEGORY_HARVEST_PAGES_PER_DOMAIN || '6',
};

const phase31Env = {
  ...coverageEnv,
  PHASE31_YEARS: process.env.PHASE31_YEARS || '2026,2027',
  PHASE31_GAP_CELLS: process.env.PHASE31_GAP_CELLS || '10',
  PHASE31_MAX_PROVEN_DOMAINS: process.env.PHASE31_MAX_PROVEN_DOMAINS || '16',
  PHASE31_HARVEST_MAX_PAGES: process.env.PHASE31_HARVEST_MAX_PAGES || '96',
  PHASE31_HARVEST_PAGES_PER_DOMAIN: process.env.PHASE31_HARVEST_PAGES_PER_DOMAIN || '5',
  PHASE31_CLOSURE_RUNTIME_MS: process.env.PHASE31_CLOSURE_RUNTIME_MS || '1500000',
  PHASE31_DISCOVERY_MS: process.env.PHASE31_DISCOVERY_MS || '480000',
  PHASE31_ENRICHMENT_MS: process.env.PHASE31_ENRICHMENT_MS || '720000',
  PHASE31_PROMOTION_LIMIT: process.env.PHASE31_PROMOTION_LIMIT || '180',
  PHASE31_PUBLISH: process.env.PHASE31_PUBLISH || '1',
};

const phase32Env = {
  ...phase31Env,
  PHASE32_YEARS: process.env.PHASE32_YEARS || process.env.PHASE31_YEARS || '2026,2027',
  PHASE32_GAP_CELLS: process.env.PHASE32_GAP_CELLS || '16',
  PHASE32_MAX_DOMAINS: process.env.PHASE32_MAX_DOMAINS || '14',
  PHASE32_MAX_PAGES: process.env.PHASE32_MAX_PAGES || '72',
  PHASE32_PAGES_PER_DOMAIN: process.env.PHASE32_PAGES_PER_DOMAIN || '4',
  PHASE32_EXPLORATION_SHARE: process.env.PHASE32_EXPLORATION_SHARE || '0.2',
  PHASE32_EWMA_ALPHA: process.env.PHASE32_EWMA_ALPHA || '0.32',
  PHASE32_COOLDOWN_NO_GAIN: process.env.PHASE32_COOLDOWN_NO_GAIN || '3',
};

const steps = [
  ['node', ['scripts/patchImportedPublicationGuards.mjs']],
  ['node', ['scripts/repairApifyDiscoveryEvidence.mjs']],
  ['node', ['scripts/syncRequestedCategoryExpansion.mjs']],
  ['node', ['scripts/syncPhase13GlobalDepth.mjs']],
  ['node', ['scripts/sourcePerformanceLearning.mjs'], phase32Env, true],
  ['node', ['scripts/adaptiveCoverageExecution.mjs'], phase31Env, true],
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
