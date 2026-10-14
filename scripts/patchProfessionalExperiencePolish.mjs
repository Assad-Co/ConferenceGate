import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patch(pathname, replacements) {
  const file = path.join(root, pathname);
  let source = fs.readFileSync(file, 'utf8');
  // The newer save-only Discover UX intentionally rewrites the earlier saved/followed card block.
  // Once that state exists, the older Professional-polish Discovery mutations are already superseded.
  if (pathname === 'src/components/DiscoveryEngineAdvanced.tsx' && source.includes('Remove from saved conferences')) {
    fs.writeFileSync(file, source);
    return;
  }
  for (const replacement of replacements) {
    const { before, after, regex, marker } = replacement;
    if (marker && source.includes(marker)) continue;
    if (!marker && typeof after === 'string' && source.includes(after)) continue;
    if (regex) {
      if (!regex.test(source)) throw new Error(`Professional polish regex target missing in ${pathname}: ${regex}`);
      source = source.replace(regex, after);
    } else {
      if (!source.includes(before)) throw new Error(`Professional polish target missing in ${pathname}: ${String(before).slice(0, 120)}`);
      source = source.replace(before, after);
    }
  }
  fs.writeFileSync(file, source);
}

patch('src/components/HomeLanding.tsx', [
  {
    before: `  const quickLinks = [\n    { label: 'Discover Conferences', icon: Layers, tab: 'discover' },\n    { label: 'My Abstracts', icon: FileText, tab: 'abstracts' },\n    { label: 'Reviewer Portal', icon: Award, tab: 'reviewer' },\n    { label: 'Certificates', icon: BadgeCheck, tab: 'certificates' },\n  ];`,
    after: `  const quickLinks = [\n    { label: 'Discover', icon: Layers, tab: 'discover' },\n    { label: 'My Conferences', icon: Calendar, tab: 'my-conferences' },\n    { label: 'My Abstracts', icon: FileText, tab: 'abstracts' },\n    { label: 'Opportunities', icon: Award, tab: 'reviewer' },\n  ];`,
  },
]);

patch('src/api/auth.ts', [
  {
    before: `export interface ProfessionalPreferencesPayload {\n  professionalExpertise: string[];`,
    after: `export interface ProfessionalPreferencesPayload {\n  reviewerAvailable: boolean;\n  professionalExpertise: string[];`,
  },
  {
    regex: /export async function updateProfessionalPreferences\(payload: ProfessionalPreferencesPayload\): Promise<AuthUser> \{[\s\S]*?\n\}/,
    marker: 'const { reviewerAvailable, ...matchingProfile } = payload;',
    after: `export async function updateProfessionalPreferences(payload: ProfessionalPreferencesPayload): Promise<AuthUser> {\n  const { reviewerAvailable, ...matchingProfile } = payload;\n  const res = await fetch('/api/auth/me/professional-preferences', {\n    method: 'PATCH',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify(matchingProfile),\n  });\n  await parseResponse(res);\n\n  const availabilityRes = await fetch('/api/auth/me/reviewer-availability', {\n    method: 'PATCH',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify({ available: reviewerAvailable }),\n  });\n  const data = await parseResponse(availabilityRes);\n  return data.user;\n}`,
  },
]);

patch('src/components/ProfessionalPreferencesModal.tsx', [
  {
    before: `  const [committeeAvailable, setCommitteeAvailable] = useState(initial.committeeAvailable);`,
    after: `  const [reviewerAvailable, setReviewerAvailable] = useState(initial.reviewerAvailable);\n  const [committeeAvailable, setCommitteeAvailable] = useState(initial.committeeAvailable);`,
  },
  {
    before: `    setCommitteeAvailable(initial.committeeAvailable);`,
    after: `    setReviewerAvailable(initial.reviewerAvailable);\n    setCommitteeAvailable(initial.committeeAvailable);`,
  },
  {
    before: `      await onSave({\n        professionalExpertise: splitList(expertise),`,
    after: `      await onSave({\n        reviewerAvailable,\n        professionalExpertise: splitList(expertise),`,
  },
  {
    before: `<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">\n            {[\n              {\n                label: 'Technical Committee',`,
    after: `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">\n            {[\n              {\n                label: 'Reviewer',\n                note: 'Open to abstract review invitations',\n                value: reviewerAvailable,\n                set: setReviewerAvailable,\n                icon: Briefcase,\n              },\n              {\n                label: 'Technical Committee',`,
  },
]);

