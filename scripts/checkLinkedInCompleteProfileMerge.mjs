import fs from 'node:fs';

const profile = fs.readFileSync('server/linkedinProfileBootstrap.ts', 'utf8');
const conference = fs.readFileSync('server/linkedinConferenceActivityBootstrap.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`LinkedIn complete-profile merge check failed: ${message}`);
}

assert(profile.includes('const previousProfile = await readStoredProfile(userId);'), 'refresh does not read prior profile history');
for (const name of ['mergedExperience','mergedEducation','mergedPublications','mergedPatents','mergedCertifications','mergedProjects','mergedSkills','mergedHonors','mergedLanguages']) {
  assert(profile.includes(`const ${name} = mergeHistoricalItems(`), `${name} is not merged`);
}
assert(profile.includes('previousProfile?.photoUrl || null'), 'previous LinkedIn portrait is not preserved as fallback');
assert(profile.includes('manual_avatar_override:${userId}'), 'manual ConferenceGate avatar protection is missing');
assert(!profile.includes('isOwnerPreviewEmail(user.email)') || profile.includes('router.post("/refresh", requireMember'), 'normal refresh must stay available to all authenticated members');

assert(conference.includes('rawPosts: parseArray(row.raw_posts)'), 'stored raw LinkedIn posts are not read');
assert(conference.includes('const rawPosts = mergeRawLinkedInPosts('), 'raw LinkedIn post history is replaced instead of merged');
assert(conference.includes('JSON.stringify(rawPosts)'), 'merged raw posts are not persisted');
assert(!conference.includes('mergeEvidence(existing?.conferenceActivity || [], classified.conferenceActivity).slice('), 'merged conference evidence is capped');
assert(!conference.includes('mergeEvidence(existing?.callsForPapers || [], classified.callsForPapers).slice('), 'merged CFP history is capped');
assert(conference.includes('participated(?:\\s+(?:in|at))?'), 'participation attendance wording is not classified');
assert(conference.includes('memberClaimed'), 'LinkedIn attendance remains provenance-labelled');
assert(conference.includes('verified: false'), 'LinkedIn evidence must not be promoted to verified attendance automatically');

console.log(JSON.stringify({
  linkedInCompleteProfileMerge: 'passed',
  allAuthenticatedMembers: true,
  profileHistoryAdditive: true,
  conferenceHistoryAdditive: true,
  rawPostsAdditive: true,
  attendanceWordingExpanded: true,
  portraitSourcesMerged: true,
  manualPhotoProtected: true,
  linkedInClaimsRemainUnverified: true,
}));
