import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, text) => fs.writeFileSync(path, text);
function replaceExact(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(from, to);
}
function replaceRegex(text, re, to, label) {
  if (!re.test(text)) throw new Error(`Missing regex anchor: ${label}`);
  return text.replace(re, to);
}

// Sponsor Portal: simplified sponsor journey, light-blue active navigation, organizer requests only.
{
  const path = 'src/components/SponsorPortal.tsx';
  let text = read(path);

  text = text
    .replace('  createSponsorRequest,\n', '')
    .replace('  fetchMySponsorRequests,\n', '')
    .replace('  type SponsorRequest,\n', '');

  text = replaceExact(
    text,
    `  const [activeTab, setActiveTab] = useState<'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'workspace' | 'roi' | 'profile'>('matches');`,
    `  const [activeTab, setActiveTab] = useState<'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'workspace' | 'roi' | 'profile'>('preferences');`,
    'Sponsor default tab'
  );

  text = text.replace(`  const [sponsorRequests, setSponsorRequests] = useState<SponsorRequest[]>([]);\n`, '');
  text = text.replace(`  const [requestSaving, setRequestSaving] = useState(false);\n`, '');
  text = replaceRegex(
    text,
    /  const \[requestDraft, setRequestDraft\] = useState\(\{[\s\S]*?\n  \}\);\n/,
    '',
    'Sponsor request draft state'
  );

  text = replaceExact(
    text,
    `      const [pref, needs, deals, requests, responses, analytics, watchlist, launchpad] = await Promise.all([\n        fetchMySponsorPreferences(),\n        fetchMatchedSponsorshipNeeds(),\n        fetchMySponsorshipDeals('sponsor'),\n        fetchMySponsorRequests(),\n        fetchMySponsorRequestResponses(),\n        fetchSponsorPortfolioAnalytics(),\n        fetchSponsorWatchlist(),\n        fetchSponsorLaunchpad(),\n      ]);`,
    `      const [pref, needs, deals, responses, analytics, watchlist, launchpad] = await Promise.all([\n        fetchMySponsorPreferences(),\n        fetchMatchedSponsorshipNeeds(),\n        fetchMySponsorshipDeals('sponsor'),\n        fetchMySponsorRequestResponses(),\n        fetchSponsorPortfolioAnalytics(),\n        fetchSponsorWatchlist(),\n        fetchSponsorLaunchpad(),\n      ]);`,
    'Sponsor data Promise list'
  );
  text = text.replace(`      setSponsorRequests(requests);\n`, '');

  text = replaceRegex(
    text,
    /  const handleCreateSponsorRequest = async \(event: React\.FormEvent\) => \{[\s\S]*?\n  \};\n\n(?=  const handleSponsorRequestResponseDecision)/,
    '',
    'Sponsor request creation handler'
  );

  text = text.replace('✓ Matching preferences', '✓ Sponsor Wizard');

  const nav = `      {/* Navigation Sub-Tabs — one simple sponsor journey */}\n      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">\n        {[\n          { id: 'preferences', label: 'Sponsor Wizard', icon: SlidersHorizontal, count: null },\n          { id: 'marketplace', label: 'Sponsorship Marketplace', icon: Briefcase, count: sponsorshipPackages.length },\n          { id: 'matches', label: 'Matched Opportunities', icon: Target, count: matchedNeeds.length },\n          { id: 'requests', label: 'Organizer Requests', icon: Send, count: sponsorRequestResponses.length },\n          { id: 'saved', label: 'Saved', icon: Bookmark, count: savedOpportunities.length },\n          { id: 'deals', label: 'Deal Rooms', icon: Briefcase, count: sponsorshipDeals.length },\n          { id: 'roi', label: 'Sponsor ROI', icon: DollarSign, count: null },\n          { id: 'profile', label: 'Sponsor Profile', icon: Star, count: null },\n        ].map((tab) => {\n          const Icon = tab.icon;\n          const active = activeTab === tab.id;\n          return (\n            <button\n              key={tab.id}\n              type="button"\n              onClick={() => setActiveTab(tab.id as any)}\n              className={\`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap border \${\n                active\n                  ? 'bg-blue-50 text-blue-800 border-blue-200 font-bold shadow-xs'\n                  : 'bg-white border-transparent hover:bg-blue-50/70 hover:text-blue-800 text-slate-700'\n              }\`}\n            >\n              <Icon className="w-3.5 h-3.5" />\n              <span>{tab.label}{tab.count === null ? '' : \` (\${tab.count})\`}</span>\n              {tab.id === 'marketplace' && unreadAlertCount > 0 && (\n                <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">\n                  {unreadAlertCount}\n                </span>\n              )}\n            </button>\n          );\n        })}\n      </div>`;

  text = replaceRegex(
    text,
    /      \{\/\* Navigation Sub-Tabs \*\/\}\n      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">[\s\S]*?\n      <\/div>\n\n(?=      \{\/\* Sponsor Pro: internally matched organizer sponsorship needs \*\/\})/,
    nav + '\n\n',
    'Sponsor navigation'
  );

  const organizerRequests = `      {/* Organizer-originated sponsor requests / proposals only. Sponsors no longer publish reverse-marketplace requests. */}\n      {activeTab === 'requests' && (\n        <div className="space-y-6">\n          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">\n            <div className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600">Organizer → Sponsor</div>\n            <h2 className="text-xl font-bold text-slate-900 mt-1">Organizer Requests</h2>\n            <p className="text-xs text-slate-500 mt-1 max-w-3xl">\n              Direct conference proposals and sponsorship invitations sent by organizers appear here. Sponsors do not publish requests from this portal.\n            </p>\n          </div>\n\n          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">\n            {sponsorRequestResponses.length === 0 ? (\n              <div className="p-10 text-center">\n                <Send className="w-9 h-9 text-slate-300 mx-auto mb-2" />\n                <h3 className="text-sm font-bold text-slate-800">No direct organizer requests yet</h3>\n                <p className="text-xs text-slate-500 mt-1">\n                  Organizer-published opportunities are still ranked under Matched Opportunities. Direct proposals will appear here when an organizer sends one to your sponsor workspace.\n                </p>\n              </div>\n            ) : (\n              <div className="divide-y divide-slate-100">\n                {sponsorRequestResponses.map((response) => (\n                  <div key={response.id} className="p-5 flex flex-col md:flex-row md:items-center gap-4 justify-between">\n                    <div>\n                      <div className="font-bold text-sm text-slate-900">{response.conferenceTitle}</div>\n                      <div className="text-[11px] text-slate-500">Organizer: {response.organizerName}</div>\n                      {response.message && <p className="text-[11px] text-slate-600 mt-1">{response.message}</p>}\n                    </div>\n                    {response.status === 'new' ? (\n                      <div className="flex gap-2 shrink-0">\n                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'declined')} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer">Decline</button>\n                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'accepted')} className="px-3 py-2 rounded-lg bg-blue-700 text-white text-xs font-bold cursor-pointer">Accept</button>\n                      </div>\n                    ) : (\n                      <span className={\`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase \${\n                        response.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'\n                      }\`}>{response.status}</span>\n                    )}\n                  </div>\n                ))}\n              </div>\n            )}\n          </div>\n        </div>\n      )}\n\n`;

  text = replaceRegex(
    text,
    /      \{\/\* Sponsor Pro reverse marketplace \*\/\}[\s\S]*?(?=      \{\/\* Sponsor Pro shared commercial Deal Rooms \*\/\})/,
    organizerRequests,
    'Sponsor requests tab'
  );

  text = replaceExact(
    text,
    `        <SponsorWizardPanel\n          preferenceDraft={preferenceDraft}\n          setPreferenceDraft={setPreferenceDraft}\n          saving={savingPreferences}\n          onSubmit={saveSponsorPreferences}\n          onOpenRequests={() => setActiveTab('requests')}\n        />`,
    `        <SponsorWizardPanel\n          preferenceDraft={preferenceDraft}\n          setPreferenceDraft={setPreferenceDraft}\n          saving={savingPreferences}\n          onSubmit={saveSponsorPreferences}\n        />`,
    'Sponsor wizard callsite'
  );

  text = text.replace(
    'These metrics come from your real ConferenceGate matching, inquiries, Deal Rooms, Sponsor Requests, and provider-confirmed payments. No impression or lead numbers are invented.',
    'These metrics come from your real ConferenceGate matching, inquiries, Deal Rooms, organizer proposals, and provider-confirmed payments. No impression or lead numbers are invented.'
  );

  text = replaceRegex(
    text,
    /          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">[\s\S]*?\n          <\/div>\n\n          <div className="p-4 bg-slate-50/,
    `          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">\n            <div className="p-5 bg-white rounded-2xl border border-slate-200">\n              <div className="text-[10px] uppercase font-bold text-slate-400">Organizer Requests</div>\n              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.organizerResponses}</div>\n              <div className="text-[10px] text-slate-500">Direct conference proposals received</div>\n            </div>\n            <div className="p-5 bg-white rounded-2xl border border-slate-200">\n              <div className="text-[10px] uppercase font-bold text-slate-400">Accepted Organizer Requests</div>\n              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.acceptedRequestResponses}</div>\n              <div className="text-[10px] text-slate-500">Organizer proposals accepted</div>\n            </div>\n          </div>\n\n          <div className="p-4 bg-slate-50`,
    'Sponsor ROI request metrics'
  );

  write(path, text);
}

