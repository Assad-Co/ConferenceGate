// Reads the launch dataset that ships in the repository.
//
// Conference Gate's customer surfaces are a stored-data read, which is right — no visitor's search
// may start a crawl — but it left them empty on a host with no database credentials. This module is
// the other half of that answer: a catalogue built from evidence, committed to the repository, and
// served with exactly the same guarantee. Reading it fetches nothing, calls no provider and runs no
// model. It is a file on disk.
//
// It never replaces a stored record. Turso rows are the conferences Conference Gate has actually
// prepared, and they win every ranking and every deduplication slot; these fill the space
// underneath them so the catalogue is populated rather than blank.

import fs from "node:fs";
import path from "node:path";
import { scoreStoredConferenceRecord } from "../storedConferenceSearch";
import type {
  LaunchConferenceRecord, LaunchDataset, LaunchDetailPerson, LaunchSearchIndex,
  LaunchSectionAvailability,
} from "./types";

export const LAUNCH_DATASET_FILE = "conferencegate-worldwide-2026-2028.json";
export const LAUNCH_INDEX_FILE = "conferencegate-search-index.json";

/** Where the dataset can be, in the order worth trying.
 *
 *  `npm start` runs `node dist/server.cjs` from the repository root, so the working directory finds
 *  it; the others cover a bundle executed from inside `dist/` and tests that set an explicit root. */
function candidateDirectories(): string[] {
  // An explicitly configured directory is the only one consulted. Falling through to the default
  // when it holds nothing would let a misconfigured deployment quietly serve a different catalogue
  // than the one it was pointed at, and would make a test asserting "no dataset" pass against the
  // real one.
  const configured = process.env.LAUNCH_DATASET_DIR?.trim();
  if (configured) return [configured];
  return [...new Set([path.join(process.cwd(), "data"), path.join(process.cwd(), "..", "data")])];
}

function readJsonFile<T>(fileName: string): T | null {
  for (const directory of candidateDirectories()) {
    const filePath = path.join(directory, fileName);
    try {
      if (!fs.existsSync(filePath)) continue;
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    } catch (error) {
      // A malformed dataset must degrade to "no static records", never take the server down.
      console.warn(`[launch-dataset] could not read ${filePath}:`, (error as Error).message);
      return null;
    }
  }
  return null;
}

interface LoadedDataset {
  records: LaunchConferenceRecord[];
  /** Every record a URL belongs to. A society's events calendar belongs to all of the conferences
   *  it lists, so this is a list rather than one record — keeping only the last one read meant two
   *  of the three AAPG conferences found on one calendar opened a third conference's page. */
  byUrl: Map<string, LaunchConferenceRecord[]>;
  index: LaunchSearchIndex | null;
}

let cached: LoadedDataset | null = null;

export function loadLaunchDataset(): LoadedDataset {
  if (cached) return cached;
  const dataset = readJsonFile<LaunchDataset>(LAUNCH_DATASET_FILE);
  const index = readJsonFile<LaunchSearchIndex>(LAUNCH_INDEX_FILE);
  const records = Array.isArray(dataset?.records) ? dataset!.records : [];
  const byUrl = new Map<string, LaunchConferenceRecord[]>();
  const fileUnder = (url: string | null | undefined, record: LaunchConferenceRecord) => {
    if (!url) return;
    const existing = byUrl.get(url);
    if (!existing) byUrl.set(url, [record]);
    else if (!existing.includes(record)) existing.push(record);
  };
  for (const record of records) {
    fileUnder(record?.sourceUrl, record);
    fileUnder(record?.officialUrl, record);
  }
  cached = { records, byUrl, index };
  if (records.length === 0) {
    console.warn(`[launch-dataset] no static conference records found — Discover will show stored records only.`);
  }
  return cached;
}

/** Test seam: forget what was loaded so a fixture directory takes effect. */
export function resetLaunchDatasetCache(): void {
  cached = null;
}

export interface LaunchSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: null;
  favicon: null;
  prepared: boolean;
  startDate: string | null;
  /**
   * Where the conference is held, as data.
   *
   * City and country were only ever joined into `snippet` for display, so nothing downstream could
   * filter on them: the discovery page reads `location.country`, got undefined for every catalogue
   * record, and a country filter therefore excluded all 359 of them. A field a filter needs cannot
   * live inside a sentence.
   */
  location: { city: string | null; country: string | null } | null;
  /**
   * Whether `link` is this conference's own page.
   *
   * False when the dataset builder refused the stated website as the conference's own — a society's
   * events calendar listing every event it runs, say. The record is still real and still shown; the
   * URL simply says where it was found, and three conferences found on one calendar are three
   * conferences, not one seen three times.
   */
  linkIsConferencePage: boolean;
}

