import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const panel = read('src/components/MeetingMinutesPanel.tsx');
const api = read('src/api/meetingMinutesPdf.ts');
const pdf = read('server/meetingMinutesPdf.ts');
const activity = read('server/activity.ts');
const organizerPatch = read('scripts/patchOrganizerFinalUX.mjs');

const must = (ok, label) => { if (!ok) throw new Error(`Organizer messaging/PDF audit failed: ${label}`); };
must(panel.includes('Save & Send PDF to Selected Groups'), 'selected-group PDF button');
must(panel.includes('sendMeetingMinutesPdfToMembers(item.id, extraEmails, item.distributionGroups, item.notifyInApp)'), 'selected groups passed to PDF API');
must(api.includes('distributionGroups: string[] = []'), 'client API accepts groups');
must(pdf.includes("role_type IN ('committee','chair')"), 'committee includes chairs');
must(pdf.includes("groups.includes('members')"), 'conference members group resolver');
must(pdf.includes('notifiedCount'), 'in-app notification count returned');
must(pdf.includes('conference-gate-logo.png') && pdf.includes('doc.addImage'), 'branded PDF embeds ConferenceGate logo');
must(pdf.includes('attachments: [{ filename: pdfFilename'), 'email attaches PDF');
must(activity.includes("roleClauses.push(\"'committee'\", \"'chair'\")"), 'legacy distribute path includes chairs');
must(activity.includes('SELECT DISTINCT submitter_id FROM submissions WHERE conference_id=? AND is_external=0'), 'conference members include authors');
must(organizerPatch.includes('Send Technical Committee Announcement'), 'committee announcement wording');
must(organizerPatch.includes('accepted Technical Committee members and chairs'), 'automatic group resolution wording');
console.log('Organizer messaging/PDF delivery audit passed.');
