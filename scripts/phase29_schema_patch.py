from pathlib import Path

p = Path('server/discovery/coveragePlanner.ts')
text = p.read_text()
old = '''  const rows = await dbAll<Record<string, any>>(`
    SELECT de.id,de.title,de.country,de.region,de.start_date,de.start_year,de.status,de.publish_readiness,
           dec.category,ec.source_url AS published_source_url,ec.overview,ec.call_for_papers,
           ec.program_agenda,ec.keynote_speakers,ec.technical_committee,ec.sponsors_exhibitors,
           ec.venue_accommodation,ec.fees_pricing,ec.community,ec.extraction_metadata,de.image_url
      FROM discovery_events de
      JOIN discovery_event_categories dec ON dec.event_id=de.id
      LEFT JOIN extracted_conferences ec
        ON ec.source_url=de.official_url OR ec.source_url=de.canonical_url
     WHERE de.status IN ('validated','published','needs_review')
       AND (
         (de.start_date IS NOT NULL AND date(de.start_date) >= date('now'))
         OR (de.start_date IS NULL AND de.start_year >= CAST(strftime('%Y','now') AS INTEGER))
       )
  `);
'''
new = '''  // The discovery schema is deliberately additive and can exist before the app's own
  // `extracted_conferences` table in a fresh local/worker database. Coverage planning remains
  // useful there: it can still measure accepted category/geography inventory, while published
  // and rich counts are correctly zero until the app catalogue exists. Production normally takes
  // the richer join below.
  const appTables = await dbAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='extracted_conferences'"
  );
  const hasPublishedCatalogue = appTables.length > 0;
  const rows = hasPublishedCatalogue
    ? await dbAll<Record<string, any>>(`
        SELECT de.id,de.title,de.country,de.region,de.start_date,de.start_year,de.status,de.publish_readiness,
               dec.category,ec.source_url AS published_source_url,ec.overview,ec.call_for_papers,
               ec.program_agenda,ec.keynote_speakers,ec.technical_committee,ec.sponsors_exhibitors,
               ec.venue_accommodation,ec.fees_pricing,ec.community,ec.extraction_metadata,de.image_url
          FROM discovery_events de
          JOIN discovery_event_categories dec ON dec.event_id=de.id
          LEFT JOIN extracted_conferences ec
            ON ec.source_url=de.official_url OR ec.source_url=de.canonical_url
         WHERE de.status IN ('validated','published','needs_review')
           AND (
             (de.start_date IS NOT NULL AND date(de.start_date) >= date('now'))
             OR (de.start_date IS NULL AND de.start_year >= CAST(strftime('%Y','now') AS INTEGER))
           )
      `)
    : await dbAll<Record<string, any>>(`
        SELECT de.id,de.title,de.country,de.region,de.start_date,de.start_year,de.status,de.publish_readiness,
               dec.category,NULL AS published_source_url,NULL AS overview,NULL AS call_for_papers,
               NULL AS program_agenda,NULL AS keynote_speakers,NULL AS technical_committee,
               NULL AS sponsors_exhibitors,NULL AS venue_accommodation,NULL AS fees_pricing,
               NULL AS community,NULL AS extraction_metadata,de.image_url
          FROM discovery_events de
          JOIN discovery_event_categories dec ON dec.event_id=de.id
         WHERE de.status IN ('validated','published','needs_review')
           AND (
             (de.start_date IS NOT NULL AND date(de.start_date) >= date('now'))
             OR (de.start_date IS NULL AND de.start_year >= CAST(strftime('%Y','now') AS INTEGER))
           )
      `);
'''
if old not in text:
    raise SystemExit('Phase 29 schema patch target not found')
if text.count(old) != 1:
    raise SystemExit(f'Phase 29 schema patch target not unique ({text.count(old)})')
p.write_text(text.replace(old, new, 1))
print('Phase 29 coverage schema fallback applied')
