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
  // Immediately give every record a non-blank identity, complete tab-state map, and multi-category
  // classification before the slower network readers begin.
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  await runScript('scripts/enrichAllConferenceDetails.mjs');
  await runScript('scripts/enrichConferenceApifyFallback.mjs');
  // Re-normalize after readers add richer logos, section content and category evidence.
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  console.log(`[conference-enrich-loop] cycle complete; next in ${INTERVAL_HOURS}h`);
}

for (;;) {
  await cycle();
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
