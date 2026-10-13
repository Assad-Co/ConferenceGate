import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patch(pathname, replacements) {
  const file = path.join(root, pathname);
  let source = fs.readFileSync(file, 'utf8');
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`Professional navigation patch target missing in ${pathname}: ${before.slice(0, 100)}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source);
}

patch('src/components/auth/AuthScreen.tsx', [
  ["orgLabel: 'Institution / University'", "orgLabel: 'Company / University / Institution'"],
  ["orgPlaceholder: 'e.g. University of Oxford'", "orgPlaceholder: 'e.g. Saudi Aramco, University of Oxford'"],
]);

patch('src/components/ProfessionalPreferencesModal.tsx', [
  [
    'In Phase 2, paid organizers will search and match against these preferences. Professionals remain free and control whether they are available for each role.',
    'Organizers can discover and invite professionals whose expertise and availability match their conference needs. You remain in control of which roles you are available for.'
  ],
]);

patch('src/components/LegacyNavbar.tsx', [
  [
    "...(isAttendeeRole ? [{ id: 'discover', label: 'Discover', icon: Layers, match: ['discover'] }] : []),\n    ...(isAttendeeRole ? [{ id: 'abstracts', label: 'My Abstracts', icon: FileText, match: ['abstracts'] }] : []),",
    "...(isAttendeeRole ? [{ id: 'discover', label: 'Discover', icon: Layers, match: ['discover'] }] : []),\n    ...(isAttendeeRole ? [{ id: 'my-conferences', label: 'My Conferences', icon: Calendar, match: ['my-conferences', 'certificates'] }] : []),\n    ...(isAttendeeRole ? [{ id: 'abstracts', label: 'My Abstracts', icon: FileText, match: ['abstracts'] }] : []),"
  ],
]);

patch('src/App.tsx', [
  [
    "import { HomeLanding } from './components/HomeLanding';",
    "import { HomeLanding } from './components/HomeLanding';\nimport { MyConferencesHub } from './components/MyConferencesHub';"
  ],
  [
    "        {activeTab === 'discover' && (\n          <DiscoveryEngine",
    "        {activeTab === 'my-conferences' && (\n          <MyConferencesHub\n            conferences={discoverConferences}\n            savedConferenceIds={savedConferenceIds}\n            followedConferenceIds={followedConferenceIds}\n            registrations={registrations}\n            attendance={conferenceAttendance}\n            submissions={submissions}\n            userProfile={userProfile}\n            professionalInvitations={professionalInvitations}\n            currentUserId={authUser?.id}\n            currentUserEmail={authUser?.email}\n            onSelectConference={handleSelectConference}\n          />\n        )}\n\n        {activeTab === 'discover' && (\n          <DiscoveryEngine"
  ],
]);

console.log('Professional navigation and wording patch applied.');
