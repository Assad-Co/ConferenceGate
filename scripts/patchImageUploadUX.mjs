import fs from 'node:fs';

const path = new URL('../src/components/OrganizerDashboard.tsx', import.meta.url);
let source = fs.readFileSync(path, 'utf8');
let changed = false;

function replaceOnce(before, after, description) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Conference Gate UX patch could not find expected source for: ${description}`);
  }
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
  "import { OrganizerFeedbackPanel } from './OrganizerFeedbackPanel';\n",
  "import { OrganizerFeedbackPanel } from './OrganizerFeedbackPanel';\nimport { ImageUploadDropzone } from './ImageUploadDropzone';\n",
  'ImageUploadDropzone import'
);

replaceOnce(
`  const [committeeDraft, setCommitteeDraft] = useState({
    name: '',
    title: '',
    org: '',
    committeeRole: 'Technical Committee Member',
  });
  const [newConfCommittee, setNewConfCommittee] = useState<
    Array<{ name: string; title: string; org: string; committeeRole: string }>
  >([]);`,
`  const [committeeDraft, setCommitteeDraft] = useState({
    name: '',
    title: '',
    org: '',
    avatar: '',
    committeeRole: 'Technical Committee Member',
  });
  const [newConfCommittee, setNewConfCommittee] = useState<
    Array<{ name: string; title: string; org: string; avatar: string; committeeRole: string }>
  >([]);`,
  'committee avatar state'
);

replaceOnce(
  "    setCommitteeDraft({ name: '', title: '', org: '', committeeRole: 'Technical Committee Member' });",
  "    setCommitteeDraft({ name: '', title: '', org: '', avatar: '', committeeRole: 'Technical Committee Member' });",
  'committee draft reset'
);

replaceOnce(
`        org: member.org,
        // Initials, never a stock portrait: this is a named real person on a real committee.
        avatar: generateInitialsAvatar(member.name),
        committeeRole: member.committeeRole,`,
`        org: member.org,
        avatar: member.avatar || generateInitialsAvatar(member.name),
        committeeRole: member.committeeRole,`,
  'committee avatar persistence'
);

replaceOnce(
`              </div>
              <button
                type="button"
                onClick={handleAddCommitteeMember}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >`,
`              </div>
              <ImageUploadDropzone
                value={committeeDraft.avatar}
                onChange={(avatar) => setCommitteeDraft({ ...committeeDraft, avatar })}
                label="Committee member photo"
                helperText="Choose a headshot or drag & drop it here. No image URL is required."
                variant="portrait"
                className="max-w-xl"
              />
              <button
                type="button"
                onClick={handleAddCommitteeMember}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >`,
  'committee member dropzone'
);

replaceOnce(
`                    >
                      <div>
                        <div className="font-bold text-slate-900">{member.name}</div>`,
`                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={member.avatar || generateInitialsAvatar(member.name)}
                          alt={member.name}
                          className="w-10 h-10 rounded-xl object-cover bg-white border border-slate-200 shrink-0"
                        />
                        <div className="min-w-0">
                        <div className="font-bold text-slate-900">{member.name}</div>`,
  'committee member list photo opening'
);

replaceOnce(
`                          {member.committeeRole}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommitteeMember(idx)}`,
`                          {member.committeeRole}
                        </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommitteeMember(idx)}`,
  'committee member list photo closing'
);

// The conference importer is intentionally not restricted to an organizer's official site.
replaceOnce(
  'Import from the official conference page',
  'Import from any public webpage',
  'generic webpage import heading'
);
replaceOnce(
  'ConferenceGate reads the public official page and prefills only facts it can extract. Nothing is published until you review the wizard and submit it.',
  'Paste any relevant public webpage — conference site, event page, organizer or society page, university page, sponsor page, or other public source. ConferenceGate prefills only facts it can extract. Nothing is published until you review the wizard and submit it.',
  'generic webpage import helper copy'
);
replaceOnce(
  'placeholder="https://official-conference-site.org/2027"',
  'placeholder="https://any-public-conference-page.org/event"',
  'generic webpage import placeholder'
);
replaceOnce(
  "'Could not import the official conference page.'",
  "'Could not import this public webpage.'",
  'generic webpage import error copy'
);

// Make verified organizer → sponsor feedback visible from the commercial workflow.
replaceOnce(
  "  const [sponsorshipDeals, setSponsorshipDeals] = useState<SponsorshipDeal[]>([]);",
  "  const [sponsorshipDeals, setSponsorshipDeals] = useState<SponsorshipDeal[]>([]);\n  const [sponsorEvaluationTarget, setSponsorEvaluationTarget] = useState<{ sponsorId: string; conferenceTitle: string } | null>(null);",
  'sponsor evaluation target state'
);

replaceOnce(
`                {sponsorshipDeals.map((deal) => {
                  const draft = dealDraft(deal);
                  return (`,
`                {sponsorshipDeals.map((deal) => {
                  const draft = dealDraft(deal);
                  const sponsorCanBeEvaluated = sponsorApplicants.some((application) =>
                    application.status === 'Approved' &&
                    application.sponsor?.id === deal.sponsorId &&
                    application.conferenceTitle === deal.conferenceTitle
                  );
                  return (`,
  'deal room sponsor evaluation eligibility'
);

replaceOnce(
`                        <div className="text-right">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Agreed amount</div>
                          <div className="text-lg font-extrabold text-blue-700">
                            {deal.agreedAmount === null ? 'Not set' : `${deal.currency} ${Number(deal.agreedAmount).toLocaleString()}`}
                          </div>
                        </div>`,
`                        <div className="text-right space-y-2">
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase font-bold">Agreed amount</div>
                            <div className="text-lg font-extrabold text-blue-700">
                              {deal.agreedAmount === null ? 'Not set' : `${deal.currency} ${Number(deal.agreedAmount).toLocaleString()}`}
                            </div>
                          </div>
                          {sponsorCanBeEvaluated && (
                            <button
                              type="button"
                              onClick={() => {
                                setSponsorEvaluationTarget({ sponsorId: deal.sponsorId, conferenceTitle: deal.conferenceTitle });
                                setActiveTab('feedback');
                                window.setTimeout(() => {
                                  document.getElementById('sponsor-evaluation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }, 80);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-xl cursor-pointer"
                            >
                              <MessageSquareQuote className="w-3.5 h-3.5" />
                              Evaluate Sponsor
                            </button>
                          )}
                        </div>`,
  'deal room evaluate sponsor button'
);

replaceOnce(
`            <SponsorEvaluationPanel
              sponsors={reviewableSponsors}
              conferences={conferences}
              onSubmit={onReviewSponsor}
            />`,
`            <SponsorEvaluationPanel
              key={`${sponsorEvaluationTarget?.sponsorId || 'default'}:${sponsorEvaluationTarget?.conferenceTitle || 'default'}`}
              sponsors={reviewableSponsors}
              conferences={conferences}
              initialSponsorId={sponsorEvaluationTarget?.sponsorId}
              initialConferenceTitle={sponsorEvaluationTarget?.conferenceTitle}
              onSubmit={onReviewSponsor}
            />`,
  'sponsor evaluation preselection'
);

if (changed) {
  fs.writeFileSync(path, source, 'utf8');
  console.log('Applied Conference Gate organizer UX patch.');
} else {
  console.log('Conference Gate organizer UX patch already applied.');
}

function patchFile(fileUrl, replacements, label) {
  let text = fs.readFileSync(fileUrl, 'utf8');
  let fileChanged = false;
  for (const [before, after, description] of replacements) {
    if (text.includes(after)) continue;
    if (!text.includes(before)) {
      throw new Error(`${label} patch could not find expected source for: ${description}`);
    }
    text = text.replace(before, after);
    fileChanged = true;
  }
  if (fileChanged) {
    fs.writeFileSync(fileUrl, text, 'utf8');
    console.log(`Applied ${label} patch.`);
  }
}

patchFile(
  new URL('../src/components/SponsorEvaluationPanel.tsx', import.meta.url),
  [
    [
`  onSubmit: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string; ratings: Record<string, number>; overallScore: number }) => void | Promise<void>;
  sponsorsLoading?: boolean;
}> = ({ sponsors, conferences, onSubmit, sponsorsLoading = false }) => {
  const [sponsorId, setSponsorId] = useState(sponsors[0]?.id || '');
  const [conferenceTitle, setConferenceTitle] = useState('');`,
`  onSubmit: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string; ratings: Record<string, number>; overallScore: number }) => void | Promise<void>;
  sponsorsLoading?: boolean;
  initialSponsorId?: string;
  initialConferenceTitle?: string;
}> = ({ sponsors, conferences, onSubmit, sponsorsLoading = false, initialSponsorId, initialConferenceTitle }) => {
  const [sponsorId, setSponsorId] = useState(initialSponsorId || sponsors[0]?.id || '');
  const [conferenceTitle, setConferenceTitle] = useState(initialConferenceTitle || '');`,
      'evaluation target props'
    ],
    [
`    if (!sponsors.some((sponsor) => sponsor.id === sponsorId)) {
      setSponsorId(sponsors[0].id);
    }
  }, [sponsors, sponsorId]);`,
`    if (initialSponsorId && sponsors.some((sponsor) => sponsor.id === initialSponsorId)) {
      if (sponsorId !== initialSponsorId) setSponsorId(initialSponsorId);
      return;
    }
    if (!sponsors.some((sponsor) => sponsor.id === sponsorId)) {
      setSponsorId(sponsors[0].id);
    }
  }, [sponsors, sponsorId, initialSponsorId]);`,
      'initial sponsor selection'
    ],
    [
`    if (!eligibleConferenceTitles.includes(conferenceTitle)) {
      setConferenceTitle(eligibleConferenceTitles[0]);
    }
  }, [conferenceTitle, eligibleConferenceTitles]);`,
`    if (initialConferenceTitle && eligibleConferenceTitles.includes(initialConferenceTitle)) {
      if (conferenceTitle !== initialConferenceTitle) setConferenceTitle(initialConferenceTitle);
      return;
    }
    if (!eligibleConferenceTitles.includes(conferenceTitle)) {
      setConferenceTitle(eligibleConferenceTitles[0]);
    }
  }, [conferenceTitle, eligibleConferenceTitles, initialConferenceTitle]);`,
      'initial conference selection'
    ],
    [
`    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">`,
`    <div id="sponsor-evaluation" className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4 scroll-mt-6">`,
      'sponsor evaluation anchor'
    ],
  ],
  'sponsor evaluation deep-link'
);

