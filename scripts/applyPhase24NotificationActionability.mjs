import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, needle, replacement, label) {
  const first = content.indexOf(needle);
  if (first === -1) throw new Error(`Phase 24 patch target not found: ${label}`);
  if (content.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`Phase 24 patch target is ambiguous: ${label}`);
  }
  return content.slice(0, first) + replacement + content.slice(first + needle.length);
}

// 1) Notification model: the backend already emits real achievement notifications when a
// professional role is completed. Make that an explicit supported notification type.
{
  const path = 'src/types.ts';
  let text = read(path);
  text = replaceOnce(
    text,
    "  type: 'review' | 'abstract' | 'invitation' | 'sponsorship' | 'agenda' | 'followup';",
    "  type: 'review' | 'abstract' | 'invitation' | 'sponsorship' | 'agenda' | 'followup' | 'achievement';",
    'NotificationItem achievement type'
  );
  write(path, text);
}

// 2) Notification center: every row opens its related ConferenceGate workspace, even after it
// has already been read. This removes the old read=disabled behavior that made rows look dead.
{
  const path = 'src/components/ProfileNotifications.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
    "  Search,\n  UserPlus,\n} from 'lucide-react';",
    "  Search,\n  UserPlus,\n  ChevronRight,\n} from 'lucide-react';",
    'ProfileNotifications ChevronRight import'
  );

  text = replaceOnce(
    text,
    "  followup: { icon: MessageCircle, bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Follow-up' },\n};",
    "  followup: { icon: MessageCircle, bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Follow-up' },\n  achievement: { icon: Award, bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Achievements' },\n};",
    'ProfileNotifications achievement metadata'
  );

  text = replaceOnce(
    text,
    "  onMarkRead: (id: string) => void;\n  onMarkAllRead: () => void;\n}",
    "  onMarkRead: (id: string) => void;\n  onMarkAllRead: () => void;\n  onOpenNotification: (notification: NotificationItem) => void;\n}",
    'ProfileNotifications prop interface'
  );

  text = replaceOnce(
    text,
    "  onMarkRead,\n  onMarkAllRead,\n}) => {",
    "  onMarkRead,\n  onMarkAllRead,\n  onOpenNotification,\n}) => {",
    'ProfileNotifications prop destructuring'
  );

  text = replaceOnce(
    text,
    `                disabled={notification.read}\n                onClick={() => {\n                  if (!notification.read) onMarkRead(notification.id);\n                }}\n                className={\`w-full text-left p-4 rounded-2xl border flex items-start gap-3 transition-colors \${\n                  notification.read\n                    ? 'bg-white border-slate-200 cursor-default'\n                    : 'bg-blue-50/40 border-blue-200 hover:bg-blue-50 cursor-pointer'\n                }\`}\n                title={notification.read ? 'Already read' : 'Mark as read'}\n`,
    `                onClick={() => {\n                  if (!notification.read) onMarkRead(notification.id);\n                  onOpenNotification(notification);\n                }}\n                className={\`w-full text-left p-4 rounded-2xl border flex items-start gap-3 transition-colors cursor-pointer \${\n                  notification.read\n                    ? 'bg-white border-slate-200 hover:bg-slate-50'\n                    : 'bg-blue-50/40 border-blue-200 hover:bg-blue-50'\n                }\`}\n                title="Open related ConferenceGate workspace"\n`,
    'ProfileNotifications clickable notification row'
  );

  text = replaceOnce(
    text,
    "                  <span className=\"text-[10px] text-slate-400 font-medium mt-1.5 block\">{notification.timestamp}</span>\n                </div>\n              </button>",
    "                  <span className=\"text-[10px] text-slate-400 font-medium mt-1.5 block\">{notification.timestamp}</span>\n                </div>\n                <ChevronRight className=\"w-4 h-4 text-slate-400 shrink-0 mt-2\" aria-hidden=\"true\" />\n              </button>",
    'ProfileNotifications open affordance'
  );

  write(path, text);
}

// 3) Thread the action callback through the profile view.
{
  const path = 'src/components/UserProfileView.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
    "  onMarkNotificationRead: (id: string) => void;\n  onMarkAllNotificationsRead: () => void;\n  onAvatarChange?:",
    "  onMarkNotificationRead: (id: string) => void;\n  onMarkAllNotificationsRead: () => void;\n  onOpenNotification: (notification: NotificationItem) => void;\n  onAvatarChange?:",
    'UserProfileView notification action prop'
  );

  text = replaceOnce(
    text,
    "  onMarkNotificationRead,\n  onMarkAllNotificationsRead,\n  onAvatarChange,",
    "  onMarkNotificationRead,\n  onMarkAllNotificationsRead,\n  onOpenNotification,\n  onAvatarChange,",
    'UserProfileView notification action destructuring'
  );

  text = replaceOnce(
    text,
    "            onMarkRead={onMarkNotificationRead}\n            onMarkAllRead={onMarkAllNotificationsRead}\n          />",
    "            onMarkRead={onMarkNotificationRead}\n            onMarkAllRead={onMarkAllNotificationsRead}\n            onOpenNotification={onOpenNotification}\n          />",
    'UserProfileView ProfileNotifications callback'
  );

  write(path, text);
}

// 4) App-level routing: use the real active experience (Professional / Organizer / Sponsor)
// to take each notification category to the workspace where the user can act on it.
{
  const path = 'src/App.tsx';
  let text = read(path);

  const anchor = `  const handleMarkAllNotificationsRead = () => {\n    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));\n    markAllNotificationsRead().catch(() => {});\n  };\n`;

  const replacement = `${anchor}  const handleOpenNotification = (notification: NotificationItem) => {\n    switch (notification.type) {\n      case 'abstract':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'abstracts');\n        return;\n      case 'review':\n        setActiveTab('abstracts');\n        return;\n      case 'invitation':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'reviewer');\n        return;\n      case 'sponsorship':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'sponsor');\n        return;\n      case 'agenda':\n        setActiveTab('discover');\n        return;\n      case 'followup':\n        if (activeRole === 'Organizer') {\n          setActiveTab('organizer');\n        } else {\n          setProfileInitialTab('notifications');\n          setActiveTab('profile');\n        }\n        return;\n      case 'achievement':\n        setProfileInitialTab('conferences');\n        setActiveTab('profile');\n        return;\n      default:\n        setProfileInitialTab('notifications');\n        setActiveTab('profile');\n    }\n  };\n`;

  text = replaceOnce(text, anchor, replacement, 'App notification action router');

  text = replaceOnce(
    text,
    "            onMarkNotificationRead={displayedOnMarkNotificationRead}\n            onMarkAllNotificationsRead={displayedOnMarkAllNotificationsRead}\n            onAvatarChange={handleAvatarChange}",
    "            onMarkNotificationRead={displayedOnMarkNotificationRead}\n            onMarkAllNotificationsRead={displayedOnMarkAllNotificationsRead}\n            onOpenNotification={handleOpenNotification}\n            onAvatarChange={handleAvatarChange}",
    'App UserProfileView notification callback'
  );

  write(path, text);
}

// Keep the branch canonical after this one-time patch executes.
for (const tempPath of [
  'scripts/applyPhase24NotificationActionability.mjs',
  '.github/workflows/phase24-notification-actionability.yml',
]) {
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
}

console.log('Phase 24 notification actionability patch applied.');
