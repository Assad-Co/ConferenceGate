import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patch(pathname, replacements) {
  const file = path.join(root, pathname);
  let source = fs.readFileSync(file, 'utf8');
  for (const { before, after } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`LinkedIn deep-professional patch target missing in ${pathname}: ${before.slice(0, 140)}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source);
}

patch('src/components/LinkedInProfilePanel.tsx', [
  {
    before: `import {\n  fetchLinkedInConferenceActivity,`,
    after: `import type { ConferenceRegistration } from '../api/activity';\nimport {\n  fetchLinkedInConferenceActivity,`,
  },
  {
    before: `interface Props {\n  currentUserId?: string;\n  linkedinUrl?: string;\n}`,
    after: `interface Props {\n  currentUserId?: string;\n  linkedinUrl?: string;\n  registrations?: ConferenceRegistration[];\n}`,
  },
  {
    before: `export const LinkedInProfilePanel: React.FC<Props> = ({ currentUserId, linkedinUrl }) => {`,
    after: `export const LinkedInProfilePanel: React.FC<Props> = ({ currentUserId, linkedinUrl, registrations = [] }) => {`,
  },
  {
    before: `  const importedCommitteeLeadershipCount = importedRoleClaims.filter((item) =>\n    /committee|chair|moderator|panel|reviewer|workshop|instructor/i.test(item.role || '')\n  ).length;`,
    after: `  const importedCommitteeLeadershipCount = importedRoleClaims.filter((item) =>\n    /committee|chair|moderator|panel|reviewer|workshop|instructor/i.test(item.role || '')\n  ).length;\n\n  const normalizeConferenceName = (value) => String(value || '')\n    .toLowerCase()\n    .replace(/&/g, ' and ')\n    .replace(/[^a-z0-9]+/g, ' ')\n    .trim();\n  const linkedinConferenceSignals = (activity?.conferenceActivity || []).filter((item) =>\n    ['PAST_CONFERENCE', 'UPCOMING_CONFERENCE', 'CONFERENCE_ROLE', 'CONFERENCE_MENTION'].includes(item.kind)\n  );\n  const registrationCrossChecks = registrations.map((registration) => {\n    const registrationName = normalizeConferenceName(registration.conferenceTitle);\n    const tokens = registrationName.split(/\\s+/).filter((token) => token.length > 2);\n    const signal = linkedinConferenceSignals.find((candidate) => {\n      const candidateName = normalizeConferenceName(candidate.conferenceName || candidate.label);\n      if (!candidateName) return false;\n      if (candidateName === registrationName || candidateName.includes(registrationName) || registrationName.includes(candidateName)) return true;\n      const candidateTokens = new Set(candidateName.split(/\\s+/));\n      const overlap = tokens.filter((token) => candidateTokens.has(token)).length;\n      return tokens.length >= 3 && overlap >= Math.min(3, tokens.length);\n    });\n    return { registration, signal };\n  });\n  const linkedRegistrationMatches = registrationCrossChecks.filter((item) => item.signal);`,
  },
  {
    before: `      <ProfessionalDeepResearchPanel />`,
    after: `      {(profile?.experience.length || 0) > 0 && (\n        <section className="rounded-2xl border border-slate-200 bg-white p-5">\n          <div className="flex items-center justify-between gap-3 mb-3">\n            <div>\n              <div className="flex items-center gap-2"><Briefcase className="w-4 h-4 text-slate-700" /><h3 className="text-sm font-extrabold text-slate-900">Complete LinkedIn Position History</h3></div>\n              <p className="text-[11px] text-slate-500 mt-1">All positions returned by the consent-based LinkedIn import are retained; ConferenceGate no longer hides roles older than seven years.</p>\n            </div>\n            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-700">{profile!.experience.length} positions</span>\n          </div>\n          <div className="grid md:grid-cols-2 gap-3">\n            {profile!.experience.slice(0, 50).map((item, index) => (\n              <div key={index} className="rounded-xl border border-slate-200 p-3">\n                <div className="text-sm font-semibold text-slate-800">{experienceTitle(item)}</div>\n                <div className="text-xs text-slate-500 mt-0.5">{experienceOrg(item)}</div>\n                {dateText(item) && <div className="text-[11px] text-slate-400 mt-1">{dateText(item)}</div>}\n              </div>\n            ))}\n          </div>\n        </section>\n      )}\n\n      {registrations.length > 0 && (\n        <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5">\n          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">\n            <div>\n              <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-700" /><h3 className="text-sm font-extrabold text-slate-900">LinkedIn ↔ ConferenceGate Registration Cross-check</h3></div>\n              <p className="text-[11px] text-slate-600 mt-1">ConferenceGate registrations are verified platform records. LinkedIn matches are supporting public evidence only and never replace registration or attendance verification.</p>\n            </div>\n            <span className="px-2.5 py-1 rounded-full bg-white border border-blue-200 text-[10px] font-bold text-blue-800">{linkedRegistrationMatches.length}/{registrations.length} matched</span>\n          </div>\n          <div className="space-y-2">\n            {registrationCrossChecks.slice(0, 30).map(({ registration, signal }) => (\n              <div key={registration.conferenceId + ':' + registration.registeredAt} className="rounded-xl border border-blue-100 bg-white p-3 flex items-start justify-between gap-3">\n                <div>\n                  <div className="text-xs font-bold text-slate-900">{registration.conferenceTitle}</div>\n                  <div className="text-[10px] text-slate-500 mt-0.5">ConferenceGate registration · {new Date(registration.registeredAt).toLocaleDateString()}</div>\n                  {signal && <div className="text-[10px] text-blue-700 mt-1">LinkedIn evidence: {signal.role || signal.kind.replaceAll('_', ' ')}{signal.year ? ' · ' + signal.year : ''}</div>}\n                </div>\n                <span className={signal ? 'px-2 py-1 rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800' : 'px-2 py-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600'}>{signal ? 'Cross-matched' : 'Registration only'}</span>\n              </div>\n            ))}\n          </div>\n        </section>\n      )}\n\n      <ProfessionalDeepResearchPanel />`,
  },
  {
    before: `<div className="flex items-center gap-2 mb-3"><Briefcase className="w-4 h-4 text-slate-600" /><h3 className="text-sm font-extrabold text-slate-900">Experience — Past 7 Years</h3></div>\n          <div className="grid md:grid-cols-2 gap-3">\n            {profile!.experience.filter(experienceWithinSevenYears).slice(0, 20).map((item, index) => (`,
    after: `<div className="flex items-center gap-2 mb-3"><Briefcase className="w-4 h-4 text-slate-600" /><h3 className="text-sm font-extrabold text-slate-900">Professional Positions — Full Imported History</h3></div>\n          <div className="grid md:grid-cols-2 gap-3">\n            {profile!.experience.slice(0, 50).map((item, index) => (`,
  },
]);

patch('src/components/UserProfileView.tsx', [
  {
    before: `<LinkedInProfilePanel currentUserId={currentUserId} linkedinUrl={userProfile.linkedinUrl} />`,
    after: `<LinkedInProfilePanel currentUserId={currentUserId} linkedinUrl={userProfile.linkedinUrl} registrations={registrations} />`,
  },
]);

console.log('LinkedIn deep Professional cross-check patch applied.');
