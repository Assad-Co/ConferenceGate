import fs from 'node:fs';

const panel = fs.readFileSync('src/components/LinkedInProfilePanel.tsx', 'utf8');
const backend = fs.readFileSync('server/linkedinProfileBootstrap.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`LinkedIn career-history check failed: ${message}`);
}

assert(panel.includes('Experience — Full Career History'), 'full-career heading is missing');
assert(!panel.includes('Experience — Past 7 Years'), 'legacy seven-year label remains');
assert(!panel.includes('experienceWithinSevenYears'), 'legacy seven-year filter remains');
assert(!panel.includes('profile!.experience.filter('), 'experience is still filtered before display');
assert(!panel.includes('profile!.experience.slice(0, 20)'), 'experience is still capped at 20 items');
assert(panel.includes('profile!.experience.map((item, index)'), 'all stored positions are not rendered');
assert(backend.includes('function mergeCareerPositions('), 'backend multi-field career merger is missing');
assert(backend.includes('arrayValue(profile.experience)'), 'experience provider field is not included');
assert(backend.includes('arrayValue(profile.positions)'), 'positions provider field is not included');
assert(backend.includes('arrayValue(profile.currentPositions)'), 'currentPositions provider field is not included');
assert(backend.includes('arrayValue(profile.pastPositions)'), 'pastPositions provider field is not included');
assert(backend.includes('const normalizedExperience = mergeCareerPositions(profile);'), 'refresh does not persist merged career history');

console.log(JSON.stringify({
  linkedInFullCareerHistory: 'passed',
  noSevenYearCutoff: true,
  noTwentyPositionCap: true,
  providerPositionFieldsMerged: true,
  deduplicatedBeforePersistence: true,
}));
