import fs from 'node:fs';

const fileUrl = new URL('../src/App.tsx', import.meta.url);
let source = fs.readFileSync(fileUrl, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Real production data patch could not find: ${label}`);
  source = source.replace(before, after);
  changed = true;
}

replaceOnce(
`import {
  sampleConferences,
  currentUserProfile,
} from './data/mockData';`,
`import { currentUserProfile } from './data/mockData';`,
  'mock conference import'
);

replaceOnce(
  'const [conferences, setConferences] = useState<Conference[]>(sampleConferences);',
  'const [conferences, setConferences] = useState<Conference[]>([]);',
  'initial mock conference state'
);

replaceOnce(
`    fetchCreatedConferences()
      .then((created) => {
        if (created.length === 0) return;
        const createdIds = new Set(created.map((c) => c.id));
        setConferences([...created, ...sampleConferences.filter((c) => !createdIds.has(c.id))]);
      })
      .catch(() => {});`,
`    fetchCreatedConferences()
      .then((created) => {
        // Internal ConferenceGate actions must only use conferences that really exist in
        // persistent storage. Worldwide public conferences live in the Discover catalogue;
        // never mix hard-coded demo records into registration, submission, or organizer flows.
        setConferences(created);
      })
      .catch(() => setConferences([]));`,
  'created conference demo merge'
);

replaceOnce(
`  // Discover shows only real, organizer-created conferences (submitted through the app) plus
  // live web results — never the static seed catalog, which was only ever meant as starter
  // demo data, not something to present as if it were live/current. attendeeCount is overridden
  // here with the real registration count for every conference — never the stored value, which
  // is only ever a stale snapshot from creation time (0 for new ones).
  const sampleConferenceIds = React.useMemo(() => new Set(sampleConferences.map((c) => c.id)), []);
  const discoverConferences = React.useMemo(
    () =>
      conferences
        .filter((c) => !sampleConferenceIds.has(c.id))
        .map((c) => ({ ...c, attendeeCount: registrationCountsByConference[c.id] ?? 0 })),
    [conferences, sampleConferenceIds, registrationCountsByConference]
  );`,
`  // ConferenceGate-native records are now all persisted records. Public worldwide records are
  // provided separately by the Discover catalogue. attendeeCount is always the live registration
  // count rather than a snapshot copied at conference creation time.
  const discoverConferences = React.useMemo(
    () => conferences.map((c) => ({ ...c, attendeeCount: registrationCountsByConference[c.id] ?? 0 })),
    [conferences, registrationCountsByConference]
  );`,
  'obsolete demo conference discover filter'
);

if (changed) {
  fs.writeFileSync(fileUrl, source, 'utf8');
  console.log('Removed demo conference records from production app state.');
} else {
  console.log('Production app already uses only persisted conference records.');
}
