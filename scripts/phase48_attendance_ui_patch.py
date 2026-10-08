from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one exact match, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


# ---------------- App wiring ----------------
replace_once(
    "src/App.tsx",
    "import { ConferenceDetail } from './components/ConferenceDetail';\n",
    "import { ConferenceDetail } from './components/ConferenceDetail';\nimport { ConferenceFeedbackModal } from './components/ConferenceFeedbackModal';\n",
)
replace_once(
    "src/App.tsx",
    """  fetchMyRegistrations,\n  ConferenceRegistration,\n  fetchMyConferenceInteractions,\n""",
    """  fetchMyRegistrations,\n  ConferenceRegistration,\n  ConferenceAttendance,\n  MarkConferenceAttendancePayload,\n  fetchMyConferenceAttendance,\n  markConferenceAttended,\n  fetchMyConferenceInteractions,\n""",
)
replace_once(
    "src/App.tsx",
    """  const [registrations, setRegistrations] = useState<ConferenceRegistration[]>([]);\n  const [volunteeredOpportunityIds, setVolunteeredOpportunityIds] = useState<string[]>([]);\n""",
    """  const [registrations, setRegistrations] = useState<ConferenceRegistration[]>([]);\n  const [conferenceAttendance, setConferenceAttendance] = useState<ConferenceAttendance[]>([]);\n  const [attendanceFeedbackTarget, setAttendanceFeedbackTarget] = useState<ConferenceAttendance | null>(null);\n  const [volunteeredOpportunityIds, setVolunteeredOpportunityIds] = useState<string[]>([]);\n""",
)
replace_once(
    "src/App.tsx",
    "    fetchMyRegistrations().then(setRegistrations).catch(() => {});\n",
    "    fetchMyRegistrations().then(setRegistrations).catch(() => {});\n    fetchMyConferenceAttendance().then(setConferenceAttendance).catch(() => {});\n",
)
replace_once(
    "src/App.tsx",
    """  const handleToggleSaveConference = async (conferenceId: string) => {\n""",
    """  const handleMarkConferenceAttendance = async (payload: MarkConferenceAttendancePayload) => {\n    try {\n      const attendance = await markConferenceAttended(payload);\n      setConferenceAttendance((prev) => [attendance, ...prev.filter((item) => item.conferenceId !== attendance.conferenceId)]);\n      showToast({\n        type: 'success',\n        title: 'Attendance saved',\n        message: `${attendance.conferenceTitle} is now in your attended-conference history. You can rate ${attendance.organizerName} from this record.`,\n      });\n    } catch (err: any) {\n      showToast({ type: 'info', title: 'Attendance not saved', message: err.message || 'Please try again.' });\n      throw err;\n    }\n  };\n\n  const handleToggleSaveConference = async (conferenceId: string) => {\n""",
)
replace_once(
    "src/App.tsx",
    """    return {\n      conferencesAttended: registrations.length,\n""",
    """    return {\n      conferencesAttended: conferenceAttendance.length,\n""",
)
replace_once(
    "src/App.tsx",
    "  }, [submissions, registrations, authUser?.id, authUser?.email, authUser?.keynoteSpeakerMatches]);\n",
    "  }, [submissions, registrations, conferenceAttendance, authUser?.id, authUser?.email, authUser?.keynoteSpeakerMatches]);\n",
)

# External detail: stored catalogue conference (the AICON screenshot path).
replace_once(
    "src/App.tsx",
    """          <ExternalConferenceDetail\n            result={selectedExternalResult}\n            onBack={() => setActiveTab('discover')}\n            initialTab={selectedExternalTab}\n            author={authUser ? { name: userProfile.name, email: authUser.email } : null}\n            onExternalSubmissionRecorded={(submission) => setSubmissions((prev) => [submission, ...prev])}\n          />\n""",
    """          <ExternalConferenceDetail\n            result={selectedExternalResult}\n            onBack={() => setActiveTab('discover')}\n            initialTab={selectedExternalTab}\n            author={authUser ? { name: userProfile.name, email: authUser.email } : null}\n            onExternalSubmissionRecorded={(submission) => setSubmissions((prev) => [submission, ...prev])}\n            isAttended={conferenceAttendance.some((item) => item.conferenceId === `catalog:${selectedExternalResult.link}`)}\n            onMarkAttended={handleMarkConferenceAttendance}\n            onRateOrganizer={() => {\n              const attendance = conferenceAttendance.find((item) => item.conferenceId === `catalog:${selectedExternalResult.link}`);\n              if (attendance) setAttendanceFeedbackTarget(attendance);\n            }}\n          />\n""",
)

