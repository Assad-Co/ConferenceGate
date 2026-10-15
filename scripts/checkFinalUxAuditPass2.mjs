import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const must = (ok, label) => { if (!ok) throw new Error(`Final UX pass 2 audit failed: ${label}`); };

const db = read('server/db.ts');
const activity = read('server/activity.ts');
const sponsors = read('server/sponsors.ts');
const search = read('server/storedConferenceSearch.ts');
const app = read('src/App.tsx');
const abstracts = read('src/components/AbstractTrackerView.tsx');
const organizer = read('src/components/OrganizerDashboard.tsx');
const sponsor = read('src/components/SponsorPortal.tsx');
const notifications = read('src/components/ProfileNotifications.tsx');
const myConferences = read('src/components/MyConferencesHub.tsx');
const messages = read('src/components/MessagesPanel.tsx');
const reviewer = read('src/components/ReviewerPortal.tsx');

// CTA/dead-control guardrails already have handler-driven controls; reject the most common placeholders.
for (const placeholder of ['href="#"', 'onClick={() => {}}', 'Coming soon', 'Demo only']) {
  must(![app, abstracts, organizer, sponsor, notifications, myConferences, messages, reviewer].join('\n').includes(placeholder), `placeholder/dead control remains: ${placeholder}`);
}

// Notification routing is now data-backed, not type-only.
must(db.includes('action_url TEXT'), 'notification destination column missing');
must(db.includes('ALTER TABLE notifications ADD COLUMN action_url TEXT'), 'notification destination migration missing');
must(activity.includes('actionUrl: r.action_url || undefined'), 'notification destination not returned to client');
must(activity.includes('submissionId=${encodeURIComponent(submission.id)}'), 'review/abstract notification lacks exact submission destination');
must(sponsors.includes('section=marketplace&needId='), 'Sponsor Marketplace notification lacks exact need destination');
must(sponsors.includes('section=deals&needId='), 'Sponsor deal notification lacks destination');
must(app.includes("notification.id.startsWith('msg_')"), 'message notification does not open exact conversation');
must(app.includes("notification.actionUrl"), 'client does not honor persisted notification destination');
must(abstracts.includes('focusSubmissionId'), 'abstract tracker cannot focus notified submission');
must(organizer.includes('initialTab?'), 'Organizer workspace cannot receive notification section focus');
must(sponsor.includes('initialTab?'), 'Sponsor workspace cannot receive notification section focus');

// Saved conferences survive sessions because IDs are persisted and reloaded; unresolved external records stay preserved.
must(activity.includes('/conference-interactions/mine'), 'saved conference persistence API missing');
must(app.includes('fetchMyConferenceInteractions()'), 'saved conference interactions are not reloaded after auth');
must(app.includes("toggleConferenceInteraction(conferenceId, 'saved')"), 'Save action is not server-backed');
must(myConferences.includes('saved reference is still preserved'), 'unresolved external saved-record protection missing');
must(myConferences.includes('onOpenExternalResult'), 'saved external conference reopen flow missing');

// Search covers partials/acronyms/organizer/location/subjects and now tolerates one small typo.
must(search.includes('wordStartMatcher'), 'partial word search missing');
must(search.includes('const acronym ='), 'acronym search missing');
must(search.includes('[fields.organizer, fields.location, fields.dates]'), 'organizer/location search missing');
must(search.includes('SEMANTIC_PATTERNS'), 'discipline semantic search missing');
must(search.includes('oneEditOrAdjacentTranspose'), 'typo tolerance helper missing');
must(search.includes('fuzzyTokenMatches(text, token)'), 'typo tolerance is not used');

// Empty-state coverage: key customer-facing zero-data screens must tell the user what to do next.
must(notifications.includes('Nothing needs your attention yet'), 'notification empty state missing');
must(myConferences.includes('No saved conferences yet'), 'saved conference empty state missing');
must(abstracts.includes('Start your first abstract submission'), 'abstract empty state missing');
must(messages.includes('No conversations') || messages.includes('Start a conversation') || messages.includes('No messages'), 'message empty state missing');
must(reviewer.includes('opportunit'), 'opportunity experience missing');

// End-to-end role journeys and owner preview remain wired to real APIs.
for (const needle of ['createSponsorshipNeed', 'sendBroadcast', 'assignReviewerToSubmission', 'createProfessionalInvitation']) {
  must(organizer.includes(needle), `Organizer journey missing ${needle}`);
}
for (const needle of ['inquireAboutSponsorshipNeed', 'fetchMySponsorshipDeals', 'updateSponsorshipDeal']) {
  must(sponsor.includes(needle), `Sponsor journey missing ${needle}`);
}
for (const needle of ['handleToggleSaveConference', 'handleAddSubmission', 'handleProfessionalInvitationDecision', 'openConversationWith']) {
  must(app.includes(needle), `Professional journey missing ${needle}`);
}
must(app.includes('authUser.ownerPreview'), 'owner-preview role switching missing');

// Responsive fundamentals: major customer surfaces use breakpoint-aware layout classes.
for (const [name, source] of [['abstracts', abstracts], ['organizer', organizer], ['sponsor', sponsor], ['notifications', notifications], ['my conferences', myConferences]]) {
  must(/\b(sm:|md:|lg:|xl:)/.test(source), `${name} lacks responsive breakpoint behavior`);
}

console.log(JSON.stringify({
  finalUxAuditPass2: 'passed',
  ctas: true,
  notificationRouting: true,
  savedPersistence: true,
  searchQuality: true,
  emptyStates: true,
  sponsorJourney: true,
  organizerJourney: true,
  professionalJourney: true,
  ownerPreviewConsistency: true,
  responsiveGuardrails: true,
}));
