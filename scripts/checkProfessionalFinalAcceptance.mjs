import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const navbar = read('src/components/LegacyNavbar.tsx');
const home = read('src/components/HomeLanding.tsx');
const discover = read('src/components/DiscoveryEngineAdvanced.tsx');
const myConferences = read('src/components/MyConferencesHub.tsx');
const abstracts = read('src/components/AbstractTrackerView.tsx');
const opportunities = read('src/components/ReviewerPortal.tsx');
const feed = read('src/components/CommunityFeed.tsx');
const profile = read('src/components/UserProfileView.tsx');
const messages = read('src/components/MessagesPanel.tsx');
const notifications = read('src/components/ProfileNotifications.tsx');
const linkedin = read('src/components/LinkedInProfilePanel.tsx');
const imported = read('src/components/LinkedInImportedTabSections.tsx');
const app = read('src/App.tsx');

function assert(condition, message) {
  if (!condition) throw new Error(`Professional final acceptance failed: ${message}`);
}

for (const label of ['Home', 'Discover', 'My Conferences', 'My Abstracts', 'Opportunities', 'Feed']) {
  assert(navbar.includes(`label: '${label}'`), `main navigation missing ${label}`);
}
for (const label of ['Discover', 'My Conferences', 'My Abstracts', 'Opportunities']) {
  assert(home.includes(`label: '${label}'`), `Home quick links missing ${label}`);
}
for (const obsolete of ['Reviewer Portal', '<span>Digital Badge</span>', "label: 'Certificates'"]) {
  assert(!home.includes(obsolete), `obsolete Home shortcut remains: ${obsolete}`);
}

assert(discover.includes("'Save conference'"), 'Discover Save action missing');
assert(discover.includes("'Saved'"), 'Discover Saved state missing');
assert(!discover.includes("'+ Follow'"), 'Follow action still visible in Discover');

for (const tab of ["{ id: 'saved', label: 'Saved'", "{ id: 'attended', label: 'Attended'", "{ id: 'certificates', label: 'Certificates'"]) {
  assert(myConferences.includes(tab), `My Conferences missing ${tab}`);
}
assert(!myConferences.includes("label: 'Following'"), 'Following tab remains in My Conferences');
assert(!myConferences.includes("label: 'Registered'"), 'Registered tab remains in My Conferences');
assert(myConferences.includes('onOpenExternalResult'), 'worldwide saved conference reopen flow missing');
assert(myConferences.includes('saved reference is still preserved'), 'unresolved saved-record protection missing');

for (const needle of ['Submit New Abstract', 'submitRevision', 'Real-time Peer Review Timeline', 'currentSub.isExternal']) {
  assert(abstracts.includes(needle), `My Abstracts missing ${needle}`);
}
assert(abstracts.includes("ConferenceGate can't see this conference's"), 'external abstract honesty notice missing');

for (const needle of ['Professional Opportunity Center', 'onProfessionalInvitationDecision', 'onProfessionalOpportunityInterest', 'onCompleteReview', 'professionalInvitations']) {
  assert(opportunities.includes(needle), `Opportunities flow missing ${needle}`);
}
for (const role of ["'reviewer'", "'committee'", "'chair'", "'speaker'"]) {
  assert(opportunities.includes(role), `Opportunities role coverage missing ${role}`);
}

for (const needle of ['onAddPost', 'onReact', 'onToggleRepost', 'onToggleSave', 'onFetchComments', 'onAddComment', 'handleSharePost', 'Search posts']) {
  assert(feed.includes(needle), `Feed interaction missing ${needle}`);
}

for (const needle of ['Professional Summary', "label: 'Conference History'", "label: 'Papers & Abstracts'", "label: 'LinkedIn Profile'", "label: 'Professional Roles'", "label: 'Credentials & Verification'", 'Profile Completeness']) {
  assert(profile.includes(needle), `Professional profile missing ${needle}`);
}
for (const obsolete of ["label: 'Peer Reviews & Kudos'", "label: 'Committee Positions'", "label: 'Verified Badges'", "label: 'Trust & Verification'", '>Current Load<']) {
  assert(!profile.includes(obsolete), `obsolete Professional profile UI remains: ${obsolete}`);
}

for (const needle of ['Search your inbox', 'Unread', 'onSendMessage']) {
  assert(messages.includes(needle), `Messages missing ${needle}`);
}
for (const needle of ['onMarkAllRead', 'onOpenNotification']) {
  assert(notifications.includes(needle), `Notifications missing ${needle}`);
}
assert(app.includes('connectMessageSocket'), 'real-time message delivery missing');
assert(app.includes('setInterval(refreshConversations, 15000)'), 'message polling fallback missing');
assert(app.includes('fetchMyNotifications().then(setNotifications)'), 'server notifications load missing');

assert(linkedin.includes('Full Career History'), 'LinkedIn full career history view missing');
assert(imported.includes("s.kind === 'PAPER_ABSTRACT'"), 'LinkedIn paper/abstract evidence missing');
assert(imported.includes('...importedPublicationTitles, ...importedPaperSignalTitles'), 'LinkedIn research-output merge missing');

const combined = [navbar, home, discover, myConferences, abstracts, opportunities, feed, profile, messages, notifications, linkedin, imported].join('\n');
for (const obsolete of ['In Phase 2, paid organizers', 'Coming soon', 'Demo only']) {
  assert(!combined.includes(obsolete), `prototype wording remains: ${obsolete}`);
}

console.log(JSON.stringify({
  professionalFinalAcceptance: 'passed',
  navigation: true,
  home: true,
  discoverAndSave: true,
  myConferences: true,
  abstracts: true,
  opportunities: true,
  feed: true,
  profile: true,
  linkedin: true,
  messages: true,
  notifications: true,
}));
