import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiFile = path.join(root, 'src/api/meetingMinutesPdf.ts');
const panelFile = path.join(root, 'src/components/MeetingMinutesPanel.tsx');
const pdfServerFile = path.join(root, 'server/meetingMinutesPdf.ts');
const activityServerFile = path.join(root, 'server/activity.ts');
const organizerPatchFile = path.join(root, 'scripts/patchOrganizerFinalUX.mjs');

const replace = (source, from, to, label) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Organizer delivery patch: ${label} anchor missing`);
  return source.replace(from, to);
};

let api = fs.readFileSync(apiFile, 'utf8');
api = replace(api,
`export interface MeetingMinutesPdfSendResult {\n  emailConfigured: boolean;\n  recipientCount: number;\n  emailSentCount: number;\n  emailFailedCount: number;\n  distributedAt?: string | null;\n}`,
`export interface MeetingMinutesPdfSendResult {\n  emailConfigured: boolean;\n  recipientCount: number;\n  notifiedCount: number;\n  emailSentCount: number;\n  emailFailedCount: number;\n  distributedAt?: string | null;\n}`,
'PDF result type');
api = replace(api,
`export async function sendMeetingMinutesPdfToMembers(id: string, externalEmails: string[] = []): Promise<MeetingMinutesPdfSendResult> {\n  const res = await fetch(\`/api/meeting-minutes/\${encodeURIComponent(id)}/send-pdf\`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify({ externalEmails }),\n  });\n  return parseJson(res);\n}`,
`export async function sendMeetingMinutesPdfToMembers(\n  id: string,\n  externalEmails: string[] = [],\n  distributionGroups: string[] = [],\n  notifyInApp = true\n): Promise<MeetingMinutesPdfSendResult> {\n  const res = await fetch(\`/api/meeting-minutes/\${encodeURIComponent(id)}/send-pdf\`, {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify({ externalEmails, distributionGroups, notifyInApp }),\n  });\n  return parseJson(res);\n}`,
'PDF send client');
fs.writeFileSync(apiFile, api);

let panel = fs.readFileSync(panelFile, 'utf8');
panel = panel.split('can send it to all conference-member emails or prepare a Gmail message with the recipients already added.').join('can send the branded PDF to exactly the recipient groups selected below, with ConferenceGate notifications where enabled.');
panel = panel.split('Save & Send PDF to All Members').join('Save & Send PDF to Selected Groups');
panel = panel.split('One-click email delivery automatically resolves all stored conference members, accepted committee/chair/speaker roles, assigned reviewers and abstract submitters, then sends each recipient the PDF privately.').join('ConferenceGate resolves only the selected groups below, removes duplicates, sends in-app notifications when enabled, and emails the branded PDF when email delivery is configured.');
panel = replace(panel,
`const result = await sendMeetingMinutesPdfToMembers(item.id, extraEmails);`,
`const result = await sendMeetingMinutesPdfToMembers(item.id, extraEmails, item.distributionGroups, item.notifyInApp);`,
'panel PDF send');
panel = panel.split("title: 'PDF meeting minutes sent',").join("title: 'PDF meeting minutes delivered',");
panel = panel.split('member email${result.recipientCount === 1 ? \'\' : \'s\'} sent with the branded PDF attached').join('selected recipient${result.recipientCount === 1 ? \'\' : \'s\'} reached; ${result.emailSentCount} branded PDF email${result.emailSentCount === 1 ? \'\' : \'s\'} sent and ${result.notifiedCount} in-app notification${result.notifiedCount === 1 ? \'\' : \'s\'} created');
fs.writeFileSync(panelFile, panel);

let pdfServer = fs.readFileSync(pdfServerFile, 'utf8');
pdfServer = replace(pdfServer,
`async function resolveRecipients(row: any, organizerId: string, extraEmails: string[] = []) {\n  const userIds = new Set<string>();\n  const professionals = await dbAll<{ professional_id: string }>(\n    "SELECT DISTINCT professional_id FROM professional_invitations WHERE organizer_id=? AND conference_id=? AND status IN ('accepted','completed')",\n    [organizerId, row.conference_id]\n  );\n  professionals.forEach((item) => userIds.add(item.professional_id));\n\n  const registrations = await dbAll<{ user_id: string }>(\n    "SELECT DISTINCT user_id FROM conference_registrations WHERE conference_id=?",\n    [row.conference_id]\n  );\n  registrations.forEach((item) => userIds.add(item.user_id));\n\n  const reviewers = await dbAll<{ reviewer_id: string }>(\n    "SELECT DISTINCT a.reviewer_id FROM submission_reviewer_assignments a JOIN submissions s ON s.id=a.submission_id WHERE s.conference_id=?",\n    [row.conference_id]\n  );\n  reviewers.forEach((item) => userIds.add(item.reviewer_id));\n\n  const authors = await dbAll<{ submitter_id: string }>(\n    "SELECT DISTINCT submitter_id FROM submissions WHERE conference_id=? AND is_external=0",\n    [row.conference_id]\n  );\n  authors.forEach((item) => userIds.add(item.submitter_id));\n\n  const recipients: Array<{ id?: string; name: string; email: string }> = [];`,
`async function resolveRecipients(row: any, organizerId: string, extraEmails: string[] = [], requestedGroups?: string[]) {\n  const groups = (requestedGroups?.length ? requestedGroups : safeArray(row.distribution_groups).map(String))\n    .filter((value) => ['committee','members','reviewers','speakers'].includes(value));\n  const userIds = new Set<string>();\n\n  if (groups.includes('committee')) {\n    const professionals = await dbAll<{ professional_id: string }>(\n      "SELECT DISTINCT professional_id FROM professional_invitations WHERE organizer_id=? AND conference_id=? AND status IN ('accepted','completed') AND role_type IN ('committee','chair')",\n      [organizerId, row.conference_id]\n    );\n    professionals.forEach((item) => userIds.add(item.professional_id));\n  }\n  if (groups.includes('speakers')) {\n    const speakers = await dbAll<{ professional_id: string }>(\n      "SELECT DISTINCT professional_id FROM professional_invitations WHERE organizer_id=? AND conference_id=? AND status IN ('accepted','completed') AND role_type='speaker'",\n      [organizerId, row.conference_id]\n    );\n    speakers.forEach((item) => userIds.add(item.professional_id));\n  }\n  if (groups.includes('members')) {\n    const registrations = await dbAll<{ user_id: string }>(\n      "SELECT DISTINCT user_id FROM conference_registrations WHERE conference_id=?",\n      [row.conference_id]\n    );\n    registrations.forEach((item) => userIds.add(item.user_id));\n    const authors = await dbAll<{ submitter_id: string }>(\n      "SELECT DISTINCT submitter_id FROM submissions WHERE conference_id=? AND is_external=0",\n      [row.conference_id]\n    );\n    authors.forEach((item) => userIds.add(item.submitter_id));\n  }\n  if (groups.includes('reviewers')) {\n    const reviewers = await dbAll<{ reviewer_id: string }>(\n      "SELECT DISTINCT a.reviewer_id FROM submission_reviewer_assignments a JOIN submissions s ON s.id=a.submission_id WHERE s.conference_id=?",\n      [row.conference_id]\n    );\n    reviewers.forEach((item) => userIds.add(item.reviewer_id));\n  }\n\n  const recipients: Array<{ id?: string; name: string; email: string }> = [];`,
'group-aware recipient resolver');

pdfServer = replace(pdfServer,
`  const recipients = await resolveRecipients(loaded.row, loaded.context.accountId, extraEmails);\n  if (!recipients.length) return res.status(400).json({ error: "No conference member email addresses are available yet." });\n  const configured = emailConfigured();\n  if (!configured) {\n    return res.json({ emailConfigured: false, recipientCount: recipients.length, emailSentCount: 0, emailFailedCount: 0 });\n  }\n  const pdf = buildPdfBuffer(loaded.row);`,
`  const groups = Array.isArray(req.body?.distributionGroups) ? req.body.distributionGroups.filter((value: unknown) => ['committee','members','reviewers','speakers'].includes(String(value))) : safeArray(loaded.row.distribution_groups).map(String);\n  const notifyInApp = req.body?.notifyInApp === undefined ? Boolean(loaded.row.notify_in_app) : Boolean(req.body.notifyInApp);\n  const recipients = await resolveRecipients(loaded.row, loaded.context.accountId, extraEmails, groups);\n  if (!recipients.length) return res.status(400).json({ error: "No recipients are available for the selected distribution groups." });\n  let notifiedCount = 0;\n  if (notifyInApp) {\n    for (const recipient of recipients) {\n      if (!recipient.id) continue;\n      await dbRun(\n        "INSERT INTO notifications(id,user_id,type,title,message) VALUES(?,?,?,?,?)",\n        [\`ntf_\${crypto.randomUUID()}\`, recipient.id, "agenda", \`Meeting minutes: \${loaded.row.title}\`, \`\${loaded.row.conference_title}: official meeting minutes are available from the organizer.\`]\n      );\n      notifiedCount += 1;\n    }\n  }\n  const configured = emailConfigured();\n  if (!configured) {\n    await dbRun("UPDATE organizer_meeting_minutes SET distribution_groups=?,notify_in_app=?,updated_at=datetime('now') WHERE id=?", [JSON.stringify(groups),notifyInApp ? 1 : 0,loaded.row.id]);\n    return res.json({ emailConfigured: false, recipientCount: recipients.length, notifiedCount, emailSentCount: 0, emailFailedCount: 0 });\n  }\n  const pdf = buildPdfBuffer(loaded.row);`,
'send-pdf group handling');

pdfServer = replace(pdfServer,
`      if (recipient.id) {\n        await dbRun(\n          "INSERT INTO notifications(id,user_id,type,title,message) VALUES(?,?,?,?,?)",\n          [\`ntf_\${crypto.randomUUID()}\`, recipient.id, "agenda", \`Meeting minutes: \${loaded.row.title}\`, \`\${loaded.row.conference_title}: the organizer emailed you the official PDF meeting minutes.\`]\n        );\n      }`,
`      // In-app notification delivery is handled once above, independently of email success.`,
'avoid duplicate notification');
pdfServer = pdfServer.split('res.json({ emailConfigured: true, recipientCount: recipients.length, emailSentCount, emailFailedCount, distributedAt: updated?.distributed_at || null });').join('res.json({ emailConfigured: true, recipientCount: recipients.length, notifiedCount, emailSentCount, emailFailedCount, distributedAt: updated?.distributed_at || null });');
pdfServer = pdfServer.split('UPDATE organizer_meeting_minutes SET distributed_at=datetime(\'now\'),send_email=1,updated_at=datetime(\'now\') WHERE id=?').join('UPDATE organizer_meeting_minutes SET distribution_groups=?,notify_in_app=?,distributed_at=datetime(\'now\'),send_email=1,updated_at=datetime(\'now\') WHERE id=?');
pdfServer = pdfServer.split('[loaded.row.id]);\n  const updated = await dbGet<{ distributed_at: string | null }>("SELECT distributed_at FROM organizer_meeting_minutes WHERE id=?", [loaded.row.id]);').join('[JSON.stringify(groups),notifyInApp ? 1 : 0,loaded.row.id]);\n  const updated = await dbGet<{ distributed_at: string | null }>("SELECT distributed_at FROM organizer_meeting_minutes WHERE id=?", [loaded.row.id]);');
fs.writeFileSync(pdfServerFile, pdfServer);

let activityServer = fs.readFileSync(activityServerFile, 'utf8');
activityServer = activityServer.split(`if (groups.includes("committee")) roleClauses.push("'committee'");`).join(`if (groups.includes("committee")) roleClauses.push("'committee'", "'chair'");`);
activityServer = activityServer.split(`  if (groups.includes("members")) {\n    const registrations = await dbAll<{ user_id: string }>("SELECT DISTINCT user_id FROM conference_registrations WHERE conference_id=?", [row.conference_id]);\n    registrations.forEach((item) => userIds.add(item.user_id));\n  }`).join(`  if (groups.includes("members")) {\n    const registrations = await dbAll<{ user_id: string }>("SELECT DISTINCT user_id FROM conference_registrations WHERE conference_id=?", [row.conference_id]);\n    registrations.forEach((item) => userIds.add(item.user_id));\n    const authors = await dbAll<{ submitter_id: string }>("SELECT DISTINCT submitter_id FROM submissions WHERE conference_id=? AND is_external=0", [row.conference_id]);\n    authors.forEach((item) => userIds.add(item.submitter_id));\n  }`);
fs.writeFileSync(activityServerFile, activityServer);

// Keep the generated committee messaging language explicit: this is a ConferenceGate group announcement.
let organizerPatch = fs.readFileSync(organizerPatchFile, 'utf8');
organizerPatch = organizerPatch.split('Message Technical Committee</h3>').join('Send Technical Committee Announcement</h3>');
organizerPatch = organizerPatch.split('Send a real ConferenceGate notification to accepted Technical Committee members and chairs for one of your conferences.').join('ConferenceGate automatically resolves accepted Technical Committee members and chairs for the selected conference and sends each person an in-app notification.');
organizerPatch = organizerPatch.split("'Send Message & Notification'").join("'Send Committee Announcement'");
fs.writeFileSync(organizerPatchFile, organizerPatch);

console.log('Organizer group messaging and branded PDF delivery patch applied.');
