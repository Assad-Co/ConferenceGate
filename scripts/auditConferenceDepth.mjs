import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = /^(?:not found|not retrieved|not announced|unknown|n\/?a|tbd|tba|none|unavailable|coming soon)$/i;
const SECTION_NAMES = ['cfp', 'agenda', 'speakers', 'committee', 'sponsors', 'venue', 'fees', 'community'];

function safeJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function usefulText(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 2 && !PLACEHOLDER.test(text);
}

function hasUsefulValue(value, depth = 0) {
  if (depth > 4 || value == null) return false;
  if (typeof value === 'string') return usefulText(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some((item) => hasUsefulValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => {
      if (/^(?:source_url|source_urls|source_page|provenance|confidence|verified_at|updated_at)$/i.test(key)) return false;
      return hasUsefulValue(child, depth + 1);
    });
  }
  return false;
}

function cfpHasData(cfp) {
  if (!cfp || typeof cfp !== 'object') return false;
  return [
    cfp.abstract_submission_deadline,
    cfp.paper_submission_deadline,
    cfp.submission_deadline,
    cfp.submission_url,
    cfp.submission_guidelines,
    cfp.abstract_requirements,
    cfp.paper_requirements,
    cfp.submission_format,
    cfp.review_process,
    cfp.notification_date,
  ].some(usefulText) || (Array.isArray(cfp.topics_tracks) && cfp.topics_tracks.length > 0);
}

function openCfp(cfp, today) {
  if (!cfpHasData(cfp)) return false;
  const status = String(cfp?.status || '').trim();
  if (/\b(?:open|extended|accepting|speaker applications open)\b/i.test(status) && !/\bclosed\b/i.test(status)) return true;
  const deadline = [cfp?.abstract_submission_deadline, cfp?.submission_deadline, cfp?.paper_submission_deadline]
    .find((value) => usefulText(value));
  if (!deadline) return false;
  const parsed = Date.parse(String(deadline));
  return Number.isFinite(parsed) && parsed >= Date.parse(today);
}

function sectionFlags(row) {
  const cfp = safeJson(row.call_for_papers, {});
  const agenda = safeJson(row.program_agenda, {});
  const speakers = safeJson(row.keynote_speakers, []);
  const committee = safeJson(row.technical_committee, []);
  const sponsors = safeJson(row.sponsors_exhibitors, []);
  const venue = safeJson(row.venue_accommodation, {});
  const fees = safeJson(row.fees_pricing, {});
  const community = safeJson(row.community, {});
  return {
    cfp: cfpHasData(cfp),
    agenda: hasUsefulValue(agenda),
    speakers: Array.isArray(speakers) ? speakers.some(hasUsefulValue) : hasUsefulValue(speakers),
    committee: Array.isArray(committee) ? committee.some(hasUsefulValue) : hasUsefulValue(committee),
    sponsors: Array.isArray(sponsors) ? sponsors.some(hasUsefulValue) : hasUsefulValue(sponsors),
    venue: hasUsefulValue(venue),
    fees: hasUsefulValue(fees),
    community: hasUsefulValue(community),
    cfpPayload: cfp,
  };
}

function categoriesFrom(overview) {
  const values = [
    ...(Array.isArray(overview?.categories) ? overview.categories : []),
    ...(Array.isArray(overview?.topics) ? overview.topics : []),
    overview?.category,
  ];
  return [...new Set(values.filter(usefulText).map((value) => String(value).trim()))];
}