// Sponsor Wizard: remove the sponsor-created request path entirely.
{
  const path = 'src/components/SponsorWizardPanel.tsx';
  let text = read(path);
  text = text.replace(`  onOpenRequests: () => void;\n`, '');
  text = text.replace(`  onOpenRequests,\n`, '');
  text = text.replace(
    'Saving this wizard activates personalized matching. You can change it any time without affecting existing Deal Rooms or Sponsor Requests.',
    'Saving this wizard activates personalized matching. You can change it any time without affecting existing Deal Rooms, saved opportunities, or organizer requests.'
  );
  text = replaceRegex(
    text,
    /\n          <button type="button" onClick=\{onOpenRequests\} className="text-xs font-bold text-blue-700 hover:underline cursor-pointer">Need something specific\? Open Sponsor Request →<\/button>/,
    '',
    'Sponsor Wizard request link'
  );
  write(path, text);
}

// Secure organizer review-material upload. Reuses the existing author_original review-source kind
// so production databases need no CHECK-constraint migration; uploader_id still preserves provenance.
{
  const path = 'server/professionalTrust.ts';
  let text = read(path);
  text = replaceExact(
    text,
    `  const requestedKind = String(body.kind || "");\n  const allowedKind = access.role === "author" ? "author_original" : access.role === "reviewer" ? "reviewer_return" : "organizer_to_author";\n  if (requestedKind && requestedKind !== allowedKind) return res.status(403).json({ error: \`Your role can only upload \${allowedKind} documents.\` });`,
    `  const requestedKind = String(body.kind || "");\n  const allowedKind =\n    access.role === "author"\n      ? "author_original"\n      : access.role === "reviewer"\n        ? "reviewer_return"\n        : requestedKind === "author_original"\n          ? "author_original"\n          : "organizer_to_author";\n  if (requestedKind && requestedKind !== allowedKind) return res.status(403).json({ error: \`Your role can only upload \${allowedKind} documents for this action.\` });`,
    'Organizer review material kind'
  );

  text = replaceExact(
    text,
    `  if (access.role === "reviewer") {\n    const owned = await dbGet<any>("SELECT organizer_id FROM created_conferences WHERE id=?", [access.submission.conference_id]);\n    if (owned?.organizer_id) await createNotification(owned.organizer_id, "followup", "Reviewed abstract file returned", \`A reviewer returned \${fileName} for “\${access.submission.title}”. Open the abstract workflow to review and forward it to the author.\`);\n  } else if (access.role === "organizer") {\n    await createNotification(access.submission.submitter_id, "followup", "Reviewed abstract file from organizer", \`\${access.submission.conference_title} sent \${fileName} for “\${access.submission.title}”.\`);\n  }`,
    `  if (access.role === "reviewer") {\n    const owned = await dbGet<any>("SELECT organizer_id FROM created_conferences WHERE id=?", [access.submission.conference_id]);\n    if (owned?.organizer_id) await createNotification(owned.organizer_id, "followup", "Reviewed abstract file returned", \`A reviewer returned \${fileName} for “\${access.submission.title}”. Open the abstract workflow to review and forward it to the author.\`);\n  } else if (access.role === "organizer" && allowedKind === "author_original") {\n    const reviewers = await dbAll<{ reviewer_id: string }>(\n      "SELECT reviewer_id FROM submission_reviewer_assignments WHERE submission_id=?",\n      [req.params.id]\n    );\n    for (const reviewer of reviewers) {\n      await createNotification(reviewer.reviewer_id, "followup", "Review material available", \`The organizer added \${fileName} for “\${access.submission.title}”. Open your Reviewer Portal to download it.\`);\n    }\n  } else if (access.role === "organizer") {\n    await createNotification(access.submission.submitter_id, "followup", "Reviewed abstract file from organizer", \`\${access.submission.conference_title} sent \${fileName} for “\${access.submission.title}”.\`);\n  }`,
    'Organizer reviewer notification'
  );
  write(path, text);
}

