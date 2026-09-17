import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[conference-role-totals] anchor not found (${label})`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

// Derive explicit roles directly from the member's own LinkedIn evidence as a UI backstop.
// This makes older CONFERENCE_MENTION rows immediately useful even before a backend reclassification
// finishes, while requiring first-person language and excluding reposts/quotes.
const strongRoleBefore = `  const strongLinkedInRoleSignals = useMemo(
    () => linkedInSignals.filter((signal) =>
      signal.kind === 'CONFERENCE_ROLE' &&
      signal.memberClaimed &&
      !signal.repostOrQuote &&
      signal.confidence >= 90 &&
      Boolean(signal.role)
    ),
    [linkedInSignals],
  );`;

const strongRoleAfter = `  const strongLinkedInRoleSignals = useMemo(() => {
    const rolePatterns: Array<[RegExp, string]> = [
      [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, 'Technical Program Committee Co-Chair'],
      [/\\bscientific program(?:me)? committee co[- ]?chair\\b/i, 'Scientific Program Committee Co-Chair'],
      [/\\bprogram(?:me)? committee co[- ]?chair\\b/i, 'Program Committee Co-Chair'],
      [/\\btechnical committee co[- ]?chair\\b/i, 'Technical Committee Co-Chair'],
      [/\\bscientific committee co[- ]?chair\\b/i, 'Scientific Committee Co-Chair'],
      [/\\borganizing committee co[- ]?chair\\b|\\borganising committee co[- ]?chair\\b/i, 'Organizing Committee Co-Chair'],
      [/\\bsession co[- ]?chair\\b/i, 'Session Co-Chair'],
      [/\\bsession chair\\b/i, 'Session Chair'],
      [/\\btrack co[- ]?chair\\b/i, 'Track Co-Chair'],
      [/\\btrack chair\\b/i, 'Track Chair'],
      [/\\bcore presenter\\b/i, 'Core Presenter'],
      [/\\boral presenter\\b/i, 'Oral Presenter'],
      [/\\btechnical presenter\\b/i, 'Technical Presenter'],
      [/\\bposter presenter\\b|\\bposter presentation\\b/i, 'Poster Presenter'],
      [/\\bkeynote(?: speaker)?\\b/i, 'Keynote Speaker'],
      [/\\bplenary(?: speaker)?\\b/i, 'Plenary Speaker'],
      [/\\b(?:invited|distinguished|guest) speaker\\b/i, 'Invited Speaker'],
      [/\\bpanelist\\b|\\bpanellist\\b|\\bpanel participant\\b/i, 'Panelist'],
      [/\\bmoderator\\b|\\bmoderating\\b/i, 'Moderator'],
      [/\\bworkshop (?:presenter|leader|chair|instructor|facilitator|trainer)\\b/i, 'Workshop Presenter'],
      [/\\b(?:technical|scientific|program|programme|organizing|organising|steering|advisory) committee member\\b/i, 'Committee Member'],
      [/\\bcommittee member\\b/i, 'Committee Member'],
      [/\\b(?:abstract|paper|technical|scientific|conference) reviewer\\b/i, 'Reviewer'],
    ];
    const firstPerson = /\\b(?:i\\s+(?:am|was|have|had|presented|spoke|attended|participated|chaired|served|joined|contributed|took part|take part)|i['’]m|my\\s+(?:talk|presentation|poster|paper|abstract|session)|honou?red to|proud to|pleased to|delighted to|excited to|privileged to|grateful to)\\b/i;
    const expanded: LinkedInConferenceSignal[] = [];

    for (const signal of linkedInSignals) {
      if (signal.repostOrQuote) continue;
      if (signal.kind === 'CONFERENCE_ROLE' && signal.memberClaimed && signal.confidence >= 90 && signal.role) {
        expanded.push(signal);
      }

      const evidence = [signal.evidenceText, signal.label].filter(Boolean).join(' ');
      if (!firstPerson.test(evidence)) continue;
      rolePatterns.forEach(([pattern, role], index) => {
        if (!pattern.test(evidence)) return;
        expanded.push({
          ...signal,
          id: signal.id + ':derived-role:' + index,
          kind: 'CONFERENCE_ROLE',
          role,
          memberClaimed: true,
          confidence: Math.max(signal.confidence || 0, 95),
        });
      });
    }

    const seen = new Set<string>();
    return expanded.filter((signal) => {
      const key = [signal.sourceUrl || signal.conferenceName || signal.label, signal.year || '', (signal.role || '').toLowerCase()].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [linkedInSignals]);`;
replaceOnce(strongRoleBefore, strongRoleAfter, 'derive all explicit roles from LinkedIn evidence');

// Show every strong conference role in the role list, not only committee/chair roles.
const leadershipFilterBefore = `    () => uniqueStrongRoleSignals
      .filter((signal) => /committee|session (?:co-)?chair|track (?:co-)?chair|\\bchair\\b/i.test(signal.role || ''))
      .map((signal) => ({`;
const leadershipFilterAfter = `    () => uniqueStrongRoleSignals
      .filter((signal) => Boolean(signal.role))
      .map((signal) => ({`;
replaceOnce(leadershipFilterBefore, leadershipFilterAfter, 'list every conference role');

// Add distinct role totals. Core Presenter + Oral Presenter are two roles even when evidenced by the same post.
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

// Top profile summary should reflect total conference roles rather than only committee roles.
source = source.replace(
  '<div className="text-[10px] font-bold text-slate-400 uppercase">Committee Roles</div>\n            <div className="text-xl font-extrabold text-indigo-700">{committeePositionCount} Positions</div>',
  '<div className="text-[10px] font-bold text-slate-400 uppercase">Conference Roles</div>\n            <div className="text-xl font-extrabold text-indigo-700">{totalConferenceRoleCount} Roles</div>',
);

// Expand the leadership dashboard to six explicit categories.
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
console.log('[conference-role-totals] total roles, presenter roles, all-role list, and evidence fallback installed');
