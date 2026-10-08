from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


def regex_once(path: str, pattern: str, repl: str) -> None:
    p = Path(path)
    text = p.read_text()
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one regex match, found {count}: {pattern[:120]!r}")
    p.write_text(updated)


# -----------------------------------------------------------------------------
# LinkedIn conference activity: every member uses the same per-account pipeline.
# Scan much more of the available public post history and capture multiple roles
# from one post while keeping every imported item source-labelled, never verified.
# -----------------------------------------------------------------------------
replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    'const MAX_POSTS = 400;\nconst LOOKBACK_YEARS = 7;\n',
    'const MAX_POSTS = 1000;\n',
)

regex_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    r'function postWithinSevenYears\(post: Record<string, any>\): boolean \{.*?\n\}\n\nfunction postUrl',
    '''function postWithinAvailableHistory(_post: Record<string, any>): boolean {\n  // The provider is already asked for the member's available public post history.\n  // Do not discard older professional conference evidence with an arbitrary year cutoff.\n  return true;\n}\n\nfunction postUrl''',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '''function detectRole(value: string): string | null {\n  const roles: Array<[RegExp, string]> = [\n    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker"],\n    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker"],\n    [/\\binvited speaker\\b/i, "Invited Speaker"],\n    [/\\b(?:session|track|program|programme|scientific) chair\\b/i, "Chair"],\n    [/\\bmoderator\\b/i, "Moderator"],\n    [/\\bpanelist\\b|\\bpanellist\\b/i, "Panelist"],\n    [/\\bcommittee member\\b|\\btechnical committee\\b|\\bscientific committee\\b|\\bprogram committee\\b/i, "Committee Member"],\n    [/\\b(?:oral )?presenter\\b|\\bpresenting\\b|\\bpresentation\\b/i, "Presenter"],\n    [/\\bspeaker\\b|\\bspeaking\\b/i, "Speaker"],\n    [/\\bposter\\b/i, "Poster Presenter"],\n  ];\n  for (const [re, label] of roles) if (re.test(value)) return label;\n  return null;\n}\n''',
    '''function detectRoles(value: string): string[] {\n  const patterns: Array<[RegExp, string]> = [\n    [/\\btechnical program(?:me)? committee co[- ]?chair\\b/i, "Technical Program Committee Co-Chair"],\n    [/\\btechnical program(?:me)? committee chair\\b/i, "Technical Program Committee Chair"],\n    [/\\b(?:program|programme) committee co[- ]?chair\\b/i, "Program Committee Co-Chair"],\n    [/\\b(?:program|programme) committee chair\\b/i, "Program Committee Chair"],\n    [/\\bscientific committee co[- ]?chair\\b/i, "Scientific Committee Co-Chair"],\n    [/\\bscientific committee chair\\b/i, "Scientific Committee Chair"],\n    [/\\borganizing committee co[- ]?chair\\b|\\borganising committee co[- ]?chair\\b/i, "Organizing Committee Co-Chair"],\n    [/\\borganizing committee chair\\b|\\borganising committee chair\\b/i, "Organizing Committee Chair"],\n    [/\\bsession co[- ]?chair\\b/i, "Session Co-Chair"],\n    [/\\bsession chair\\b/i, "Session Chair"],\n    [/\\btrack co[- ]?chair\\b/i, "Track Co-Chair"],\n    [/\\btrack chair\\b/i, "Track Chair"],\n    [/\\bconference co[- ]?chair\\b/i, "Conference Co-Chair"],\n    [/\\bkeynote(?: speaker)?\\b/i, "Keynote Speaker"],\n    [/\\bplenary(?: speaker)?\\b/i, "Plenary Speaker"],\n    [/\\binvited speaker\\b/i, "Invited Speaker"],\n    [/\\bcore presenter\\b/i, "Core Presenter"],\n    [/\\boral presenter\\b|\\boral presentation\\b/i, "Oral Presenter"],\n    [/\\bposter presenter\\b|\\bposter presentation\\b/i, "Poster Presenter"],\n    [/\\bworkshop (?:instructor|facilitator|leader|chair)\\b/i, "Workshop Instructor"],\n    [/\\b(?:course|short course) instructor\\b/i, "Course Instructor"],\n    [/\\bmoderator\\b/i, "Moderator"],\n    [/\\bpanel chair\\b/i, "Panel Chair"],\n    [/\\bpanelist\\b|\\bpanellist\\b|\\bpanel participant\\b/i, "Panelist"],\n    [/\\b(?:abstract|paper|technical)?\\s*reviewer\\b/i, "Reviewer"],\n    [/\\badvisory board(?: member)?\\b|\\badvisory committee(?: member)?\\b/i, "Advisory Committee Member"],\n    [/\\bsteering committee(?: member)?\\b/i, "Steering Committee Member"],\n    [/\\borganizing committee(?: member)?\\b|\\borganising committee(?: member)?\\b/i, "Organizing Committee Member"],\n    [/\\bscientific committee(?: member)?\\b/i, "Scientific Committee Member"],\n    [/\\btechnical program(?:me)? committee(?: member)?\\b/i, "Technical Program Committee Member"],\n    [/\\bprogram(?:me)? committee(?: member)?\\b/i, "Program Committee Member"],\n    [/\\btechnical committee(?: member)?\\b|\\bcommittee member\\b/i, "Committee Member"],\n    [/\\b(?:oral )?presenter\\b|\\bpresenting\\b/i, "Presenter"],\n    [/\\bspeaker\\b|\\bspeaking\\b/i, "Speaker"],\n  ];\n  const matches: string[] = [];\n  for (const [pattern, label] of patterns) {\n    if (pattern.test(value) && !matches.includes(label)) matches.push(label);\n  }\n  return matches;\n}\n''',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '''function explicitSelfClaim(value: string): boolean {\n  return /\\b(i\\s+(?:am|was|will|shall|have|had|presented|spoke|attended|participated|chaired|moderated|served|joined)|i['’]m|i['’]ll|my\\s+(?:talk|presentation|poster|paper|abstract|session)|honou?red to|pleased to|delighted to|excited to)\\b/i.test(\n    value,\n  );\n}\n''',
    '''function explicitSelfClaim(value: string): boolean {\n  return /\\b(i\\s+(?:am|was|will|shall|have|had|presented|spoke|attended|participated|chaired|co[- ]?chaired|moderated|served|serve|joined|reviewed|facilitated|led|instructed)|i['’]m|i['’]ll|my\\s+(?:talk|presentation|poster|paper|abstract|session|role)|honou?red to|pleased to|delighted to|excited to|proud to|appointed as|selected as|invited as|serving as|serve as|member of)\\b/i.test(\n    value,\n  );\n}\n''',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '    if (!postWithinSevenYears(post)) return;\n',
    '    if (!postWithinAvailableHistory(post)) return;\n',
)
replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '    const role = detectRole(content);\n',
    '    const roles = detectRoles(content);\n    const role = roles[0] || null;\n',
)
replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '    if (year && year < nowYear - LOOKBACK_YEARS) return;\n',
    '',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '''    conferenceActivity.push({\n      id,\n      kind,\n      label,\n      role: memberClaimed ? role : null,\n      year,\n      sourceUrl,\n      evidenceText: label,\n      confidence,\n      memberClaimed,\n      repostOrQuote,\n      verified: false,\n    });\n''',
    '''    const baseSignal = {\n      kind,\n      label,\n      conferenceName: hasEvent ? label : null,\n      year,\n      sourceUrl,\n      evidenceText: label,\n      confidence,\n      memberClaimed,\n      repostOrQuote,\n      verified: false as const,\n    };\n\n    if (kind === "CONFERENCE_ROLE" && memberClaimed && roles.length > 0) {\n      roles.forEach((detectedRole, roleIndex) => {\n        conferenceActivity.push({\n          id: `${id}:role:${roleIndex}`,\n          ...baseSignal,\n          role: detectedRole,\n        });\n      });\n    } else {\n      conferenceActivity.push({\n        id,\n        ...baseSignal,\n        role: memberClaimed ? role : null,\n      });\n    }\n''',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '''    conferenceActivity: dedupe(conferenceActivity).slice(0, 400),\n    callsForPapers: dedupe(callsForPapers).slice(0, 250),\n''',
    '''    conferenceActivity: dedupe(conferenceActivity).slice(0, 1000),\n    callsForPapers: dedupe(callsForPapers).slice(0, 500),\n''',
)

