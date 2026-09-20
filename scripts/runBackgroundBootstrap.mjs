import { spawn } from 'node:child_process';

const START_DELAY_MS = Math.max(1000, Number(process.env.STARTUP_MAINTENANCE_DELAY_MS || 8000));

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function runScript(file, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code, signal) => {
      if (code && code !== 0) {
        console.warn(`[background-bootstrap] ${file} exited code=${code}${signal ? ` signal=${signal}` : ''}`);
      }
      resolve();
    });
    child.on('error', (error) => {
      console.warn(`[background-bootstrap] could not start ${file}: ${error?.message || error}`);
      resolve();
    });
  });
}

async function main() {
  // Render decides whether a web service is healthy by seeing the HTTP port promptly. None of the
  // import/crawl/cleanup jobs below is required to bind that port, so they must never sit in front
  // of dist/server.cjs in the start command.
  console.log(`[background-bootstrap] server-first startup; maintenance begins in ${START_DELAY_MS}ms`);
  await sleep(START_DELAY_MS);

  // Fast DB-only reconciliation first: make the complete AAPG set and its reliable local
  // logo visible within seconds of a deploy, before slower imports and network image work.
  await runScript('scripts/syncAapgOfficialUpcoming.mjs');
  await runScript('scripts/syncVerifiedCalendarBatch.mjs');
  await runScript('scripts/ensureAapgLogos.mjs');
  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  // Restore the authoritative AAPG manifest after the generic fast normalization too, so the
  // first customer search after deploy sees the full customer-ready AAPG set.
  await runScript('scripts/syncAapgOfficialUpcoming.mjs');
  await runScript('scripts/ensureAapgLogos.mjs');

  await runScript('scripts/repairLaunchDatasetJson.mjs');
  await runScript('scripts/repairApifyDiscoveryEvidence.mjs');
  await runScript('scripts/importApifyValidated.mjs');
  await runScript('scripts/importLinkedInValidated.mjs');
  // Fast verified inserts first so the newly requested IMOG/geoscience/politics/health/etc.
  // categories are available without waiting for the long discovery/enrichment cycle.
  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');
  await runScript('scripts/syncRequestedCategoryExpansion.mjs');
  await runScript('scripts/enrichConferenceImages.mjs', { IMAGE_ENRICH_LIMIT: process.env.IMAGE_ENRICH_LIMIT || '250' });

  // This loop already performs Popular Search seeding, sanitization, AAPG/calendar reconciliation,
  // Firecrawl/direct deep research, Apify fallback, logo recovery and coverage reporting.
  console.log('[background-bootstrap] starting continuous conference enrichment loop');
  const loop = spawn(process.execPath, ['scripts/runConferenceEnrichmentLoop.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });
  loop.on('exit', (code, signal) => {
    console.warn(`[background-bootstrap] enrichment loop exited code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`);
  });
  loop.on('error', (error) => {
    console.warn(`[background-bootstrap] could not start enrichment loop: ${error?.message || error}`);
  });
}

await main();
