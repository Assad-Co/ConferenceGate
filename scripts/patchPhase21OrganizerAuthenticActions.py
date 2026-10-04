from pathlib import Path

path = Path('src/components/OrganizerDashboard.tsx')
text = path.read_text()

def replace(old: str, new: str, label: str):
    global text
    if old not in text:
        raise RuntimeError(f'missing patch marker: {label}')
    text = text.replace(old, new, 1)

replace(
"""  const [committeeMatches, setCommitteeMatches] = useState<
    Array<{ reviewerId: string; matchPercentage: number; reason: string }> | null
  >(null);""",
"""  const [committeeMatches, setCommitteeMatches] = useState<
    Array<{ reviewerId: string; matchPercentage: number | null; reason: string }> | null
  >(null);""",
'nullable committee score')

replace('matchPercentage: Math.min(98, 95 - idx * 6),', 'matchPercentage: null,', 'committee fake score')
replace('matchPercentage: Math.min(97, 94 - idx * 5),', 'matchPercentage: null,', 'reviewer fake score')

old_badge = """                          <span className=\"px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full\">
                            {match.matchPercentage}% Match
                          </span>"""
new_badge = """                          {typeof match.matchPercentage === 'number' ? (
                            <span className=\"px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full\">
                              {match.matchPercentage}% AI Match
                            </span>
                          ) : (
                            <span className=\"px-2.5 py-1 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-full\">
                              Review-history candidate
                            </span>
                          )}"""
replace(old_badge, new_badge, 'reviewer fallback badge')

old_committee_badge = """                        <span className=\"px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full\">
                          {match.matchPercentage}% Match
                        </span>"""
new_committee_badge = """                        {typeof match.matchPercentage === 'number' ? (
                          <span className=\"px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full\">
                            {match.matchPercentage}% AI Match
                          </span>
                        ) : (
                          <span className=\"px-2.5 py-1 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-full\">
                            Review-history candidate
                          </span>
                        )}"""
replace(old_committee_badge, new_committee_badge, 'committee fallback badge')

replace("hall: item.type === 'Technical Session' ? 'Main Hall' : item.type,", "hall: '',", 'fabricated hall')

replace(
"""  const [followUpDraft, setFollowUpDraft] = useState({
    from: 'Conference Organizer',
    to: 'Technical Committee Chair',
    message: '',
    sendEmail: true,
  });
  const [committeeFollowUps, setCommitteeFollowUps] = useState<
    Array<{ id: string; from: string; to: string; message: string; date: string; sendEmail: boolean }>
  >([]);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);

  const followUpRecipientEmail = (to: string) =>
    `${to.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\\.|\\.$/g, '')}@conferencegate.app`;""",
"""  const [followUpDraft, setFollowUpDraft] = useState({
    from: 'Conference Organizer',
    to: 'Technical Committee Chair',
    message: '',
  });
  const [committeeFollowUps, setCommitteeFollowUps] = useState<
    Array<{ id: string; from: string; to: string; message: string; date: string }>
  >([]);""",
'fake email state')

replace(
"""    // In-app notification is always sent — it's the source of truth for delivery in Conference Gate.
    onAddNotification({
      title: `Follow-Up from ${followUpDraft.from}`,
      message: followUpDraft.message,
      type: 'followup',
    });
    setExpandedEmailId(followUpDraft.sendEmail ? id : null);
    setFollowUpDraft({ ...followUpDraft, message: '' });""",
"""    // This is a local coordination note only. Do not claim delivery to a committee member unless
    // the recipient is linked to a real ConferenceGate identity and a server delivery route.
    setFollowUpDraft({ ...followUpDraft, message: '' });""",
'fake delivery behavior')

