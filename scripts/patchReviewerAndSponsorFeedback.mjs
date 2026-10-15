import fs from 'node:fs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('src/components/ReviewerPortal.tsx', (source) => {
  return source
    .replaceAll('Verified Professional History', 'Review History')
    .replaceAll('Verified Reviews', 'Completed Reviews')
    .replaceAll('Verified Roles', 'Completed Roles')
    .replaceAll('verified professional activity', 'professional activity')
    .replaceAll('verified ConferenceGate activity', 'ConferenceGate activity');
});

patchFile('src/components/SponsorEvaluationPanel.tsx', (source) => {
  if (!source.includes('type SponsorshipDeal')) {
    source = source.replace(
      "import { fetchApplicantsForMyPackages, type ReviewableSponsor, type SponsorApplicant } from '../api/sponsors';",
      "import { fetchApplicantsForMyPackages, type ReviewableSponsor, type SponsorApplicant, type SponsorshipDeal } from '../api/sponsors';"
    );
  }
  if (!source.includes('completedDeals?: SponsorshipDeal[];')) {
    source = source.replace(
      '  sponsorsLoading?: boolean;\n}> = ({ sponsors, conferences, onSubmit, sponsorsLoading = false }) => {',
      '  sponsorsLoading?: boolean;\n  completedDeals?: SponsorshipDeal[];\n}> = ({ sponsors, conferences, onSubmit, sponsorsLoading = false, completedDeals = [] }) => {'
    );
  }
  source = source.replace(
    /  const eligibleConferenceTitles = useMemo\(\(\) => \{[\s\S]*?\}, \[approvedLinks, sponsorId\]\);/,
    `  const eligibleConferenceTitles = useMemo(() => {\n    return [...new Set(\n      completedDeals\n        .filter((deal) => deal.status === 'completed' && deal.sponsorId === sponsorId)\n        .map((deal) => deal.conferenceTitle)\n        .filter(Boolean)\n    )];\n  }, [completedDeals, sponsorId]);`
  );
  source = source
    .replace('Organizer → Sponsor Evaluation Survey', 'Organizer → Sponsor Feedback Sheet')
    .replace('Verified sponsorship only', 'Completed sponsorship only')
    .replace("Use the same 1–6 feedback scale as the professional conference survey, with questions written specifically for sponsor delivery and partnership performance. A submitted evaluation is published in that sponsor's ConferenceGate Profile as verified organizer feedback.", "Complete this feedback sheet after the sponsorship Deal Room is marked completed. The evaluation covers sponsor delivery, reliability, collaboration, event contribution, and whether you would work together again.")
    .replace('No sponsor is eligible for evaluation yet. This survey becomes available automatically after a sponsor is approved for one of your ConferenceGate conferences, ensuring every review is tied to a real organizer–sponsor relationship.', 'No completed sponsorship is available for feedback yet. Complete a sponsorship Deal Room first; the feedback sheet will then become available for that sponsor and conference.')
    .replace('This sponsor is not linked to an approved sponsorship for one of your current conferences, so a verified review cannot be submitted.', 'This sponsor does not yet have a completed sponsorship Deal Room for one of your current conferences, so feedback cannot be submitted yet.')
    .replaceAll('Verified sponsorship', 'Completed sponsorship');
  return source;
});

patchFile('src/components/OrganizerDashboard.tsx', (source) => {
  const oldBlock = `          {reviewableSponsors.length > 0 && (\n            <SponsorEvaluationPanel\n              sponsors={reviewableSponsors}\n              conferences={conferences}\n              onSubmit={onReviewSponsor}\n            />\n          )}`;
  const newBlock = `          <SponsorEvaluationPanel\n            sponsors={reviewableSponsors}\n            conferences={conferences}\n            onSubmit={onReviewSponsor}\n            completedDeals={sponsorshipDeals.filter((deal) => deal.status === 'completed')}\n          />`;
  if (source.includes(oldBlock)) source = source.replace(oldBlock, newBlock);
  return source;
});

patchFile('src/components/SponsorPortal.tsx', (source) => {
  if (!source.includes("import { SponsorOrganizerFeedbackSheet } from './SponsorOrganizerFeedbackSheet';")) {
    source = source.replace(
      "import { SponsorHistoryEditor } from './SponsorHistoryEditor';",
      "import { SponsorHistoryEditor } from './SponsorHistoryEditor';\nimport { SponsorOrganizerFeedbackSheet } from './SponsorOrganizerFeedbackSheet';"
    );
  }
  if (!source.includes('<SponsorOrganizerFeedbackSheet')) {
    const anchor = `                  {deal.status === 'payment_pending' && (\n                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">\n                      Payment is pending. ConferenceGate will show <strong>Paid</strong> only after the configured payment provider confirms settlement.\n                    </div>\n                  )}`;
    const insert = `${anchor}\n\n                  {deal.status === 'completed' && (\n                    <SponsorOrganizerFeedbackSheet\n                      deal={deal}\n                      onSaved={(update) =>\n                        setSponsorshipDeals((prev) =>\n                          prev.map((item) => item.id === deal.id ? { ...item, updates: [...item.updates, update] } : item)\n                        )\n                      }\n                    />\n                  )}`;
    if (!source.includes(anchor)) throw new Error('Sponsor feedback patch: SponsorPortal completed deal anchor not found');
    source = source.replace(anchor, insert);
  }
  return source;
});

console.log('[reviewer-sponsor-feedback] Reviewer labels cleaned and completed sponsorship feedback sheets applied.');