regex_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    r'\nconst REGISTERED_LINKEDIN_ROLE_EVIDENCE = \[.*?\nasync function readStored',
    '\nasync function readStored',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '''  const { dbGet } = await import("./db");\n  const user = await dbGet<{ linkedin_url: string | null }>(\n    "SELECT linkedin_url FROM users WHERE id = ?",\n    [userId],\n  );\n  const stored = await readStored(userId);\n  const activity = mergeRegisteredLinkedInRoleEvidence(\n    stored,\n    stored?.linkedinUrl || user?.linkedin_url || null,\n  );\n''',
    '''  const activity = await readStored(userId);\n''',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '    endpoint.searchParams.set("maxTotalChargeUsd", "1.20");\n',
    '    endpoint.searchParams.set("maxTotalChargeUsd", "3.00");\n',
)

replace_once(
    "server/linkedinConferenceActivityBootstrap.ts",
    '''      conferenceActivity: conferenceActivity.length,\n      callsForPapers: callsForPapers.length,\n      explicitMemberClaims: conferenceActivity.filter((item) => item.memberClaimed).length,\n''',
    '''      conferenceActivity: conferenceActivity.length,\n      callsForPapers: callsForPapers.length,\n      explicitMemberClaims: conferenceActivity.filter((item) => item.memberClaimed).length,\n      conferenceRoles: conferenceActivity.filter((item) => item.kind === "CONFERENCE_ROLE" && item.memberClaimed).length,\n      committeeLeadershipRoles: conferenceActivity.filter((item) =>\n        item.kind === "CONFERENCE_ROLE" &&\n        item.memberClaimed &&\n        /committee|chair|moderator|panel|reviewer|workshop|instructor/i.test(item.role || "")\n      ).length,\n      pastConferenceClaims: conferenceActivity.filter((item) => item.kind === "PAST_CONFERENCE" && item.memberClaimed).length,\n''',
)