# Internal detail: organizer-created ConferenceGate conferences.
replace_once(
    "src/App.tsx",
    """            onToggleFollow={() => handleToggleFollowConference(selectedConference.id)}\n            onExpressCommitteeInterest={async (confId) => {\n""",
    """            onToggleFollow={() => handleToggleFollowConference(selectedConference.id)}\n            isAttended={conferenceAttendance.some((item) => item.conferenceId === selectedConference.id)}\n            onMarkAttended={(localDate) => handleMarkConferenceAttendance({\n              conferenceId: selectedConference.id,\n              conferenceTitle: selectedConference.title,\n              organizerName: selectedConference.organizerName,\n              startDate: selectedConference.dates.start,\n              endDate: selectedConference.dates.end,\n              location: [selectedConference.location.venue, selectedConference.location.city, selectedConference.location.country].filter(Boolean).join(', '),\n              sourceType: 'conferencegate',\n              sourceUrl: selectedConference.officialWebsite || null,\n              localDate,\n            })}\n            onRateOrganizer={() => {\n              const attendance = conferenceAttendance.find((item) => item.conferenceId === selectedConference.id);\n              if (attendance) setAttendanceFeedbackTarget(attendance);\n            }}\n            onExpressCommitteeInterest={async (confId) => {\n""",
)
replace_once(
    "src/App.tsx",
    """            registrations={registrations}\n            conferences={discoverConferences}\n""",
    """            registrations={registrations}\n            attendanceRecords={conferenceAttendance}\n            conferences={discoverConferences}\n""",
)
replace_once(
    "src/App.tsx",
    """      <DigitalBadgeModal\n        isOpen={isBadgeOpen}\n""",
    """      <ConferenceFeedbackModal\n        isOpen={attendanceFeedbackTarget !== null}\n        onClose={() => setAttendanceFeedbackTarget(null)}\n        conferenceId={attendanceFeedbackTarget?.conferenceId}\n        conferenceTitle={attendanceFeedbackTarget?.conferenceTitle || ''}\n        organizerName={attendanceFeedbackTarget?.organizerName || ''}\n        eventDate={attendanceFeedbackTarget ? `${attendanceFeedbackTarget.startDate} – ${attendanceFeedbackTarget.endDate}` : ''}\n        participantName={userProfile.name}\n        participantCompany={userProfile.organization}\n        defaultRole="Attendee"\n      />\n\n      <DigitalBadgeModal\n        isOpen={isBadgeOpen}\n""",
)

