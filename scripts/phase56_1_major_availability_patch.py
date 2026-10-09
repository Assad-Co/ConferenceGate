from pathlib import Path

# 1) Make verified major-conference manifests part of the static customer catalogue as a deterministic fallback.
path = Path('server/dataset/staticDataset.ts')
text = path.read_text()
anchor = '''let cached: LoadedDataset | null = null;\n\nexport function loadLaunchDataset(): LoadedDataset {'''
if anchor not in text:
    raise SystemExit('staticDataset insertion anchor not found')
helper = r'''let cached: LoadedDataset | null = null;

/**
 * Verified flagship manifests are also a static catalogue source.
 *
 * Their primary home is Turso, where the startup sync creates the richer extracted-conference
 * rows. But Discover must not lose a major event merely because a background bootstrap is slow or
 * a database write is temporarily unavailable. These manifests ship with the release, so they can
 * provide an immediate, zero-network fallback using the same evidence-first rules as the launch
 * dataset. Turso still wins the deduplication/ranking slot once its richer record is available.
 */
function readVerifiedMajorManifestRecords(): LaunchConferenceRecord[] {
  const files = [
    'phase52-major-conference-expansion.json',
    'phase56-global-major-conferences.json',
  ];
  const records: LaunchConferenceRecord[] = [];
  const seen = new Set<string>();

  const cleanText = (value: unknown): string | null => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
  };
  const availability = (present: boolean): LaunchSectionAvailability => present ? 'stated' : 'not_announced';
  const people = (items: any[]): LaunchDetailPerson[] => (Array.isArray(items) ? items : [])
    .filter((item) => cleanText(item?.name))
    .map((item) => ({
      name: String(item.name).trim(),
      role: cleanText(item.role),
      org: cleanText(item.organization ?? item.org),
      title: cleanText(item.title),
      topic: cleanText(item.topic),
    }));

  for (const directory of candidateDirectories()) {
    for (const file of files) {
      const filePath = path.join(directory, file);
      if (!fs.existsSync(filePath)) continue;
      let events: any[] = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        events = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn(`[launch-dataset] could not read verified major manifest ${filePath}:`, (error as Error).message);
        continue;
      }

      for (const event of events) {
        const title = cleanText(event?.title);
        const sourceUrl = cleanText(event?.url);
        const startDate = cleanText(event?.start);
        if (!title || !sourceUrl || !startDate) continue;
        const identity = `${sourceUrl.replace(/\/$/, '').toLowerCase()}|${startDate}`;
        if (seen.has(identity)) continue;
        seen.add(identity);

        let sourceHost = '';
        try { sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { continue; }
        const year = Number(startDate.slice(0, 4));
        if (!Number.isFinite(year)) continue;
        const categories = Array.isArray(event.categories)
          ? event.categories.map((value: unknown) => cleanText(value)).filter((value: string | null): value is string => Boolean(value))
          : [];
        const speakerItems = people(event.speakers || []);
        const committeeItems = people(event.committee || []);
        const sponsorRows = Array.isArray(event.sponsors) ? event.sponsors : [];
        const feeRows = Array.isArray(event.fees?.registration_fees) ? event.fees.registration_fees : [];
        const programThemes = Array.isArray(event.program?.themes)
          ? event.program.themes.map((value: unknown) => cleanText(value)).filter((value: string | null): value is string => Boolean(value))
          : [];
        const programSessions = Array.isArray(event.program?.sessions)
          ? event.program.sessions
              .filter((item: any) => cleanText(item?.title))
              .map((item: any) => ({
                date: cleanText(item.date),
                dateText: cleanText(item.dateText ?? item.date) || '',
                time: cleanText(item.time),
                title: String(item.title).trim(),
              }))
          : [];
        const cfp = event.cfp && typeof event.cfp === 'object'
          ? {
              status: cleanText(event.cfp.status),
              abstractDeadline: cleanText(event.cfp.abstract_submission_deadline ?? event.cfp.deadline),
              submissionEmail: cleanText(event.cfp.submission_email),
              lengthLimit: cleanText(event.cfp.length_limit),
              text: cleanText(event.cfp.submission_guidelines ?? event.cfp.overview),
              url: cleanText(event.cfp.submission_url ?? event.cfp.url),
            }
          : null;
        const acronymTokens = title.match(/\b[A-Z][A-Z0-9&-]{2,9}\b/g) || [];
        const acronym = acronymTokens.find((token) => !/^(ENERGY|CONGRESS|CONFERENCE|ANNUAL)$/.test(token)) || null;
        const edition = title.match(/^\s*(\d+(?:st|nd|rd|th))\b/i)?.[1] || null;
        const venueName = cleanText(event.venueInfo?.venue_name ?? event.venue);
        const venueAddress = cleanText(event.venueInfo?.address);
        const accommodation = cleanText(event.venueInfo?.accommodation);
        const communityText = cleanText(event.community?.overview ?? event.community?.summary);
        const programText = cleanText(event.program?.overview);

        const details: NonNullable<LaunchConferenceRecord['details']> = {
          source: 'ConferenceGate verified major-conference manifest',
          venueName,
          venueAddress,
          program: {
            availability: availability(Boolean(event.program)),
            text: programText,
          },
          callForPapers: cfp,
          schedule: { sessions: programSessions, themes: programThemes },
          keynotes: {
            availability: availability(speakerItems.length > 0),
            items: speakerItems,
            text: null,
            unstructuredReason: null,
          },
          committee: {
            availability: availability(committeeItems.length > 0),
            items: committeeItems,
            text: null,
            unstructuredReason: null,
          },
          fees: {
            availability: availability(Boolean(event.fees)),
            items: feeRows
              .filter((item: any) => cleanText(item?.category))
              .map((item: any) => ({
                category: String(item.category).trim(),
                amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : null,
                currency: cleanText(item.currency),
              })),
            text: cleanText(event.fees?.pricing_text) || feeRows.map((item: any) => cleanText(item?.notes)).filter(Boolean).join(' · ') || null,
            unstructuredReason: null,
          },
          sponsors: {
            availability: availability(sponsorRows.length > 0),
            items: sponsorRows
              .filter((item: any) => cleanText(item?.name))
              .map((item: any) => ({
                name: String(item.name).trim(),
                tier: cleanText(item.role ?? item.tier),
                logoUrl: cleanText(item.logoUrl ?? item.logo_url),
              })),
            text: null,
            unstructuredReason: null,
          },
          community: {
            availability: availability(Boolean(event.community)),
            text: communityText,
          },
          safetyNote: null,
          registrationUrl: cleanText(event.fees?.registration_url),
          accommodation,
        };

        records.push({
          id: `verified-major-${year}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)}`,
          title,
          acronym,
          series: title.replace(/\b20\d{2}\b/g, ' ').replace(/^\s*\d+(?:st|nd|rd|th)\s+/i, '').replace(/\s+/g, ' ').trim() || null,
          edition,
          year,
          startDate,
          endDate: cleanText(event.end),
          datePrecision: 'day',
          startMonth: /^\d{4}-\d{2}/.test(startDate) ? Number(startDate.slice(5, 7)) : null,
          datesText: cleanText(event.dates_text) || [startDate, cleanText(event.end)].filter(Boolean).join(' – '),
          city: cleanText(event.city),
          region: cleanText(event.region),
          country: cleanText(event.country),
          countryCode: cleanText(event.countryCode),
          worldRegion: cleanText(event.worldRegion),
          venue: cleanText(event.venue),
          format: event.format === 'online' || event.format === 'hybrid' ? event.format : 'in-person',
          organization: cleanText(event.organizer),
          category: categories[0] || null,
          categories,
          topics: categories,
          keywords: categories,
          description: cleanText(event.description),
          sourceUrl,
          sourceHost,
          sourceType: 'official_site',
          officialUrl: sourceUrl,
          logoUrl: cleanText(event.logoUrl ?? event.logo_url),
          imageUrl: cleanText(event.imageUrl ?? event.image_url),
          evidence: {
            query: 'ConferenceGate verified major-conference manifest',
            resultTitle: title,
            statedText: cleanText(event.description) || [title, startDate, event.city, event.country].filter(Boolean).join(' · '),
            retrievedAt: cleanText(event.verifiedAt) || '2026-10-09T00:00:00.000Z',
            method: 'web_search',
          },
          provenance: {},
          corroboratingSourceUrls: Array.isArray(event.sourceUrls)
            ? event.sourceUrls.map((value: unknown) => cleanText(value)).filter((value: string | null): value is string => Boolean(value) && value !== sourceUrl)
            : [],
          origin: 'launch_dataset',
          supply: 'curated_list',
          details,
        });
      }
    }
  }

  if (records.length) console.log(`[launch-dataset] verified major manifest fallback=${records.length}`);
  return records;
}

export function loadLaunchDataset(): LoadedDataset {'''
text = text.replace(anchor, helper, 1)
old = '''  const importedRecords = Array.isArray(imported?.records) ? imported.records : [];\n  const identity = (record: LaunchConferenceRecord) =>'''
new = '''  const importedRecords = Array.isArray(imported?.records) ? imported.records : [];\n  const verifiedMajorRecords = readVerifiedMajorManifestRecords();\n  const identity = (record: LaunchConferenceRecord) =>'''
if old not in text:
    raise SystemExit('staticDataset importedRecords anchor not found')
