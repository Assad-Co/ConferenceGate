import fs from "node:fs";
// Run after the legacy source generators. Keep the integration narrow and replay-safe.
export function patchIntelligenceApp(source) {
  if (source.includes("/* conference-intelligence-suite */")) return source;
  const insertions = [
    [
      "import { DiscoveryEngine }",
      "import { ConferenceIntelligenceHub, ConferenceDiscoveryWorkspace } from './components/ConferenceIntelligenceHub';\nimport { OrganizerIntelligencePanel, SponsorIntelligencePanel } from './components/RoleIntelligencePanel';\nimport { DiscoveryEngine }",
    ],
    [
      "{activeTab === 'discover' && (\n          <DiscoveryEngine",
      "{activeTab === 'discover' && (\n          /* conference-intelligence-suite */\n          <ConferenceDiscoveryWorkspace accountId={authUser.id} profile={userProfile} onOpen={handleOpenExternalResult} onOpportunities={() => setActiveTab('reviewer')}>\n          <DiscoveryEngine",
    ],
    [
      "authUser.hasPaidAccess ? (\n          <OrganizerDashboard",
      "authUser.hasPaidAccess ? (\n          <>\n          <OrganizerIntelligencePanel conferences={myConferences} submissions={submissions} registrations={registrationCountsByConference} />\n          <OrganizerDashboard",
    ],
    [
      "authUser.hasPaidAccess ? (\n          <SponsorPortal",
      "authUser.hasPaidAccess ? (\n          <>\n          <SponsorIntelligencePanel />\n          <SponsorPortal",
    ],
  ];
  for (const [before, after] of insertions) {
    if (!source.includes(before))
      throw new Error(`Intelligence integration target missing: ${before}`);
    source = source.replace(before, after);
  }
  for (const name of [
    "DiscoveryEngine",
    "OrganizerDashboard",
    "SponsorPortal",
  ]) {
    const start = source.indexOf(`<${name}\n`);
    const end = source.indexOf("/>", start);
    if (start < 0 || end < 0)
      throw new Error(`Intelligence component boundary missing: ${name}`);
    source =
      source.slice(0, end + 2) +
      (name === "DiscoveryEngine"
        ? "\n          </ConferenceDiscoveryWorkspace>"
        : "\n          </>") +
      source.slice(end + 2);
  }
  // The planning dashboard is also reachable from My Conferences, without a new navigation role.
  const hub = source.indexOf("<MyConferencesHub\n");
  if (hub >= 0) {
    const end = source.indexOf("/>", hub);
    source =
      source.slice(0, hub) +
      '<>\n          <ConferenceIntelligenceHub accountId={authUser.id} profile={userProfile} onOpen={handleOpenExternalResult} onOpportunities={() => setActiveTab(\'reviewer\')} defaultView="planner" />\n          ' +
      source.slice(hub, end + 2) +
      "\n          </>" +
      source.slice(end + 2);
  } else throw new Error("My Conferences integration target missing");
  return source;
}
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))
) {
  const path = "src/App.tsx";
  fs.writeFileSync(
    path,
    patchIntelligenceApp(fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n")),
  );
} else if (!process.env.CONFERENCE_INTELLIGENCE_PATCH_TEST) {
  const path = "src/App.tsx";
  fs.writeFileSync(
    path,
    patchIntelligenceApp(fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n")),
  );
}
