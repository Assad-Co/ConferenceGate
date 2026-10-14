import fs from 'node:fs';

const source = fs.readFileSync('scripts/automationEntry.mjs', 'utf8');
const failures = [];
const requireText = (text, label) => { if (!source.includes(text)) failures.push(label); };

requireText("const currentYear = new Date().getUTCFullYear()", 'rolling current-year anchor');
requireText("Array.from({ length: 4 }", 'four-year rolling horizon');
requireText("PHASE31_YEARS: process.env.PHASE31_YEARS || rollingYears", 'Phase 31 rolling years');
requireText("PHASE32_YEARS: process.env.PHASE32_YEARS || process.env.PHASE31_YEARS || rollingYears", 'Phase 32 rolling years');
requireText("PHASE32_EXPLORATION_SHARE: process.env.PHASE32_EXPLORATION_SHARE || '0.35'", 'meaningful exploration share');
requireText("scripts/syncMegaOrganizerRegistry.mjs", 'global organizer registry refresh');
requireText("'harvest', '--max-org-domains'", 'long-tail organizer harvest');
requireText("GLOBAL_ORG_DOMAINS_PER_CYCLE || 120", 'broad organizer rotation');
requireText("'--years', rollingYears", 'rolling years passed to harvest');
requireText("scripts/coverageDrivenCategoryHarvest.mjs", 'coverage-driven field expansion');
requireText("'--schedule-hours', '4'", 'sub-cron refresh cadence');
requireText("'--target', '10000'", 'expanded accepted inventory target');
requireText("'--published-target', '10000'", 'expanded published inventory target');

if (source.includes("PHASE31_YEARS: process.env.PHASE31_YEARS || '2026,2027'")) failures.push('stale Phase 31 hard-coded years remain');
if (source.includes("PHASE32_YEARS: process.env.PHASE32_YEARS || process.env.PHASE31_YEARS || '2026,2027'")) failures.push('stale Phase 32 hard-coded years remain');

if (failures.length) {
  console.error('[always-on-discovery] FAILED');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log('[always-on-discovery] PASS — rolling 4-year global exploration and refresh are enabled.');