replace(
"""                  <span className=\"inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700\">
                    <Bell className=\"w-3 h-3\" />
                    In-app notification always sent
                  </span>
                  <label className=\"flex items-center gap-1.5 cursor-pointer font-semibold text-slate-600\">
                    <input
                      type=\"checkbox\"
                      checked={followUpDraft.sendEmail}
                      onChange={(e) => setFollowUpDraft({ ...followUpDraft, sendEmail: e.target.checked })}
                      className=\"w-3.5 h-3.5 text-blue-600 rounded cursor-pointer\"
                    />
                    Also send email copy (optional)
                  </label>""",
"""                  <span className=\"inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800\">
                    <ShieldAlert className=\"w-3 h-3\" />
                    Coordination note only — no email or member notification is sent
                  </span>""",
'follow-up controls')

replace('<span>Send Follow-Up</span>', '<span>Save Coordination Note</span>', 'follow-up button')

old_history = """                    <div className=\"flex items-center gap-2 mt-2\">
                      <span className=\"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700\">
                        <Bell className=\"w-3 h-3\" />
                        In-app notification sent
                      </span>
                      {fu.sendEmail ? (
                        <button
                          type=\"button\"
                          onClick={() => setExpandedEmailId((cur) => (cur === fu.id ? null : fu.id))}
                          className=\"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 cursor-pointer transition-colors\"
                        >
                          <Mail className=\"w-3 h-3\" />
                          Email sent{expandedEmailId === fu.id ? ' — hide' : ' — view'}
                        </button>
                      ) : (
                        <span className=\"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400\">
                          <Mail className=\"w-3 h-3\" />
                          No email sent
                        </span>
                      )}
                    </div>

                    {fu.sendEmail && expandedEmailId === fu.id && (
                      <div className=\"mt-2 bg-white border border-slate-200 rounded-xl overflow-hidden\">
                        <div className=\"px-3 py-2 bg-slate-100 border-b border-slate-200 space-y-0.5\">
                          <div className=\"flex items-center gap-1.5 text-[10px] text-slate-500\">
                            <span className=\"font-bold text-slate-700 w-12 shrink-0\">From:</span>
                            {followUpRecipientEmail(fu.from)}
                          </div>
                          <div className=\"flex items-center gap-1.5 text-[10px] text-slate-500\">
                            <span className=\"font-bold text-slate-700 w-12 shrink-0\">To:</span>
                            {followUpRecipientEmail(fu.to)}
                          </div>
                          <div className=\"flex items-center gap-1.5 text-[10px] text-slate-500\">
                            <span className=\"font-bold text-slate-700 w-12 shrink-0\">Subject:</span>
                            Follow-Up: {fu.from} → {fu.to}
                          </div>
                        </div>
                        <p className=\"p-3 text-[11px] text-slate-700 leading-relaxed\">{fu.message}</p>
                      </div>
                    )}"""
new_history = """                    <div className=\"flex items-center gap-2 mt-2\">
                      <span className=\"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800\">
                        <ShieldAlert className=\"w-3 h-3\" />
                        Session-only coordination note
                      </span>
                    </div>"""
replace(old_history, new_history, 'fake email history')

replace(
"""              <h3 className=\"font-bold text-sm text-slate-900\">Assign Tasks to Committee Members</h3>
            </div>
            <form onSubmit={handleAssignTask} className=\"space-y-3 text-xs\">""",
"""              <div>
                <h3 className=\"font-bold text-sm text-slate-900\">Committee Task Planning</h3>
                <p className=\"text-[10px] text-amber-700 mt-0.5\">Session-only planning board. Tasks are not yet persisted or delivered to members.</p>
              </div>
            </div>
            <form onSubmit={handleAssignTask} className=\"space-y-3 text-xs\">""",
'task disclosure')
replace('<span>Assign Task</span>', '<span>Add Planning Task</span>', 'task button')

replace(
"""                <p className=\"text-[10px] text-slate-400\">
                  Conference Gate doesn't generate meeting rooms — paste the link from your own video conferencing
                  account.
                </p>""",
"""                <p className=\"text-[10px] text-amber-700\">
                  Planning only: ConferenceGate does not create the room, send invitations, or persist this plan yet. Paste a real link from your conferencing account.
                </p>""",
'meeting disclosure')
replace('<span>Schedule Meeting</span>', '<span>Add Meeting Plan</span>', 'meeting button')

path.write_text(text)
print('Phase 21 organizer authenticity patch applied')
