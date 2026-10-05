from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


# Sponsor portal: make alerts actionable and prevent duplicate application clicks.
sponsor_path = Path('src/components/SponsorPortal.tsx')
sponsor = sponsor_path.read_text()

sponsor = replace_once(
    sponsor,
    "  Trash2,\n} from 'lucide-react';",
    "  Trash2,\n  ChevronRight,\n} from 'lucide-react';",
    'add ChevronRight import',
)

sponsor = replace_once(
    sponsor,
    "  onMarkAlertRead?: (id: string) => void;\n  onMarkAllAlertsRead?: () => void;\n  onApplyForSponsorship?: (packageId: string) => void;",
    "  onMarkAlertRead: (id: string) => void;\n  onMarkAllAlertsRead: () => void;\n  onApplyForSponsorship: (packageId: string) => void | Promise<void>;",
    'make sponsor action callbacks required',
)

sponsor = replace_once(
    sponsor,
    "  sponsorAlerts = [],\n  onMarkAlertRead = (_id: string) => {},\n  onMarkAllAlertsRead = () => {},\n  onApplyForSponsorship = (_packageId: string) => {},\n  ownerPreview = false,",
    "  sponsorAlerts = [],\n  onMarkAlertRead,\n  onMarkAllAlertsRead,\n  onApplyForSponsorship,\n  ownerPreview = false,",
    'remove silent sponsor callback fallbacks',
)

sponsor = replace_once(
    sponsor,
    "  const [inquiringNeedId, setInquiringNeedId] = useState<string | null>(null);\n",
    "  const [inquiringNeedId, setInquiringNeedId] = useState<string | null>(null);\n  const [applyingPackageId, setApplyingPackageId] = useState<string | null>(null);\n",
    'add sponsorship application busy state',
)

sponsor = replace_once(
    sponsor,
    "  const handleApplySponsorship = (packageId: string) => {\n    if (applicationByPackageId.has(packageId)) return;\n    onApplyForSponsorship(packageId);\n  };",
    "  const handleApplySponsorship = async (packageId: string) => {\n    if (applicationByPackageId.has(packageId) || applyingPackageId === packageId) return;\n    setApplyingPackageId(packageId);\n    try {\n      await onApplyForSponsorship(packageId);\n    } finally {\n      setApplyingPackageId(null);\n    }\n  };",
    'harden sponsorship application action',
)

sponsor = replace_once(
    sponsor,
    "    return (\n      <button\n        onClick={() => handleApplySponsorship(packageId)}\n        className=\"w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer\"\n      >\n        Apply for Sponsorship\n      </button>\n    );",
    "    const applying = applyingPackageId === packageId;\n    return (\n      <button\n        type=\"button\"\n        onClick={() => handleApplySponsorship(packageId)}\n        disabled={applying}\n        className=\"w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait\"\n      >\n        {applying ? 'Submitting…' : 'Apply for Sponsorship'}\n      </button>\n    );",
    'show sponsorship application progress',
)

jump_block = """  const handleJumpToAlerts = () => {
    setActiveTab('marketplace');
    setTimeout(() => alertsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
"""
alert_handler = jump_block + """

  const handleSponsorAlertOpen = (alert: NotificationItem) => {
    onMarkAlertRead(alert.id);
    const signal = `${alert.actionUrl || ''} ${alert.title || ''} ${alert.message || ''}`.toLowerCase();

    if (/deal|contract|payment|invoice/.test(signal)) {
      setActiveTab('deals');
    } else if (/request|proposal/.test(signal)) {
      setActiveTab('requests');
    } else if (/review|rating|reputation/.test(signal)) {
      setActiveTab('profile');
    } else if (/saved|watchlist/.test(signal)) {
      setActiveTab('saved');
    } else if (/match|new sponsorship opportunity|opportunit/.test(signal)) {
      setActiveTab('matches');
    } else {
      setActiveTab('marketplace');
    }
  };
"""
sponsor = replace_once(sponsor, jump_block, alert_handler, 'add sponsor alert routing')

sponsor = replace_once(
    sponsor,
    "                    onClick={() => onMarkAlertRead(alert.id)}",
    "                    onClick={() => handleSponsorAlertOpen(alert)}",
    'make sponsor alerts actionable',
)

sponsor = replace_once(
    sponsor,
    "                      <div className=\"text-[10px] text-slate-400 mt-1\">{alert.timestamp}</div>\n                    </div>\n                  </button>",
    "                      <div className=\"text-[10px] text-slate-400 mt-1\">{alert.timestamp}</div>\n                    </div>\n                    <ChevronRight className=\"w-4 h-4 text-slate-400 shrink-0 mt-1\" aria-hidden=\"true\" />\n                  </button>",
    'add sponsor alert navigation affordance',
)

sponsor_path.write_text(sponsor)


# Organizer dashboard: make persisted planning actions explicit and avoid active no-op status buttons.
organizer_path = Path('src/components/OrganizerDashboard.tsx')
organizer = organizer_path.read_text()

organizer = replace_once(
    organizer,
    "          {/* Follow-Up Notifications */}",
    "          {/* Persisted coordination notes */}",
    'rename coordination section comment',
)
organizer = replace_once(
    organizer,
    "                Follow-Up Notifications — Organizer, Chair & Co-Chair",
    "                Coordination Notes — Organizer, Chair & Co-Chair",
    'rename coordination heading',
)

organizer = replace_once(
    organizer,
    "      setCommitteeFollowUps((prev) => [note, ...prev]);\n      setFollowUpDraft({ ...followUpDraft, message: '' });",
    "      setCommitteeFollowUps((prev) => [note, ...prev]);\n      setFollowUpDraft({ ...followUpDraft, message: '' });\n      showToast({\n        type: 'success',\n        title: 'Coordination note saved',\n        message: 'The note is persisted in the organizer workspace for the committee team.',\n      });",
    'confirm coordination note persistence',
)

meeting_pattern = re.compile(
    r"(      setMeetingDraft\(\{\n"
    r"        title: '',\n"
    r"        attendees: \[\],\n"
    r"        date: '',\n"
    r"        time: '',\n"
    r"        organizerTimezone: meetingDraft\.organizerTimezone,\n"
    r"        meetingLink: '',\n"
    r"      \}\);\n)(    \} catch \(error\) \{)"
)
organizer, count = meeting_pattern.subn(
    r"\1      showToast({\n        type: 'success',\n        title: 'Meeting plan saved',\n        message: 'The committee meeting plan is persisted in the organizer workspace.',\n      });\n\2",
    organizer,
    count=1,
)
if count != 1:
    raise RuntimeError(f'confirm meeting persistence: expected 1 match, found {count}')

organizer = replace_once(
    organizer,
    "                                  disabled={savingDealId === deal.id || deal.status === 'paid' && status === 'payment_pending'}",
    "                                  disabled={savingDealId === deal.id || deal.status === status || (deal.status === 'paid' && status === 'payment_pending')}",
    'disable current deal status action',
)

organizer_path.write_text(organizer)

print('Phase 26 organizer/sponsor action integrity patch applied.')