# Client API contract for the richer per-member import result.
replace_once(
    "src/api/linkedinConferenceActivity.ts",
    '''    callsForPapers: number;\n    explicitMemberClaims: number;\n''',
    '''    callsForPapers: number;\n    explicitMemberClaims: number;\n    conferenceRoles: number;\n    committeeLeadershipRoles: number;\n    pastConferenceClaims: number;\n''',
)

# LinkedIn profile UX: describe the expanded import honestly and emphasize roles.
replace_once(
    "src/components/LinkedInProfilePanel.tsx",
    '''  const explicitClaims = (activity?.conferenceActivity || []).filter((item) => item.memberClaimed && !item.repostOrQuote);\n  const otherConferenceSignals = (activity?.conferenceActivity || []).filter((item) => !item.memberClaimed || item.repostOrQuote);\n''',
    '''  const explicitClaims = (activity?.conferenceActivity || []).filter((item) => item.memberClaimed && !item.repostOrQuote);\n  const otherConferenceSignals = (activity?.conferenceActivity || []).filter((item) => !item.memberClaimed || item.repostOrQuote);\n  const importedRoleClaims = explicitClaims.filter((item) => item.kind === 'CONFERENCE_ROLE' && Boolean(item.role));\n  const importedCommitteeLeadershipCount = importedRoleClaims.filter((item) =>\n    /committee|chair|moderator|panel|reviewer|workshop|instructor/i.test(item.role || '')\n  ).length;\n''',
)
replace_once(
    "src/components/LinkedInProfilePanel.tsx",
    "Public LinkedIn data only. ConferenceGate searches the member's public profile plus up to 400 public posts across the past 7 years for conference attendance/roles, positions and paper evidence. Explicit first-person posts remain member claims until independently verified.",
    "Public LinkedIn data only. ConferenceGate imports the signed-in member's own public profile plus up to 1,000 currently available public posts, with no seven-year cutoff, to recover conference attendance, committee/chair/reviewer roles, speaking activity and paper evidence. Imported first-person evidence stays source-labelled until independently verified.",
)
replace_once(
    "src/components/LinkedInProfilePanel.tsx",
    '          Refresh LinkedIn\n',
    '          Import / Refresh LinkedIn Activity\n',
)
replace_once(
    "src/components/LinkedInProfilePanel.tsx",
    '''        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">\n          <div className="text-[10px] uppercase font-bold text-slate-400">Conference claims</div>\n          <div className="text-2xl font-extrabold text-slate-900 mt-1">{explicitClaims.length}</div>\n        </div>\n        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">\n          <div className="text-[10px] uppercase font-bold text-slate-400">Calls & opportunities</div>\n          <div className="text-2xl font-extrabold text-slate-900 mt-1">{activity?.callsForPapers.length || 0}</div>\n        </div>\n''',
    '''        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">\n          <div className="text-[10px] uppercase font-bold text-slate-400">Conference Activity</div>\n          <div className="text-2xl font-extrabold text-slate-900 mt-1">{explicitClaims.length}</div>\n          <div className="text-[9px] text-slate-400 mt-1">Member-linked LinkedIn evidence</div>\n        </div>\n        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">\n          <div className="text-[10px] uppercase font-bold text-slate-400">Committee & Leadership</div>\n          <div className="text-2xl font-extrabold text-slate-900 mt-1">{importedCommitteeLeadershipCount}</div>\n          <div className="text-[9px] text-slate-400 mt-1">Committee, chair, moderator, reviewer & related roles</div>\n        </div>\n''',
)

