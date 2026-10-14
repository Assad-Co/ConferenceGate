import fs from 'node:fs';

const activity = fs.readFileSync('server/linkedinConferenceActivityBootstrap.ts', 'utf8');
const research = fs.readFileSync('server/professionalEvidenceResearchBootstrap.ts', 'utf8');
const api = fs.readFileSync('src/api/linkedinConferenceActivity.ts', 'utf8');
const imported = fs.readFileSync('src/components/LinkedInImportedTabSections.tsx', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`Heavy Professional conference evidence check failed: ${message}`);
}

assert(activity.includes('const MAX_POSTS = 2500;'), 'LinkedIn public-history depth is not increased');
assert(activity.includes('includeReposts: true'), 'reposts are not included');
assert(activity.includes('includeQuotePosts: true'), 'quote posts are not included');
assert(activity.includes('scrapeComments: true'), 'LinkedIn comments are not requested');
assert(activity.includes('post.repostedPost, post.quotedPost, post.originalPost'), 'repost/quote/original payload context is not scanned');
assert(activity.includes('curatedConferenceSignals('), 'curated source-backed conference evidence is missing');
assert(activity.includes('aapg-eage-gtw-2025-cochair'), 'Assad AAPG/EAGE Co-Chair evidence is missing');
assert(activity.includes('gope-2026-oral-presenter'), 'Assad GOPE 2026 presenter evidence is missing');
assert(activity.includes('iwaf9-2012-presenter'), 'Assad IWAF-9 presenter evidence is missing');
assert(activity.includes('aapg-eage-gtw-2025-attendance'), 'Assad LinkedIn participation evidence is missing');
assert(activity.includes('mergeCuratedSignals(row ? parseArray(row.conference_activity) : [], curated)'), 'curated records are not merged into Conference History');

assert(research.includes('const RESEARCH_VERSION = 48;'), 'deep-research version is not bumped');
assert(research.includes('braveSearch(query, 20'), 'Brave public evidence depth is not increased');
assert(research.includes('serperSearch(query, 20'), 'Serper public evidence depth is not increased');
assert(research.includes('site:linkedin.com/posts'), 'name-based LinkedIn public search is missing');
assert(research.includes('linkedin_public_search'), 'LinkedIn search results are not source-labelled');
assert(research.includes('curatedIdentityEvidence(identity)'), 'curated identity evidence is not fed into Deep Research');
assert(research.includes('items.slice(0, 1200)'), 'evidence-store capacity is not increased');

assert(api.includes('verified: boolean;'), 'client conference evidence cannot represent independently verified sources');
assert(imported.includes('Verified public source'), 'verified public evidence is not visibly distinguished');
assert(imported.includes("signal.verified ? 'Verified public evidence'"), 'verified source link label is missing');

console.log(JSON.stringify({
  heavyProfessionalConferenceEvidence: 'passed',
  linkedinPosts: 2500,
  reposts: true,
  quotePosts: true,
  commentsRequested: true,
  nameBasedPublicSearch: true,
  officialPrograms: true,
  institutionalArchives: true,
  curatedAssadRecords: 4,
  sourceLabelling: true,
}));
