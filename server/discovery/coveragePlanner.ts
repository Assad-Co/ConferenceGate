// Phase 29 — category × geography coverage planning.
//
// The catalogue already knows *how many* rich records it has. This module turns that inventory
// into an actionable search plan: which category, region and year is actually thin, and therefore
// where the discovery budget should be spent next. It reads stored data only; it never fetches,
// publishes, deletes or rewrites a conference.

import { dbAll } from "../db";
import { CATEGORY_RULES } from "./categories";
import { COUNTRIES } from "./countries";
import type { CoverageSearchTarget } from "./providers/searchProvider";

const REGIONS = ["Europe", "North America", "South America", "Middle East", "Africa", "Asia", "Oceania"] as const;
const PLACEHOLDER = /^(?:not found|not retrieved|not announced|unknown|n\/?a|tbd|tba|none|unavailable|coming soon)$/i;

const countryRegion = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country.region]));

function safeJson(value: unknown, fallback: any): any {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

function useful(value: unknown, depth = 0): boolean {
  if (depth > 4 || value == null) return false;
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > 2 && !PLACEHOLDER.test(text);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some((item) => useful(item, depth + 1));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
      if (/^(?:source_url|source_urls|source_page|provenance|confidence|verified_at|updated_at)$/i.test(key)) return false;
      return useful(child, depth + 1);
    });
  }
  return false;
}

function cfpHasData(cfp: any): boolean {
  if (!cfp || typeof cfp !== "object") return false;
  return [
    cfp.abstract_submission_deadline, cfp.paper_submission_deadline, cfp.submission_deadline,
    cfp.submission_url, cfp.submission_guidelines, cfp.abstract_requirements,
    cfp.paper_requirements, cfp.submission_format, cfp.review_process, cfp.notification_date,
  ].some(useful) || (Array.isArray(cfp.topics_tracks) && cfp.topics_tracks.some(useful));
}

function cfpOpen(cfp: any, today: number): boolean {
  if (!cfpHasData(cfp)) return false;
  const status = String(cfp?.status || "");
  if (/\b(?:open|extended|accepting|speaker applications open)\b/i.test(status) && !/\bclosed\b/i.test(status)) return true;
  const deadline = [cfp?.abstract_submission_deadline, cfp?.submission_deadline, cfp?.paper_submission_deadline]
    .find((value) => typeof value === "string" && value.trim());
  const parsed = deadline ? Date.parse(String(deadline)) : NaN;
  return Number.isFinite(parsed) && parsed >= today;
}

function filledTabs(row: Record<string, any>): number {
  const metadata = safeJson(row.extraction_metadata, {});
  const audited = Number(metadata.catalogue_filled_tabs);
  if (Number.isFinite(audited) && audited >= 1 && audited <= 9) return audited;

  const cfp = safeJson(row.call_for_papers, {});
  const sections = [
    cfpHasData(cfp),
    useful(safeJson(row.program_agenda, {})),
    useful(safeJson(row.keynote_speakers, [])),
    useful(safeJson(row.technical_committee, [])),
    useful(safeJson(row.sponsors_exhibitors, [])),
    useful(safeJson(row.venue_accommodation, {})),
    useful(safeJson(row.fees_pricing, {})),
    useful(safeJson(row.community, {})),
  ];
  return 1 + sections.filter(Boolean).length;
}

function hasVisualIdentity(row: Record<string, any>): boolean {
  const overview = safeJson(row.overview, {});
  return Boolean(
    (typeof overview.logo_url === "string" && overview.logo_url.trim()) ||
    (typeof overview.image_url === "string" && overview.image_url.trim()) ||
    (typeof row.image_url === "string" && row.image_url.trim())
  );
}

function regionOf(row: Record<string, any>): string | null {
  const stored = String(row.region || "").trim();
  if ((REGIONS as readonly string[]).includes(stored)) return stored;
  const country = String(row.country || "").trim().toLowerCase();
  return countryRegion.get(country) || null;
}

export interface CoverageCell {
  category: string;
  region: string;
  year: number;
  accepted: number;
  publishReady: number;
  published: number;
  richPublished: number;
  openCfpPublished: number;
  targetRich: number;
  gap: number;
  priority: number;
}

export interface CoveragePlan {
  generatedAt: string;
  years: number[];
  targetRichPerCell: number;
  targetRichPerCategory: number;
  categories: number;
  regions: number;
  cells: number;
  coveredCells: number;
  richPublished: number;
  accepted: number;
  publishReady: number;
  topGaps: CoverageCell[];
  categoryTotals: Array<{ category: string; richPublished: number; accepted: number; gapToTarget: number }>;
  regionTotals: Array<{ region: string; richPublished: number; accepted: number }>;
}