replace_once(
    "src/components/LinkedInImportedTabSections.tsx",
    "Attendance, participation and conference roles found by the consent-based scan of the member's own public LinkedIn evidence across the past 7 years. These remain evidence-backed member claims until independently verified.",
    "Attendance, participation and conference roles found by the consent-based scan of the signed-in member's available public LinkedIn evidence. ConferenceGate imports these per account and keeps them source-labelled until independently verified.",
)
replace_once(
    "src/components/LinkedInImportedTabSections.tsx",
    "Publications from the public LinkedIn profile plus paper/abstract evidence found in the member's public posts across the past 7 years.",
    "Publications from the public LinkedIn profile plus paper/abstract evidence found across the member's currently available public LinkedIn history.",
)

# Footer slogan selected by the user.
replace_once(
    "src/components/Footer.tsx",
    '<p>© {new Date().getFullYear()} Conference Gate. The Global Gateway to Conferences. All rights reserved.</p>',
    '<p>© {new Date().getFullYear()} Conference Gate — Your Gateway to Conferences, Connections & Opportunity. All rights reserved.</p>',
)

# -----------------------------------------------------------------------------
# Conference-detail generic actions -> only real published opportunities/packages.
# -----------------------------------------------------------------------------
replace_once(
    "src/components/ConferenceDetail.tsx",
    '''  onToggleFollow?: () => void;\n  isAttended?: boolean;\n''',
    '''  onToggleFollow?: () => void;\n  reviewerOpeningCount?: number;\n  committeeOpeningCount?: number;\n  sponsorshipPackageCount?: number;\n  isAttended?: boolean;\n''',
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    '''  onToggleSave,\n  onToggleFollow,\n  isAttended = false,\n''',
    '''  onToggleSave,\n  onToggleFollow,\n  reviewerOpeningCount = 0,\n  committeeOpeningCount = 0,\n  sponsorshipPackageCount = 0,\n  isAttended = false,\n''',
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    '''            <button\n              onClick={() => onVolunteerReviewer(conference.id)}\n              className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"\n            >\n              <Award className="w-4 h-4" />\n              <span>Volunteer as Reviewer</span>\n            </button>\n            <button\n              onClick={() => onExpressCommitteeInterest(conference.id)}\n              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"\n            >\n              <UserCheck className="w-4 h-4" />\n              <span>Join Technical Committee</span>\n            </button>\n            <button\n              onClick={() => onApplySponsorship(conference.id)}\n              className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"\n            >\n              <Briefcase className="w-4 h-4" />\n              <span>Become Sponsor</span>\n            </button>\n''',
    '''            {reviewerOpeningCount > 0 && (\n              <button\n                onClick={() => onVolunteerReviewer(conference.id)}\n                className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"\n              >\n                <Award className="w-4 h-4" />\n                <span>Reviewer Openings ({reviewerOpeningCount})</span>\n              </button>\n            )}\n            {committeeOpeningCount > 0 && (\n              <button\n                onClick={() => onExpressCommitteeInterest(conference.id)}\n                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"\n              >\n                <UserCheck className="w-4 h-4" />\n                <span>Committee Openings ({committeeOpeningCount})</span>\n              </button>\n            )}\n            {sponsorshipPackageCount > 0 && (\n              <button\n                onClick={() => onApplySponsorship(conference.id)}\n                className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"\n              >\n                <Briefcase className="w-4 h-4" />\n                <span>Sponsorship Packages ({sponsorshipPackageCount})</span>\n              </button>\n            )}\n''',
)

