import fs from 'node:fs';

const file = 'src/App.tsx';
let source = fs.readFileSync(file, 'utf8');

const oldBlock = `  const discoverConferences = React.useMemo(\n    () =>\n      conferences\n        .filter((c) => !sampleConferenceIds.has(c.id))\n        .map((c) => ({ ...c, attendeeCount: registrationCountsByConference[c.id] ?? 0 })),\n    [conferences, sampleConferenceIds, registrationCountsByConference]\n  );`;

const newBlock = `  const discoverConferences = React.useMemo(\n    () =>\n      conferences\n        .filter((c) => !sampleConferenceIds.has(c.id))\n        .map((c) => ({ ...c, attendeeCount: registrationCountsByConference[c.id] ?? 0 })),\n    [conferences, sampleConferenceIds, registrationCountsByConference]\n  );\n\n  // Active discovery should not resurface historical catalogue records. Past conferences remain\n  // in ConferenceGate for attendance, profile evidence and history; only clearly finished events\n  // are hidden from the normal upcoming-discovery surfaces. Undated records are retained rather\n  // than guessed to be stale.\n  const upcomingDiscoverConferences = React.useMemo(() => {\n    const today = new Date();\n    today.setHours(0, 0, 0, 0);\n    return discoverConferences.filter((conference) => {\n      const raw = conference.dates?.end || conference.dates?.start || '';\n      if (!raw) return true;\n      const parsed = Date.parse(raw);\n      if (!Number.isFinite(parsed)) return true;\n      const eventDate = new Date(parsed);\n      eventDate.setHours(23, 59, 59, 999);\n      return eventDate.getTime() >= today.getTime();\n    });\n  }, [discoverConferences]);`;

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) throw new Error('[upcoming-discovery] discoverConferences anchor missing');
  source = source.replace(oldBlock, newBlock);

  // Only active discovery/submission surfaces use the upcoming-only list. Profile/history and\n  // certificates keep the complete non-demo catalogue so historical records remain resolvable.\n  source = source.replace('conferences={discoverConferences}\n            onSelectConference={handleSelectConference}\n            onNavigateTab={setActiveTab}', 'conferences={upcomingDiscoverConferences}\n            onSelectConference={handleSelectConference}\n            onNavigateTab={setActiveTab}');
  source = source.replace('          <DiscoveryEngine\n            conferences={discoverConferences}', '          <DiscoveryEngine\n            conferences={upcomingDiscoverConferences}');
  source = source.replace('        conferences={discoverConferences}\n        defaultConferenceId={submitAbstractConfId}', '        conferences={upcomingDiscoverConferences}\n        defaultConferenceId={submitAbstractConfId}');
  fs.writeFileSync(file, source);
}

console.log('[upcoming-discovery] clearly past conferences hidden from active discovery surfaces');
