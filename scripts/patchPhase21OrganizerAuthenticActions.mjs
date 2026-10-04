import fs from 'node:fs';

const path = 'src/components/OrganizerDashboard.tsx';
let text = fs.readFileSync(path, 'utf8');

function replace(from, to, label) {
  if (!text.includes(from)) throw new Error(`missing patch marker: ${label}`);
  text = text.replace(from, to);
}

replace(
`  const [committeeMatches, setCommitteeMatches] = useState<
    Array<{ reviewerId: string; matchPercentage: number; reason: string }> | null
  >(null);`,
`  const [committeeMatches, setCommitteeMatches] = useState<
    Array<{ reviewerId: string; matchPercentage: number | null; reason: string }> | null
  >(null);`,
'nullable committee match score'
);

replace(
`      setCommitteeMatchIsFallback(true);
      setCommitteeMatches(
        committeeCandidatePool.map((c, idx) => ({
          reviewerId: c.id,
          matchPercentage: Math.min(98, 95 - idx * 6),
          reason: \`${c.reviewCount} completed peer review${c.reviewCount === 1 ? '' : 's'} on Conference Gate${
            c.expertise[0] ? \`, including work in ${c.expertise[0]}\` : ''
          }.\`,
        }))
      );`,
`      setCommitteeMatchIsFallback(true);
      setCommitteeMatches(
        [...committeeCandidatePool]
          .sort((a, b) => b.reviewCount - a.reviewCount)
          .map((c) => ({
            reviewerId: c.id,
            matchPercentage: null,
            reason: \`${c.reviewCount} completed peer review${c.reviewCount === 1 ? '' : 's'} on ConferenceGate${
              c.expertise[0] ? \`, including recorded work in ${c.expertise[0]}\` : ''
            }. No AI match score is available.\`,
          }))
      );`,
'committee fallback score removal'
);

replace(
`      setAiMatchIsFallback(true);
      setAiMatches(
        candidatePool.map((c, idx) => ({
          reviewerId: c.id,
          matchPercentage: Math.min(97, 94 - idx * 5),
          reason: \`${c.reviewCount} completed peer review${c.reviewCount === 1 ? '' : 's'} on Conference Gate${
            c.expertise[0] ? \`, including work in ${c.expertise[0]}\` : ''
          }.\`,
        }))
      );`,
`      setAiMatchIsFallback(true);
      setAiMatches(
        [...candidatePool]
          .sort((a, b) => b.reviewCount - a.reviewCount)
          .map((c) => ({
            reviewerId: c.id,
            matchPercentage: null,
            reason: \`${c.reviewCount} completed peer review${c.reviewCount === 1 ? '' : 's'} on ConferenceGate${
              c.expertise[0] ? \`, including recorded work in ${c.expertise[0]}\` : ''
            }. No AI match score is available.\`,
          }))
      );`,
'reviewer fallback score removal'
);

replace(
`                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                            {match.matchPercentage}% Match
                          </span>`,
`                          {typeof match.matchPercentage === 'number' ? (
                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                              {match.matchPercentage}% AI Match
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-full">
                              Review-history candidate
                            </span>
                          )}`,
'abstract reviewer fallback badge'
);

replace(
`                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                          {match.matchPercentage}% Match
                        </span>`,
`                        {typeof match.matchPercentage === 'number' ? (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                            {match.matchPercentage}% AI Match
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-full">
                            Review-history candidate
                          </span>
                        )}`,
'committee fallback badge'
);

replace(
`            id: \`sess_${date}_${idx}\`,
            time: item.time,
            title: item.title,
            hall: item.type === 'Technical Session' ? 'Main Hall' : item.type,`,
`            id: \`sess_${date}_${idx}\`,
            time: item.time,
            title: item.title,
            hall: '',`,
'fabricated hall removal'
);

replace(
`  const [followUpDraft, setFollowUpDraft] = useState({
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
    \`${to.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\\.|\\.$/g, '')}@conferencegate.app\`;`,
`  const [followUpDraft, setFollowUpDraft] = useState({
    from: 'Conference Organizer',
    to: 'Technical Committee Chair',
    message: '',
  });
  const [committeeFollowUps, setCommitteeFollowUps] = useState<
    Array<{ id: string; from: string; to: string; message: string; date: string }>
  >([]);`,
'fake follow-up email state removal'
);

replace(
`    setCommitteeFollowUps((prev) => [
      { id, ...followUpDraft, date: new Date().toLocaleString() },
      ...prev,
    ]);
    // In-app notification is always sent — it's the source of truth for delivery in Conference Gate.
    onAddNotification({
      title: \`Follow-Up from ${followUpDraft.from}\`,
      message: followUpDraft.message,
      type: 'followup',
    });
    setExpandedEmailId(followUpDraft.sendEmail ? id : null);
    setFollowUpDraft({ ...followUpDraft, message: '' });`,
`    setCommitteeFollowUps((prev) => [
      { id, ...followUpDraft, date: new Date().toLocaleString() },
      ...prev,
    ]);
    // This panel currently records a local coordination note only. It must not claim delivery to
    // a committee member unless that person is linked to a real ConferenceGate account.
    setFollowUpDraft({ ...followUpDraft, message: '' });`,
'fake follow-up notification claim removal'
);

replace(
`                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700">
                    <Bell className="w-3 h-3" />
                    In-app notification always sent
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={followUpDraft.sendEmail}
                      onChange={(e) => setFollowUpDraft({ ...followUpDraft, sendEmail: e.target.checked })}
                      className="w-3.5 h-3.5 text-blue-600 rounded cursor-pointer"
                    />
                    Also send email copy (optional)
                  </label>`,
`                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">
                    <ShieldAlert className="w-3 h-3" />
                    Coordination note only — no email or member notification is sent
                  </span>`,
'follow-up delivery copy'
);

replace(
`                <span>Send Follow-Up</span>`,
`                <span>Save Coordination Note</span>`,
'follow-up button copy'
);

replace(
`              <h3 className="font-bold text-sm text-slate-900">Assign Tasks to Committee Members</h3>
            </div>
            <form onSubmit={handleAssignTask} className="space-y-3 text-xs">`,
`              <div>
                <h3 className="font-bold text-sm text-slate-900">Committee Task Planning</h3>
                <p className="text-[10px] text-amber-700 mt-0.5">Session-only planning board. Tasks are not yet persisted or delivered to members.</p>
              </div>
            </div>
            <form onSubmit={handleAssignTask} className="space-y-3 text-xs">`,
'task persistence disclosure'
);

replace(
`                  <span>Assign Task</span>`,
`                  <span>Add Planning Task</span>`,
'task action copy'
);

replace(
`                <span>Schedule Meeting</span>`,
`                <span>Add Meeting Plan</span>`,
'meeting action copy'
);

replace(
`                <p className="text-[10px] text-slate-400">
                  Conference Gate doesn't generate meeting rooms — paste the link from your own video conferencing
                  account.
                </p>`,
`                <p className="text-[10px] text-amber-700">
                  Planning only: ConferenceGate does not create the meeting room, send invitations, or persist this plan yet. Paste a real link from your conferencing account.
                </p>`,
'meeting persistence disclosure'
);

fs.writeFileSync(path, text);
console.log('Phase 21 organizer authenticity patch applied');
