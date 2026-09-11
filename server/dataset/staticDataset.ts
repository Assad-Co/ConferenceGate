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

/**
 * The deep sections this record actually has something to show in.
 *
 * "Something" means the source stated it — a list, or the sentence it described the section in.
 * A section whose cell says "Not yet announced" is not in here, because a card that offers a
 * Speakers chip for it promises a tab that opens on nothing. Venue is excluded: it comes from the
 * record's core details rather than from anybody supplying a section.
 */
export function filledSections(record: LaunchConferenceRecord): string[] {
  const details = record.details;
  if (!details) return [];
  const filled: string[] = [];
  if (details.program.availability === "stated" || details.schedule.sessions.length) filled.push("agenda");
  if (details.callForPapers) filled.push("cfp");
  if (details.keynotes.availability === "stated") filled.push("speakers");
  if (details.committee.availability === "stated") filled.push("committee");
  if (details.sponsors.availability === "stated") filled.push("sponsors");
  if (details.fees.availability === "stated") filled.push("fees");
  return filled;
}

/**
 * Whether there is enough here to be worth opening.
 *
 * The first version of this gate asked one question — does any of the six deep tabs hold
 * something? — and held back 386 conferences that state a date, a city, a country, an overview, a
 * venue, an organiser and their own website, because nobody had published their speaker list yet.
 * That is a conference missing one tab, not a conference missing everything, and hiding it loses a
 * real event a reader was looking for.
 *
 * So the question is what the page can say. A reader needs to know what it is, when it runs and
 * where, and then to have something to read or somewhere to go. A record that cannot answer those
 * is a name and nothing else, and that is the only thing held back.
 */
/** A path that is the site's root, or the root plus a bare edition segment: "/", "/2027/",
 *  "/us-26/". Anything else is a page on a site that carries other things too. */
const OWN_SITE_PATH = /^\/(?:(?:[a-z]{1,6}-)?(?:19|20)?\d{2}\/?)?$/i;

/**
 * The conference's own icon, derived from the conference's own website.
 *
 * Derived, not read — so it follows the same rule the hotel distances do: a value this server
 * worked out is never allowed to claim more than it knows. What it knows is that every browser asks
 * a site for /favicon.ico, and that the icon it gets back is *that site's* mark.
 *
 * Which is the whole difficulty, because a site's mark is the conference's only when the site is
 * the conference's. The first version of this asked only whether an official URL was known, and put
 * a trade magazine's logo on Gastech (its stated page was an article on rogtecmagazine.com) and
 * Elsevier's on the 20th Vaccine Congress. Both are exactly the failure the rest of this file
 * exists to prevent: a reader shown a brand the conference has nothing to do with.
 *
 * So the test is the one `eventIdentityFrom` already makes for deep pages — a conference that owns
 * its domain has its page at the root of it, and anything deeper means the host carries other
 * things too. A year segment is still the root of the conference's own site ("/2027/"), and that is
 * the only path allowed past. Everywhere else the card and the page show the conference's initials,
 * which say nothing rather than something false.
 *
 * The icon may still not exist: a site that declares its icon in markup alone answers this path
 * with a 404. That is a rendering concern rather than a data one, and both the card and the detail
 * page fall back to the initials when the image does not load.
 */
export function siteIconUrl(officialUrl: string | null): string | null {
  if (!officialUrl) return null;
  try {
    const site = new URL(officialUrl);
    if (site.protocol !== "https:" && site.protocol !== "http:") return null;
    if (!OWN_SITE_PATH.test(site.pathname)) return null;
    return new URL("/favicon.ico", site.origin).toString();
  } catch {
    return null;
  }
}

export function conferenceLogoUrl(record: LaunchConferenceRecord): string | null {
  // An image the source actually named beats one derived from a domain, and is the only case where
  // this is a fact rather than a derivation. Everything else falls back to the organiser's own icon.
  return record.logoUrl ?? siteIconUrl(record.officialUrl);
}

export function hasSomethingToShow(record: LaunchConferenceRecord): boolean {
  const whenKnown = Boolean(record.startDate || record.datePrecision === "month");
  const whereKnown = Boolean(record.city || record.country);
  const somethingToRead =
    Boolean(record.description || record.officialUrl || record.venue || record.organization)
    || filledSections(record).length > 0;
  return whenKnown && whereKnown && somethingToRead;
}

