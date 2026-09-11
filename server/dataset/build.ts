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
import { parseHarvestEvidence, type HarvestEvidence, type ParseOptions, type ParseOutcome } from "./parseEvidence";
import { flattenStoredConferenceText } from "../storedConferenceSearch";
import { filledSections } from "./staticDataset";
import { parseCuratedDates } from "./sources/curated";
import {
  detailMatchKey, mapCuratedDetailRow, type CuratedDetailRow,
} from "./sources/curatedDetails";

/** Strength order used when two sources describe one conference. */
const SOURCE_RANK: Record<LaunchSourceType, number> = {
  official_site: 4,
  event_api: 3,
  third_party: 2,
  reference: 1,
  directory_listing: 0,
};

export interface BuildResult {
  dataset: LaunchDataset;
  index: LaunchSearchIndex;
  rejections: LaunchRejection[];
  duplicatesMerged: number;
  /** How many conferences a curated detail list filled the deep sections of. */
  detailsAttached: number;
  /** Detail rows that reached no conference. Reported rather than dropped, because a row that
   *  matches nothing usually means a title was rewritten, not that the conference is gone. */
  detailsUnmatched: Array<{ title: string; reason: string }>;
  /** Real conferences held back because no section of theirs has been described yet. */
  withoutDetail: number;
}

function identityKey(record: LaunchConferenceRecord): string {
  const identity = (record.acronym || record.series || record.title).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const place = (record.city || record.country || record.format).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${identity}|${record.year}|${place}`;
}

/** The words that say what kind of event something is rather than which event it is. Two sources
 *  describing one conference rarely choose the same ones -- "EAGE Annual 2027" and "88th EAGE
 *  Annual Conference & Exhibition 2027" are the same event -- so they are removed before names are
 *  compared. */
const NAME_NOISE = new Set([
  "annual", "conference", "conferences", "congress", "congresses", "exhibition", "exhibitions",
  "international", "national", "world", "global", "european", "asian", "summit", "symposium",
  "symposia", "meeting", "workshop", "expo", "exposition", "convention", "forum", "edition",
  "the", "and", "on", "of", "for", "in", "at", "conf",
]);

/** The distinctive words in a conference's name: what is left once the event-type words and the
 *  year are gone. */
function nameTokens(record: LaunchConferenceRecord): Set<string> {
  const source = `${record.acronym || ""} ${record.series || record.title}`;
  const tokens = source
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_NOISE.has(token) && !/^\d+(st|nd|rd|th)?$/.test(token));
  return new Set(tokens);
}

/** Same place, same year, same stated start date -- the bucket inside which two names are worth
 *  comparing at all. Keeping the date in the key is what stops one series' regional editions from
 *  collapsing into each other. */
function placeKey(record: LaunchConferenceRecord): string {
  const place = (record.city || record.country || record.format).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${place}|${record.year}|${record.startDate || "undated"}`;
}

function isSubsetOrEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) return false;
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  for (const token of smaller) if (!larger.has(token)) return false;
  return true;
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

/** One already-structured outcome from an API source, with the context needed to report a refusal
 *  as legibly as a text one. */
export interface StructuredOutcome {
  outcome: ParseOutcome;
  sourceUrl: string;
  statedText: string;
}

/**
 * Builds the dataset from harvested text evidence and, optionally, from API sources that already
 * produced structured records.
 *
 * Both streams meet here on purpose. An API record skips the text parser — its start date was
 * already a date — but it goes through the same date-window rules upstream and the same
 * deduplication, ranking and ordering below, so the catalogue has one set of rules and not two.
 */
/** A curated list of deep sections, waiting for the conferences it describes to exist. */
export interface DetailSupply {
  /** The file it came from, kept on every record it fills so the claim has a source. */
  source: string;
  rows: CuratedDetailRow[];
}

export interface BuildOptions extends ParseOptions {
  /**
   * Ship only conferences some section of which has been described.
   *
   * A conference nobody has supplied a programme, speakers, committee, sponsors, fees or a call for
   * papers for has nothing behind its tabs, and a card offering them makes a promise the detail
   * page cannot keep. Off by default: every one of these records is a real conference, and the only
   * thing wrong with them is that nobody has described them yet.
   */
  publishOnlyDescribed?: boolean;
}

