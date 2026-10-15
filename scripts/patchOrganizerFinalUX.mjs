import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboardFile = path.join(root, 'src/components/OrganizerDashboard.tsx');
const recruitmentFile = path.join(root, 'src/components/ProfessionalRecruitmentPanel.tsx');
const uploadFile = path.join(root, 'src/components/OrganizerReviewerQuickUpload.tsx');
const clientActivityFile = path.join(root, 'src/api/activity.ts');
const serverActivityFile = path.join(root, 'server/activity.ts');

const replaceAll = (source, pairs) => {
  for (const [from, to] of pairs) source = source.split(from).join(to);
  return source;
};

let dashboard = fs.readFileSync(dashboardFile, 'utf8');
dashboard = replaceAll(dashboard, [
  ['Professional Network & Committee Recruitment', 'Professional Network & Committee Connections'],
  ['Abstracts & AI Matcher', 'Abstracts & Reviewer Matching'],
  ['Abstract Submissions & AI Reviewer Allocation', 'Abstract Submissions & Reviewer Matching'],
  ['assign accredited peer reviewers using AI subject-matter matching', 'assign suitable peer reviewers using subject-matter matching'],
  ['AI Reviewer Match', 'Reviewer Match'],
  ['AI Match Reviewers', 'Match Reviewers'],
  ['AI matching is unavailable right now', 'Automated matching is unavailable right now'],
  ['Nominate candidates with AI, review your current committee roster, assign tasks, and keep the\n              organizer, chair, and co-chair in sync with follow-up notifications.', 'Find suitable candidates, review your current committee roster, assign tasks, and keep the\n              organizer, chair, and co-chair connected with messages and notifications.'],
  ['Review topic (e.g. Reservoir Analytics & AI) *', 'Review topic (e.g. Reservoir Analytics) *'],
  ['Expertise required, comma separated', 'Expertise focus, comma separated'],
  ['Publish to Marketplace', 'Publish Reviewer Opportunity'],
]);

if (!dashboard.includes('sendCommitteeAnnouncement')) {
  dashboard = dashboard.replace(
    '  createOrganizerCoordinationNote,\n  type OrganizerCoordinationNote,',
    '  createOrganizerCoordinationNote,\n  sendCommitteeAnnouncement,\n  type OrganizerCoordinationNote,'
  );

  const stateAnchor = "  const [committeeFollowUps, setCommitteeFollowUps] = useState<OrganizerCoordinationNote[]>([]);\n";
  if (!dashboard.includes(stateAnchor)) throw new Error('Organizer UX patch: committee follow-up state anchor missing');
  dashboard = dashboard.replace(stateAnchor, `${stateAnchor}  const [committeeMessageDraft, setCommitteeMessageDraft] = useState({ conferenceId: '', subject: '', body: '' });\n  const [committeeMessageSending, setCommitteeMessageSending] = useState(false);\n\n  useEffect(() => {\n    if (!committeeMessageDraft.conferenceId && conferences[0]) {\n      setCommitteeMessageDraft((prev) => ({ ...prev, conferenceId: conferences[0].id }));\n    }\n  }, [conferences, committeeMessageDraft.conferenceId]);\n\n  const handleSendCommitteeAnnouncement = async (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!committeeMessageDraft.conferenceId || !committeeMessageDraft.subject.trim() || !committeeMessageDraft.body.trim()) return;\n    setCommitteeMessageSending(true);\n    try {\n      const result = await sendCommitteeAnnouncement({\n        conferenceId: committeeMessageDraft.conferenceId,\n        subject: committeeMessageDraft.subject.trim(),\n        body: committeeMessageDraft.body.trim(),\n      });\n      setCommitteeMessageDraft((prev) => ({ ...prev, subject: '', body: '' }));\n      showToast({\n        type: 'success',\n        title: 'Committee message sent',\n        message: result.notifiedCount > 0\n          ? \`\${result.notifiedCount} accepted committee member\${result.notifiedCount === 1 ? '' : 's'} received a ConferenceGate notification.\`\n          : 'No accepted committee members are connected to this conference yet.',\n      });\n    } catch (error) {\n      showToast({ type: 'info', title: 'Could not send committee message', message: error instanceof Error ? error.message : 'Please try again.' });\n    } finally {\n      setCommitteeMessageSending(false);\n    }\n  };\n`);

  const uiAnchor = `          {/* AI Nomination */}`;
  if (!dashboard.includes(uiAnchor)) throw new Error('Organizer UX patch: Technical Committee UI anchor missing');
  const committeeCard = `          <div className="bg-white rounded-2xl border border-blue-100 p-6 shadow-xs space-y-4">\n            <div>\n              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-600" />Message Technical Committee</h3>\n              <p className="text-[11px] text-slate-500 mt-1">Send a real ConferenceGate notification to accepted Technical Committee members and chairs for one of your conferences.</p>\n            </div>\n            <form onSubmit={handleSendCommitteeAnnouncement} className="grid grid-cols-1 md:grid-cols-2 gap-3">\n              <select value={committeeMessageDraft.conferenceId} onChange={(e) => setCommitteeMessageDraft({ ...committeeMessageDraft, conferenceId: e.target.value })} className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold">\n                <option value="">Select conference...</option>\n                {conferences.map((conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}\n              </select>\n              <input value={committeeMessageDraft.subject} onChange={(e) => setCommitteeMessageDraft({ ...committeeMessageDraft, subject: e.target.value })} placeholder="Message subject" className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs" />\n              <textarea value={committeeMessageDraft.body} onChange={(e) => setCommitteeMessageDraft({ ...committeeMessageDraft, body: e.target.value })} placeholder="Message to the Technical Committee" className="md:col-span-2 p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs min-h-24" />\n              <button type="submit" disabled={committeeMessageSending || !committeeMessageDraft.conferenceId || !committeeMessageDraft.subject.trim() || !committeeMessageDraft.body.trim()} className="md:col-span-2 px-4 py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"><Bell className="w-4 h-4" />{committeeMessageSending ? 'Sending…' : 'Send Message & Notification'}</button>\n            </form>\n          </div>\n\n`;
  dashboard = dashboard.replace(uiAnchor, committeeCard + uiAnchor);
}