patch('src/components/UserProfileView.tsx', [
  {
    before: `            researchInterests: userProfile.researchInterests || [],\n            preferredRegions: userProfile.preferredRegions || [],\n            committeeAvailable: Boolean(userProfile.committeeAvailable),`,
    after: `            researchInterests: userProfile.researchInterests || [],\n            preferredRegions: userProfile.preferredRegions || [],\n            reviewerAvailable: Boolean(userProfile.reviewerInfo.available),\n            committeeAvailable: Boolean(userProfile.committeeAvailable),`,
  },
  {
    before: `  const opportunityProfileGaps = [\n    (userProfile.expertise || []).length >= 3 ? null : 'Add 3+ expertise terms',\n    (userProfile.technicalSpecialization || []).length > 0 ? null : 'Add specialization',\n    (userProfile.researchInterests || []).length > 0 ? null : 'Add research interests',\n    (userProfile.preferredRegions || []).length > 0 ? null : 'Choose preferred regions',\n    opportunityAvailabilityEnabled ? null : 'Enable at least one role',\n  ].filter((item): item is string => Boolean(item));`,
    after: `  const opportunityProfileGaps = [\n    (userProfile.expertise || []).length >= 3 ? null : 'Add 3+ expertise terms',\n    (userProfile.technicalSpecialization || []).length > 0 ? null : 'Add specialization',\n    (userProfile.researchInterests || []).length > 0 ? null : 'Add research interests',\n    (userProfile.preferredRegions || []).length > 0 ? null : 'Choose preferred regions',\n    opportunityAvailabilityEnabled ? null : 'Enable at least one role',\n  ].filter((item): item is string => Boolean(item));\n\n  const profileCompletenessActions = [\n    { key: 'photo', done: effectiveHasCustomAvatar, label: 'Add professional photo', action: () => avatarInputRef.current?.click() },\n    { key: 'basics', done: Boolean(userProfile.title && userProfile.organization), label: 'Complete role & organization', action: () => setIsEditProfileOpen(true) },\n    { key: 'expertise', done: (userProfile.expertise || []).length > 0, label: 'Add expertise', action: () => setIsProfessionalPreferencesOpen(true) },\n    { key: 'linkedin', done: Boolean(userProfile.linkedinUrl), label: 'Import LinkedIn', action: () => setIsEditProfileOpen(true) },\n    { key: 'publications', done: (userProfile.publications || []).length > 0 || linkedInPublicationCount > 0 || externalConfirmed.length > 0, label: 'Add publications', action: () => setActiveTab('papers') },\n    { key: 'availability', done: opportunityAvailabilityEnabled, label: 'Set availability', action: () => setIsProfessionalPreferencesOpen(true) },\n  ];\n  const profileCompletenessGaps = profileCompletenessActions.filter((item) => !item.done);`,
  },
  {
    before: `        {variant === 'professional' && (\n          <div className="px-6 sm:px-8 py-5 border-t border-slate-200 bg-white">\n            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">\n              <div>\n                <h3 className="text-sm font-extrabold text-slate-900">Opportunity Matching Profile</h3>`,
    after: `        {variant === 'professional' && (\n          <div className="px-6 sm:px-8 py-5 border-t border-slate-200 bg-slate-50/70">\n            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">\n              <div className="flex-1">\n                <div className="flex items-center justify-between gap-3">\n                  <div>\n                    <h3 className="text-sm font-extrabold text-slate-900">Profile Completeness</h3>\n                    <p className="text-[11px] text-slate-500 mt-0.5">A stronger profile improves conference recommendations and organizer matching.</p>\n                  </div>\n                  <span className="text-lg font-extrabold text-blue-700">{profileCompleteness}%</span>\n                </div>\n                <div className="mt-3 h-2.5 rounded-full bg-white border border-slate-200 overflow-hidden">\n                  <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: \`${'${profileCompleteness}'}%\` }} />\n                </div>\n                {profileCompletenessGaps.length > 0 ? (\n                  <div className="mt-3 flex flex-wrap gap-2">\n                    {profileCompletenessGaps.map((item) => (\n                      <button key={item.key} type="button" onClick={item.action} className="px-3 py-1.5 rounded-full border border-blue-200 bg-white text-[10px] font-bold text-blue-700 hover:bg-blue-50 cursor-pointer">\n                        + {item.label}\n                      </button>\n                    ))}\n                  </div>\n                ) : (\n                  <div className="mt-3 text-[11px] font-bold text-emerald-700">Profile complete — your Professional profile is ready for discovery and matching.</div>\n                )}\n              </div>\n            </div>\n          </div>\n        )}\n\n        {variant === 'professional' && (\n          <div className="px-6 sm:px-8 py-5 border-t border-slate-200 bg-white">\n            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">\n              <div>\n                <h3 className="text-sm font-extrabold text-slate-900">Opportunity Matching Profile</h3>`,
  },
]);

patch('src/components/DiscoveryEngineAdvanced.tsx', [
  {
    before: `            {displayedStored.map((result) => {\n              const date = dateLine(result.startDate, result.endDate);`,
    after: `            {displayedStored.map((result) => {\n              const saved = savedConferenceIds.includes(result.link);\n              const followed = followedConferenceIds.includes(result.link);\n              const date = dateLine(result.startDate, result.endDate);`,
  },
  {
    before: `                      <div className="flex flex-wrap gap-1.5">\n                        {result.cfpOpen && <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>}`,
    after: `                      <div className="flex flex-wrap items-center gap-1.5">\n                        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleSave?.(result.link); }} className={saved ? 'p-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200' : 'p-1.5 rounded-lg bg-slate-50 text-slate-400 border border-slate-200'} title={saved ? 'Remove from saved' : 'Save conference'}>\n                          <Bookmark className={\`w-3.5 h-3.5 ${'${saved ? \'fill-current\' : \'\'}'}\`} />\n                        </button>\n                        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleFollow?.(result.link); }} className={followed ? 'px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold' : 'px-2.5 py-1 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-[10px] font-bold'}>\n                          {followed ? 'Following' : '+ Follow'}\n                        </button>\n                        {result.cfpOpen && <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>}`,
  },
]);

patch('src/App.tsx', [
  {
    before: `            currentUserEmail={authUser?.email}\n            onSelectConference={handleSelectConference}\n          />`,
    after: `            currentUserEmail={authUser?.email}\n            onSelectConference={handleSelectConference}\n            onOpenExternalResult={handleOpenExternalResult}\n          />`,
  },
]);

console.log('Professional experience polish patch applied.');
