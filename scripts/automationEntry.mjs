import { spawn } from 'node:child_process';

if (String(process.env.AUTOMATION_DISABLED || '').trim() === '1') {
  console.log('[automation] disabled for this Render service; authoritative automation runs elsewhere.');
  process.exit(0);
}

const steps = [
  ['node', ['scripts/patchImportedPublicationGuards.mjs']],
  ['node', ['scripts/repairApifyDiscoveryEvidence.mjs']],
  ['node', ['scripts/enrichConferenceImages.mjs'], { IMAGE_ENRICH_LIMIT: '250' }, true],
  ['npx', ['tsx', 'server/discovery/cli.ts', 'automate', '--target', '5000', '--published-target', '5000', '--batch-pages', '500', '--enrichment-limit', '600', '--max-search-queries', '14', '--enrichment-search-queries', '6', '--max-jina-pages', '100', '--enrichment-jina-pages', '50', '--schedule-hours', '8', '--run-time-budget-ms', '3300000', '--repeat-for-ms', '25200000', '--quiet']],
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
