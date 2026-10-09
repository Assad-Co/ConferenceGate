from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match in {path}, found {count}")
    p.write_text(text.replace(old, new, 1))
    print(f"updated {path}: {label}")


# Legacy navbar: remove dead AI/QR language, move Organizations into normal navigation,
# correct the search scope, and stop claiming unverified account identities are verified.
replace_once(
    "src/components/LegacyNavbar.tsx",
    "  Layers,\n  QrCode,\n  ShieldCheck,\n  Home,",
    "  Layers,\n  Home,",
    "remove obsolete QR and verification icons",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    "  unreadMessageCount?: number;\n  onOpenAIAssistant?: () => void;\n  onOpenAIModal?: () => void;\n  onOpenMessages?: () => void;\n  onOpenDigitalBadge?: () => void;",
    "  unreadMessageCount?: number;\n  onOpenMessages?: () => void;\n  onOpenDigitalBadge?: () => void;\n  onOpenOrganizationDirectory?: () => void;",
    "remove dead AI props and add organization directory action",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    "  onOpenMessages = () => {},\n  onOpenDigitalBadge = () => {},\n  onSearch = (_query: string) => {},",
    "  onOpenMessages = () => {},\n  onOpenDigitalBadge = () => {},\n  onOpenOrganizationDirectory = () => {},\n  onSearch = (_query: string) => {},",
    "wire organization directory callback",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    "  const identityLabel = isOrganizerRole ? 'Verified Organizer' : isSponsorRole ? 'Verified Sponsor' : 'Verified Identity';",
    "  const identityLabel = isOrganizerRole ? 'Organizer Account' : isSponsorRole ? 'Sponsor Account' : 'Professional Account';",
    "neutral account identity wording",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    '                  placeholder="Search conferences, abstracts, topics..."',
    '                  placeholder="Search conferences and topics..."',
    "correct global search scope",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    '''            {/* Digital Event Badge Quick Access */}\n            <button\n              onClick={onOpenDigitalBadge}\n              className="p-1 sm:p-1.5 md:p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"\n              title="Digital Attendee Badge & QR Check-In"\n            >\n              <QrCode className="w-4 h-4" />\n            </button>\n\n            {/* Direct Messages Icon */}''',
    '''            <button\n              onClick={onOpenOrganizationDirectory}\n              className="p-1 sm:p-1.5 md:p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"\n              title="Organizations & Reputation"\n            >\n              <Building2 className="w-4 h-4" />\n            </button>\n\n            {isAttendeeRole && (\n              <button\n                onClick={onOpenDigitalBadge}\n                className="p-1 sm:p-1.5 md:p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"\n                title="ConferenceGate Professional Badge"\n              >\n                <Award className="w-4 h-4" />\n              </button>\n            )}\n\n            {/* Direct Messages Icon */}''',
    "replace floating/generic quick actions with real navbar actions",
)
replace_once(
    "src/components/LegacyNavbar.tsx",
    '''                  <div className="text-[10px] font-medium text-emerald-600 flex items-center gap-0.5">\n                    <ShieldCheck className="w-3 h-3" />\n                    <span>{identityLabel}</span>\n                  </div>''',
    '''                  <div className="text-[10px] font-medium text-slate-500 flex items-center gap-0.5">\n                    <UserCheck className="w-3 h-3" />\n                    <span>{identityLabel}</span>\n                  </div>''',
    "remove unverified identity styling",
)

# Professional profile: remove the duplicated record summary and tighten badge wording.
replace_once(
    "src/components/UserProfileView.tsx",
    "import { ConferenceGateIndexCard } from './ConferenceGateIndexCard';\n",
    "",
    "remove duplicate trust-card import",
)
replace_once(
    "src/components/UserProfileView.tsx",
    '            <h3 className="text-base font-bold text-slate-900">Verified Conference Identity Badges</h3>',
    '            <h3 className="text-base font-bold text-slate-900">Verified Conference Badges</h3>',
    "remove identity overclaim from badges",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "\n            <ConferenceGateIndexCard />\n",
    "",
    "remove repeated verified-record card",
)

# Opportunity Center: avoid repeating the same title and explanation twice on one page.
replace_once(
    "src/components/ReviewerPortal.tsx",
    '''                <h2 className="text-lg font-bold text-slate-900">Professional Opportunity Center</h2>\n                <p className="text-xs text-slate-500 mt-1 max-w-3xl">\n                  ConferenceGate only shows opportunities that an organizer actually publishes. Your stored expertise\n                  is used to rank organizer-published opportunities; no committee, chair, or speaker vacancy is inferred from a conference page.\n                </p>''',
    '''                <h2 className="text-lg font-bold text-slate-900">Open Opportunities</h2>\n                <p className="text-xs text-slate-500 mt-1 max-w-3xl">\n                  Only organizer-published reviewer, committee, chair, and speaker openings are listed here.\n                </p>''',
    "remove duplicated opportunity-center copy",
)