# App state: route conference actions into the real opportunity center/package marketplace.
replace_once(
    "src/App.tsx",
    '  recordConferenceAction,\n',
    '',
)
replace_once(
    "src/App.tsx",
    '''  const [professionalOpportunities, setProfessionalOpportunities] = useState<ProfessionalOpportunity[]>([]);\n  const [professionalOpportunityInterestIds, setProfessionalOpportunityInterestIds] = useState<string[]>([]);\n''',
    '''  const [professionalOpportunities, setProfessionalOpportunities] = useState<ProfessionalOpportunity[]>([]);\n  const [professionalOpportunityInterestIds, setProfessionalOpportunityInterestIds] = useState<string[]>([]);\n  const [opportunityRoleFilter, setOpportunityRoleFilter] = useState<'recommended' | 'reviewer' | 'committee' | 'chair' | 'speaker'>('recommended');\n  const [opportunityConferenceId, setOpportunityConferenceId] = useState<string | null>(null);\n''',
)
replace_once(
    "src/App.tsx",
    '''            onOpenSubmitAbstract={handleOpenSubmitAbstract}\n            onVolunteerReviewer={() => setActiveTab('reviewer')}\n            registeredPackageId={registrations.find((r) => r.conferenceId === selectedConference.id)?.packageId || null}\n''',
    '''            onOpenSubmitAbstract={handleOpenSubmitAbstract}\n            reviewerOpeningCount={reviewOpportunities.filter((item) => item.conferenceId === selectedConference.id).length}\n            committeeOpeningCount={professionalOpportunities.filter((item) => item.conferenceId === selectedConference.id && item.status === 'active' && item.roleType === 'committee').length}\n            sponsorshipPackageCount={activeRole === 'Sponsor' ? sponsorshipPackagesReal.filter((item) => item.conferenceId === selectedConference.id && item.availableSlots > 0).length : 0}\n            onVolunteerReviewer={() => {\n              setOpportunityRoleFilter('reviewer');\n              setOpportunityConferenceId(selectedConference.id);\n              setActiveTab('reviewer');\n            }}\n            registeredPackageId={registrations.find((r) => r.conferenceId === selectedConference.id)?.packageId || null}\n''',
)
replace_once(
    "src/App.tsx",
    '''            onExpressCommitteeInterest={async (confId) => {\n              const conf = conferences.find((c) => c.id === confId);\n              await recordConferenceAction(confId, conf?.title || 'this conference', 'committee_interest').catch(() => {});\n              showToast({\n                type: 'success',\n                title: 'Interest recorded',\n                message: `Saved to your activity. Explore open Technical Committee roles from the Committee tab.`,\n              });\n            }}\n            onApplySponsorship={async (confId) => {\n              const conf = conferences.find((c) => c.id === confId);\n              await recordConferenceAction(confId, conf?.title || 'this conference', 'sponsorship_inquiry').catch(() => {});\n              showToast({\n                type: 'success',\n                title: 'Sponsorship inquiry recorded',\n                message: `Saved to your activity — explore live packages in the Sponsor Marketplace.`,\n              });\n            }}\n''',
    '''            onExpressCommitteeInterest={() => {\n              setOpportunityRoleFilter('committee');\n              setOpportunityConferenceId(selectedConference.id);\n              setActiveTab('reviewer');\n            }}\n            onApplySponsorship={() => setActiveTab('sponsor')}\n''',
)
replace_once(
    "src/App.tsx",
    '''            professionalOpportunities={professionalOpportunities}\n            professionalOpportunityInterestIds={professionalOpportunityInterestIds}\n''',
    '''            professionalOpportunities={professionalOpportunities}\n            professionalOpportunityInterestIds={professionalOpportunityInterestIds}\n            initialRoleFilter={opportunityRoleFilter}\n            focusConferenceId={opportunityConferenceId}\n            onClearOpportunityFocus={() => {\n              setOpportunityConferenceId(null);\n              setOpportunityRoleFilter('recommended');\n            }}\n''',
)