// Shared organizer-side control that exposes secure review materials next to each abstract.
{
  const path = 'src/components/ReviewerTrustWorkflow.tsx';
  let text = read(path);
  const anchor = `export const ReviewerDocumentWorkflow: React.FC<{ submission: AbstractSubmission }> = ({ submission }) => {`;
  if (!text.includes(anchor)) throw new Error('Missing ReviewerDocumentWorkflow anchor');
  const component = `export const OrganizerReviewMaterials: React.FC<{ submission: AbstractSubmission }> = ({ submission }) => {\n  const [documents, setDocuments] = useState<SubmissionDocument[]>([]);\n  const [message, setMessage] = useState<string | null>(null);\n  const [busy, setBusy] = useState(false);\n  const refresh = () => fetchSubmissionDocuments(submission.id).then(setDocuments).catch(() => setDocuments([]));\n  useEffect(() => { refresh(); }, [submission.id]);\n  const reviewFiles = documents.filter((doc) => doc.kind === 'author_original');\n  const returnedFiles = documents.filter((doc) => doc.kind === 'reviewer_return');\n  const upload = async (file?: File) => {\n    if (!file || busy) return;\n    setBusy(true);\n    setMessage(null);\n    try {\n      await uploadSubmissionDocument(submission.id, 'author_original', file);\n      setMessage('Review material added. Assigned reviewers can download it securely.');\n      await refresh();\n    } catch (e: any) {\n      setMessage(e?.message || 'Could not upload review material.');\n    } finally {\n      setBusy(false);\n    }\n  };\n  return <div className="min-w-[210px] space-y-2">\n    <div className="flex flex-wrap items-center gap-2">\n      <label className={\`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-[10px] font-bold cursor-pointer \${busy ? 'opacity-60' : ''}\`}>\n        <Upload className="w-3.5 h-3.5" />{busy ? 'Uploading…' : 'Add review file'}\n        <input type="file" disabled={busy} accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.currentTarget.value = ''; }} />\n      </label>\n      <span className="text-[9px] text-slate-400">PDF/DOC/DOCX · max 5 MB</span>\n    </div>\n    {reviewFiles.length > 0 && <div className="space-y-1">{reviewFiles.map((doc) => <button key={doc.id} type="button" onClick={() => downloadSubmissionDocument(submission.id, doc.id)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-left cursor-pointer"><span className="truncate text-[10px] font-semibold text-slate-700">{doc.fileName}</span><Download className="w-3 h-3 text-blue-600 shrink-0" /></button>)}</div>}\n    {returnedFiles.length > 0 && <div className="text-[9px] font-semibold text-emerald-700">{returnedFiles.length} reviewed file{returnedFiles.length === 1 ? '' : 's'} returned</div>}\n    {message && <div className="text-[9px] font-semibold text-blue-700 max-w-[240px]">{message}</div>}\n  </div>;\n};\n\n`;
  text = text.replace(anchor, component + anchor);
  write(path, text);
}

