import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CSV = path.join(process.cwd(), 'data', 'conferencegate-worldwide-2026-2028.csv');
const OVERRIDES = path.join(process.cwd(), 'data', 'sources', 'launch-record-overrides.json');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v || '').trim()));
}
function normalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b20\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function stableId(value) {
  return 'launch_' + createHash('sha1').update(String(value || '')).digest('hex').slice(0, 24);
}
function loadOverrides() {
  try {
    const doc = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
    return new Map((Array.isArray(doc?.records) ? doc.records : []).map((r) => [r.id, r]));
  } catch { return new Map(); }
}

async function main() {
  if (!fs.existsSync(CSV)) {
    console.log('[launch-seed] CSV missing; skipping');
    return;
  }

  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: 'file:' + localPath });

  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_events'");
    if (!(tables.rows || []).length) {
      console.log('[launch-seed] discovery schema unavailable; skipping');
      return;
    }

    const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
    if (rows.length < 2) return;
    const headers = rows[0].map((v) => String(v || '').trim());
    const idx = new Map(headers.map((name, i) => [name, i]));
    const get = (row, name) => {
      const i = idx.get(name);
      if (i === undefined) return null;
      const v = String(row[i] || '').trim();
      return v || null;
    };
    const overrides = loadOverrides();
    const today = new Date().toISOString().slice(0, 10);
    let seeded = 0, existingCount = 0, skipped = 0;

    for (const row of rows.slice(1)) {
      const sourceId = get(row, 'id');
      const title = get(row, 'title');
      const year = Number(get(row, 'year'));
      const start = get(row, 'startDate');
      const end = get(row, 'endDate');
      const override = sourceId ? overrides.get(sourceId) : null;
      const officialUrl = String(override?.officialUrl || get(row, 'officialUrl') || '').trim();
      const sourceUrl = String(override?.sourceUrl || get(row, 'sourceUrl') || officialUrl).trim();
      if (!sourceId || !title || !Number.isFinite(year) || !officialUrl || !sourceUrl) { skipped += 1; continue; }
      if (end && end < today) { skipped += 1; continue; }

      const normalized = normalizeTitle(title);
      const found = await db.execute({
        sql: 'SELECT id FROM discovery_events WHERE normalized_title=? AND COALESCE(start_date,\'\')=COALESCE(?,\'\') LIMIT 1',
        args: [normalized, start],
      });
      const existingId = found.rows?.[0]?.id ? String(found.rows[0].id) : null;
      const id = existingId || stableId(sourceId);
      if (existingId) existingCount += 1;

      const city = get(row, 'city');
      const region = get(row, 'region');
      const country = get(row, 'country');
      const venue = override?.venue || get(row, 'venue');
      const organizer = override?.organization || get(row, 'organization');
      const format = get(row, 'format') || 'unknown';
      const category = get(row, 'category');
      const topics = String(get(row, 'topics') || '').split(';').map((v) => v.trim()).filter(Boolean);
      const description = override?.description || get(row, 'description');
      const sourceDomain = hostOf(sourceUrl);
      const now = new Date().toISOString();
      const locationText = [venue, city, region, country].filter(Boolean).join(', ');

      await db.execute({
        sql: `INSERT INTO discovery_events (
          id,title,normalized_title,description,start_date,end_date,start_year,start_month,date_precision,dates_text,
          venue,city,region,country,country_code,raw_location,format,event_type,organizer,official_url,canonical_url,
          topics,primary_category,status,confidence_score,relevance_classification,relevance_reason,quality_flags,
          extraction_method,source_url,source_domain,last_seen,last_checked,last_verified,published_at,
          publish_readiness,readiness_reasons,official_source_verified_at,title_verified_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'conference',?,?,?,?,?,'published',0.95,'conference',
          'launch_catalogue_seed','[]','launch_catalogue_seed',?,?,?,?,?,?,?,'publish_ready','[]',?,?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title,
          description=COALESCE(discovery_events.description, excluded.description),
          start_date=COALESCE(discovery_events.start_date, excluded.start_date),
          end_date=COALESCE(discovery_events.end_date, excluded.end_date),
          venue=COALESCE(discovery_events.venue, excluded.venue),
          city=COALESCE(discovery_events.city, excluded.city),
          region=COALESCE(discovery_events.region, excluded.region),
          country=COALESCE(discovery_events.country, excluded.country),
          organizer=COALESCE(discovery_events.organizer, excluded.organizer),
          official_url=COALESCE(discovery_events.official_url, excluded.official_url),
          canonical_url=COALESCE(discovery_events.canonical_url, excluded.canonical_url),
          topics=CASE WHEN discovery_events.topics='[]' THEN excluded.topics ELSE discovery_events.topics END,
          primary_category=COALESCE(discovery_events.primary_category, excluded.primary_category),
          status='published',
          publish_readiness='publish_ready',
          last_seen=excluded.last_seen,
          last_checked=COALESCE(discovery_events.last_checked, excluded.last_checked)`,
        args: [
          id,title,normalized,description,start,end,year,start ? Number(start.slice(5,7)) : null,get(row,'datePrecision'),start && end ? (start === end ? start : start + ' – ' + end) : start,
          venue,city,region,country,get(row,'countryCode'),locationText,format,organizer,officialUrl,officialUrl,
          JSON.stringify(topics),category,sourceUrl,sourceDomain,now,now,now,now,now,now
        ]
      });
      seeded += 1;
    }

    console.log('[launch-seed] upcoming catalogue ready for enrichment seeded=' + seeded + ' matched_existing=' + existingCount + ' skipped=' + skipped);
  } catch (error) {
    console.warn('[launch-seed] failed:', error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