function toResult(record: LaunchConferenceRecord): LaunchSearchResult {
  const place = [record.city, record.country].filter(Boolean).join(", ");
  const when = record.startDate
    ? [record.startDate, record.endDate].filter(Boolean).join(" – ")
    : record.datesText || String(record.year);
  return {
    title: record.title,
    link: record.sourceUrl,
    snippet: [when, place].filter(Boolean).join(" · ") || record.description || "",
    displayLink: record.sourceHost,
    thumbnail: null,
    favicon: null,
    // True only where a curated list actually filled the deep sections. The flag drives the badge
    // on the results card, so claiming it for a record carrying core details alone would promise a
    // detail page with speakers and a programme behind it and then not have them.
    prepared: Boolean(record.details),
    startDate: record.startDate,
    location: record.city || record.country
      ? { city: record.city ?? null, country: record.country ?? null }
      : null,
    linkIsConferencePage: Boolean(record.officialUrl),
  };
}

/** Ranks the static catalogue against a query using the same scorer as the stored records, so one
 *  query cannot mean two different things depending on which source answered it. */
export function searchLaunchDataset(query: string, limit = 20): LaunchSearchResult[] {
  const { records, index } = loadLaunchDataset();
  if (records.length === 0) return [];
  const entriesById = new Map((index?.entries || []).map((entry) => [entry.id, entry]));

  const ranked: Array<{ record: LaunchConferenceRecord; score: number }> = [];
  for (const record of records) {
    const entry = entriesById.get(record.id);
    const score = scoreStoredConferenceRecord(query, {
      title: record.title,
      acronym: record.acronym,
      topics: record.topics,
      categories: [record.category, ...record.categories],
      keywords: record.keywords,
      description: record.description,
      organizer: [record.organization, record.sourceHost],
      location: [record.city, record.region, record.country, record.worldRegion, record.venue, record.format],
      dates: [record.startDate, record.endDate, record.datesText, String(record.year)],
      officialUrl: record.officialUrl,
      // The index's haystack carries the same text flattened once at build time; passing it here
      // lets a query match anything the record holds without re-walking every field.
      community: entry?.haystack,
    });
    if (score === null) continue;
    ranked.push({ record, score });
  }

  return ranked
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDate = left.record.startDate || `${left.record.year}-12-31`;
      const rightDate = right.record.startDate || `${right.record.year}-12-31`;
      return leftDate < rightDate ? -1 : leftDate > rightDate ? 1 : 0;
    })
    .slice(0, Math.max(1, limit))
    .map(({ record }) => toResult(record));
}