# Reviewer/Professional Opportunity Center accepts deep links from a conference page.
replace_once(
    "src/components/ReviewerPortal.tsx",
    "import React, { useMemo, useState } from 'react';",
    "import React, { useEffect, useMemo, useState } from 'react';",
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''  onVolunteer?: (opportunityId: string, conferenceTitle: string, topic: string) => void;\n  onToggleAvailability?: () => void;\n}\n''',
    '''  onVolunteer?: (opportunityId: string, conferenceTitle: string, topic: string) => void;\n  onToggleAvailability?: () => void;\n  initialRoleFilter?: OpportunityRoleFilter;\n  focusConferenceId?: string | null;\n  onClearOpportunityFocus?: () => void;\n}\n''',
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''  onVolunteer,\n  onToggleAvailability,\n}) => {\n  const [activeTab, setActiveTab] = useState<'opportunities' | 'my-reviews' | 'evaluate' | 'history'>('opportunities');\n  const [roleFilter, setRoleFilter] = useState<OpportunityRoleFilter>('recommended');\n''',
    '''  onVolunteer,\n  onToggleAvailability,\n  initialRoleFilter = 'recommended',\n  focusConferenceId = null,\n  onClearOpportunityFocus,\n}) => {\n  const [activeTab, setActiveTab] = useState<'opportunities' | 'my-reviews' | 'evaluate' | 'history'>('opportunities');\n  const [roleFilter, setRoleFilter] = useState<OpportunityRoleFilter>(initialRoleFilter);\n''',
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''  const [opportunitySearch, setOpportunitySearch] = useState('');\n  const availableToReview = userProfile.reviewerInfo.available;\n''',
    '''  const [opportunitySearch, setOpportunitySearch] = useState('');\n  useEffect(() => {\n    setRoleFilter(initialRoleFilter);\n    if (focusConferenceId) {\n      setActiveTab('opportunities');\n      setOpportunitySearch('');\n    }\n  }, [initialRoleFilter, focusConferenceId]);\n  const focusedConferenceTitle = focusConferenceId\n    ? conferences.find((conference) => conference.id === focusConferenceId)?.title || 'Selected conference'\n    : null;\n  const availableToReview = userProfile.reviewerInfo.available;\n''',
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''      .filter(({ opportunity }) => {\n        if (!query) return true;\n''',
    '''      .filter(({ opportunity }) => {\n        if (focusConferenceId && opportunity.conferenceId !== focusConferenceId) return false;\n        if (!query) return true;\n''',
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''  }, [opportunities, opportunitySearch, userProfile]);\n''',
    '''  }, [opportunities, opportunitySearch, userProfile, focusConferenceId]);\n''',
)
# second .filter block is intentionally addressed by its distinctive professional field list.
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''      .filter(({ opportunity }) => {\n        if (!query) return true;\n        return [\n          opportunity.conferenceTitle,\n          opportunity.title,\n''',
    '''      .filter(({ opportunity }) => {\n        if (focusConferenceId && opportunity.conferenceId !== focusConferenceId) return false;\n        if (!query) return true;\n        return [\n          opportunity.conferenceTitle,\n          opportunity.title,\n''',
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''  }, [professionalOpportunities, opportunitySearch, userProfile]);\n''',
    '''  }, [professionalOpportunities, opportunitySearch, userProfile, focusConferenceId]);\n''',
)
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''        <div className="space-y-6">\n          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">\n''',
    '''        <div className="space-y-6">\n          {focusConferenceId && (\n            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">\n              <div>\n                <div className="text-[10px] uppercase font-extrabold tracking-wide text-blue-700">Conference-specific openings</div>\n                <div className="text-sm font-bold text-slate-900 mt-0.5">{focusedConferenceTitle}</div>\n                <div className="text-[11px] text-slate-600 mt-0.5">Only real organizer-published openings for this conference are shown.</div>\n              </div>\n              {onClearOpportunityFocus && (\n                <button\n                  type="button"\n                  onClick={onClearOpportunityFocus}\n                  className="shrink-0 px-3 py-2 rounded-xl border border-blue-200 bg-white hover:bg-blue-100 text-blue-800 text-xs font-bold cursor-pointer"\n                >\n                  Show all opportunities\n                </button>\n              )}\n            </div>\n          )}\n          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">\n''',
)

print('Phase 49 guarded transformations applied successfully.')