patchFile(
  new URL('../server/workspaces.ts', import.meta.url),
  [
    ['// Paid Organizer Pro helper: fetch one organizer-supplied official conference page, extract only', '// Paid Organizer Pro helper: fetch one organizer-supplied public webpage, extract only', 'server helper comment'],
    ['return res.status(400).json({ error: "Provide the official conference URL." });', 'return res.status(400).json({ error: "Provide a public webpage URL related to the conference." });', 'missing URL error'],
    ['return res.status(400).json({ error: "Provide a valid public conference URL." });', 'return res.status(400).json({ error: "Provide a valid public webpage URL." });', 'invalid URL error'],
    ['return res.status(400).json({ error: "Only http(s) conference URLs are supported." });', 'return res.status(400).json({ error: "Only public http(s) webpage URLs are supported." });', 'protocol error'],
    ['error: "That URL cannot be fetched safely. Use the public official conference page.",', 'error: "That URL cannot be fetched safely. Use another public webpage that ConferenceGate can access securely.",', 'blocked URL error'],
    ['note: "The official page was reachable but did not expose structured conference facts. ConferenceGate kept the source URL and opened an empty reviewable draft instead of failing; enter the missing fields manually or try a conference-specific page."', 'note: "The webpage was reachable but did not expose usable conference facts. ConferenceGate kept the source URL and opened an empty reviewable draft instead of failing; enter the missing fields manually or try another relevant public page."', 'empty extraction note'],
    ['"Imported fields are a draft from the supplied official page. Review every field before publishing." +', '"Imported fields are a draft from the supplied public webpage. Review every field before publishing." +', 'success note'],
  ],
  'any-public-webpage import server'
);