export interface LaunchSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: null;
  /** The conference's own icon, where it has its own site to take one from. See conferenceLogoUrl. */
  favicon: string | null;
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
  /** Which tabs actually have something behind them, so the card offers only those. */
  sections: string[];
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
    favicon: conferenceLogoUrl(record),
    // True only where a section actually holds something. The flag drives the badge on the results
    // card, so claiming it for a record whose every section says "not announced yet" would promise
    // a detail page with speakers and a programme behind it and then not have them.
    prepared: filledSections(record).length > 0,
    sections: filledSections(record),
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
  const cfp = details?.callForPapers ?? null;
  const availability: Record<string, LaunchSectionAvailability> = {
    call_for_papers: cfp ? "stated" : "unread",
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
      // The one line the page puts under the title. The record holds the parts; if nobody joins
      // them here the page has a city and a country in its payload and no place on its screen.
      location_text:
        [details?.venueName || record.venue, record.city, record.region, record.country]
          .filter(Boolean)
          .join(", ") || null,
      format: record.format,
      organizer: record.organization,
      topics: record.topics,
      categories: record.categories,
      keywords: record.keywords,
      important_dates: importantDates,
      official_url: record.officialUrl,
      source_url: record.sourceUrl,
      // The conference's own mark, and the picture from its own page. The logo is derived from the
      // site (see conferenceLogoUrl); the picture can only come from a page somebody read, so it
      // is null here until the worker reads one and stores it.
      logo_url: conferenceLogoUrl(record),
      image_url: null,
    },
    call_for_papers: cfp
      ? {
          status: cfp.status,
          abstract_submission_deadline: cfp.abstractDeadline,
          submission_email: cfp.submissionEmail,
          length_limit: cfp.lengthLimit,
          submission_url: cfp.url ?? null,
        }
      : {},
    program_agenda: {
      // A schedule the source wrote as prose is still a schedule; these are its rows, and the
      // paragraph stays underneath because it says things no row can hold.
      sessions: (details?.schedule.sessions ?? []).map((entry) => ({
        date: entry.date || entry.dateText,
        time: entry.time,
        title: entry.title,
        speakerName: null,
        speakerImageUrl: null,
        track: null,
      })),
      themes: details?.schedule.themes ?? [],
      overview: details?.program.availability === "stated" ? details.program.text : null,
    },
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
      registration_url: details?.registrationUrl ?? null,
      registration_fees: (details?.fees.items ?? []).map((fee) => ({
        category: fee.category,
        amount: fee.amount,
        currency: fee.currency,
        deadline: null,
        notes: null,
      })),
      early_bird_deadline: null,
      // "Not yet announced as of 10 Sep 2026" is not a pricing note. Only a cell that states
      // something reaches the panel; the tab says the rest in its own words.
      pricing_text: details?.fees.availability === "stated" ? details.fees.text : null,
    },
    community: {},
    // The cell each section came from, verbatim, so a reader sees what the list actually said —
    // including the sentence that withdrew a value the parser therefore refused to store.
    section_notes: details
      ? {
          call_for_papers: details.callForPapers?.text ?? null,
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

/**
 * Fills the sections a stored record leaves empty from the launch catalogue's own.
 *
 * The two sources describe the same conference and neither is allowed to erase the other. A record
 * published by the discovery engine wins wherever it has content — it read the conference's own
 * pages, which is stronger evidence than any list. But a record can be published the moment its
 * title, date and country verify, long before anything read its speakers page, and serving that
 * row alone replaced a curated twenty-seven-person committee with an empty tab.
 *
 * So this fills gaps and only gaps. It never overwrites a stored value, never merges two lists into
 * one, and never claims a section is complete: each filled section keeps the launch record's own
 * account of where it came from and what its source said.
 */
export function fillGapsFromLaunchRecord(
  stored: Record<string, any>,
  record: LaunchConferenceRecord
): Record<string, any> {
  const launch = launchRecordToTabbedExtraction(record) as Record<string, any>;
  const merged: Record<string, any> = { ...stored };
  const filled: string[] = [];

  const isEmptyList = (value: unknown): boolean => !Array.isArray(value) || value.length === 0;
  for (const section of ["keynote_speakers", "technical_committee", "sponsors_exhibitors"]) {
    if (isEmptyList(stored[section]) && !isEmptyList(launch[section])) {
      merged[section] = launch[section];
      filled.push(section);
    }
  }

  const storedProgram = stored.program_agenda || {};
  if (isEmptyList(storedProgram.sessions) && !String(storedProgram.overview || "").trim()
      && String(launch.program_agenda?.overview || "").trim()) {
    merged.program_agenda = { ...storedProgram, overview: launch.program_agenda.overview };
    filled.push("program_agenda");
  }

  const storedFees = stored.fees_pricing || {};
  if (isEmptyList(storedFees.registration_fees) && !isEmptyList(launch.fees_pricing?.registration_fees)) {
    merged.fees_pricing = {
      ...storedFees,
      registration_fees: launch.fees_pricing.registration_fees,
      pricing_text: storedFees.pricing_text || launch.fees_pricing.pricing_text || null,
    };
    filled.push("fees_pricing");
  }

  const storedVenue = stored.venue_accommodation || {};
  const launchVenue = launch.venue_accommodation || {};
  if (!String(storedVenue.venue_name || "").trim() && String(launchVenue.venue_name || "").trim()) {
    merged.venue_accommodation = {
      ...storedVenue,
      venue_name: launchVenue.venue_name,
      address: storedVenue.address || launchVenue.address || null,
    };
    filled.push("venue_accommodation");
  }
  // The advisory is not a section anyone crawls, so it is carried across whenever the stored row
  // has none of its own.
  if (launchVenue.travel_advisory && !(merged.venue_accommodation || storedVenue).travel_advisory) {
    merged.venue_accommodation = {
      ...(merged.venue_accommodation || storedVenue),
      travel_advisory: launchVenue.travel_advisory,
      travel_advisory_source: launchVenue.travel_advisory_source,
    };
  }

  if (filled.length === 0) return stored;

  // What the page needs to describe each tab honestly: a filled section answers as the launch
  // record does, and everything else keeps whatever the stored row already said.
  const availability: Record<string, string> = { ...(stored.sectionAvailability || {}) };
  const notes: Record<string, string | null> = { ...(stored.section_notes || {}) };
  for (const section of filled) {
    availability[section] = launch.sectionAvailability?.[section] ?? "stated";
    if (launch.section_notes?.[section]) notes[section] = launch.section_notes[section];
  }
  merged.sectionAvailability = availability;
  merged.section_notes = notes;
  merged.sectionsNotRead = false;
  merged.extraction_metadata = {
    ...(stored.extraction_metadata || {}),
    // Named so a reader of the payload can tell which tabs came from the list rather than a crawl.
    sections_filled_from_launch_dataset: filled,
    launch_detail_source: record.details?.source ?? null,
  };
  return merged;
}
