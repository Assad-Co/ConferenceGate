// Shared vocabulary for the Conference Gate discovery engine.
//
// Everything downstream of a fetch speaks these types. They exist so the pipeline's stages —
// discover, extract, normalize, classify, validate, deduplicate, store — can be developed and
// tested independently, and so a new discovery source can be added by implementing one interface
// rather than by editing the pipeline.
//
// The single rule these types encode: a field the source did not state is `null`, never a guess.
// Anything the engine works out for itself (a normalized country, a parsed date, a classified
// category) carries the evidence that produced it, so a consumer can always tell what was read
// from what was inferred.

/** Controlled event-type taxonomy. `original_event_type` keeps whatever the site actually said. */
export const EVENT_TYPES = [
  "conference",
  "congress",
  "symposium",
  "summit",
  "workshop",
  "seminar",
  "forum",
  "exhibition",
  "expo",
  "convention",
  "professional_meeting",
  "continuing_professional_development",
  "webinar",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Normalized attendance format. `unknown` is a real answer, not a placeholder to be filled in —
 *  a site that never says how it is held has not said "in person". */
export const EVENT_FORMATS = ["in_person", "online", "hybrid", "unknown"] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

/** How firmly a value was established. Structured data the organiser published outranks text a
 *  parser recognised, which outranks anything a model was asked to read. */
export type ExtractionMethod = "structured_data" | "html" | "ai" | "derived" | "manual";

/** Publication lifecycle. Nothing reaches `published` on confidence alone; see validate.ts. */
export const PUBLICATION_STATUSES = [
  "discovered",
  "validated",
  "published",
  "needs_review",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** What kind of organisation a domain is, which is what its trust score is derived from. */
export const SOURCE_TYPES = [
  "university",
  "professional_society",
  "scientific_organization",
  "research_institute",
  "medical_society",
  "engineering_society",
  "publisher",
  "conference_organizer",
  "government",
  "professional_association",
  "convention_organization",
  "conference_directory",
  "official_conference_site",
  "unknown",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** How precisely a date was stated. A site that says "May 2027" has not named a day, so
 *  `start_date` stays null and only `start_year`/`start_month` are filled. */
export type DatePrecision = "day" | "month" | "year";

export interface ParsedDateRange {
  /** ISO YYYY-MM-DD, only when the source named an actual day. */
  startDate: string | null;
  endDate: string | null;
  startYear: number | null;
  startMonth: number | null;
  precision: DatePrecision | null;
  /** Exactly what the page said, kept for auditing. */
  rawText: string;
}

/** A deadline the site stated, kept apart from the event's own dates. */
export interface DeadlineSet {
  abstractDeadline: string | null;
  paperSubmissionDeadline: string | null;
  earlyBirdDeadline: string | null;
  registrationDeadline: string | null;
  notificationDate: string | null;
  cameraReadyDeadline: string | null;
}

export const EMPTY_DEADLINES: DeadlineSet = {
  abstractDeadline: null,
  paperSubmissionDeadline: null,
  earlyBirdDeadline: null,
  registrationDeadline: null,
  notificationDate: null,
  cameraReadyDeadline: null,
};

/** A URL worth looking at, and why we think so. Providers emit these; the pipeline consumes them. */
export interface DiscoveryCandidate {
  url: string;
  sourceDomain: string;
  /** Which provider produced it — "sitemap", "search", "common_crawl", … */
  provider: string;
  /** 0–1. How likely this URL is to be a single conference's page, before it has been read. */
  priority: number;
  /** Human-readable reason the URL scored the way it did; goes into the logs. */
  reason: string;
  /** Anything the provider already knows (a sitemap lastmod, a search snippet). Never invented. */
  hints?: {
    title?: string | null;
    snippet?: string | null;
    lastModified?: string | null;
  };
}

/** What a page actually said, before any normalization. Field values here are verbatim strings. */
export interface RawEventExtraction {
  method: ExtractionMethod;
  /** schema.org type when structured data supplied it, e.g. "ConferenceEvent". */
  schemaType: string | null;
  title: string | null;
  description: string | null;
  datesText: string | null;
  startDateText: string | null;
  endDateText: string | null;
  locationText: string | null;
  venue: string | null;
  venueAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  formatText: string | null;
  eventTypeText: string | null;
  organizer: string | null;
  organizerUrl: string | null;
  officialUrl: string | null;
  registrationUrl: string | null;
  submissionUrl: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
  language: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  topics: string[];
  /** Label → verbatim date text, straight off an "Important dates" block. */
  importantDates: Array<{ label: string; text: string }>;
  /** 0–1 confidence in this extraction as a whole. */
  confidence: number;
  /** Which fields this method actually filled, for the metrics in section 31. */
  filledFields: string[];
}

export function emptyRawExtraction(method: ExtractionMethod): RawEventExtraction {
  return {
    method,
    schemaType: null,
    title: null,
    description: null,
    datesText: null,
    startDateText: null,
    endDateText: null,
    locationText: null,
    venue: null,
    venueAddress: null,
    city: null,
    region: null,
    country: null,
    latitude: null,
    longitude: null,
    formatText: null,
    eventTypeText: null,
    organizer: null,
    organizerUrl: null,
    registrationUrl: null,
    officialUrl: null,
    submissionUrl: null,
    imageUrl: null,
    price: null,
    currency: null,
    availability: null,
    language: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    topics: [],
    importantDates: [],
    confidence: 0,
    filledFields: [],
  };
}

/** Where one field's value came from. Stored per field, so "which source supplied the date?" has
 *  an answer for every event. */
export interface FieldProvenance {
  value: string | null;
  sourceUrl: string;
  sourceDomain: string;
  method: ExtractionMethod;
  confidence: number;
  lastVerified: string;
}

export interface RelevanceVerdict {
  isRelevantEvent: boolean;
  classification: string;
  confidenceScore: number;
  classificationReason: string;
}

export interface CategoryAssignment {
  /** A label from Conference Gate's existing industry taxonomy (see categories.ts). */
  category: string;
  confidence: number;
  /** The words in the page that produced the match — never a bare assertion. */
  evidence: string[];
}

/** The engine's canonical, normalized view of one conference. */
export interface NormalizedEvent {
  title: string;
  acronym: string | null;
  description: string | null;

  startDate: string | null;
  endDate: string | null;
  startYear: number | null;
  startMonth: number | null;
  datePrecision: DatePrecision | null;
  datesText: string | null;

  deadlines: DeadlineSet;

  venue: string | null;
  venueAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  /** The location string exactly as the page gave it. */
  rawLocation: string | null;
  latitude: number | null;
  longitude: number | null;

  format: EventFormat;
  eventType: EventType;
  originalEventType: string | null;

  organizer: string | null;
  organizerUrl: string | null;
  officialUrl: string | null;
  registrationUrl: string | null;
  submissionUrl: string | null;
  imageUrl: string | null;

  price: string | null;
  currency: string | null;
  language: string | null;

  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;

  topics: string[];
  categories: CategoryAssignment[];

  series: {
    name: string | null;
    acronym: string | null;
    edition: string | null;
    year: number | null;
  };

  sourceUrl: string;
  sourceDomain: string;
  extractionMethod: ExtractionMethod;
  confidenceScore: number;
  relevance: RelevanceVerdict;
  provenance: Record<string, FieldProvenance>;
  /** Neutral internal indicators, never accusations — see validate.ts. */
  qualityFlags: string[];
  contentHash: string;
}

/** Everything a provider needs to decide what to hand back. */
export interface DiscoveryContext {
  /** Years the run cares about, e.g. [2026, 2027, 2028]. */
  targetYears: number[];
  /** Hard ceiling on candidates this provider may return. */
  maxCandidates: number;
  /** Domains the run is scoped to, when the provider is domain-driven. */
  domains?: string[];
  /** Subject terms, when the provider is query-driven. */
  topics?: string[];
  signal?: AbortSignal;
}

/**
 * A source of candidate URLs.
 *
 * Adding Common Crawl, OpenAlex, an RSS feed or another search API means implementing this and
 * registering it — the pipeline itself does not change. Providers never extract or store; they
 * only say "this URL may be a conference, and here is why".
 */
export interface DiscoveryProvider {
  readonly name: string;
  readonly kind: "sitemap" | "search" | "dataset" | "feed" | "api";
  /** A provider that cannot run (no key, Phase 2, disabled by config) reports false and is
   *  skipped rather than failing the run. */
  isEnabled(): boolean;
  /** Why it is unavailable, when it is — surfaced in the run log and /status. */
  unavailableReason(): string | null;
  readonly rateLimit: { requestsPerMinute: number; maxConcurrent: number };
  /** Baseline confidence in candidates from this provider, before the page is read. */
  readonly baseConfidence: number;
  discover(context: DiscoveryContext): Promise<DiscoveryCandidate[]>;
}
