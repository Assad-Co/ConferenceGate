import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-cross-tabs] anchor not found (${label})`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  "import { LinkedInProfilePanel } from './LinkedInProfilePanel';",
  "import { LinkedInProfilePanel } from './LinkedInProfilePanel';\nimport { LinkedInImportedTabSections } from './LinkedInImportedTabSections';",
  'cross-tab component import',
);

replaceOnce(
`        {activeTab === 'linkedin' && (
          <LinkedInProfilePanel currentUserId={currentUserId} linkedinUrl={userProfile.linkedinUrl} />
        )}

        {activeTab === 'conferences' && (`,
`        {activeTab === 'linkedin' && (
          <LinkedInProfilePanel currentUserId={currentUserId} linkedinUrl={userProfile.linkedinUrl} />
        )}

        <LinkedInImportedTabSections tab={activeTab} />

        {activeTab === 'conferences' && (`,
  'cross-tab rendering',
);

fs.writeFileSync(path, source);
console.log('[linkedin-cross-tabs] added LinkedIn evidence to matching profile tabs');