# ---------------- Internal ConferenceDetail ----------------
replace_once(
    "src/components/ConferenceDetail.tsx",
    "  ExternalLink,\n} from 'lucide-react';\n",
    "  ExternalLink,\n  Loader2,\n} from 'lucide-react';\n",
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    "import { generateInitialsAvatar, getInitials } from '../utils/avatar';\n",
    "import { generateInitialsAvatar, getInitials } from '../utils/avatar';\nimport { useCurrentLocalDate } from '../hooks/useCurrentLocalDate';\n",
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    """  onToggleSave?: () => void;\n  onToggleFollow?: () => void;\n}\n""",
    """  onToggleSave?: () => void;\n  onToggleFollow?: () => void;\n  isAttended?: boolean;\n  onMarkAttended?: (localDate: string) => Promise<void>;\n  onRateOrganizer?: () => void;\n}\n""",
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    """  onToggleSave,\n  onToggleFollow,\n}) => {\n""",
    """  onToggleSave,\n  onToggleFollow,\n  isAttended = false,\n  onMarkAttended,\n  onRateOrganizer,\n}) => {\n""",
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    """  const registeredPackage = registeredPackageId;\n  const saved = isSaved;\n""",
    """  const registeredPackage = registeredPackageId;\n  const saved = isSaved;\n  const today = useCurrentLocalDate();\n  const attendanceEligible = conference.dates.start <= today;\n  const [markingAttendance, setMarkingAttendance] = useState(false);\n  const handleMarkAttended = async () => {\n    if (!onMarkAttended || markingAttendance || !attendanceEligible) return;\n    setMarkingAttendance(true);\n    try {\n      await onMarkAttended(today);\n    } finally {\n      setMarkingAttendance(false);\n    }\n  };\n""",
)
replace_once(
    "src/components/ConferenceDetail.tsx",
    """            <button\n              onClick={() => onApplySponsorship(conference.id)}\n              className=\"px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer\"\n            >\n              <Briefcase className=\"w-4 h-4\" />\n              <span>Become Sponsor</span>\n            </button>\n""",
    """            <button\n              onClick={() => onApplySponsorship(conference.id)}\n              className=\"px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer\"\n            >\n              <Briefcase className=\"w-4 h-4\" />\n              <span>Become Sponsor</span>\n            </button>\n            {attendanceEligible && onMarkAttended && (\n              isAttended ? (\n                <button\n                  type=\"button\"\n                  disabled\n                  className=\"px-4 py-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-xs rounded-xl flex items-center gap-2\"\n                >\n                  <CheckCircle2 className=\"w-4 h-4\" />\n                  <span>Attended</span>\n                </button>\n              ) : (\n                <button\n                  type=\"button\"\n                  onClick={handleMarkAttended}\n                  disabled={markingAttendance}\n                  className=\"px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer\"\n                >\n                  {markingAttendance ? <Loader2 className=\"w-4 h-4 animate-spin\" /> : <CheckCircle2 className=\"w-4 h-4\" />}\n                  <span>{markingAttendance ? 'Saving...' : 'I Attended'}</span>\n                </button>\n              )\n            )}\n            {attendanceEligible && isAttended && onRateOrganizer && (\n              <button\n                type=\"button\"\n                onClick={onRateOrganizer}\n                className=\"px-4 py-2.5 bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer\"\n              >\n                <MessageSquare className=\"w-4 h-4\" />\n                <span>Rate Organizer</span>\n              </button>\n            )}\n""",
)

# ---------------- External/stored ConferenceDetail ----------------
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    "import { createExternalSubmission } from '../api/activity';\n",
    "import { createExternalSubmission, type MarkConferenceAttendancePayload } from '../api/activity';\nimport { useCurrentLocalDate } from '../hooks/useCurrentLocalDate';\n",
)
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    "  AlertCircle,\n} from 'lucide-react';\n",
    "  AlertCircle,\n  MessageSquare,\n} from 'lucide-react';\n",
)
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    """  onExternalSubmissionRecorded?: (submission: AbstractSubmission) => void;\n}\n""",
    """  onExternalSubmissionRecorded?: (submission: AbstractSubmission) => void;\n  isAttended?: boolean;\n  onMarkAttended?: (payload: MarkConferenceAttendancePayload) => Promise<void>;\n  onRateOrganizer?: () => void;\n}\n""",
)
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    """  author,\n  onExternalSubmissionRecorded,\n}) => {\n""",
    """  author,\n  onExternalSubmissionRecorded,\n  isAttended = false,\n  onMarkAttended,\n  onRateOrganizer,\n}) => {\n""",
)
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    """  const [downloadingDraft, setDownloadingDraft] = useState(false);\n\n  const handleAICheck = async () => {\n""",
    """  const [downloadingDraft, setDownloadingDraft] = useState(false);\n  const [markingAttendance, setMarkingAttendance] = useState(false);\n  const today = useCurrentLocalDate();\n\n  const handleAICheck = async () => {\n""",
)
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    """  const submissionChannel = detectSubmissionChannel(data?.submissionEmail || null, submissionLink);\n""",
    """  const structuredDateCandidates = [result.startDate, result.endDate, data?.datesText]\n    .filter(Boolean)\n    .flatMap((value) => String(value).match(/\\b20\\d{2}-\\d{2}-\\d{2}\\b/g) || []);\n  const attendanceStartDate = result.startDate || structuredDateCandidates[0] || null;\n  const attendanceEndDate = result.endDate || structuredDateCandidates[1] || attendanceStartDate;\n  const attendanceOrganizerName = String(data?.overview?.organizer || data?.organizingInstitution || result.organization || result.displayLink || '').trim();\n  const attendanceEligible = Boolean(attendanceStartDate && attendanceEndDate && attendanceOrganizerName && attendanceStartDate <= today);\n  const attendancePayload: MarkConferenceAttendancePayload | null = attendanceEligible && attendanceStartDate && attendanceEndDate\n    ? {\n        conferenceId: `catalog:${result.link}`,\n        conferenceTitle: displayTitle,\n        organizerName: attendanceOrganizerName,\n        startDate: attendanceStartDate,\n        endDate: attendanceEndDate,\n        location: displayLocation || [result.location?.city, result.location?.country].filter(Boolean).join(', '),\n        sourceType: 'catalog',\n        sourceUrl: result.link,\n        localDate: today,\n      }\n    : null;\n\n  const handleMarkAttended = async () => {\n    if (!attendancePayload || !onMarkAttended || markingAttendance) return;\n    setMarkingAttendance(true);\n    try {\n      await onMarkAttended(attendancePayload);\n    } finally {\n      setMarkingAttendance(false);\n    }\n  };\n\n  const submissionChannel = detectSubmissionChannel(data?.submissionEmail || null, submissionLink);\n""",
)
replace_once(
    "src/components/ExternalConferenceDetail.tsx",
    """          )}\n        </div>\n\n        {!loading && data && (\n""",
    """          )}\n          {attendanceEligible && onMarkAttended && (\n            isAttended ? (\n              <button\n                type=\"button\"\n                disabled\n                className=\"px-5 py-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-xs rounded-xl flex items-center gap-2\"\n              >\n                <CheckCircle2 className=\"w-4 h-4\" />\n                <span>Attended</span>\n              </button>\n            ) : (\n              <button\n                type=\"button\"\n                onClick={handleMarkAttended}\n                disabled={markingAttendance}\n                className=\"px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer\"\n              >\n                {markingAttendance ? <Loader2 className=\"w-4 h-4 animate-spin\" /> : <CheckCircle2 className=\"w-4 h-4\" />}\n                <span>{markingAttendance ? 'Saving...' : 'I Attended'}</span>\n              </button>\n            )\n          )}\n          {attendanceEligible && isAttended && onRateOrganizer && (\n            <button\n              type=\"button\"\n              onClick={onRateOrganizer}\n              className=\"px-5 py-2.5 bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer\"\n            >\n              <MessageSquare className=\"w-4 h-4\" />\n              <span>Rate {attendanceOrganizerName || 'Organizer'}</span>\n            </button>\n          )}\n        </div>\n\n        {!loading && data && (\n""",
)

