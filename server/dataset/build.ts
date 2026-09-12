// Builds the launch dataset from harvested evidence.
//
// Deduplication follows the discovery engine's rule rather than inventing a second one: merge on
// strong agreement, keep both records when the match is weak. Two rows are the same conference only
// when they agree on identity AND year AND place; a shared name alone never collapses two events,
// because a series legitimately runs regional editions in the same year.

import type {
  LaunchConferenceDetails,
  LaunchConferenceRecord,
  LaunchDataset,
  LaunchRejection,
  LaunchSearchIndex,
  LaunchSearchIndexEntry,
  LaunchSourceType,
} from "./types";
import { parseHarvestEvidence, type HarvestEvidence, type ParseOptions, type ParseOutcome } from "./parseEvidence";
import { flattenStoredConferenceText } from "../storedConferenceSearch";
import { hasSomethingToShow } from "./staticDataset";
import { applyResolvedUrls, type ResolutionOutcome, type ResolvedUrl } from "./sources/resolvedUrls";
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
  /** Real conferences held back because their page could say nothing — no date, no place, or
   *  nothing at all to read. Reported rather than silently dropped: they are real either way. */
  heldBack: number;
  /** What the resolved-website file corrected, refused and could not match. */
  resolvedUrls: ResolutionOutcome;
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

/**
 * Two rows one compiler listed separately, on one page, in one file.
 *
 * The name heuristic above exists for the opposite situation: two *sources* describing one
 * conference, where neither wrote the name the same way. Inside a single listing it asserts
 * something the source denies, and the co-located workshop is where that goes wrong. NeurIPS 2026
 * runs seventy-odd workshops on one date across one set of cities, and every one of their titles
 * ends "— NeurIPS 2026" — so they land in one place bucket and each short name is a subset of some
 * longer sibling's. "ML for Systems" was absorbed into "AgenticOS: Co-designing Systems and ML
 * Foundations of an OS Layer for Agentic AI", and "Continual World Models" into "Continual
 * Learning in the Era of Foundation Models and Embodied Agents" — four distinct workshops gone,
 * each merged into a different conference that never mentioned it.
 *
 * A compiler that wrote seventy-four rows under one URL is stating that there are seventy-four
 * events. Collapsing them is the catalogue contradicting its own source, which is the one thing
 * this file is not allowed to do — "a shared name is never on its own a reason to drop a
 * conference". Exact identity matches are unaffected: two rows that really are one conference
 * still carry the same acronym, series or title and merge on the key above.
 */
function fromOneListing(left: LaunchConferenceRecord, right: LaunchConferenceRecord): boolean {
  const listing = left.evidence?.query;
  return Boolean(listing) && listing === right.evidence?.query && left.sourceUrl === right.sourceUrl;
}

/** Two rows one compiler wrote as two conferences. A repeated title in one listing is still a
 *  duplicate row and still merges; it is differing titles that the source is asserting apart. */
function separatelyListed(left: LaunchConferenceRecord, right: LaunchConferenceRecord): boolean {
  return fromOneListing(left, right) && left.title.trim() !== right.title.trim();
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
  // A conference somebody described stays described, whichever of the two records won on source
  // strength. Eight of eleven verified conferences vanished from a build because their curated
  // record merged into a harvest record of the same event, and the merged record inherited the
  // harvest tag — so the publish filter dropped exactly the conferences that had been written up.
  if (weak.supply === "curated_list") merged.supply = "curated_list";
  // And it keeps the name that person gave it. A search result's wording of a title won this merge
  // on source strength alone, so one conference appeared on the site under a name its own supplied
  // row never used — which makes the catalogue impossible to check against the file it came from.
  if (weak.supply === "curated_list" && strong.supply !== "curated_list") {
    merged.title = weak.title;
    merged.acronym = weak.acronym ?? merged.acronym;
    merged.series = weak.series ?? merged.series;
    merged.edition = weak.edition ?? merged.edition;
  }
  // The detail a person wrote is the reason that record exists. It is never dropped for a stronger
  // source that has none, and never overwrites one the stronger source already carries.
  if (!merged.details && weak.details) merged.details = weak.details;
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
   * Ship only conferences whose page can say something.
   *
   * Not "conferences with a filled tab" — that hid 386 real events over one unannounced speaker
   * list. `hasSomethingToShow` is the rule: a date, a place, and something to read or somewhere to
   * go. Off by default, because a fixture catalogue must come back as the thing it was built from.
   */
  publishOnlyUsable?: boolean;
  /**
   * Ship only conferences a person supplied, not ones a search found.
   *
   * Of the 330 records the web harvest produced, not one carries a single deep tab — a search
   * result states a name, a date and a place and stops there, and no amount of rebuilding turns
   * that into a programme. A curated list is written by somebody who knows the field, and 153 of
   * 181 such records have content behind their tabs. Also off by default.
   */
  publishOnlyCuratedLists?: boolean;
}

