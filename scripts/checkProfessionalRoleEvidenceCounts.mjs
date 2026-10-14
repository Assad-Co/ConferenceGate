import fs from 'node:fs';

const source = fs.readFileSync('src/components/UserProfileView.tsx', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`Professional role evidence counter check failed: ${message}`);
}

assert(source.includes('const verifiedPublicRoleSignals = (professionalEvidenceSnapshot?.items || [])'), 'verified public evidence is not merged');
assert(source.includes("item.kind === 'conference_role' && item.confidence === 'verified'"), 'only verified public conference roles should drive verified role counts');
assert(source.includes('const speakerPresenterRoleCount = Math.max('), 'speaker/presenter role count missing');
assert(source.includes('Chair / Co-Chair Roles'), 'chair metric still implies only session-chair activity');
assert(source.includes('Speaker / Presenter Roles'), 'verified presenter roles are not surfaced');
assert(source.includes('...verifiedPublicRoleSignals.map((signal) => ({'), 'verified role evidence is not listed in Committee & Leadership Roles');
assert(source.includes('Source evidence'), 'public evidence link is mislabeled as LinkedIn-only evidence');

console.log(JSON.stringify({
  professionalRoleEvidenceCounts: 'passed',
  verifiedPublicRolesMerged: true,
  chairCoChairCounted: true,
  speakerPresenterCounted: true,
  verifiedRoleEntriesListed: true,
  provenanceLabelGeneralized: true,
}));
