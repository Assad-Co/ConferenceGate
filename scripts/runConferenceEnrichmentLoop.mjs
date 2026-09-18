import { spawn } from 'node:child_process';

const INTERVAL_HOURS = Math.max(1, Number(process.env.CONFERENCE_ENRICH_INTERVAL_HOURS || 6));
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

function runScript(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
      if (code && code !== 0) console.warn(`[conference-enrich-loop] ${file} exited code=${code}${signal ? ` signal=${signal}` : ''}`);
      resolve();
    });
    child.on('error', (error) => {
      console.warn(`[conference-enrich-loop] could not start ${file}: ${error?.message || error}`);
      resolve();
    });
  });
}

async function cycle() {
  const started = new Date().toISOString();
  console.log(`[conference-enrich-loop] cycle started ${started}`);
  // Make every launch-catalogue conference visible to the same enrichment workers as Turso-native
  // records. Without this step the static CSV catalogue could be browsed but its detail tabs could
  // never fill, because the workers only iterate discovery_events.
  await runScript('scripts/seedLaunchCatalogueForEnrichment.mjs');
  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');
  // Remove stale editions/navigation dumps before deciding what still needs enrichment.
  await runScript('scripts/sanitizeConferenceDetailData.mjs');
  // Curated current-edition corrections take precedence over generic crawling.
  await runScript('scripts/applyCuratedConferenceOverrides.mjs');
  // Immediately give every record a non-blank identity, honest tab-state map, and multi-category
  // classification before the slower network readers begin.
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  await runScript('scripts/upgradeConferenceIdentityAndTabs.mjs');
  await runScript('scripts/enrichAllConferenceDetails.mjs');
  await runScript('scripts/enrichConferenceApifyFallback.mjs');
  // Readers can encounter generic historical pages, so sanitize again, then restore any vetted
  // current-edition overrides before the final customer-facing normalization.
  await runScript('scripts/sanitizeConferenceDetailData.mjs');
  await runScript('scripts/applyCuratedConferenceOverrides.mjs');
  // AAPG has a verified calendar manifest because its live site blocks some Render/Apify paths.
  // Re-apply it after generic readers so blocked pages cannot erase official program/pricing data.
  await runScript('scripts/syncAapgOfficialUpcoming.mjs');
  await runScript('scripts/syncVerifiedCalendarBatch.mjs');
  await runScript('scripts/ensureAapgLogos.mjs');
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  await runScript('scripts/upgradeConferenceIdentityAndTabs.mjs');
  await runScript('scripts/popularCategoryCoverageReport.mjs');
  console.log(`[conference-enrich-loop] cycle complete; next in ${INTERVAL_HOURS}h`);
}

for (;;) {
  await cycle();
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