/** The nothing-typed view: soonest first, exactly as the stored browse orders its rows. */
export function browseLaunchDataset(limit = 60, now = new Date()): LaunchSearchResult[] {
  const { records } = loadLaunchDataset();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dated = records
    .map((record) => ({ record, time: Date.parse(record.startDate || "") }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time >= startOfToday.getTime())
    .sort((left, right) => left.time - right.time);
  const undated = records.filter((record) => !Number.isFinite(Date.parse(record.startDate || "")));
  return [...dated.map((entry) => entry.record), ...undated]
    .slice(0, Math.max(1, Math.min(limit, 200)))
    .map(toResult);
}

/**
 * The record a reader opened.
 *
 * `title` decides between conferences that share a URL, which happens when the only page a source
 * published for several events is the listing that names them all. Without it the reader clicks
 * "Venecon 2027" and reads about a different conference entirely — the URL is where all three were
 * found, so it cannot say which one was asked for. With no title, or one that matches nothing, an
 * ambiguous URL identifies no record rather than an arbitrary one of them.
 */
export function findLaunchRecordByUrl(url: string, title?: string | null): LaunchConferenceRecord | null {
  const { byUrl } = loadLaunchDataset();
  const matches = byUrl.get(url.trim());
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const wanted = String(title || "").trim().toLowerCase();
  if (!wanted) return null;
  return matches.find((record) => record.title.trim().toLowerCase() === wanted) ?? null;
}

/** Whether this URL belongs to more than one conference, so a payload read for one of them must
 *  not be cached under it and served to the others. */
export function urlIdentifiesOneLaunchRecord(url: string): boolean {
  return (loadLaunchDataset().byUrl.get(url.trim()) ?? []).length === 1;
}

/**
 * The detail page's payload for a launch record.
 *
 * Only what the source stated is filled in. The deep sections stay empty AND are marked
 * `sectionsNotRead`, because "nobody has read this conference's speakers page" and "this conference
 * has no speakers" are different facts and the page must not print the second when the first is
 * true.
 */
export function launchRecordToTabbedExtraction(record: LaunchConferenceRecord): Record<string, unknown> {
  const importantDates = record.startDate
    ? [{ label: "Conference dates", date: record.startDate, isDeadline: false }]
    : [];
  const details = record.details ?? null;

  // A section nobody supplied is "not read". A section a curated list covered is whatever that list
  // said it was — content, an organiser who has not announced it yet, or a page that could not be
  // read. Collapsing those three into one flag is what made the page tell every reader the same
  // thing about a conference with twelve named keynote speakers and one with none.
  const availability: Record<string, LaunchSectionAvailability> = {
    call_for_papers: "unread",
    program_agenda: details?.program.availability ?? "unread",
    keynote_speakers: details?.keynotes.availability ?? "unread",
    technical_committee: details?.committee.availability ?? "unread",
    sponsors_exhibitors: details?.sponsors.availability ?? "unread",
    venue_accommodation: details?.venueName || details?.venueAddress || record.venue ? "stated" : "unread",
    fees_pricing: details?.fees.availability ?? "unread",
    community: "unread",
  };
  const sectionsNotRead = Object.entries(availability)
    .filter(([, state]) => state === "unread")
    .map(([section]) => section);

  const people = (items: LaunchDetailPerson[]) =>
    items.map((person) => ({
      name: person.name,
      full_name: person.name,
      role: person.role,
      org: person.org,
      organization: person.org,
      title: person.title,
      topic: person.topic,
      email: null,
      imageUrl: null,
      photo_url: null,
    }));

  return {
    extracted: true,
    isFallback: false,
    fetchFailed: false,
    crawlComplete: true,
    crawlPending: false,
    // Whether anything deeper than the core details exists here at all. A venue read out of the
    // record's own source text is core data, not a section somebody went and read, so it does not
    // make this false — only a curated list of the deep sections does. Where one is attached, the
    // per-section map below is what the page must read.
    sectionsNotRead: details === null,
    sectionAvailability: availability,
    detailsReady: Boolean(details),
    sourceUrl: record.sourceUrl,
    pagesRead: 0,
    overview: {
      conference_name: record.title,
      acronym: record.acronym,
      edition: record.edition,
      description: record.description,
      dates_text: record.datesText || (record.startDate ? `${record.startDate}${record.endDate && record.endDate !== record.startDate ? ` – ${record.endDate}` : ""}` : null),
      start_date: record.startDate,
      end_date: record.endDate,
      city: record.city,
      region: record.region,
      country: record.country,
      world_region: record.worldRegion,
      venue: details?.venueName || record.venue,
      format: record.format,
      organizer: record.organization,
      topics: record.topics,
      categories: record.categories,
      keywords: record.keywords,
      important_dates: importantDates,
      official_url: record.officialUrl,
      source_url: record.sourceUrl,
    },
    call_for_papers: {},
    program_agenda: { sessions: [], overview: details?.program.text ?? null },
    keynote_speakers: people(details?.keynotes.items ?? []),
    technical_committee: people(details?.committee.items ?? []),
    sponsors_exhibitors: (details?.sponsors.items ?? []).map((sponsor) => ({
      name: sponsor.name,
      tier: sponsor.tier,
      sponsorship_level: sponsor.tier,
      logoUrl: null,
      logo_url: null,
    })),
    venue_accommodation: {
      venue_name: details?.venueName || record.venue || null,
      address: details?.venueAddress ?? null,
      hotels: [],
      // Named as an advisory from the list's compiler, because it is not the organiser speaking and
      // a reader deciding whether to travel needs to know whose word it is.
      travel_advisory: details?.safetyNote ?? null,
      travel_advisory_source: details?.safetyNote ? details.source : null,
    },
    fees_pricing: {
      registration_url: null,
      registration_fees: (details?.fees.items ?? []).map((fee) => ({
        category: fee.category,
        amount: fee.amount,
        currency: fee.currency,
        deadline: null,
        notes: null,
      })),
      early_bird_deadline: null,
      pricing_text: details?.fees.text ?? null,
    },
    community: {},
    // The cell each section came from, verbatim, so a reader sees what the list actually said —
    // including the sentence that withdrew a value the parser therefore refused to store.
    section_notes: details
      ? {
          program_agenda: details.program.text,
          keynote_speakers: details.keynotes.text,
          technical_committee: details.committee.text,
          sponsors_exhibitors: details.sponsors.text,
          fees_pricing: details.fees.text,
        }
      : {},
    provenance: record.provenance,
    extraction_metadata: {
      origin: "launch_dataset",
      status: "success",
      pages_crawled: 0,
      source_type: record.sourceType,
      evidence: record.evidence,
      corroborating_source_urls: record.corroboratingSourceUrls,
      // Named explicitly so a reader (and a future migration) can tell which sections were never
      // attempted rather than attempted and found empty.
      sections_not_read: sectionsNotRead,
      detail_source: details?.source ?? null,
      section_availability: availability,
      unstructured_reasons: details
        ? {
            keynote_speakers: details.keynotes.unstructuredReason,
            technical_committee: details.committee.unstructuredReason,
            sponsors_exhibitors: details.sponsors.unstructuredReason,
            fees_pricing: details.fees.unstructuredReason,
          }
        : {},
    },
  };
}