fs.writeFileSync(dashboardFile, dashboard);

let recruitment = fs.readFileSync(recruitmentFile, 'utf8');
recruitment = replaceAll(recruitment, [
  ['Build the committee from basic conference information', 'Connect with the right committee from basic conference information'],
  ['Create a lightweight conference draft, search the Professional Network, and invite committee members. Once a Professional accepts, continue into the full Conference Wizard.', 'Create a lightweight conference draft, search the Professional Network, and connect with committee members. Once a Professional accepts, continue into the full Conference Wizard.'],
  ['Save basic conference & recruit committee', 'Save basic conference & connect committee'],
  ['Select conference / recruitment draft', 'Select conference / committee draft'],
  [' — recruitment draft', ' — committee draft'],
]);
fs.writeFileSync(recruitmentFile, recruitment);

let upload = fs.readFileSync(uploadFile, 'utf8');
upload = replaceAll(upload, [
  ['Place a file for reviewers', 'Upload abstract / review document'],
  ['Choose the submitted abstract, then upload the PDF, DOC or DOCX that reviewers should work on.', 'Choose the submitted abstract, then upload a PDF, DOC or DOCX (Microsoft Word) for reviewers to open and return securely.'],
  ["{busy ? 'Uploading…' : 'Add Review File'}", "{busy ? 'Uploading…' : 'Upload File'}"],
]);
fs.writeFileSync(uploadFile, upload);

let clientActivity = fs.readFileSync(clientActivityFile, 'utf8');
if (!clientActivity.includes('export async function sendCommitteeAnnouncement')) {
  clientActivity += `\n\nexport async function sendCommitteeAnnouncement(payload: { conferenceId: string; subject: string; body: string }): Promise<{ notifiedCount: number; recipientCount: number }> {\n  const res = await fetch('/api/activity/organizer/committee-message', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify(payload),\n  });\n  return parseResponse(res);\n}\n`;
}
fs.writeFileSync(clientActivityFile, clientActivity);

let serverActivity = fs.readFileSync(serverActivityFile, 'utf8');
if (!serverActivity.includes('/organizer/committee-message')) {
  const anchor = 'activityRouter.post("/broadcasts", asyncHandler(async (req: AuthedRequest, res: Response) => {';
  if (!serverActivity.includes(anchor)) throw new Error('Organizer UX patch: broadcasts route anchor missing');
  const route = `activityRouter.post("/organizer/committee-message", asyncHandler(async (req: AuthedRequest, res: Response) => {\n  const organizerContext = await organizerWorkspaceContext(req, res, true);\n  if (!organizerContext) return;\n  const body = req.body || {};\n  const conferenceId = typeof body.conferenceId === "string" ? body.conferenceId.trim() : "";\n  const subject = typeof body.subject === "string" ? body.subject.trim() : "";\n  const message = typeof body.body === "string" ? body.body.trim() : "";\n  if (!conferenceId || !subject || !message) return res.status(400).json({ error: "Conference, subject, and message are required." });\n\n  const conference = await dbGet<CreatedConferenceRow>(\n    "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",\n    [conferenceId, organizerContext.accountId]\n  );\n  if (!conference) return res.status(404).json({ error: "Conference not found in this Organizer workspace." });\n\n  const recipients = await dbAll<{ professional_id: string }>(\n    \`SELECT DISTINCT professional_id FROM professional_invitations\n      WHERE organizer_id = ? AND conference_id = ? AND status IN ('accepted','completed') AND role_type IN ('committee','chair')\`,\n    [organizerContext.accountId, conferenceId]\n  );\n  for (const recipient of recipients) {\n    await createNotification(recipient.professional_id, "followup", subject, message);\n  }\n\n  const id = \`bc_\${crypto.randomUUID()}\`;\n  await dbRun(\n    "INSERT INTO organizer_broadcasts (id, organizer_id, recipient_group, subject, body) VALUES (?, ?, ?, ?, ?)",\n    [id, organizerContext.accountId, "Technical Committee", subject, message]\n  );\n  res.status(201).json({ notifiedCount: recipients.length, recipientCount: recipients.length });\n}));\n\n`;
  serverActivity = serverActivity.replace(anchor, route + anchor);
}
fs.writeFileSync(serverActivityFile, serverActivity);

console.log('Organizer final UX and committee communication patch applied.');
