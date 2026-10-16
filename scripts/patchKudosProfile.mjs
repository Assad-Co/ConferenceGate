import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let source = fs.readFileSync(path, 'utf8');

if (!source.includes("import { KudosProfileSection } from './KudosProfileSection';")) {
  const anchor = "import { ConferenceHistoryDetails } from './ConferenceHistoryDetails';";
  if (!source.includes(anchor)) throw new Error('[kudos-profile] import anchor not found');
  source = source.replace(anchor, `${anchor}\nimport { KudosProfileSection } from './KudosProfileSection';`);
}

source = source.replaceAll('Verified Badges', 'Kudos & Recognition');
source = source.replaceAll('Peer Reviews & Kudos', 'Peer Reviews');

if (!source.includes('<KudosProfileSection')) {
  const candidates = [
    "{activeTab === 'badges' && (",
    "{activeTab === \"badges\" && (",
  ];
  const anchor = candidates.find((candidate) => source.includes(candidate));
  if (!anchor) throw new Error('[kudos-profile] badges block anchor not found');
  const restored = `{activeTab === 'badges' && (\n          <KudosProfileSection\n            currentUserId={currentUserId}\n            currentUserEmail={currentUserEmail}\n            submissions={submissions}\n            attendanceRecords={attendanceRecords}\n            professionalInvitations={professionalInvitations}\n            onOpenCertificates={onOpenCertificates}\n          />\n        )}\n\n        {false && (`;
  source = source.replace(anchor, restored);
}

fs.writeFileSync(path, source);
console.log('[kudos-profile] restored real earned Kudos profile section');
