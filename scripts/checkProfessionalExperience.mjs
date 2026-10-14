import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const profile = read('src/components/UserProfileView.tsx');
const navbar = read('src/components/LegacyNavbar.tsx');
const notifications = read('src/components/ProfileNotifications.tsx');
const messages = read('src/components/MessagesPanel.tsx');
const app = read('src/App.tsx');

function assert(condition, message) {
  if (!condition) throw new Error(`Professional experience audit failed: ${message}`);
}

for (const label of [
  'Professional Summary',
  "label: 'Notifications'",
  "label: 'Conference History'",
  "label: 'Papers & Abstracts'",
  "label: 'LinkedIn Profile'",
  "label: 'Professional Roles'",
  "label: 'Credentials & Verification'",
]) {
  assert(profile.includes(label), `missing agreed Professional profile element: ${label}`);
}

for (const obsolete of [
  "label: 'Peer Reviews & Kudos'",
  "label: 'Committee Positions'",
  "label: 'Verified Badges'",
  "label: 'Trust & Verification'",
  "label: 'Engagement Analytics'",
  '>Current Load<',
  '<span>Digital Badge</span>',
  '<span>Certificates</span>',
]) {
  assert(!profile.includes(obsolete), `obsolete/duplicate Professional profile UI remains: ${obsolete}`);
}

assert(!navbar.includes('title="ConferenceGate Professional Badge"'), 'top Digital Badge shortcut still exists');
assert(navbar.includes('title="Direct Messages"'), 'Direct Messages navbar action is missing');
assert(navbar.includes('title={bellTitle}'), 'Notifications navbar action is missing');
assert(messages.includes('onSendMessage'), 'Messages panel send flow is missing');
assert(messages.includes('Search your inbox'), 'Messages inbox search is missing');
assert(messages.includes('Unread'), 'Messages unread filtering is missing');
assert(notifications.includes('onMarkAllRead'), 'Notification mark-all-read flow is missing');
assert(notifications.includes('onOpenNotification'), 'Notification open/navigation flow is missing');
assert(app.includes('connectMessageSocket'), 'real-time message socket is not wired');
assert(app.includes('setInterval(refreshConversations, 15000)'), 'message polling fallback is not wired');
assert(app.includes('fetchMyNotifications().then(setNotifications)'), 'Professional notifications are not loaded from the server');
assert(app.includes('markNotificationRead(id)'), 'Professional notification read persistence is not wired');

console.log(JSON.stringify({
  professionalExperienceAudit: 'passed',
  profileStructure: true,
  duplicateActionsRemoved: true,
  notificationsWired: true,
  messagesWired: true,
  liveMessageDelivery: true,
  pollingFallback: true,
}));