# Remove dead mock sponsorship-template plumbing that is no longer rendered by the Organizer workspace.
replace_once(
    "src/App.tsx",
    "  fetchSponsorshipPackages,\n  createSponsorshipPackage,\n  applyForSponsorship,",
    "  fetchSponsorshipPackages,\n  applyForSponsorship,",
    "remove unused package-template API import",
)
replace_once(
    "src/App.tsx",
    "import {\n  sampleConferences,\n  currentUserProfile,\n  sampleSponsorshipOpportunities,\n} from './data/mockData';",
    "import {\n  sampleConferences,\n  currentUserProfile,\n} from './data/mockData';",
    "remove unused mock sponsorship data",
)
replace_once(
    "src/App.tsx",
    '''  const handleActivateOpportunityPackage = async (opp: {\n    key: string;\n    name: string;\n    tier: string;\n    price: number;\n    slots: number;\n    benefits: string[];\n  }) => {\n    const targetConference = myConferences[0];\n    if (!targetConference) {\n      showToast({\n        type: 'info',\n        title: 'Create a conference first',\n        message: 'Publish a conference from the Wizard tab before activating sponsorship packages.',\n      });\n      return;\n    }\n    try {\n      const pkg = await createSponsorshipPackage({\n        conferenceId: targetConference.id,\n        tier: opp.tier,\n        price: opp.price,\n        benefits: opp.benefits,\n        totalSlots: opp.slots,\n        sourceOpportunityId: opp.key,\n      });\n      setSponsorshipPackagesReal((prev) => [pkg, ...prev]);\n      showToast({\n        type: 'success',\n        title: 'Package activated',\n        message: `${opp.tier} is now live in the Sponsor Marketplace for ${targetConference.title}.`,\n      });\n    } catch (e) {\n      showToast({\n        type: 'info',\n        title: "Couldn't activate package",\n        message: e instanceof Error ? e.message : 'Please try again.',\n      });\n    }\n  };\n\n''',
    "",
    "remove unused mock package activation handler",
)
replace_once(
    "src/App.tsx",
    '''            sponsorshipPackages={organizerOwnPackages}\n            sponsorshipOpportunities={sampleSponsorshipOpportunities}\n            onActivateOpportunityPackage={handleActivateOpportunityPackage}\n            sponsorApplicants={packageApplicants}''',
    '''            sponsorshipPackages={organizerOwnPackages}\n            sponsorApplicants={packageApplicants}''',
    "remove dead Organizer mock props",
)
replace_once(
    "src/App.tsx",
    '''        }}\n        onOpenBadge={() => setIsBadgeOpen(true)}\n        role={authUser.role}''',
    '''        }}\n        role={authUser.role}''',
    "remove dead footer badge prop",
)

# Organizer Dashboard prop cleanup for the dead mock sponsorship path.
replace_once(
    "src/components/OrganizerDashboard.tsx",
    "import { Conference, AbstractSubmission, SponsorshipPackage, SponsorshipOpportunity, ReviewOpportunity } from '../types';",
    "import { Conference, AbstractSubmission, SponsorshipPackage, ReviewOpportunity } from '../types';",
    "remove unused SponsorshipOpportunity type",
)
replace_once(
    "src/components/OrganizerDashboard.tsx",
    '''  sponsorshipPackages: SponsorshipPackage[];\n  sponsorshipOpportunities: SponsorshipOpportunity[];\n  onActivateOpportunityPackage: (opp: { key: string; tier: string; price: number; slots: number; benefits: string[] }) => void;\n  sponsorApplicants?: SponsorApplicant[];''',
    '''  sponsorshipPackages: SponsorshipPackage[];\n  sponsorApplicants?: SponsorApplicant[];''',
    "remove dead sponsorship template props",
)
replace_once(
    "src/components/OrganizerDashboard.tsx",
    '''  sponsorshipPackages,\n  sponsorshipOpportunities,\n  onActivateOpportunityPackage,\n  sponsorApplicants = [],''',
    '''  sponsorshipPackages,\n  sponsorApplicants = [],''',
    "remove dead sponsorship template destructuring",
)

print("Phase 51 guarded cleanup completed")
