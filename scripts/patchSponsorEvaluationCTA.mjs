import fs from 'node:fs';

function patchFile(fileUrl, replacements, label) {
  let text = fs.readFileSync(fileUrl, 'utf8');
  let changed = false;
  for (const [before, after, description] of replacements) {
    if (text.includes(after)) continue;
    if (description === 'evaluation target props' && text.includes('initialSponsorId?: string;') && text.includes('initialConferenceTitle?: string;')) continue;
    if (!text.includes(before)) {
      throw new Error(`${label} patch could not find expected source for: ${description}`);
    }
    text = text.replace(before, after);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(fileUrl, text, 'utf8');
    console.log(`Applied ${label} patch.`);
  } else {
    console.log(`${label} patch already applied.`);
  }
}

patchFile(
  new URL('../src/components/OrganizerDashboard.tsx', import.meta.url),
  [
    [
      "  const [sponsorshipDeals, setSponsorshipDeals] = useState<SponsorshipDeal[]>([]);",
      "  const [sponsorshipDeals, setSponsorshipDeals] = useState<SponsorshipDeal[]>([]);\n  const [sponsorEvaluationTarget, setSponsorEvaluationTarget] = useState<{ sponsorId: string; conferenceTitle: string } | null>(null);",
      'sponsor evaluation target state',
    ],
    [
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
      'deal room sponsor evaluation eligibility',
    ],
    [
      '                          <p className="text-xs text-slate-500">{deal.conferenceTitle} · {deal.counterpartName}</p>',
      `                          <p className="text-xs text-slate-500">{deal.conferenceTitle} · {deal.counterpartName}</p>
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
                              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-xl cursor-pointer"
                            >
                              <MessageSquareQuote className="w-3.5 h-3.5" />
                              Evaluate Sponsor
                            </button>
                          )}`,
      'deal room evaluate sponsor button',
    ],
    [
`            <SponsorEvaluationPanel
              sponsors={reviewableSponsors}
              conferences={conferences}
              onSubmit={onReviewSponsor}
            />`,
`            <SponsorEvaluationPanel
              key={(sponsorEvaluationTarget?.sponsorId || 'default') + ':' + (sponsorEvaluationTarget?.conferenceTitle || 'default')}
              sponsors={reviewableSponsors}
              conferences={conferences}
              initialSponsorId={sponsorEvaluationTarget?.sponsorId}
              initialConferenceTitle={sponsorEvaluationTarget?.conferenceTitle}
              onSubmit={onReviewSponsor}
            />`,
      'sponsor evaluation preselection',
    ],
  ],
  'organizer Deal Room sponsor evaluation CTA'
);

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
      'evaluation target props',
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
      'initial sponsor selection',
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
      'initial conference selection',
    ],
    [
      '    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">',
      '    <div id="sponsor-evaluation" className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4 scroll-mt-6">',
      'sponsor evaluation anchor',
    ],
  ],
  'sponsor evaluation preselection'
);