// Organizer abstract table: attach/download review files directly where reviewers are assigned.
{
  const path = 'src/components/OrganizerDashboard.tsx';
  let text = read(path);
  text = replaceExact(
    text,
    `import { MeetingMinutesPanel } from './MeetingMinutesPanel';`,
    `import { MeetingMinutesPanel } from './MeetingMinutesPanel';\nimport { OrganizerReviewMaterials } from './ReviewerTrustWorkflow';`,
    'Organizer review material import'
  );

  text = replaceExact(
    text,
    `            </form>\n\n            {myReviewOpportunities.length > 0 && (`,
    `            </form>\n\n            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-900">\n              Review documents are attached to each submitted abstract below. Add a PDF, DOC, or DOCX and assigned reviewers will receive secure access in their Reviewer Portal.\n            </div>\n\n            {myReviewOpportunities.length > 0 && (`,
    'Reviewer file guidance'
  );

  text = replaceExact(
    text,
    `                    <th className="p-4">Status</th>\n                    <th className="p-4">AI Reviewer Match</th>`,
    `                    <th className="p-4">Status</th>\n                    <th className="p-4">Review Files</th>\n                    <th className="p-4">AI Reviewer Match</th>`,
    'Review files table heading'
  );
  text = text.replace(`                      <td colSpan={5} className="p-6 text-center text-xs text-slate-400 font-medium">`, `                      <td colSpan={6} className="p-6 text-center text-xs text-slate-400 font-medium">`);
  text = replaceExact(
    text,
    `                        <td className="p-4">\n                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">\n                            {sub.status}\n                          </span>\n                        </td>\n                        <td className="p-4">\n                          <button`,
    `                        <td className="p-4">\n                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">\n                            {sub.status}\n                          </span>\n                        </td>\n                        <td className="p-4 align-top">\n                          <OrganizerReviewMaterials submission={sub} />\n                        </td>\n                        <td className="p-4">\n                          <button`,
    'Review files table cell'
  );
  write(path, text);
}

console.log('Phase 36 portal polish applied.');