export async function buildCoveragePlan(options: {
  years?: number[];
  targetRichPerCell?: number;
  targetRichPerCategory?: number;
  top?: number;
} = {}): Promise<CoveragePlan> {
  const now = new Date();
  const defaultYears = [now.getUTCFullYear(), now.getUTCFullYear() + 1];
  const years = [...new Set((options.years?.length ? options.years : defaultYears).filter(Number.isInteger))].sort();
  const yearSet = new Set(years);
  const targetRich = Math.max(1, Math.floor(options.targetRichPerCell ?? 2));
  const targetCategory = Math.max(targetRich, Math.floor(options.targetRichPerCategory ?? 25));
  const top = Math.max(1, Math.min(500, Math.floor(options.top ?? 60)));

  // The discovery schema is deliberately additive and can exist before the app's own
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

  const taxonomy = [...new Set(CATEGORY_RULES.map((rule) => rule.category))];
  const categorySet = new Set(taxonomy);
  for (const row of rows) if (row.category) categorySet.add(String(row.category));
  const categories = [...categorySet].sort();

  type Counts = { accepted: Set<string>; publishReady: Set<string>; published: Set<string>; rich: Set<string>; openCfp: Set<string> };
  const createCounts = (): Counts => ({ accepted: new Set(), publishReady: new Set(), published: new Set(), rich: new Set(), openCfp: new Set() });
  const cells = new Map<string, Counts>();
  const categoryCounts = new Map<string, Counts>();
  const regionCounts = new Map<string, Counts>();
  const today = Date.parse(now.toISOString().slice(0, 10));

  for (const raw of rows) {
    const row = { ...raw };
    const year = Number(row.start_year || String(row.start_date || "").slice(0, 4));
    if (!yearSet.has(year)) continue;
    const category = String(row.category || "").trim();
    const region = regionOf(row);
    if (!category || !region) continue;
    const id = String(row.id);
    const published = Boolean(row.published_source_url);
    const rich = published && filledTabs(row) >= 6 && hasVisualIdentity(row);
    const openCfp = published && cfpOpen(safeJson(row.call_for_papers, {}), today);
    const ready = row.publish_readiness === "publish_ready";

    const add = (bucket: Counts) => {
      bucket.accepted.add(id);
      if (ready) bucket.publishReady.add(id);
      if (published) bucket.published.add(id);
      if (rich) bucket.rich.add(id);
      if (openCfp) bucket.openCfp.add(id);
    };
    const key = `${category}|${region}|${year}`;
    if (!cells.has(key)) cells.set(key, createCounts());
    if (!categoryCounts.has(category)) categoryCounts.set(category, createCounts());
    if (!regionCounts.has(region)) regionCounts.set(region, createCounts());
    add(cells.get(key)!);
    add(categoryCounts.get(category)!);
    add(regionCounts.get(region)!);
  }

  const globalCategoryRich = new Map(categories.map((category) => [category, categoryCounts.get(category)?.rich.size || 0]));
  const coverageCells: CoverageCell[] = [];
  for (const category of categories) {
    for (const region of REGIONS) {
      for (const year of years) {
        const bucket = cells.get(`${category}|${region}|${year}`) || createCounts();
        const richPublished = bucket.rich.size;
        const globalShortfall = Math.max(0, targetCategory - (globalCategoryRich.get(category) || 0));
        const gap = Math.max(0, targetRich - richPublished);
        const priority = gap * 100 + globalShortfall * 3 + (richPublished === 0 ? 35 : 0) +
          (bucket.accepted.size === 0 ? 25 : 0) + Math.min(20, bucket.publishReady.size * 4) +
          (year === Math.max(...years) ? 5 : 0);
        coverageCells.push({
          category, region, year,
          accepted: bucket.accepted.size,
          publishReady: bucket.publishReady.size,
          published: bucket.published.size,
          richPublished,
          openCfpPublished: bucket.openCfp.size,
          targetRich,
          gap,
          priority,
        });
      }
    }
  }

  const categoryTotals = categories.map((category) => {
    const bucket = categoryCounts.get(category) || createCounts();
    return {
      category,
      richPublished: bucket.rich.size,
      accepted: bucket.accepted.size,
      gapToTarget: Math.max(0, targetCategory - bucket.rich.size),
    };
  }).sort((a, b) => b.gapToTarget - a.gapToTarget || a.category.localeCompare(b.category));

  const regionTotals = [...REGIONS].map((region) => {
    const bucket = regionCounts.get(region) || createCounts();
    return { region, richPublished: bucket.rich.size, accepted: bucket.accepted.size };
  }).sort((a, b) => a.richPublished - b.richPublished || a.region.localeCompare(b.region));

  const richPublished = new Set<string>();
  const accepted = new Set<string>();
  const publishReady = new Set<string>();
  for (const bucket of cells.values()) {
    for (const id of bucket.rich) richPublished.add(id);
    for (const id of bucket.accepted) accepted.add(id);
    for (const id of bucket.publishReady) publishReady.add(id);
  }
  const coveredCells = coverageCells.filter((cell) => cell.gap === 0).length;
  const topGaps = coverageCells.filter((cell) => cell.gap > 0)
    .sort((a, b) => b.priority - a.priority || a.richPublished - b.richPublished || a.category.localeCompare(b.category))
    .slice(0, top);

  return {
    generatedAt: now.toISOString(), years, targetRichPerCell: targetRich, targetRichPerCategory: targetCategory,
    categories: categories.length, regions: REGIONS.length, cells: coverageCells.length, coveredCells,
    richPublished: richPublished.size, accepted: accepted.size, publishReady: publishReady.size,
    topGaps, categoryTotals, regionTotals,
  };
}

export function coverageTargets(plan: CoveragePlan, limit = 12): CoverageSearchTarget[] {
  const cap = Math.max(1, Math.min(100, Math.floor(limit)));
  const byCategory = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const chosen: CoverageSearchTarget[] = [];
  for (const gap of plan.topGaps) {
    if (chosen.length >= cap) break;
    if ((byCategory.get(gap.category) || 0) >= 2) continue;
    if ((byRegion.get(gap.region) || 0) >= Math.max(2, Math.ceil(cap / 3))) continue;
    chosen.push({ subject: gap.category, region: gap.region, year: gap.year });
    byCategory.set(gap.category, (byCategory.get(gap.category) || 0) + 1);
    byRegion.set(gap.region, (byRegion.get(gap.region) || 0) + 1);
  }
  return chosen;
}
