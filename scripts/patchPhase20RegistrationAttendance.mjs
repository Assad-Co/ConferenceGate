import fs from 'node:fs';

const path = 'src/components/UserProfileView.tsx';
let text = fs.readFileSync(path, 'utf8');

function replace(from, to, label) {
  if (!text.includes(from)) throw new Error(`missing patch marker: ${label}`);
  text = text.replace(from, to);
}

replace(
`  // Verified attendance is derived from real, persisted conference registrations —
  // never fabricated, so it starts empty until the account actually registers for one.
  const ATTENDED_CONFERENCES: AttendedConference[] = useMemo(`,
`  // A ConferenceGate registration proves enrollment, not actual attendance. Keep registrations
  // separate from the self-reported attendance section so the profile never upgrades one fact
  // into another without evidence.
  const REGISTERED_CONFERENCES: AttendedConference[] = useMemo(`,
'registration provenance comment'
);

replace(
`            everything else, so their profile page only needs Notifications and their own
            conference attendance history. */}`,
`            everything else, so their profile page only needs Notifications and their own
            conference registration/history view. */}`,
'profile tab comment'
);

replace(
`            <h3 className="text-base font-bold text-slate-900">Verified Conferences Attended</h3>
            {ATTENDED_CONFERENCES.length > 0 ? (`,
`            <div>
              <h3 className="text-base font-bold text-slate-900">ConferenceGate Registrations</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                These records confirm registration through ConferenceGate. They do not claim attendance unless attendance is verified separately.
              </p>
            </div>
            {REGISTERED_CONFERENCES.length > 0 ? (`,
'registration heading'
);

replace(
`                {ATTENDED_CONFERENCES.map((conf) => (`,
`                {REGISTERED_CONFERENCES.map((conf) => (`,
'registration map'
);

replace(
`                        Verified Attendance`,
`                        Registered`,
'registration badge'
);

replace(
`                No verified conference attendance on record yet. Once you register for a conference through Conference
                Gate, it'll appear here.`,
`                No ConferenceGate registrations on record yet. Registrations completed through ConferenceGate will appear here.`,
'registration empty copy'
);

fs.writeFileSync(path, text);
console.log('Phase 20 registration/attendance integrity patch applied');
