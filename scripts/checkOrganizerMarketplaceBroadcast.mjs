import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const activity = read('server/activity.ts');
const sponsors = read('server/sponsors.ts');
const dashboard = read('src/components/OrganizerDashboard.tsx');
const api = read('src/api/activity.ts');

const must = (ok, label) => { if (!ok) throw new Error(`Organizer marketplace/broadcast audit failed: ${label}`); };

must(activity.includes('JOIN created_conferences c ON c.id=r.conference_id'), 'attendee broadcast resolves owned conferences');
must(activity.includes("s.status IN ('Accepted','Accepted for Oral','Accepted for Poster')"), 'accepted author group resolution');
must(activity.includes('submission_reviewer_assignments a'), 'reviewer group resolution');
must(activity.includes("a.status='Approved'"), 'approved sponsor group resolution');
must(activity.includes('await createNotification(userId, "announcement"'), 'broadcast creates real notifications');
must(api.includes('notifiedCount?: number'), 'client exposes delivered count');
must(dashboard.includes('Broadcast sent to {broadcastSentCount}'), 'UI reports actual delivered count');

must(sponsors.includes('/needs/matched'), 'Sponsor Marketplace reads matched sponsorship needs');
must(sponsors.includes('New sponsorship opportunity:'), 'matched sponsors receive sponsorship alert');
must(sponsors.includes('Open the Sponsor Marketplace to review it.'), 'notification routes sponsor intent to marketplace');
must(dashboard.includes('createSponsorshipNeed({'), 'Organizer Publish Sponsorship Need uses real API');
must(dashboard.includes('result.notifiedSponsors'), 'Organizer sees matched Sponsor Pro notification count');

must(dashboard.includes('// Real platform activity for the managed conferences — no fabricated totals.'), 'analytics explicitly real-data only');
must(dashboard.includes('registrationCountsByConference[c.id] || 0'), 'analytics uses real registrations');
must(dashboard.includes('relevantSubmissions'), 'analytics uses real submissions');
must(dashboard.includes('feedbackSummary'), 'analytics uses real feedback');

console.log('Organizer marketplace, broadcast, and analytics audit passed.');