export function buildLaunchDataset(
  evidence: HarvestEvidence[],
  options: BuildOptions,
  structured: StructuredOutcome[] = [],
  details: DetailSupply[] = []
): BuildResult {
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

  for (const item of structured) {
    if (item.outcome.ok === false) {
      rejections.push({ reason: item.outcome.reason, sourceUrl: item.sourceUrl, statedText: item.statedText });
      continue;
    }
    parsed.push({ ...item.outcome.record, corroboratingSourceUrls: [] });
  }

  // Strongest sources first, so a merge keeps the organiser's own wording and a directory only ever
  // fills gaps.
  parsed.sort((left, right) => SOURCE_RANK[right.sourceType] - SOURCE_RANK[left.sourceType]);

  const byIdentity = new Map<string, LaunchConferenceRecord>();
  const byPlace = new Map<string, string[]>();
  let duplicatesMerged = 0;

  for (const record of parsed) {
    const key = identityKey(record);
    let existingKey: string | null = byIdentity.has(key) ? key : null;

    // Not an exact identity match: look for strong agreement instead. Same city, same year, same
    // start date, and one name's distinctive words contained in the other's. Anything weaker is
    // left as two records -- a shared name is never on its own a reason to drop a conference.
    if (!existingKey) {
      const tokens = nameTokens(record);
      for (const candidateKey of byPlace.get(placeKey(record)) || []) {
        const candidate = byIdentity.get(candidateKey);
        if (candidate && isSubsetOrEqual(tokens, nameTokens(candidate))) {
          existingKey = candidateKey;
          break;
        }
      }
    }

    if (existingKey) {
      byIdentity.set(existingKey, mergeRecords(byIdentity.get(existingKey)!, record));
      duplicatesMerged += 1;
      continue;
    }
    byIdentity.set(key, record);
    const place = placeKey(record);
    byPlace.set(place, [...(byPlace.get(place) || []), key]);
  }

  const records = [...byIdentity.values()].sort((left, right) => {
    const leftDate = left.startDate || `${left.year}-12-31`;
    const rightDate = right.startDate || `${right.year}-12-31`;
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    return left.title.localeCompare(right.title);
  });

  const attachment = attachDetails(records, details);

  // Publishing only described conferences is a choice about what to ship, not about what the
  // evidence says, so it is an option rather than the builder's own rule: a fixture catalogue must
  // still come back as the thing it was built from.
  const published = options.publishOnlyDescribed
    ? records.filter((record) => filledSections(record).length > 0)
    : records;
  const withoutDetail = records.length - published.length;

  const generatedAt = new Date().toISOString();
  return {
    dataset: { generatedAt, horizonStart: options.horizonStart, years: options.years, records: published },
    index: { generatedAt, count: published.length, entries: published.map(buildSearchIndexEntry) },
    rejections,
    duplicatesMerged,
    detailsAttached: attachment.attached,
    detailsUnmatched: attachment.unmatched,
    withoutDetail,
  };
}

/**
 * Whether a detail row is describing the same edition as the record it matched by title.
 *
 * Conference titles repeat across years, so a title match alone could file the 2027 programme
 * under the 2026 event — the single mistake the discovery engine's `eventIdentity` guard exists to
 * prevent, arriving here by a different road. Where both sides state a month, both must agree;
 * where the record only knows a year, the year must agree.
 */
function agreesOnDate(record: LaunchConferenceRecord, datesText: string | null): boolean {
  if (!datesText) return true;
  const stated = parseCuratedDates(datesText.replace(/\([^)]*\)/g, " "));
  if (stated.startYear === null) return true;
  if (stated.startYear !== record.year) return false;
  if (!record.startDate || stated.startMonth === null) return true;
  return Number(record.startDate.slice(5, 7)) === stated.startMonth;
}

function attachDetails(
  records: LaunchConferenceRecord[],
  supplies: DetailSupply[]
): { attached: number; unmatched: Array<{ title: string; reason: string }> } {
  const unmatched: Array<{ title: string; reason: string }> = [];
  let attached = 0;
  if (supplies.length === 0) return { attached, unmatched };

  const byTitle = new Map<string, LaunchConferenceRecord>();
  for (const record of records) byTitle.set(detailMatchKey(record.title), record);

  for (const supply of supplies) {
    for (const row of supply.rows) {
      const record = byTitle.get(detailMatchKey(row.name));
      if (!record) {
        unmatched.push({ title: row.name, reason: "no_conference_with_this_title" });
        continue;
      }
      if (!agreesOnDate(record, row.dates)) {
        unmatched.push({ title: row.name, reason: "dates_disagree_with_the_record" });
        continue;
      }
      // A conference already filled by an earlier list keeps what it has: two lists disagreeing is
      // a fact to look at, not something to resolve by whichever file sorted last.
      if (record.details) {
        unmatched.push({ title: row.name, reason: "already_filled_by_another_list" });
        continue;
      }
      const detail = mapCuratedDetailRow(row, record.city, record.year);
      record.details = {
        source: supply.source,
        venueName: detail.venueName,
        venueAddress: detail.venueAddress,
        program: detail.program,
        callForPapers: detail.callForPapers,
        schedule: detail.schedule,
        keynotes: detail.keynotes,
        committee: detail.committee,
        fees: detail.fees,
        sponsors: detail.sponsors,
        safetyNote: detail.safetyNote,
      };
      attached += 1;
    }
  }
  return { attached, unmatched };
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
