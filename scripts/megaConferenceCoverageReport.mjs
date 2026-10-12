import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), 'data', 'phase57-mega-organizer-registry.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const targetPublished = Number(manifest.targetPublished || 1000);
const targetAccepted = Number(manifest.targetAccepted || 1500);
const years = Array.isArray(manifest.years) && manifest.years.length ? manifest.years.map(Number) : [2026, 2027, 2028];

const localPath = path.join(process.cwd(), 'data', 'app.db');
fs.mkdirSync(path.dirname(localPath), { recursive: true });
const db = process.env.TURSO_DATABASE_URL?.trim()
  ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
  : createClient({ url: 'file:' + localPath });

function number(row, key) { return Number(row?.[key] || 0); }
function string(row, key) { return String(row?.[key] || ''); }

try {
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences','discovery_domains')");
  const names = new Set((tables.rows || []).map((row) => String(row.name)));
  if (!names.has('discovery_events')) {
    console.log('[mega-coverage] discovery_events unavailable; skipping');
    process.exit(0);
  }

  const placeholders = years.map(() => '?').join(',');
  const acceptedRows = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM discovery_events
          WHERE start_year IN (${placeholders})
            AND relevance_classification='conference'
            AND status IN ('accepted','published')`,
    args: years,
  });
  const publishedRows = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM discovery_events
          WHERE start_year IN (${placeholders})
            AND relevance_classification='conference'
            AND (status='published' OR publish_readiness='publish_ready')`,
    args: years,
  });
  const countriesRows = await db.execute({
    sql: `SELECT COUNT(DISTINCT country) AS count FROM discovery_events
          WHERE start_year IN (${placeholders}) AND country IS NOT NULL AND TRIM(country)<>''`,
    args: years,
  });
  const organizersRows = await db.execute({
    sql: `SELECT COUNT(DISTINCT organizer) AS count FROM discovery_events
          WHERE start_year IN (${placeholders}) AND organizer IS NOT NULL AND TRIM(organizer)<>''`,
    args: years,
  });
  const officialRows = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM discovery_events
          WHERE start_year IN (${placeholders})
            AND official_url IS NOT NULL AND TRIM(official_url)<>''`,
    args: years,
  });
  const byYearRows = await db.execute({
    sql: `SELECT start_year AS year, COUNT(*) AS count FROM discovery_events
          WHERE start_year IN (${placeholders}) AND relevance_classification='conference'
          GROUP BY start_year ORDER BY start_year`,
    args: years,
  });
  const byCountryRows = await db.execute({
    sql: `SELECT country, COUNT(*) AS count FROM discovery_events
          WHERE start_year IN (${placeholders}) AND country IS NOT NULL AND TRIM(country)<>''
          GROUP BY country ORDER BY count DESC, country ASC LIMIT 20`,
    args: years,
  });
  const byOrganizerRows = await db.execute({
    sql: `SELECT organizer, COUNT(*) AS count FROM discovery_events
          WHERE start_year IN (${placeholders}) AND organizer IS NOT NULL AND TRIM(organizer)<>''
          GROUP BY organizer ORDER BY count DESC, organizer ASC LIMIT 20`,
    args: years,
  });

  let extracted = 0;
  if (names.has('extracted_conferences')) {
    const result = await db.execute('SELECT COUNT(*) AS count FROM extracted_conferences');
    extracted = number(result.rows?.[0], 'count');
  }
  let domains = 0;
  if (names.has('discovery_domains')) {
    const result = await db.execute('SELECT COUNT(*) AS count FROM discovery_domains WHERE enabled=1');
    domains = number(result.rows?.[0], 'count');
  }

  const accepted = number(acceptedRows.rows?.[0], 'count');
  const publishReady = number(publishedRows.rows?.[0], 'count');
  const countries = number(countriesRows.rows?.[0], 'count');
  const organizers = number(organizersRows.rows?.[0], 'count');
  const official = number(officialRows.rows?.[0], 'count');

  const report = {
    years,
    targetAccepted,
    targetPublished,
    accepted,
    publishReady,
    extracted,
    officialUrlRecords: official,
    countries,
    organizers,
    enabledSourceDomains: domains,
    acceptedProgressPct: Math.min(100, Number(((accepted / Math.max(1, targetAccepted)) * 100).toFixed(1))),
    publishedProgressPct: Math.min(100, Number(((publishReady / Math.max(1, targetPublished)) * 100).toFixed(1))),
    targetReached: publishReady >= targetPublished,
    byYear: (byYearRows.rows || []).map((row) => ({ year: number(row, 'year'), count: number(row, 'count') })),
    topCountries: (byCountryRows.rows || []).map((row) => ({ country: string(row, 'country'), count: number(row, 'count') })),
    topOrganizers: (byOrganizerRows.rows || []).map((row) => ({ organizer: string(row, 'organizer'), count: number(row, 'count') })),
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { db.close(); } catch {}
}