# ---------------- Profile history ----------------
replace_once(
    "src/components/UserProfileView.tsx",
    "  ConferenceRegistration,\n",
    "  ConferenceRegistration,\n  ConferenceAttendance,\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "import { generateInitialsAvatar } from '../utils/avatar';\n",
    "import { generateInitialsAvatar } from '../utils/avatar';\nimport { useCurrentLocalDate } from '../hooks/useCurrentLocalDate';\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    """  registrations?: ConferenceRegistration[];\n  conferences?: Conference[];\n""",
    """  registrations?: ConferenceRegistration[];\n  attendanceRecords?: ConferenceAttendance[];\n  conferences?: Conference[];\n""",
)
replace_once(
    "src/components/UserProfileView.tsx",
    """  registrations = [],\n  conferences = [],\n""",
    """  registrations = [],\n  attendanceRecords = [],\n  conferences = [],\n""",
)
replace_once(
    "src/components/UserProfileView.tsx",
    """  const [feedbackConference, setFeedbackConference] = useState<AttendedConference | null>(null);\n  const [professionalEvidenceSnapshot, setProfessionalEvidenceSnapshot] = useState<ProfessionalEvidenceSnapshot | null>(null);\n""",
    """  const [feedbackConference, setFeedbackConference] = useState<AttendedConference | null>(null);\n  const [professionalEvidenceSnapshot, setProfessionalEvidenceSnapshot] = useState<ProfessionalEvidenceSnapshot | null>(null);\n  const today = useCurrentLocalDate();\n  const attendanceByConferenceId = useMemo(\n    () => new Map(attendanceRecords.map((item) => [item.conferenceId, item] as const)),\n    [attendanceRecords]\n  );\n""",
)

# Remove the old unconditional Evaluate button from registrations. A registration is not attendance.
replace_once(
    "src/components/UserProfileView.tsx",
    """                      <button\n                        onClick={() => setFeedbackConference(conf)}\n                        className=\"px-2.5 py-1 border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors\"\n                      >\n                        Evaluate Conference\n                      </button>\n                      <span className=\"px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap\">\n                        Registered\n                      </span>\n""",
    """                      {conf.id && attendanceByConferenceId.has(conf.id) ? (\n                        <span className=\"px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap\">\n                          Attended\n                        </span>\n                      ) : conferences.find((item) => item.id === conf.id)?.dates.start && conferences.find((item) => item.id === conf.id)!.dates.start > today ? (\n                        <span className=\"px-2.5 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-full whitespace-nowrap\">\n                          Upcoming · Registered\n                        </span>\n                      ) : (\n                        <span className=\"px-2.5 py-0.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded-full whitespace-nowrap\">\n                          Registered · attendance not confirmed\n                        </span>\n                      )}\n""",
)

