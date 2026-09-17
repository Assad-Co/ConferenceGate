import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let source = fs.readFileSync(path, 'utf8');

const replacements = [
  [
    'const committeePositionCount = Math.max(userProfile.contributions.technicalCommittees, linkedInCommitteeCount);',
    'const committeePositionCount = Math.max(userProfile.contributions.technicalCommittees, linkedInCommitteeCount, directLinkedInRoleSummary.committee);',
  ],
  [
    'const sessionChairCount = Math.max(userProfile.contributions.sessionsChaired, linkedInSessionChairCount);',
    'const sessionChairCount = Math.max(userProfile.contributions.sessionsChaired, linkedInSessionChairCount, directLinkedInRoleSummary.sessionChair);',
  ],
  [
    'const panelParticipationCount = Math.max(userProfile.contributions.panelsParticipated, linkedInPanelCount);',
    'const panelParticipationCount = Math.max(userProfile.contributions.panelsParticipated, linkedInPanelCount, directLinkedInRoleSummary.panel);',
  ],
  [
    'const workshopDeliveredCount = Math.max(userProfile.contributions.workshopsDelivered, linkedInWorkshopCount);',
    'const workshopDeliveredCount = Math.max(userProfile.contributions.workshopsDelivered, linkedInWorkshopCount, directLinkedInRoleSummary.workshop);',
  ],
  [
    `  const presenterRoleCount = Math.max(\n    linkedInPresenterRoleCount,\n    userProfile.contributions.oralPresentations + userProfile.contributions.posterPresentations,\n  );`,
    `  const presenterRoleCount = Math.max(\n    linkedInPresenterRoleCount,\n    directLinkedInRoleSummary.presenter,\n    userProfile.contributions.oralPresentations + userProfile.contributions.posterPresentations,\n  );`,
  ],
  [
    'const totalConferenceRoleCount = Math.max(uniqueStrongRoleSignals.length, categorizedConferenceRoleCount);',
    'const totalConferenceRoleCount = Math.max(uniqueStrongRoleSignals.length, categorizedConferenceRoleCount, directLinkedInRoleSummary.total);',
  ],
];

for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (!source.includes(before)) throw new Error('[linkedin-role-direct-counters] anchor not found: ' + before.slice(0, 80));
  source = source.replace(before, after);
}

fs.writeFileSync(path, source);
console.log('[linkedin-role-direct-counters] direct raw-post summary now drives profile role cards');
