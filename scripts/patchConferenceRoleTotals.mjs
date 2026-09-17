import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[conference-role-totals] anchor not found (${label})`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

// patchLinkedInRoleTabDisplay runs immediately before this file and already merges current
// CONFERENCE_ROLE records with roles derived from older stored LinkedIn evidenceText. Do not
// replace that classifier again here. This patch only turns the resulting unique role set into
// clear totals and exposes every role in the leadership list.

// Show every strong conference role in the role list, not only committee/chair roles.
const leadershipFilterBefore = `    () => uniqueStrongRoleSignals
      .filter((signal) => /committee|session (?:co-)?chair|track (?:co-)?chair|\\bchair\\b/i.test(signal.role || ''))
      .map((signal) => ({`;
const leadershipFilterAfter = `    () => uniqueStrongRoleSignals
      .filter((signal) => Boolean(signal.role))
      .map((signal) => ({`;
replaceOnce(leadershipFilterBefore, leadershipFilterAfter, 'list every conference role');

// Add distinct role totals. Core Presenter + Oral Presenter count as two roles even when they
// come from the same LinkedIn post. Committee and chair counts remain their own categories.
const countAnchor = `  const posterPresentationCount = Math.max(userProfile.contributions.posterPresentations, linkedInPosterPresentationCount);`;
const countAfter = `${countAnchor}
  const linkedInPresenterRoleCount = new Set(
    uniqueStrongRoleSignals
      .filter((signal) => /core presenter|oral presenter|technical presenter|poster presenter|^presenter$/i.test(signal.role || ''))
      .map(roleEvidenceKey)
  ).size;
  const presenterRoleCount = Math.max(
    linkedInPresenterRoleCount,
    userProfile.contributions.oralPresentations + userProfile.contributions.posterPresentations,
  );
  const categorizedConferenceRoleCount =
    committeePositionCount +
    sessionChairCount +
    panelParticipationCount +
    workshopDeliveredCount +
    presenterRoleCount;
  const totalConferenceRoleCount = Math.max(uniqueStrongRoleSignals.length, categorizedConferenceRoleCount);`;
replaceOnce(countAnchor, countAfter, 'conference role totals');

// Top profile summary: the base component may still reference the original contribution directly,
// while a prior patch may already have converted it to committeePositionCount. Accept both forms.
const topBeforeCandidates = [
  `<div className="text-[10px] font-bold text-slate-400 uppercase">Committee Roles</div>
            <div className="text-xl font-extrabold text-indigo-700">{committeePositionCount} Positions</div>`,
  `<div className="text-[10px] font-bold text-slate-400 uppercase">Committee Roles</div>
            <div className="text-xl font-extrabold text-indigo-700">{userProfile.contributions.technicalCommittees} Positions</div>`,
];
const topAfter = `<div className="text-[10px] font-bold text-slate-400 uppercase">Conference Roles</div>
            <div className="text-xl font-extrabold text-indigo-700">{totalConferenceRoleCount} Roles</div>`;
if (!source.includes(topAfter)) {
  const topBefore = topBeforeCandidates.find((candidate) => source.includes(candidate));
  if (!topBefore) throw new Error('[conference-role-totals] top role summary anchor not found');
  source = source.replace(topBefore, topAfter);
}

// Expand the leadership dashboard from four category cards to six cards by prepending Total Roles
// and Presenter Roles. Existing committee/chair/panel/workshop cards remain unchanged.
const gridBefore = `            <h3 className="text-base font-bold text-slate-900">Committee & Leadership Roles</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">`;
const gridAfter = `            <h3 className="text-base font-bold text-slate-900">Conference Roles & Leadership</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Total Conference Roles</div>
                <div className="text-lg font-extrabold text-blue-800">{totalConferenceRoleCount}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Presenter Roles</div>
                <div className="text-lg font-extrabold text-blue-700">{presenterRoleCount}</div>
              </div>`;
replaceOnce(gridBefore, gridAfter, 'six-category role dashboard');

source = source.replace('No committee positions on record yet.', 'No conference roles on record yet.');

fs.writeFileSync(path, source);
console.log('[conference-role-totals] total roles, presenter roles, and complete role list installed after evidence fallback');
