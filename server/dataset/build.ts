// Builds the launch dataset from harvested evidence.
//
// Deduplication follows the discovery engine's rule rather than inventing a second one: merge on
// strong agreement, keep both records when the match is weak. Two rows are the same conference only
// when they agree on identity AND year AND place; a shared name alone never collapses two events,
// because a series legitimately runs regional editions in the same year.

import type {
  LaunchConferenceRecord,
  LaunchDataset,
  LaunchRejection,
  LaunchSearchIndex,
  LaunchSearchIndexEntry,
  LaunchSourceType,
} from "./types";
import { parseHarvestEvidence, type HarvestEvidence, type ParseOptions } from "./parseEvidence";
import { flattenStoredConferenceText } from "../storedConferenceSearch";

/** Strength order used when two sources describe one conference. */
const SOURCE_RANK: Record<LaunchSourceType, number> = {
  official_site: 3,
  third_party: 2,
  reference: 1,
  directory_listing: 0,
};

export interface BuildResult {
  dataset: LaunchDataset;
  index: LaunchSearchIndex;
  rejections: LaunchRejection[];
  duplicatesMerged: number;
}

function identityKey(record: LaunchConferenceRecord): string {
  const identity = (record.acronym || record.series || record.title).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const place = (record.city || record.country || record.format).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${identity}|${record.year}|${place}`;
}

/** A second key that catches the same event described with and without its venue city, e.g. one
 *  source saying "Houston" and another naming only the country. Requires the dates to match, so it
 *  cannot merge two different editions of one series. */
function dateKey(record: LaunchConferenceRecord): string | null {
  if (!record.startDate) return null;
  const identity = (record.acronym || record.series || record.title).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${identity}|${record.startDate}`;
}

function mergeRecords(strong: LaunchConferenceRecord, weak: LaunchConferenceRecord): LaunchConferenceRecord {
  const merged: LaunchConferenceRecord = { ...strong };
  // Fill only what the stronger source left unsaid. A weaker source never overwrites a stated value.
  const fillable = [
    "acronym", "series", "edition", "startDate", "endDate", "datesText", "city", "region",
    "country", "countryCode", "worldRegion", "venue", "organization", "category",
  ] as const;
  for (const field of fillable) {
    if (merged[field] === null || merged[field] === undefined) {
      (merged as unknown as Record<string, unknown>)[field] = weak[field];
    }
  }
  if (merged.datePrecision === "month" && weak.datePrecision === "day" && weak.startDate) {
    merged.startDate = weak.startDate;
    merged.endDate = weak.endDate;
    merged.datePrecision = "day";
  }
  merged.categories = [...new Set([...merged.categories, ...weak.categories])];
  merged.topics = [...new Set([...merged.topics, ...weak.topics])].slice(0, 20);
  merged.keywords = [...new Set([...merged.keywords, ...weak.keywords])];
  merged.corroboratingSourceUrls = [
    ...new Set([...merged.corroboratingSourceUrls, ...weak.corroboratingSourceUrls, weak.sourceUrl]),
  ].filter((url) => url !== merged.sourceUrl);
  if (!merged.officialUrl && weak.officialUrl) merged.officialUrl = weak.officialUrl;
  for (const [field, entry] of Object.entries(weak.provenance)) {
    if (!merged.provenance[field]) merged.provenance[field] = entry;
  }
  return merged;
}

export function buildSearchIndexEntry(record: LaunchConferenceRecord): LaunchSearchIndexEntry {
  const haystack = flattenStoredConferenceText([
    record.title,
    record.acronym,
    record.series,
    record.edition,
    record.organization,
    record.category,
    record.categories,
    record.topics,
    record.keywords,
    record.city,
    record.region,
    record.country,
    record.worldRegion,
    record.venue,
    String(record.year),
    record.startDate,
    record.endDate,
    record.format,
    record.description,
    record.sourceHost,
  ]);
  return {
    id: record.id,
    title: record.title,
    acronym: record.acronym,
    series: record.series,
    organization: record.organization,
    category: record.category,
    topics: record.topics,
    keywords: record.keywords,
    city: record.city,
    country: record.country,
    worldRegion: record.worldRegion,
    year: record.year,
    startDate: record.startDate,
    endDate: record.endDate,
    format: record.format,
    sourceUrl: record.sourceUrl,
    sourceType: record.sourceType,
    description: record.description,
    haystack,
  };
}

export function buildLaunchDataset(evidence: HarvestEvidence[], options: ParseOptions): BuildResult {
  const rejections: LaunchRejection[] = [];
  const parsed: LaunchConferenceRecord[] = [];

  for (const item of evidence) {
    const outcome = parseHarvestEvidence(item, options);
    if (outcome.ok === false) {
      rejections.push({ reason: outcome.reason, sourceUrl: item.url, statedText: item.stated });
      continue;
    }
    parsed.push({ ...outcome.record, corroboratingSourceUrls: [] });
  }

  // Strongest sources first, so a merge keeps the organiser's own wording and a directory only ever
  // fills gaps.
  parsed.sort((left, right) => SOURCE_RANK[right.sourceType] - SOURCE_RANK[left.sourceType]);

  const byIdentity = new Map<string, LaunchConferenceRecord>();
  const byDate = new Map<string, string>();
  let duplicatesMerged = 0;

  for (const record of parsed) {
    const key = identityKey(record);
    const dKey = dateKey(record);
    const existingKey = byIdentity.has(key) ? key : dKey && byDate.has(dKey) ? byDate.get(dKey)! : null;
    if (existingKey && byIdentity.has(existingKey)) {
      byIdentity.set(existingKey, mergeRecords(byIdentity.get(existingKey)!, record));
      duplicatesMerged += 1;
      continue;
    }
    byIdentity.set(key, record);
    if (dKey && !byDate.has(dKey)) byDate.set(dKey, key);
  }

  const records = [...byIdentity.values()].sort((left, right) => {
    const leftDate = left.startDate || `${left.year}-12-31`;
    const rightDate = right.startDate || `${right.year}-12-31`;
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    return left.title.localeCompare(right.title);
  });

  const generatedAt = new Date().toISOString();
  return {
    dataset: { generatedAt, horizonStart: options.horizonStart, years: options.years, records },
    index: { generatedAt, count: records.length, entries: records.map(buildSearchIndexEntry) },
    rejections,
    duplicatesMerged,
  };
}

const CSV_COLUMNS = [
  "id", "title", "acronym", "series", "edition", "year", "startDate", "endDate", "datePrecision",
  "city", "region", "country", "countryCode", "worldRegion", "venue", "format", "organization",
  "category", "topics", "keywords", "sourceUrl", "sourceType", "officialUrl",
  "corroboratingSourceUrls", "description",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(records: LaunchConferenceRecord[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    rows.push(CSV_COLUMNS.map((column) => csvCell((record as unknown as Record<string, unknown>)[column])).join(","));
  }
  return rows.join("\n") + "\n";
}
