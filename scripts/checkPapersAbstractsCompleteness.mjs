import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const imported = read('src/components/LinkedInImportedTabSections.tsx');
const profile = read('src/components/UserProfileView.tsx');
const conference = read('server/linkedinConferenceActivityBootstrap.ts');
const mergePatch = read('scripts/patchLinkedInCompleteProfileMerge.mjs');

const requiredImported = [
  "s.kind === 'PAPER_ABSTRACT'",
  'profile?.publications || []',
  'activity?.callsForPapers || []',
  'const importedPaperSignalTitles = useMemo(',
  '...importedPublicationTitles, ...importedPaperSignalTitles',
  'Imported LinkedIn Papers & Abstracts',
];
for (const needle of requiredImported) {
  if (!imported.includes(needle)) throw new Error(`Missing LinkedIn papers/abstracts coverage: ${needle}`);
}

const requiredProfile = [
  "{ id: 'papers', label: 'Papers & Abstracts' }",
  'const mySubmissions = submissions.filter(',
  '(s.coAuthors || []).some',
  'fetchMyExternalPapers()',
  '...linkedInPaperTitles',
];
for (const needle of requiredProfile) {
  if (!profile.includes(needle)) throw new Error(`Missing Professional papers/abstracts coverage: ${needle}`);
}

const requiredConference = [
  'PAPER_ABSTRACT',
  'call for abstracts',
  'abstract submissions?',
  'hasPaper',
];
for (const needle of requiredConference) {
  if (!conference.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing LinkedIn conference-paper evidence handling: ${needle}`);
}

if (!mergePatch.includes('mergedPublications = mergeHistoricalItems')) {
  throw new Error('LinkedIn publication history is not preserved across refreshes');
}
if (!mergePatch.includes('callsForPapers = mergeEvidence')) {
  throw new Error('LinkedIn CFP/abstract-call history is not preserved across refreshes');
}

console.log('Papers & abstracts completeness regression audit passed');
