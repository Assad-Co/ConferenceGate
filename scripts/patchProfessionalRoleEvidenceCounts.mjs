import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/components/UserProfileView.tsx');
let source = fs.readFileSync(file, 'utf8');

const marker = 'const verifiedPublicRoleSignals = (professionalEvidenceSnapshot?.items || [])';
if (!source.includes(marker)) {
  const anchor = `  const uniqueLinkedInRoles = Array.from(\n    new Map(linkedInRoleSignals.map((signal) => [roleKey(signal), signal] as const)).values()\n  );\n`;
  if (!source.includes(anchor)) throw new Error('Professional role evidence patch: LinkedIn role anchor missing');
  const addition = `${anchor}\n  // Merge independently verified public conference-role evidence into the same historical\n  // role summary. Availability chips above are current preferences; these counters are past\n  // evidence and must not stay at zero when official programs/archives prove a role.\n  const verifiedPublicRoleSignals = (professionalEvidenceSnapshot?.items || [])\n    .filter((item) => item.kind === 'conference_role' && item.confidence === 'verified')\n    .map((item) => ({\n      conferenceName: item.conferenceTitle || item.title,\n      label: item.title,\n      role: item.role || item.title,\n      year: item.year || undefined,\n      sourceUrl: item.sourceUrl,\n      evidenceText: item.evidenceReason,\n    }));\n\n  const combinedRoleSignals = Array.from(new Map([\n    ...uniqueLinkedInRoles.map((signal) => [\n      [signal.conferenceName || signal.label, signal.year || '', signal.role || ''].join('|').toLowerCase(),\n      { conferenceName: signal.conferenceName || signal.label, label: signal.label, role: signal.role || '', year: signal.year, sourceUrl: signal.sourceUrl, evidenceText: signal.evidenceText },\n    ] as const),\n    ...verifiedPublicRoleSignals.map((signal) => [\n      [signal.conferenceName, signal.year || '', signal.role].join('|').toLowerCase(),\n      signal,\n    ] as const),\n  ]).values());\n\n  const verifiedChairRoleCount = combinedRoleSignals.filter((signal) => /(?:^|\\b)(?:co[- ]?chair|chair)(?:\\b|$)/i.test(signal.role || '')).length;\n  const verifiedCommitteeRoleCount = combinedRoleSignals.filter((signal) => /committee/i.test(signal.role || '')).length;\n  const verifiedSpeakerPresenterRoleCount = combinedRoleSignals.filter((signal) => /speaker|keynote|presenter|oral presentation|invited talk/i.test(signal.role || '')).length;\n  const verifiedPanelRoleCount = combinedRoleSignals.filter((signal) => /panelist|panel participant|moderator/i.test(signal.role || '')).length;\n  const verifiedWorkshopRoleCount = combinedRoleSignals.filter((signal) => /workshop/i.test(signal.role || '')).length;\n`;
  source = source.replace(anchor, addition);
}

source = source.replace(
  `  const committeePositionCount = Math.max(\n    userProfile.contributions.technicalCommittees,\n    linkedInCommitteeCount + selfReportedCommitteeCount,\n  );`,
  `  const committeePositionCount = Math.max(\n    userProfile.contributions.technicalCommittees,\n    verifiedCommitteeRoleCount + selfReportedCommitteeCount,\n  );`
);
source = source.replace(
  `  const sessionChairCount = Math.max(\n    userProfile.contributions.sessionsChaired,\n    linkedInSessionChairCount + selfReportedChairCount,\n  );`,
  `  const sessionChairCount = Math.max(\n    userProfile.contributions.sessionsChaired,\n    verifiedChairRoleCount + selfReportedChairCount,\n  );`
);
source = source.replace(
  `  const panelParticipationCount = Math.max(\n    userProfile.contributions.panelsParticipated,\n    linkedInPanelCount,\n  );`,
  `  const panelParticipationCount = Math.max(\n    userProfile.contributions.panelsParticipated,\n    verifiedPanelRoleCount,\n  );`
);
source = source.replace(
  `  const workshopDeliveredCount = Math.max(\n    userProfile.contributions.workshopsDelivered,\n    linkedInWorkshopCount,\n  );`,
  `  const workshopDeliveredCount = Math.max(\n    userProfile.contributions.workshopsDelivered,\n    verifiedWorkshopRoleCount,\n  );\n  const speakerPresenterRoleCount = Math.max(\n    verifiedSpeakerPresenterRoleCount,\n    keynoteSpeakerMatches.filter((match) => match.verified).length,\n  );`
);

const entriesAnchor = `    ...uniqueLinkedInRoles.map((signal) => ({\n      title: signal.conferenceName || signal.label,\n      conferenceName: signal.conferenceName || signal.label,\n      year: signal.year || new Date().getFullYear(),\n      roleLabel: signal.role || 'Conference Role',\n      sourceUrl: signal.sourceUrl,\n    })),`;
if (source.includes(entriesAnchor) && !source.includes('...verifiedPublicRoleSignals.map((signal) => ({')) {
  source = source.replace(entriesAnchor, `${entriesAnchor}\n    ...verifiedPublicRoleSignals.map((signal) => ({\n      title: signal.label || signal.conferenceName,\n      conferenceName: signal.conferenceName,\n      year: signal.year || new Date().getFullYear(),\n      roleLabel: signal.role || 'Conference Role',\n      sourceUrl: signal.sourceUrl,\n    })),`);
}

source = source.replace(
  `<div className="text-[10px] font-bold text-slate-400 uppercase">Sessions Chaired</div>`,
  `<div className="text-[10px] font-bold text-slate-400 uppercase">Chair / Co-Chair Roles</div>`
);
source = source.replace(
  `<div className="text-[10px] font-bold text-slate-400 uppercase">Panels Participated</div>\n                <div className="text-lg font-extrabold text-blue-700">{panelParticipationCount}</div>`,
  `<div className="text-[10px] font-bold text-slate-400 uppercase">Speaker / Presenter Roles</div>\n                <div className="text-lg font-extrabold text-blue-700">{speakerPresenterRoleCount}</div>`
);
source = source.replace('LinkedIn evidence', 'Source evidence');

if (!source.includes(marker)) throw new Error('Professional role evidence patch failed to add verified evidence merge');
if (!source.includes('speakerPresenterRoleCount')) throw new Error('Professional role evidence patch failed to add presenter count');
if (!source.includes('Chair / Co-Chair Roles')) throw new Error('Professional role evidence patch failed to clarify chair metric');

fs.writeFileSync(file, source);
console.log('Professional role evidence counters now include verified public-source roles.');
