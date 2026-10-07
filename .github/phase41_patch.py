from pathlib import Path

# Phase 41 — restore Conference & Workshop Feedback across Conference History.

user_path = Path('src/components/UserProfileView.tsx')
text = user_path.read_text()

text = text.replace(
"""interface AttendedConference {\n  id: string;\n""",
"""interface AttendedConference {\n  id?: string;\n""",
1,
)

old_imported = """        <LinkedInImportedTabSections tab={activeTab} onPaperTitlesChange={setLinkedInPaperTitles} />"""
new_imported = """        <LinkedInImportedTabSections
          tab={activeTab}
          onPaperTitlesChange={setLinkedInPaperTitles}
          onLeaveFeedback={activeTab === 'conferences' ? (signal) => {
            const rawRole = signal.role || '';
            const defaultRole: ConferenceRole = /reviewer/i.test(rawRole)
              ? 'Reviewer'
              : /(?:session|track).*chair|^chair$/i.test(rawRole)
                ? 'Session Chair'
                : /keynote/i.test(rawRole)
                  ? 'Keynote'
                  : /speaker|presenter/i.test(rawRole)
                    ? 'Speaker'
                    : /committee/i.test(rawRole)
                      ? 'Technical Committee'
                      : /moderator/i.test(rawRole)
                        ? 'Moderator'
                        : 'Attendee';
            setFeedbackConference({
              title: signal.conferenceName || signal.label,
              location: '',
              roleLabel: signal.role || 'Attendee',
              organizerName: '',
              eventDate: signal.year ? String(signal.year) : '',
              defaultRole,
            });
          } : undefined}
        />"""
if old_imported not in text:
    raise SystemExit('LinkedInImportedTabSections invocation not found')
text = text.replace(old_imported, new_imported, 1)

registration_anchor = """        {activeTab === 'conferences' && (\n          <div className=\"space-y-4\">\n            <div>\n              <h3 className=\"text-base font-bold text-slate-900\">ConferenceGate Registrations</h3>"""
feedback_banner = """        {activeTab === 'conferences' && (\n          <div className=\"mb-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 flex items-start gap-3\">\n            <div className=\"w-9 h-9 rounded-xl bg-white border border-blue-100 flex items-center justify-center shrink-0\">\n              <Gauge className=\"w-4 h-4 text-blue-700\" />\n            </div>\n            <div>\n              <h3 className=\"text-sm font-extrabold text-slate-900\">Conference &amp; Workshop Feedback</h3>\n              <p className=\"text-[11px] text-slate-600 mt-1\">\n                Evaluate conferences you attended using the structured Facilitator / Speaker and Conference / Workshop questionnaire.\n                Use <span className=\"font-bold text-blue-700\">Evaluate Conference</span> beside an eligible history record.\n              </p>\n            </div>\n          </div>\n        )}\n\n""" + registration_anchor
if registration_anchor not in text:
    raise SystemExit('Conference registration anchor not found')
text = text.replace(registration_anchor, feedback_banner, 1)

self_reported_anchor = """                    <div className=\"flex items-center gap-2 shrink-0\">\n                      <span className=\"px-2.5 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] rounded-full whitespace-nowrap\">\n                        Self-Reported\n                      </span>"""
self_reported_replacement = """                    <div className=\"flex items-center gap-2 shrink-0\">\n                      <button\n                        onClick={() => setFeedbackConference({\n                          title: entry.conferenceName,\n                          location: entry.location || '',\n                          roleLabel: entry.role || 'Attendee',\n                          organizerName: '',\n                          eventDate: entry.year || '',\n                          defaultRole: 'Attendee',\n                        })}\n                        className=\"px-2.5 py-1 border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors\"\n                      >\n                        Evaluate Conference\n                      </button>\n                      <span className=\"px-2.5 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] rounded-full whitespace-nowrap\">\n                        Self-Reported\n                      </span>"""
if self_reported_anchor not in text:
    raise SystemExit('Self-reported attendance action anchor not found')
