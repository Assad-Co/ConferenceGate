from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one exact match, found {count}")
    p.write_text(text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex match, found {count}")
    p.write_text(next_text)


# 1) Remove the visible AI assistant/chat entry point from the navigation.
replace_once("src/components/LegacyNavbar.tsx", "  Sparkles,\n", "")
replace_once(
    "src/components/LegacyNavbar.tsx",
    "  onOpenAIAssistant,\n  onOpenAIModal,\n",
    "",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    "  const handleOpenAI = onOpenAIAssistant || onOpenAIModal || (() => {});\n",
    "",
)
regex_once(
    "src/components/LegacyNavbar.tsx",
    r'''\n\s*\{\/\* AI Assistant Button \*\/\}\n\s*<button\n\s*onClick=\{handleOpenAI\}[\s\S]*?<\/button>\n''',
    "\n",
)

# Remove modal wiring entirely from App so the chat is not merely hidden.
replace_once(
    "src/App.tsx",
    "import { AIAssistantModal, type AssistantConferenceTab } from './components/AIAssistantModal';\n",
    "",
)
replace_once("src/App.tsx", "  const [isAIModalOpen, setIsAIModalOpen] = useState(false);\n", "")
replace_once("src/App.tsx", "        onOpenAIModal={() => setIsAIModalOpen(true)}\n", "")
replace_once("src/App.tsx", "        onOpenAIAssistant={() => setIsAIModalOpen(true)}\n", "")
regex_once(
    "src/App.tsx",
    r'''\n\s*<AIAssistantModal\n[\s\S]*?\n\s*\/>\n\n\s*<AbstractSubmissionModal''',
    "\n\n      <AbstractSubmissionModal",
)

# 2) Evidence/provenance language in the footer, with no AI-chat link.
replace_once(
    "src/components/Footer.tsx",
    "export const Footer: React.FC<FooterProps> = ({ onNavigateTab, onOpenAIAssistant, onOpenBadge, role }) => {",
    "export const Footer: React.FC<FooterProps> = ({ onNavigateTab, onOpenBadge, role }) => {",
)
replace_once(
    "src/components/Footer.tsx",
    "              LinkedIn builds your general professional identity. Conference Gate records your conference activity, roles, reviews, and organizer-confirmed professional achievements.\n",
    "              ConferenceGate builds a conference-specific professional record from presentations, peer reviews, completed roles, certificates, and organizer-confirmed activity. Imported and self-reported evidence stays clearly labeled.\n",
)
replace_once(
    "src/components/Footer.tsx",
    "              <span>ConferenceGate Index · Verified Professional Records</span>\n",
    "              <span>Verified Conference Record · Source-labeled evidence</span>\n",
)
replace_once(
    "src/components/Footer.tsx",
    "                <li><button onClick={() => onNavigateTab('certificates')} className=\"hover:text-blue-600 transition-colors cursor-pointer text-left\">ConferenceGate Index & Digital Credentials</button></li>\n",
    "                <li><button onClick={() => onNavigateTab('certificates')} className=\"hover:text-blue-600 transition-colors cursor-pointer text-left\">Verified Record & Digital Credentials</button></li>\n",
)
replace_once(
    "src/components/Footer.tsx",
    "                <li><button onClick={() => onNavigateTab('organizer')} className=\"hover:text-blue-600 transition-colors cursor-pointer text-left\">AI Reviewer & Committee Matcher</button></li>\n",
    "                <li><button onClick={() => onNavigateTab('organizer')} className=\"hover:text-blue-600 transition-colors cursor-pointer text-left\">Reviewer & Committee Matching</button></li>\n",
)
replace_once(
    "src/components/Footer.tsx",
    "                <li><button onClick={onOpenAIAssistant} className=\"hover:text-blue-600 transition-colors cursor-pointer text-left\">Conference Gate AI Assistant</button></li>\n",
    "",
)

# 3) Replace the visible ConferenceGate score card with direct attributable evidence.
replace_once(
    "src/components/ConferenceGateIndexCard.tsx",
    "import { Award, ShieldCheck } from 'lucide-react';",
    "import { ShieldCheck } from 'lucide-react';",
)
regex_once(
    "src/components/ConferenceGateIndexCard.tsx",
    r'''  return \(\n    <div className="p-5 rounded-2xl border border-blue-200 bg-white space-y-3">[\s\S]*?\n    <\/div>\n  \);''',
    '''  const verifiedEvidenceCount =
    trust.evidence.organizerEvaluations + trust.evidence.verifiedReviews + trust.evidence.completedRoles;
  return (
    <div className="p-5 rounded-2xl border border-blue-200 bg-white space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-700" /><h4 className="text-sm font-bold text-slate-900">Verified Conference Record</h4></div>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">Evidence-backed ConferenceGate activity is shown directly instead of being compressed into an arbitrary reputation score. Imported credentials remain source-labeled and are not silently upgraded to verified activity.</p>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2 text-right">
          <div className="text-2xl font-extrabold text-emerald-800">{verifiedEvidenceCount}</div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">verified records</div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.organizerEvaluations}</b><br/>Organizer evaluations</div>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.verifiedReviews}</b><br/>Verified peer reviews</div>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.completedRoles}</b><br/>Organizer-confirmed roles</div>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.certificationCount}</b><br/>Imported credentials</div>
      </div>
      <div className={`text-xs font-bold flex items-center gap-2 ${trust.reviewerEligible ? 'text-emerald-700' : 'text-amber-700'}`}><ShieldCheck className="w-4 h-4" />{trust.eligibilityReason}</div>
    </div>
  );''',
)

# 4) Deep Research wording: independent public evidence and clear provenance.
replace_once(
    "src/components/ProfessionalDeepResearchPanel.tsx",
    "            LinkedIn anchors your identity; ConferenceGate then cross-checks public scholarly indexes, official conference/society pages and public professional sources. Private LinkedIn data is never accessed, and uncertain same-name matches stay separate from verified reputation.\n",
    "            LinkedIn anchors identity. ConferenceGate cross-checks Crossref, OpenAlex, Semantic Scholar, DBLP, official conference/society pages and other public professional sources. Independent-source agreement strengthens a record; same-name matches remain candidates until the evidence is strong enough.\n",
)
replace_once(
    "src/components/ProfessionalDeepResearchPanel.tsx",
    "            <span>•</span><span>Possible matches do not affect your ConferenceGate Index</span>\n",
    "            <span>•</span><span>Possible matches never become verified records without stronger evidence</span>\n",
)

# 5) Profile header: direct verified activity instead of 0/1000 and +kudos.
regex_once(
    "src/components/UserProfileView.tsx",
    r'''  const conferenceGateIndex = Math\.min\(\n    1000,\n    userProfile\.contributions\.reviewerKudos \+\n      userProfile\.contributions\.abstractsAccepted \* 15 \+\n      userProfile\.contributions\.technicalCommittees \* 25 \+\n      userProfile\.contributions\.sessionsChaired \* 20 \+\n      userProfile\.contributions\.speakerRoles \* 20\n  \);''',
    '''  const verifiedSpeakerCount = keynoteSpeakerMatches.filter((match) => match.verified).length;
  const verifiedProfessionalRoleCount = verifiedRoleCount + verifiedSpeakerCount;
  const verifiedConferenceActivityCount =
    userProfile.contributions.abstractsAccepted + verifiedReviewCount + verifiedProfessionalRoleCount;

  const opportunityAvailabilityEnabled = Boolean(
    userProfile.reviewerInfo.available ||
    userProfile.committeeAvailable ||
    userProfile.sessionChairAvailable ||
    userProfile.speakerAvailable
  );
  const opportunityReadinessChecks = [
    (userProfile.expertise || []).length >= 3,
    (userProfile.technicalSpecialization || []).length > 0,
    (userProfile.researchInterests || []).length > 0,
    (userProfile.preferredRegions || []).length > 0,
    opportunityAvailabilityEnabled,
  ];
  const opportunityReadiness = Math.round(
    (opportunityReadinessChecks.filter(Boolean).length / opportunityReadinessChecks.length) * 100
  );
  const opportunityProfileGaps = [
    (userProfile.expertise || []).length >= 3 ? null : 'Add 3+ expertise terms',
    (userProfile.technicalSpecialization || []).length > 0 ? null : 'Add specialization',
    (userProfile.researchInterests || []).length > 0 ? null : 'Add research interests',
    (userProfile.preferredRegions || []).length > 0 ? null : 'Choose preferred regions',
    opportunityAvailabilityEnabled ? null : 'Enable at least one role',
  ].filter((item): item is string => Boolean(item));''',
)

regex_once(
    "src/components/UserProfileView.tsx",
    r'''        \{\/\* Verified Conference Reputation Stats Grid — professional\/reviewer achievements only \*\/\}\n        \{variant === 'professional' && \(\n        <div className="px-6 sm:px-8 py-6 bg-slate-50 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4">[\s\S]*?\n        <\/div>\n        \)\}\n''',
    '''        {/* Evidence-first professional record — direct counts, no arbitrary headline score. */}
        {variant === 'professional' && (
        <div className="px-6 sm:px-8 py-6 bg-slate-50 border-t border-slate-200">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-extrabold text-slate-900">Verified Conference Record</div>
              <div className="text-[10px] text-slate-500">ConferenceGate-confirmed activity is counted separately from imported and self-reported evidence.</div>
            </div>
            <div className="text-[10px] font-semibold text-emerald-700">Evidence first · source labeled</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Verified Conference Activity</div>
              <div className="text-xl font-extrabold text-blue-700">{verifiedConferenceActivityCount}</div>
              <div className="mt-1 text-[9px] text-slate-400">accepted abstracts · reviews · completed roles</div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Verified Peer Reviews</div>
              <div className="text-xl font-extrabold text-blue-600">{verifiedReviewCount}</div>
              <div className="mt-1 text-[9px] text-slate-400">completed inside ConferenceGate</div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Research Outputs</div>
              <div className="text-xl font-extrabold text-slate-900">
                {paperPublicationCount} {paperPublicationCount === 1 ? 'Work' : 'Works'}
              </div>
              <div className="mt-1 text-[9px] text-slate-400">profile-linked and confirmed sources</div>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Verified Professional Roles</div>
              <div className="text-xl font-extrabold text-indigo-700">{verifiedProfessionalRoleCount}</div>
              <div className="mt-1 text-[9px] text-slate-400">organizer-confirmed or verified speaker evidence</div>
            </div>
          </div>
        </div>
        )}
''',
)

# 6) Make opportunity matching practical and actionable.
replace_once(
    "src/components/UserProfileView.tsx",
    '<h3 className="text-sm font-extrabold text-slate-900">Professional Opportunity Profile</h3>',
    '<h3 className="text-sm font-extrabold text-slate-900">Opportunity Matching Profile</h3>',
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                  Your expertise and availability for reviewer, committee, chair, and speaker matching.\n",
    "                  Controls how organizers can find you for reviewer, committee, chair, and speaker opportunities.\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                    <span>Profile completeness</span>\n                    <span>{profileCompleteness}%</span>\n",
    "                    <span>Matching readiness</span>\n                    <span>{opportunityReadiness}%</span>\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                    <div className=\"h-full bg-blue-600 rounded-full transition-all\" style={{ width: `${profileCompleteness}%` }} />\n",
    "                    <div className=\"h-full bg-blue-600 rounded-full transition-all\" style={{ width: `${opportunityReadiness}%` }} />\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                  Reviewer {userProfile.reviewerInfo.available ? 'Available' : 'Off'}\n",
    "                  Reviewer: {userProfile.reviewerInfo.available ? 'Open' : 'Not available'}\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                  Committee {userProfile.committeeAvailable ? 'Available' : 'Off'}\n",
    "                  Committee: {userProfile.committeeAvailable ? 'Open' : 'Not available'}\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                  Session Chair {userProfile.sessionChairAvailable ? 'Available' : 'Off'}\n",
    "                  Session Chair: {userProfile.sessionChairAvailable ? 'Open' : 'Not available'}\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "                  Speaker {userProfile.speakerAvailable ? 'Available' : 'Off'}\n",
    "                  Speaker: {userProfile.speakerAvailable ? 'Open' : 'Not available'}\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    '''              </div>
            </div>
            {(userProfile.expertise.length > 0 || userProfile.technicalSpecialization.length > 0 || (userProfile.preferredRegions?.length || 0) > 0) && (
''',
    '''              </div>
            </div>
            {opportunityProfileGaps.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-500 mr-1">Improve matching:</span>
                {opportunityProfileGaps.slice(0, 5).map((gap) => (
                  <button
                    key={gap}
                    type="button"
                    onClick={() => setIsProfessionalPreferencesOpen(true)}
                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
                  >
                    {gap}
                  </button>
                ))}
              </div>
            )}
            {(userProfile.expertise.length > 0 || userProfile.technicalSpecialization.length > 0 || (userProfile.preferredRegions?.length || 0) > 0) && (
''',
)

print("Phase 46 guarded source transformation completed.")