text = text.replace(old, new, 1)
old2 = '''  for (const record of importedRecords) {\n    const key = identity(record);'''
new2 = '''  for (const record of [...importedRecords, ...verifiedMajorRecords]) {\n    const key = identity(record);'''
if old2 not in text:
    raise SystemExit('staticDataset merge loop anchor not found')
text = text.replace(old2, new2, 1)
path.write_text(text)

# 2) Sync verified major conferences early in the production bootstrap, before slower import/repair work.
path = Path('scripts/runBackgroundBootstrap.mjs')
text = path.read_text()
old = '''  await runScript('scripts/ensureAapgLogos.mjs');\n  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');\n  await runScript('scripts/finalizeConferenceCoverage.mjs');'''
new = '''  await runScript('scripts/ensureAapgLogos.mjs');\n  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');\n  // Verified flagship manifests are DB-only and must become searchable before slower imports.\n  // The later call remains intentionally idempotent so the post-import quality pass can reassert\n  // the authoritative fields after generic normalization/enrichment.\n  await runScript('scripts/syncPhase52MajorConferences.mjs');\n  await runScript('scripts/finalizeConferenceCoverage.mjs');'''
if old not in text:
    raise SystemExit('background bootstrap fast-sync anchor not found')
text = text.replace(old, new, 1)
path.write_text(text)

print('Phase 56.1 major conference availability patch applied')
