import { spawn } from 'node:child_process';

const INTERVAL_HOURS = Math.max(1, Number(process.env.CONFERENCE_ENRICH_INTERVAL_HOURS || 6));
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

function runScript(file, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
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

function runDiscoveryCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/discovery/cli.ts', ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      if (code && code !== 0) console.warn(`[conference-enrich-loop] discovery ${args[0]} exited code=${code}${signal ? ` signal=${signal}` : ''}`);
      resolve();
    });
    child.on('error', (error) => {
      console.warn(`[conference-enrich-loop] could not start discovery ${args[0]}: ${error?.message || error}`);
      resolve();
    });
  });
}

const DEFAULT_PRIORITY_ORGS = [
  'neurips.cc','cvpr.thecvf.com','rsaconference.com','ces.tech','ieee-ras.org','2027.ieee-iros.org',
  'himssconference.com','convention.bio.org','rsna.org','agu.org','egu.eu','imogconference.org',
  'otcnet.org','gastechevent.com','adipec.com','spe.org','aapg.org','eage.org',
  'world-nuclear-exhibition.com','formnext.com','farnboroughairshow.com','hannovermesse.de',
  'mwcbarcelona.com','blackhat.com','events.linuxfoundation.org','websummit.com',
  'pdac.ca','hlth.com','slas.org','worldagritechinnovation.com',
  'eageannual.org','apsanet.org','conferenceonarchitecture.com','conference.iste.org','mrs.org',
  'nor-shipping.com','iaa-mobility.com','itb.com','mipim.com','smeannualconference.org',
  'ephconference.eu','icn.ch','ids-cologne.de','aeaweb.org','token2049.com','exporeal.net',
  'mwcshanghai.com','aaic.alz.org','meos-geo.com'
];

