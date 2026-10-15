import fs from 'fs';

const file = 'server/professionalTrust.ts';
let source = fs.readFileSync(file, 'utf8');

const anchor = `  const conferenceId = String(body.conferenceId || "").trim();\n  const conferenceTitle = String(body.conferenceTitle || "").trim();\n  if (!conferenceId || !conferenceTitle) return res.status(400).json({ error: "conferenceId and conferenceTitle are required." });\n  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};`;

const replacement = `  const conferenceId = String(body.conferenceId || "").trim();\n  const conferenceTitle = String(body.conferenceTitle || "").trim();\n  if (!conferenceId || !conferenceTitle) return res.status(400).json({ error: "conferenceId and conferenceTitle are required." });\n\n  // The organizer may evaluate only a Professional who actually completed a role for a\n  // conference/draft owned by this organizer workspace. Do not trust conferenceId/title from\n  // the browser as proof of relationship.\n  const ownedConference = await dbGet<any>(\n    "SELECT id FROM created_conferences WHERE id=? AND organizer_id=?",\n    [conferenceId, context.accountId]\n  );\n  const ownedDraft = ownedConference ? null : await dbGet<any>(\n    "SELECT id FROM conference_recruitment_drafts WHERE id=? AND organizer_id=?",\n    [conferenceId, context.accountId]\n  );\n  if (!ownedConference && !ownedDraft) {\n    return res.status(404).json({ error: "Conference not found in this Organizer workspace." });\n  }\n\n  const completedRole = await dbGet<any>(\n    \`SELECT id,status FROM professional_invitations\n      WHERE professional_id=? AND organizer_id=? AND conference_id=? AND status='completed'\n      LIMIT 1\`,\n    [professional.id, context.accountId, conferenceId]\n  );\n  if (!completedRole) {\n    return res.status(409).json({ error: "Professional feedback becomes available after this Professional has completed a role for the conference." });\n  }\n\n  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};`;

if (!source.includes(replacement)) {
  if (!source.includes(anchor)) throw new Error('[professional-evaluation-security] evaluation anchor missing');
  source = source.replace(anchor, replacement);
  fs.writeFileSync(file, source);
}

console.log('[professional-evaluation-security] organizer ownership and completed-role verification applied');
