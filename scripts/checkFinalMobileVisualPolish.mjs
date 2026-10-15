import fs from 'node:fs';

const organizer = fs.readFileSync('src/components/OrganizerDashboard.tsx', 'utf8');
const sponsor = fs.readFileSync('src/components/SponsorPortal.tsx', 'utf8');
const must = (ok, label) => { if (!ok) throw new Error(`Final mobile visual audit failed: ${label}`); };

must(organizer.includes('overflow-x-auto'), 'Organizer tabs must remain horizontally scrollable on narrow screens');
must(sponsor.includes('overflow-x-auto'), 'Sponsor tabs must remain horizontally scrollable on narrow screens');
must(organizer.includes('w-full sm:w-auto px-5 py-2.5'), 'Organizer primary CTA should be full-width on phones');
must(organizer.includes('w-full sm:w-auto px-4 py-2 bg-slate-100'), 'Organizer Edit Profile should be full-width on phones');
must(sponsor.includes('flex flex-wrap items-center gap-2'), 'Sponsor header badges should wrap on phones');
must(sponsor.includes('flex flex-col sm:flex-row gap-2'), 'Sponsor Deal Room note controls should stack on phones');
must(sponsor.includes('flex-1 min-w-0 p-2.5'), 'Sponsor Deal Room note input must be shrink-safe');
must(sponsor.includes('w-full sm:w-auto px-4 py-2.5'), 'Sponsor Deal Room Send should be full-width on phones');

for (const [name, source] of [['organizer', organizer], ['sponsor', sponsor]]) {
  must(!source.includes('href="#"'), `${name} contains placeholder href`);
  must(!source.includes('onClick={() => {}}'), `${name} contains empty click handler`);
}

console.log(JSON.stringify({
  finalMobileVisualPolish: 'passed',
  organizerTabs: true,
  sponsorTabs: true,
  mobilePrimaryActions: true,
  sponsorHeaderWrapping: true,
  dealRoomMobileStacking: true,
  deadControlGuard: true,
}));
