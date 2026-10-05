from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Phase 28 patch target not found: {label}")
    if text.count(old) != 1:
        raise SystemExit(f"Phase 28 patch target not unique: {label} ({text.count(old)})")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "server/braveSearch.ts",
    '''  const upcoming = withDates.filter((entry) => entry.time >= startOfToday.getTime() && Number.isFinite(entry.time));
  const rest = withDates.filter((entry) => !(entry.time >= startOfToday.getTime() && Number.isFinite(entry.time)));
  upcoming.sort((left, right) => left.time - right.time);
  const results = deduplicateStoredConferences(
    [...upcoming, ...rest].map((entry) => entry.result)
  ).slice(0, Math.max(1, Math.min(limit, 10000)));
''',
    '''  // Phase 28: the empty-query Discover view is an *upcoming* catalogue. Known-past
  // conferences are useful historical records and remain searchable by name, but they should not
  // occupy browse slots ahead of conferences a customer can still attend. The primary window is
  // the current calendar year plus the next one (2026-2027 at launch); later future records remain
  // available underneath it, and undated records are last rather than being mistaken for upcoming.
  const primaryWindowEnd = new Date(startOfToday.getFullYear() + 2, 0, 1).getTime();
  const primaryUpcoming = withDates.filter((entry) =>
    Number.isFinite(entry.time) && entry.time >= startOfToday.getTime() && entry.time < primaryWindowEnd
  );
  const laterUpcoming = withDates.filter((entry) =>
    Number.isFinite(entry.time) && entry.time >= primaryWindowEnd
  );
  const undated = withDates.filter((entry) => !Number.isFinite(entry.time));
  const depth = (entry: { result: LiveSearchResult; time: number }) =>
    (entry.result.prepared ? 10 : 0) +
    Math.min(8, new Set(entry.result.sections || []).size) +
    (entry.result.cfpHasData ? 1 : 0);
  const compareUpcoming = (
    left: { result: LiveSearchResult; time: number },
    right: { result: LiveSearchResult; time: number }
  ) => left.time - right.time || depth(right) - depth(left) || left.result.title.localeCompare(right.result.title);
  primaryUpcoming.sort(compareUpcoming);
  laterUpcoming.sort(compareUpcoming);
  undated.sort((left, right) => depth(right) - depth(left) || left.result.title.localeCompare(right.result.title));
  const results = deduplicateStoredConferences(
    [...primaryUpcoming, ...laterUpcoming, ...undated].map((entry) => entry.result)
  ).slice(0, Math.max(1, Math.min(limit, 10000)));
''',
    "browse upcoming window",
)

replace_once(
    "scripts/runBackgroundBootstrap.mjs",
    """  await runScript('scripts/syncRequestedCategoryExpansion.mjs');
  // Populate the stored sponsorship catalog immediately from conferences already in Turso.
""",
    """  await runScript('scripts/syncRequestedCategoryExpansion.mjs');
  // Phase 28: the verified expansion is inserted after the first fast normalisation pass, so run
  // the DB-only quality pipeline again here. This makes newly added conferences customer-ready on
  // the same deploy instead of waiting for a later enrichment cycle, and records a depth/coverage
  // audit without deleting any historical data.
  await runScript('scripts/sanitizeConferenceDetailData.mjs');
  await runScript('scripts/finalizeConferenceCoverage.mjs');
  await runScript('scripts/upgradeConferenceIdentityAndTabs.mjs');
  await runScript('scripts/auditConferenceDepth.mjs');
  // Populate the stored sponsorship catalog immediately from conferences already in Turso.
""",
    "background bootstrap expansion finalization",
)

replace_once(
    "scripts/syncRequestedCategoryExpansion.mjs",
    """    let synced=0,rich6=0;
    for(const e of EVENTS){
""",
    """    let synced=0,rich6=0,skippedPast=0;
    const today=new Date().toISOString().slice(0,10);
    for(const e of EVENTS){
      // Phase 28: this manifest is an upcoming-conference expansion. Keep historical records in
      // their existing tables, but do not keep re-inserting a verified manifest item after its
      // stated event dates have passed.
      const lastDate=String(e.end||e.start||'').slice(0,10);
      if(lastDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(lastDate) && lastDate<today){ skippedPast++; continue; }
""",
    "requested expansion skip past",
)

replace_once(
    "scripts/syncRequestedCategoryExpansion.mjs",
    """    console.log('[requested-expansion] synced='+synced+' rich_6plus_tabs='+rich6+' total='+EVENTS.length);
""",
    """    console.log('[requested-expansion] synced='+synced+' rich_6plus_tabs='+rich6+' skipped_past='+skippedPast+' total='+EVENTS.length);
""",
    "requested expansion reporting",
)

replace_once(
    "package.json",
    '    "conference:requested-expansion": "node scripts/syncRequestedCategoryExpansion.mjs",\n',
    '    "conference:requested-expansion": "node scripts/syncRequestedCategoryExpansion.mjs && node scripts/sanitizeConferenceDetailData.mjs && node scripts/finalizeConferenceCoverage.mjs && node scripts/upgradeConferenceIdentityAndTabs.mjs && node scripts/auditConferenceDepth.mjs",\n    "conference:depth-audit": "node scripts/auditConferenceDepth.mjs",\n',
    "package scripts",
)

print("Phase 28 patch applied")
