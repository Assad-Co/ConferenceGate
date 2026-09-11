// The launch dataset's record shape.
//
// One rule governs every field here, the same one the extraction pipeline and the discovery engine
// follow: a field the source did not state is null, never a plausible guess. `evidence` carries the
// exact text a value was read from, so any record on the site can be traced back to the sentence
// that justified it.

/** How strong the page that stated a fact is, as evidence about the conference. */
export type LaunchSourceType =
  /** The conference's own website, or the organising society's page for it. */
  | "official_site"
  /** A conference directory, calendar or listing aggregator. Never promoted to official. */
  | "directory_listing"
  /** An encyclopaedia or reference work. Real, but not the organiser speaking. */
  | "reference"
  /** Trade press, a university page, a partner announcement — third-party but not a directory. */
  | "third_party"
  /** A structured events API that aggregates and verifies event data (PredictHQ). Stronger than a
   *  listing because the fields are stated rather than parsed out of prose, weaker than the
   *  organiser's own site because it is still somebody reporting on the event. */
  | "event_api";

export type LaunchFormat = "in-person" | "hybrid" | "online";

/** Where one field's value came from, and how firmly. Mirrors the extraction pipeline's
 *  `FieldProvenance` so the detail page can render both the same way. */
export interface LaunchFieldProvenance {
  sourceUrl: string;
  sourcePageTitle: string | null;
  confidence: "High" | "Medium" | "Low";
}

/** The raw material a record was derived from, kept verbatim.
 *
 *  `statedText` is preserved in full rather than trimmed to the fields that parsed, because it
 *  routinely carries the venue, the edition, the hosting institution and the format — information
 *  worth showing a reader even when the structured parse could not place it in a column. */
export interface LaunchEvidence {
  /** The search that surfaced this result. */
  query: string;
  /** The result's title, verbatim. */
  resultTitle: string;
  /** The statement of the conference's facts, verbatim. */
  statedText: string;
  /** When this was read. */
  retrievedAt: string;
  /** How the facts reached us. Never "site read" — no page of any conference is fetched by any of
   *  these paths, and the detail page depends on that being visible. */
  method: "web_search" | "event_api" | "scholarly_api";
  /** The upstream record's own identifier, when the source has one. Lets a later run recognise the
   *  same event rather than re-deriving it from the title. */
  externalId?: string | null;
}

/** What a curated detail cell tells us about its section.
 *
 *  Three states, not two, because "the organiser has not announced speakers" and "nobody could
 *  read the speakers page" are different facts with different remedies, and a page that prints one
 *  when the other is true is lying to the reader. */
export type LaunchSectionAvailability = "stated" | "not_announced" | "unread";

export interface LaunchDetailPerson {
  name: string;
  /** The heading that introduced them. Never inferred from position on a page. */
  role: string | null;
  org: string | null;
  title: string | null;
  /** What they are speaking about, when the source said. */
  topic: string | null;
}

export interface LaunchDetailSponsor {
  name: string;
  tier: string | null;
}

export interface LaunchDetailFee {
  category: string;
  amount: number | null;
  currency: string | null;
}

/** Why a section holding text produced no structured entries. */
export type LaunchUnstructuredReason = "withdrawn_in_source" | "no_recognisable_entries" | null;

export interface LaunchDetailSection<T> {
  availability: LaunchSectionAvailability;
  items: T[];
  /** The source cell, verbatim. Kept whether or not anything structured out of it, because the
   *  sentence is the evidence and often says more than the columns could hold. */
  text: string | null;
  unstructuredReason: LaunchUnstructuredReason;
}

/** One item on a conference's schedule, exactly as the source wrote it. */
export interface LaunchDetailAgendaEntry {
  /** ISO date, when the source's day marker gave a month and a day. */
  date: string | null;
  /** The marker verbatim — "Sat 9/12", "15-16 Oct" — so a reader sees what was written. */
  dateText: string;
  /** A clock time only where the source printed one. */
  time: string | null;
  title: string;
}

/** A call for papers, as the source stated it. Every field is null unless it said so. */
export interface LaunchDetailCallForPapers {
  /** "Open" or "Closed" — the organiser's own word, never derived from today's date. */
  status: string | null;
  abstractDeadline: string | null;
  submissionEmail: string | null;
  /** "500-word max", verbatim. */
  lengthLimit: string | null;
  /** The clause these were read from, kept so the reader sees the sentence behind the fields. */
  text: string | null;
  /** The organiser's call-for-papers page, where the source named one of its own. */
  url?: string | null;
}

export interface LaunchDetailProse {
  availability: LaunchSectionAvailability;
  text: string | null;
}

/**
 * The deep sections of a conference, supplied rather than crawled.
 *
 * Present only where a curated list covered the conference. Its absence means nobody has supplied
 * these sections — never that the conference has no speakers.
 */