function priorityOrganizations() {
  const configured = String(process.env.PRIORITY_CONFERENCE_ORGS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_PRIORITY_ORGS;
}

async function cycle() {
  const started = new Date().toISOString();
  console.log(`[conference-enrich-loop] cycle started ${started}`);
  // Make every launch-catalogue conference visible to the same enrichment workers as Turso-native
  // records. Without this step the static CSV catalogue could be browsed but its detail tabs could
  // never fill, because the workers only iterate discovery_events.
  await runScript('scripts/seedLaunchCatalogueForEnrichment.mjs');
  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');
  await runScript('scripts/syncRequestedCategoryExpansion.mjs');
  await runScript('scripts/backfillStoredSponsorshipCatalog.mjs');

  // Coverage-driven pass: every Popular Search category has the same minimum target. Categories
  // below target receive extra official-source harvesting until they catch up; strong categories
  // no longer consume all discovery capacity while weak categories stay nearly empty.
  await runScript('scripts/coverageDrivenCategoryHarvest.mjs');

  // First sweep the globally important conference brands across many categories. This keeps
  // flagship events from waiting behind hundreds of lower-priority domains in the weekly registry.
  const priorityOrgs = priorityOrganizations();
  await runDiscoveryCli([
    'harvest',
    '--orgs', priorityOrgs.join(','),
    '--max-pages', String(process.env.PRIORITY_ORG_MAX_PAGES || 480),
    '--org-pages', String(process.env.PRIORITY_ORG_PAGES_PER_DOMAIN || 14),
    '--years', '2026,2027,2028',
    '--quiet',
  ]);

  // Then grow the long-tail catalogue from the full authoritative registry.
  await runDiscoveryCli([
    'harvest',
    '--max-org-domains', String(process.env.POPULAR_ORG_DOMAINS_PER_CYCLE || 40),
    '--max-pages', String(process.env.POPULAR_ORG_MAX_PAGES || 480),
    '--org-pages', String(process.env.POPULAR_ORG_PAGES_PER_DOMAIN || 12),
    '--years', '2026,2027,2028',
    '--quiet',
  ]);
  // Remove stale editions/navigation dumps before deciding what still needs enrichment.
  await runScript('scripts/sanitizeConferenceDetailData.mjs');
  // Curated current-edition corrections take precedence over generic crawling.
  await runScript('scripts/applyCuratedConferenceOverrides.mjs');
  // Immediately give every record a non-blank identity, honest tab-state map, and multi-category
  // classification before the slower network readers begin.
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  await runScript('scripts/enrichAllConferenceDetails.mjs', {
    DEEP_ENRICH_MAX_LINKS: process.env.DEEP_ENRICH_MAX_LINKS || '16',
    DEEP_ENRICH_FIRECRAWL_MAX_PAGES: process.env.DEEP_ENRICH_FIRECRAWL_MAX_PAGES || '250',
  });
  await runScript('scripts/enrichConferenceApifyFallback.mjs', {
    DEEP_ENRICH_APIFY_MAX_RUNS: process.env.DEEP_ENRICH_APIFY_MAX_RUNS || '120',
    DEEP_ENRICH_APIFY_MAX_PAGES: process.env.DEEP_ENRICH_APIFY_MAX_PAGES || '20',
    DEEP_ENRICH_MIN_TABS: process.env.DEEP_ENRICH_MIN_TABS || '6',
  });
  // Sponsorship intelligence is a separate official-site pass so every published conference can
  // surface sponsor/exhibitor pages even when the general detail extractor found no public price.
  await runScript('scripts/enrichExternalSponsorships.mjs');
  // Readers can encounter generic historical pages, so sanitize again, then restore any vetted
  // current-edition overrides before the final customer-facing normalization.
  await runScript('scripts/sanitizeConferenceDetailData.mjs');
  await runScript('scripts/applyCuratedConferenceOverrides.mjs');
  // AAPG has a verified calendar manifest because its live site blocks some Render/Apify paths.
  // Re-apply it after generic readers so blocked pages cannot erase official program/pricing data.
  await runScript('scripts/syncAapgOfficialUpcoming.mjs');
  await runScript('scripts/syncVerifiedCalendarBatch.mjs');
  await runScript('scripts/syncRequestedCategoryExpansion.mjs');
  await runScript('scripts/ensureAapgLogos.mjs');
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  await runScript('scripts/upgradeConferenceIdentityAndTabs.mjs');
  // Final authoritative protection pass: no generic normalizer after this point may reduce AAPG's
  // vetted current-edition fields or its customer-ready tab count.
  await runScript('scripts/syncAapgOfficialUpcoming.mjs');
  await runScript('scripts/ensureAapgLogos.mjs');
  // After the authoritative AAPG pass, fetch real event artwork separately from the organiser logo.
  // This also repairs older AAPG records whose card/hero image was previously just the AAPG mark.
  await runScript('scripts/enrichConferenceImages.mjs', {
    IMAGE_ENRICH_LIMIT: process.env.AAPG_IMAGE_ENRICH_LIMIT || '150',
    IMAGE_ENRICH_CONCURRENCY: process.env.IMAGE_ENRICH_CONCURRENCY || '5',
  });
  // Run sponsorship discovery last as well. Some authoritative conference syncs intentionally
  // replace extraction_metadata; this final pass restores the official sponsor/exhibitor action
  // URL and public pricing state after every other normalizer has finished.
  await runScript('scripts/enrichExternalSponsorships.mjs');
  await runScript('scripts/backfillStoredSponsorshipCatalog.mjs');
  // Stored-data change detection for Sponsor Pro watchlists. Alert cadence is enforced inside the
  // watcher, so the normal six-hour enrichment cycle is safe for instant/daily/weekly preferences.
  await runScript('scripts/refreshSponsorWatchlistAlerts.mjs');
  await runScript('scripts/popularCategoryCoverageReport.mjs');
  console.log(`[conference-enrich-loop] cycle complete; next in ${INTERVAL_HOURS}h`);
}

for (;;) {
  await cycle();
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