text = text.replace(self_reported_anchor, self_reported_replacement, 1)

# Rename the existing registration CTA for consistent discoverability.
text = text.replace(
""">\n                        Leave Feedback\n                      </button>""",
""">\n                        Evaluate Conference\n                      </button>""",
1,
)

user_path.write_text(text)

linkedin_path = Path('src/components/LinkedInImportedTabSections.tsx')
text = linkedin_path.read_text()

text = text.replace(
"""interface Props {\n  tab: string;\n  onPaperTitlesChange?: (titles: string[]) => void;\n}""",
"""interface Props {\n  tab: string;\n  onPaperTitlesChange?: (titles: string[]) => void;\n  onLeaveFeedback?: (signal: LinkedInConferenceSignal) => void;\n}""",
1,
)

old_signal = """function SignalCard({ signal }: { signal: LinkedInConferenceSignal }) {\n  return (\n    <div className=\"p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start justify-between gap-3\">\n      <div className=\"min-w-0\">\n        <h4 className=\"font-bold text-xs text-slate-900\">{signal.label}</h4>\n        <p className=\"text-[11px] text-slate-500 mt-0.5\">\n          {[signal.role, signal.year, signal.kind.replaceAll('_', ' ')].filter(Boolean).join(' • ')}\n        </p>\n        {sourceLink(signal.sourceUrl)}\n      </div>\n      <EvidenceBadge claimed={signal.memberClaimed} confidence={signal.confidence} />\n    </div>\n  );\n}"""
new_signal = """function SignalCard({\n  signal,\n  onLeaveFeedback,\n}: {\n  signal: LinkedInConferenceSignal;\n  onLeaveFeedback?: (signal: LinkedInConferenceSignal) => void;\n}) {\n  const feedbackEligible = Boolean(\n    onLeaveFeedback &&\n    signal.memberClaimed &&\n    !signal.repostOrQuote &&\n    signal.confidence >= 80 &&\n    (signal.kind === 'PAST_CONFERENCE' || signal.kind === 'CONFERENCE_ROLE')\n  );\n\n  return (\n    <div className=\"p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start justify-between gap-3\">\n      <div className=\"min-w-0\">\n        <h4 className=\"font-bold text-xs text-slate-900\">{signal.label}</h4>\n        <p className=\"text-[11px] text-slate-500 mt-0.5\">\n          {[signal.role, signal.year, signal.kind.replaceAll('_', ' ')].filter(Boolean).join(' • ')}\n        </p>\n        {sourceLink(signal.sourceUrl)}\n      </div>\n      <div className=\"flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0\">\n        {feedbackEligible && (\n          <button\n            type=\"button\"\n            onClick={() => onLeaveFeedback?.(signal)}\n            className=\"px-2.5 py-1 border border-blue-200 bg-white text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors whitespace-nowrap\"\n          >\n            Evaluate Conference\n          </button>\n        )}\n        <EvidenceBadge claimed={signal.memberClaimed} confidence={signal.confidence} />\n      </div>\n    </div>\n  );\n}"""
if old_signal not in text:
    raise SystemExit('SignalCard block not found')
text = text.replace(old_signal, new_signal, 1)

text = text.replace(
"""export const LinkedInImportedTabSections: React.FC<Props> = ({ tab, onPaperTitlesChange }) => {""",
"""export const LinkedInImportedTabSections: React.FC<Props> = ({ tab, onPaperTitlesChange, onLeaveFeedback }) => {""",
1,
)

old_map = """<div className=\"space-y-2\">{conferenceSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>"""
new_map = """<div className=\"space-y-2\">{conferenceSignals.map((signal) => <SignalCard key={signal.id} signal={signal} onLeaveFeedback={onLeaveFeedback} />)}</div>"""
if old_map not in text:
    raise SystemExit('Conference signal mapping not found')
text = text.replace(old_map, new_map, 1)

linkedin_path.write_text(text)