export interface LaunchConferenceDetails {
  /** The list this came from, for provenance. */
  source: string;
  venueName: string | null;
  venueAddress: string | null;
  program: LaunchDetailProse;
  /** Read out of the programme text, where the source stated one. */
  callForPapers: LaunchDetailCallForPapers | null;
  /** The day-by-day schedule and the themes, pulled out of the same programme paragraph. */
  schedule: { sessions: LaunchDetailAgendaEntry[]; themes: string[] };
  keynotes: LaunchDetailSection<LaunchDetailPerson>;
  committee: LaunchDetailSection<LaunchDetailPerson>;
  fees: LaunchDetailSection<LaunchDetailFee>;
  sponsors: LaunchDetailSection<LaunchDetailSponsor>;
  /** A travel advisory the list's compiler wrote. Not the organiser speaking, and shown as such. */
  safetyNote: string | null;
  /** Where to register, where the source named a page of its own for it. */
  registrationUrl?: string | null;
  /**
   * Where to stay: the official hotel block, its rates, the housing partner.
   *
   * Its own field because it is its own fact. Folded into `venueAddress` it was silently lost —
   * the venue parser fills that first, so Gastech's housing partner and its published room rates
   * were replaced by "Bangkok, Thailand", which the page already said twice.
   */
  accommodation?: string | null;
}

export interface LaunchConferenceRecord {
  /** Stable slug: series + year + city, so a rebuild produces the same id for the same event. */
  id: string;
  title: string;
  acronym: string | null;
  /** The title with its year and edition ordinal removed — what recurs between editions. */
  series: string | null;
  /** "88th", "13th", … when the source stated one. */
  edition: string | null;
  year: number;

  startDate: string | null;
  endDate: string | null;
  /** "day" when both days are known, "month" when only the month was stated. */
  datePrecision: "day" | "month" | null;
  /**
   * The month, 1-12, where the source stated one but not a day.
   *
   * Every parser worked this out and every one dropped it, so fourteen conferences whose source
   * said "November 2026" reached the page with no date line at all — the year survived in `year`
   * and the month did not, leaving nothing a date could be written from.
   */
  startMonth?: number | null;
  /** The date exactly as the source wrote it. */
  datesText: string | null;

  city: string | null;
  /** State, province or emirate, when the source named one. */
  region: string | null;
  country: string | null;
  countryCode: string | null;
  worldRegion: string | null;
  venue: string | null;
  format: LaunchFormat;

  organization: string | null;
  category: string | null;
  categories: string[];
  topics: string[];
  keywords: string[];

  /** The preserved source text. Deliberately not a generated summary. */
  description: string | null;

  /** The page that stated these facts. Always present — a record without one is not published. */
  sourceUrl: string;
  sourceHost: string;
  sourceType: LaunchSourceType;
  /** The conference's own website, when the source was that website. Null for every listing. */
  officialUrl: string | null;
  /**
   * A logo the source actually supplied.
   *
   * Distinct from the one derived from the official domain, which is what most records show. A
   * list that names an image the organiser publishes is stating a fact; a list that hands back a
   * favicon service's URL for that same domain is doing what this server already does, only
   * through a third party. Only the first is kept here.
   */
  logoUrl?: string | null;

  evidence: LaunchEvidence;
  provenance: Record<string, LaunchFieldProvenance>;
  /** Other pages that stated the same conference. Deduplication keeps the strongest source as the
   *  record and lists the rest here rather than discarding the fact that they agreed. */
  corroboratingSourceUrls: string[];

  /** Marks these as launch-dataset records so stored Turso records stay distinguishable. */
  origin: "launch_dataset";
  /**
   * Whether a person supplied this conference or a search found it.
   *
   * The distinction turned out to matter more than any other: of 330 records the web harvest
   * produced, not one has a single deep tab behind it — no programme, no speakers, no committee,
   * no fees — because a search result states a name, a date and a place and stops there. A curated
   * list is written by somebody who knows the field, and 153 of 181 such records carry content.
   */
  supply: "curated_list" | "web_harvest";

  /** Programme, speakers, committee, fees and sponsors, when a curated list supplied them.
   *  Absent means nobody supplied them, which is not the same as the conference having none. */
  details?: LaunchConferenceDetails | null;
}

/** A row the builder refused, and why. Kept so the rejection count in the report is auditable
 *  rather than a number nobody can check. */
export interface LaunchRejection {
  reason: string;
  sourceUrl: string;
  statedText: string;
}

export interface LaunchDataset {
  generatedAt: string;
  /** Only conferences whose end date is on or after this day are included. */
  horizonStart: string;
  years: number[];
  records: LaunchConferenceRecord[];
}

/** The compact per-record entry the customer search matches against. */
export interface LaunchSearchIndexEntry {
  id: string;
  title: string;
  acronym: string | null;
  series: string | null;
  organization: string | null;
  category: string | null;
  topics: string[];
  keywords: string[];
  city: string | null;
  country: string | null;
  worldRegion: string | null;
  year: number;
  startDate: string | null;
  endDate: string | null;
  format: LaunchFormat;
  sourceUrl: string;
  sourceType: LaunchSourceType;
  description: string | null;
  /** Everything above, normalized and joined — what the matcher actually scans. */
  haystack: string;
}

export interface LaunchSearchIndex {
  generatedAt: string;
  count: number;
  entries: LaunchSearchIndexEntry[];
}
