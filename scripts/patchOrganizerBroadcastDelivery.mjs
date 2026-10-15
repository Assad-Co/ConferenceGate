import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverFile = path.join(root, 'server/activity.ts');
const apiFile = path.join(root, 'src/api/activity.ts');
const dashboardFile = path.join(root, 'src/components/OrganizerDashboard.tsx');

const replace = (source, from, to, label) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Organizer broadcast patch: ${label} anchor missing`);
  return source.replace(from, to);
};

let server = fs.readFileSync(serverFile, 'utf8');
const insertAnchor = `  const row = (await dbGet<OrganizerBroadcastRow>("SELECT * FROM organizer_broadcasts WHERE id = ?", [id]))!;`;
const deliveryBlock = `  const group = String(body.recipientGroup || "All Attendees");\n  const recipientIds = new Set<string>();\n\n  if (group === "All Attendees") {\n    const rows = await dbAll<{ user_id: string }>(\n      \`SELECT DISTINCT r.user_id FROM conference_registrations r\n         JOIN created_conferences c ON c.id=r.conference_id\n        WHERE c.organizer_id=?\`,\n      [organizerContext.accountId]\n    );\n    rows.forEach((row) => recipientIds.add(row.user_id));\n  } else if (group === "Accepted Authors") {\n    const rows = await dbAll<{ submitter_id: string }>(\n      \`SELECT DISTINCT s.submitter_id FROM submissions s\n         JOIN created_conferences c ON c.id=s.conference_id\n        WHERE c.organizer_id=? AND s.is_external=0\n          AND s.status IN ('Accepted','Accepted for Oral','Accepted for Poster')\`,\n      [organizerContext.accountId]\n    );\n    rows.forEach((row) => recipientIds.add(row.submitter_id));\n  } else if (group === "Reviewers") {\n    const rows = await dbAll<{ reviewer_id: string }>(\n      \`SELECT DISTINCT a.reviewer_id FROM submission_reviewer_assignments a\n         JOIN submissions s ON s.id=a.submission_id\n         JOIN created_conferences c ON c.id=s.conference_id\n        WHERE c.organizer_id=?\`,\n      [organizerContext.accountId]\n    );\n    rows.forEach((row) => recipientIds.add(row.reviewer_id));\n  } else if (group === "Sponsors") {\n    const rows = await dbAll<{ sponsor_id: string }>(\n      \`SELECT DISTINCT a.sponsor_id FROM sponsorship_applications a\n         JOIN sponsorship_packages p ON p.id=a.package_id\n        WHERE p.organizer_id=? AND a.status='Approved'\`,\n      [organizerContext.accountId]\n    );\n    rows.forEach((row) => recipientIds.add(row.sponsor_id));\n  }\n\n  let notifiedCount = 0;\n  for (const userId of recipientIds) {\n    await createNotification(userId, "announcement", body.subject.trim(), body.body.trim());\n    notifiedCount += 1;\n  }\n\n  const row = (await dbGet<OrganizerBroadcastRow>("SELECT * FROM organizer_broadcasts WHERE id = ?", [id]))!;`;
server = replace(server, insertAnchor, deliveryBlock, 'recipient delivery');
server = replace(
  server,
  `      createdAt: row.created_at,`,
  `      createdAt: row.created_at,\n      recipientCount: recipientIds.size,\n      notifiedCount,`,
  'broadcast response counts'
);
fs.writeFileSync(serverFile, server);

let api = fs.readFileSync(apiFile, 'utf8');
api = replace(
  api,
  `export interface OrganizerBroadcast {\n  id: string;\n  recipientGroup: string;\n  subject: string;\n  body: string;\n  createdAt: string;\n}`,
  `export interface OrganizerBroadcast {\n  id: string;\n  recipientGroup: string;\n  subject: string;\n  body: string;\n  createdAt: string;\n  recipientCount?: number;\n  notifiedCount?: number;\n}`,
  'OrganizerBroadcast result type'
);
fs.writeFileSync(apiFile, api);

let dashboard = fs.readFileSync(dashboardFile, 'utf8');
dashboard = replace(
  dashboard,
  `  const [broadcastSent, setBroadcastSent] = useState(false);`,
  `  const [broadcastSent, setBroadcastSent] = useState(false);\n  const [broadcastSentCount, setBroadcastSentCount] = useState(0);`,
  'broadcast count state'
);
dashboard = replace(
  dashboard,
  `      setBroadcastHistory((prev) => [broadcast, ...prev]);\n      setBroadcastSent(true);`,
  `      setBroadcastHistory((prev) => [broadcast, ...prev]);\n      setBroadcastSentCount(broadcast.notifiedCount || 0);\n      setBroadcastSent(true);`,
  'broadcast count capture'
);
dashboard = dashboard.split('<span>Broadcast recorded for {recipientGroup}.</span>').join('<span>Broadcast sent to {broadcastSentCount} {recipientGroup} recipient{broadcastSentCount === 1 ? \'\' : \'s\'}.</span>');
dashboard = dashboard.split('Draft and record announcements for delegates, speakers, reviewers, or sponsors. Saved to your communications history below.').join('Send ConferenceGate announcements to the selected real audience. Every broadcast is also saved to your communications history below.');
fs.writeFileSync(dashboardFile, dashboard);

console.log('Organizer broadcast delivery patch applied.');