# Insert the authoritative linked attendance history above the registration-only section.
replace_once(
    "src/components/UserProfileView.tsx",
    """        {activeTab === 'conferences' && (\n          <div className=\"space-y-4\">\n            <div>\n              <h3 className=\"text-base font-bold text-slate-900\">ConferenceGate Registrations</h3>\n""",
    """        {activeTab === 'conferences' && (\n          <div className=\"space-y-4 mb-6\">\n            <div>\n              <h3 className=\"text-base font-bold text-slate-900\">Attended Conferences</h3>\n              <p className=\"text-[11px] text-slate-500 mt-1\">\n                Conferences you explicitly marked Attended after the event start date. These are account-linked attendance confirmations; organizer ratings are routed only to the company stored with that exact conference.\n              </p>\n            </div>\n            {attendanceRecords.length > 0 ? (\n              <div className=\"space-y-3\">\n                {attendanceRecords.map((attendance) => (\n                  <div key={attendance.id} className=\"p-4 bg-emerald-50/50 rounded-2xl border border-emerald-200 flex items-center justify-between gap-3\">\n                    <div className=\"min-w-0\">\n                      <h4 className=\"font-bold text-xs text-slate-900\">{attendance.conferenceTitle}</h4>\n                      <p className=\"text-[11px] text-slate-500\">\n                        {[attendance.startDate === attendance.endDate ? attendance.startDate : `${attendance.startDate} – ${attendance.endDate}`, attendance.location, attendance.organizerName].filter(Boolean).join(' • ')}\n                      </p>\n                      {attendance.sourceUrl && (\n                        <a href={attendance.sourceUrl} target=\"_blank\" rel=\"noopener noreferrer\" className=\"inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-blue-700 hover:underline\">\n                          <ExternalLink className=\"w-3 h-3\" /> Official source\n                        </a>\n                      )}\n                    </div>\n                    <div className=\"flex items-center gap-2 shrink-0\">\n                      <button\n                        onClick={() => setFeedbackConference({\n                          id: attendance.conferenceId,\n                          title: attendance.conferenceTitle,\n                          location: attendance.location,\n                          roleLabel: 'Attendee',\n                          organizerName: attendance.organizerName,\n                          eventDate: attendance.startDate === attendance.endDate ? attendance.startDate : `${attendance.startDate} – ${attendance.endDate}`,\n                          defaultRole: 'Attendee',\n                        })}\n                        className=\"px-2.5 py-1 border border-violet-200 text-violet-700 hover:bg-violet-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors\"\n                      >\n                        Rate Organizer\n                      </button>\n                      <span className=\"px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap\">Attended</span>\n                    </div>\n                  </div>\n                ))}\n              </div>\n            ) : (\n              <p className=\"text-xs text-slate-400\">No attended conferences recorded yet. Open a conference that is happening now or has already started and choose I Attended.</p>\n            )}\n          </div>\n        )}\n\n        {activeTab === 'conferences' && (\n          <div className=\"space-y-4 pt-4 border-t border-slate-100\">\n            <div>\n              <h3 className=\"text-base font-bold text-slate-900\">ConferenceGate Registrations</h3>\n""",
)

# ---------------- Feedback API safeguard ----------------
replace_once(
    "server/activity.ts",
    """    if (attendance) {\n      conferenceTitle = attendance.conference_title;\n      organizerName = attendance.organizer_name;\n    } else if (!organizerName) {\n""",
    """    if (attendance) {\n      conferenceTitle = attendance.conference_title;\n      organizerName = attendance.organizer_name;\n    } else {\n      return res.status(403).json({ error: \"Mark this conference Attended before submitting a conference or organizer rating.\" });\n    }\n    if (!organizerName) {\n""",
)

print('Phase 48 attendance UI and rating-integrity patch applied')