export function buildLaunchDataset(
  evidence: HarvestEvidence[],
  options: BuildOptions,
  structured: StructuredOutcome[] = [],
  details: DetailSupply[] = [],
  resolutions: ResolvedUrl[] = []
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
    const clash = byIdentity.get(key);
    // An identity match is only an identity match between *sources*. Within one listing it can be
    // an artifact of how the name parsed: "NeurIPS 2026 Workshop on SaTQuML" and "NeurIPS 2026
    // Workshop on Tackling Climate Change" both reduce to the acronym NeurIPS, which said they
    // were one conference and lost two real workshops. Same title is still a duplicate row.
    let existingKey: string | null =
      clash && !separatelyListed(record, clash) ? key : null;

    // Not an exact identity match: look for strong agreement instead. Same city, same year, same
    // start date, and one name's distinctive words contained in the other's. Anything weaker is
    // left as two records -- a shared name is never on its own a reason to drop a conference.
    if (!existingKey) {
      const tokens = nameTokens(record);
      for (const candidateKey of byPlace.get(placeKey(record)) || []) {
        const candidate = byIdentity.get(candidateKey);
        if (candidate && !separatelyListed(record, candidate)
          && isSubsetOrEqual(tokens, nameTokens(candidate))) {
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
    // A sibling kept apart from a key-mate needs a key of its own, or storing it would evict the
    // conference already there — the same loss by another route.
    const storeKey = clash ? `${key}|${record.title.toLowerCase().replace(/[^a-z0-9]+/g, "")}` : key;
    byIdentity.set(storeKey, record);
    const place = placeKey(record);
    byPlace.set(place, [...(byPlace.get(place) || []), storeKey]);
  }

  const records = [...byIdentity.values()].sort((left, right) => {
    const leftDate = left.startDate || `${left.year}-12-31`;
    const rightDate = right.startDate || `${right.year}-12-31`;
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    return left.title.localeCompare(right.title);
  });

  const attachment = attachDetails(records, details);
  // Applied after deduplication, so a conference that survived a merge is the one corrected, and
  // before publication, so a record that gains its own site gains the logo that comes with it.
  const resolvedUrls = applyResolvedUrls(records, resolutions);

  // Publishing is a choice about what to ship, not about what the evidence says, so it is an
  // option rather than the builder's own rule: a fixture catalogue must still come back as the
  // thing it was built from.
  // The horizon, not the wall clock: a record held back for a deadline that has passed should be
  // held back on a rebuild of this dataset too, rather than depending on the day it is rebuilt.
  const usable = options.publishOnlyUsable
    ? records.filter((record) => hasSomethingToShow(record, options.horizonStart))
    : records;
  const published = options.publishOnlyCuratedLists
    ? usable.filter((record) => record.supply === "curated_list")
    : usable;
  const heldBack = records.length - published.length;

  const generatedAt = new Date().toISOString();
  return {
    dataset: { generatedAt, horizonStart: options.horizonStart, years: options.years, records: published },
    index: { generatedAt, count: published.length, entries: published.map(buildSearchIndexEntry) },
    rejections,
    duplicatesMerged,
    detailsAttached: attachment.attached,
    detailsUnmatched: attachment.unmatched,
    heldBack,
    resolvedUrls,
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
      const detail = mapCuratedDetailRow(row, record.city, record.year, record.country);
      const incoming: LaunchConferenceDetails = {
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
      if (!record.details) {
        record.details = incoming;
        attached += 1;
        continue;
      }
      const filled = fillUnreadSections(record.details, incoming, supply.source);
      if (filled.length === 0) {
        unmatched.push({ title: row.name, reason: "already_filled_by_another_list" });
        continue;
      }
      attached += 1;
    }
  }
  return { attached, unmatched };
}

/**
 * What a second list may add to a conference an earlier one already described.
 *
 * The rule used to be that it may add nothing: two lists disagreeing is a fact to look at, not
 * something to settle by whichever file sorted last. That is still right about disagreement, and
 * it is what this keeps. But most of what an index batch supplies is `unread` — nobody looked —
 * and a list that fills a section no earlier list filled contradicts nothing. Refusing it left
 * twenty-four conferences showing an empty Programme tab while a file naming their venue, their
 * co-chairs and their abstract deadline sat unread in the same directory.
 *
 * So this is monotone: a section only ever gains content. `unread` is filled by anything, and
 * `not_announced` is replaced only by a section that states something — an organiser announcing a
 * programme is what is supposed to happen between one list being compiled and the next, and a
 * catalogue that reported the older list's "not yet announced" forever would be the one lying.
 * Nothing ever overwrites a section that already states something, which is the case the original
 * rule was written for and the one where two lists genuinely disagree.
 *
 * `source` then names both lists, because half of what the reader sees came from each and a page
 * claiming one of them would be claiming something false.
 */
function fillUnreadSections(
  existing: LaunchConferenceDetails,
  incoming: LaunchConferenceDetails,
  incomingSource: string
): string[] {
  const filled: string[] = [];
  const sections = ["program", "keynotes", "committee", "fees", "sponsors"] as const;
  for (const section of sections) {
    const was = existing[section].availability;
    const now = incoming[section].availability;
    if (now === "unread") continue;
    if (was === "stated") continue;
    if (was === "not_announced" && now !== "stated") continue;
    (existing[section] as LaunchConferenceDetails[typeof section]) = incoming[section] as never;
    filled.push(section);
  }
  if (!existing.callForPapers && incoming.callForPapers) {
    existing.callForPapers = incoming.callForPapers;
    filled.push("callForPapers");
  }
  if (!existing.schedule.sessions.length && incoming.schedule.sessions.length) {
    existing.schedule = incoming.schedule;
    filled.push("schedule");
  }
  if (!existing.venueName && incoming.venueName) {
    existing.venueName = incoming.venueName;
    existing.venueAddress = existing.venueAddress ?? incoming.venueAddress;
    filled.push("venue");
  }
  if (filled.length) existing.source = `${existing.source}, ${incomingSource}`;
  return filled;
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