async function main() {
  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({
        url: process.env.TURSO_DATABASE_URL.trim(),
        authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
      })
    : createClient({ url: `file:${localPath}` });

  try {
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('extracted_conferences','discovery_events')"
    );
    if ((tables.rows || []).length < 2) {
      console.log('[conference-depth-audit] schema unavailable; skipping');
      return;
    }

    const rows = await db.execute(`
      SELECT ec.source_url, ec.overview, ec.call_for_papers, ec.program_agenda,
             ec.keynote_speakers, ec.technical_committee, ec.sponsors_exhibitors,
             ec.venue_accommodation, ec.fees_pricing, ec.community, ec.extraction_metadata,
             de.start_date AS discovery_start_date, de.start_year AS discovery_start_year,
             de.country AS discovery_country, de.status AS discovery_status,
             de.publish_readiness AS discovery_publish_readiness
        FROM extracted_conferences ec
        LEFT JOIN discovery_events de
          ON de.id = json_extract(ec.extraction_metadata, '$.discovery_event_id')
       WHERE ec.overview IS NOT NULL AND ec.overview <> '{}'
    `);

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const currentYear = now.getUTCFullYear();
    const primaryEndYear = currentYear + 1;
    const countries = new Set();
    const categories = new Set();
    const summary = {
      audited: 0,
      updatedMetadata: 0,
      primaryWindow: 0,
      laterFuture: 0,
      undated: 0,
      knownPast: 0,
      rich6Plus: 0,
      standard4to5: 0,
      basic1to3: 0,
      openCfp: 0,
      missing: Object.fromEntries(SECTION_NAMES.map((name) => [name, 0])),
    };
    const thin = [];

    for (const raw of rows.rows || []) {
      const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value]));
      const overview = safeJson(row.overview, {});
      const metadata = safeJson(row.extraction_metadata, {});
      const flags = sectionFlags(row);
      const present = SECTION_NAMES.filter((name) => Boolean(flags[name]));
      const missing = SECTION_NAMES.filter((name) => !flags[name]);
      const filledTabs = 1 + present.length;
      const depthScore = Math.round((filledTabs / 9) * 100);
      const depthGrade = filledTabs >= 6 ? 'rich' : filledTabs >= 4 ? 'standard' : 'basic';

      const startDate = String(overview.start_date || row.discovery_start_date || '').trim();
      const parsedStart = Date.parse(startDate);
      const startYear = Number(overview.start_year || row.discovery_start_year || (startDate ? startDate.slice(0, 4) : 0));
      let visibility = 'undated';
      if (Number.isFinite(parsedStart)) {
        if (parsedStart < Date.parse(today)) visibility = 'past';
        else if (startYear >= currentYear && startYear <= primaryEndYear) visibility = 'primary';
        else visibility = 'future';
      }

      const country = String(overview.country || row.discovery_country || '').trim();
      if (country) countries.add(country);
      for (const category of categoriesFrom(overview)) categories.add(category);

      summary.audited += 1;
      if (visibility === 'primary') summary.primaryWindow += 1;
      else if (visibility === 'future') summary.laterFuture += 1;
      else if (visibility === 'past') summary.knownPast += 1;
      else summary.undated += 1;
      if (depthGrade === 'rich') summary.rich6Plus += 1;
      else if (depthGrade === 'standard') summary.standard4to5 += 1;
      else summary.basic1to3 += 1;
      if (openCfp(flags.cfpPayload, today)) summary.openCfp += 1;
      for (const name of missing) summary.missing[name] += 1;

      if (filledTabs < 4) {
        thin.push({
          title: String(overview.conference_name || overview.title || row.source_url || '').slice(0, 140),
          filledTabs,
          visibility,
          missing,
        });
      }

      const nextMetadata = {
        ...metadata,
        catalogue_depth_score: depthScore,
        catalogue_depth_grade: depthGrade,
        catalogue_filled_tabs: filledTabs,
        catalogue_missing_tabs: missing,
        catalogue_visibility: visibility,
        catalogue_primary_years: [currentYear, primaryEndYear],
        catalogue_audited_on: today,
      };
      const before = JSON.stringify(metadata);
      const after = JSON.stringify(nextMetadata);
      if (before !== after) {
        await db.execute({
          sql: 'UPDATE extracted_conferences SET extraction_metadata=? WHERE source_url=?',
          args: [after, row.source_url],
        });
        summary.updatedMetadata += 1;
      }
    }

    console.log('[conference-depth-audit]', JSON.stringify({
      ...summary,
      countries: countries.size,
      categories: categories.size,
      primaryYears: [currentYear, primaryEndYear],
      thinSample: thin.slice(0, 20),
    }));
  } finally {
    db.close();
  }
}

await main();
