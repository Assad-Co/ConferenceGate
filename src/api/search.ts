export interface LiveSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: string | null;
  favicon: string | null;
}

export async function searchConferencesOnTheWeb(query: string): Promise<LiveSearchResult[]> {
  const res = await fetch(`/api/search/conferences?q=${encodeURIComponent(query)}`, {
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Live search failed. Please try again.');
  }
  return data.results;
}

export interface AgendaSessionExtract {
  date: string | null;
  time: string | null;
  title: string;
  speakerName: string | null;
  speakerImageUrl: string | null;
  track: string | null;
}

export interface PersonExtract {
  name: string;
  title: string | null;
  org: string | null;
  role: string | null;
  imageUrl: string | null;
}

export interface SponsorExtract {
  name: string;
  tier: string | null;
  logoUrl: string | null;
}

/** One place to stay that the conference's own site named.
 *
 *  `distanceSource` says where the distance came from and must be kept visible to the reader:
 *  'published' is the conference's own stated figure, 'estimated' is a straight-line calculation
 *  between geocoded coordinates that nobody actually published. */
export interface HotelExtract {
  name: string;
  address: string | null;
  distanceText: string | null;
  distanceMeters: number | null;
  distanceSource: 'published' | 'estimated' | null;
  rateText: string | null;
  bookingUrl: string | null;
  isOfficialBlock: boolean;
}

/** Where a single extracted value came from, and how firmly its page supported it. */
export interface FieldProvenance {
  sourceUrl: string;
  sourcePageTitle: string | null;
  confidence: 'High' | 'Medium' | 'Low';
}

/** Two pages of the same site stating different things for one field. Reported rather than
 *  resolved — picking one silently turns a visible contradiction into a confident wrong answer. */
export interface ExtractionConflict {
  field: string;
  values: Array<{ value: string; sourceUrl: string | null; sourcePageTitle: string | null }>;
}

export interface ImportantDate {
  label: string;
  date: string;
  isDeadline: boolean;
}

export interface RegistrationFee {
  category: string;
  amount: number | null;
  currency: string | null;
  deadline: string | null;
  notes: string | null;
}

export interface PublicationInfo {
  proceedingsPublisher: string | null;
  journals: string[];
  indexing: string[];
  doi: string | null;
  isbn: string | null;
  issn: string | null;
}

/** What the crawl actually managed to look at — the completeness check, so an empty section can
 *  be told apart from one that was never reached. */
export interface CrawlCoverage {
  pagesRead: string[];
  pagesFailed: string[];
  pdfsRead: string[];
  urlsDiscovered: number;
  categoriesFound: string[];
  categoriesMissing: string[];
}

export interface ExtractedConferenceDetails {
  extracted: boolean;
  isFallback?: boolean;
  fetchFailed?: boolean;
  /** True when the site couldn't be read AND this host has no browser available to retry with —
   *  a fixable deployment gap rather than a site that genuinely defeated us. */
  browserRenderingUnavailable?: boolean;
  /** Why the read failed, established by re-probing the site rather than inferred from which code
   *  path gave up. Shown verbatim, since the remedies genuinely differ. */
  readFailureReason?: string;
  sourceUrl?: string;
  /** How many pages of the conference's site have been read so far. */
  pagesRead?: number;
  /** False while the crawl is still reading the rest of the site — the client polls until true. */
  crawlComplete?: boolean;
  overviewSummary: string | null;
  datesText: string | null;
  locationText: string | null;
  format: string | null;
  cfpStatus: string | null;
  cfpDeadline: string | null;
  submissionUrl: string | null;
  submissionRequirements: string | null;
  submissionTemplateUrl: string | null;
  submissionEmail: string | null;
  cfpSubmissionFormat: string | null;
  cfpLengthLimit: string | null;
  cfpReviewProcess: string | null;
  cfpNotificationDate: string | null;
  cfpTopics: string[];
  agendaSessions: AgendaSessionExtract[];
  speakers: PersonExtract[];
  committee: PersonExtract[];
  sponsors: SponsorExtract[];
  accommodationText: string | null;
  travelText: string | null;
  venueName: string | null;
  venueAddress: string | null;
  hotels: HotelExtract[];
  conferenceTitle: string | null;
  acronym: string | null;
  edition: string | null;
  year: string | null;
  organizingInstitution: string | null;
  topics: string[];
  city: string | null;
  country: string | null;
  importantDates: ImportantDate[];
  registrationUrl: string | null;
  registrationFees: RegistrationFee[];
  earlyBirdDeadline: string | null;
  publicationInfo: PublicationInfo;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: Array<{ platform: string; url: string }>;
  awards: Array<{ name: string; description: string | null }>;
  provenance: Record<string, FieldProvenance>;
  conflicts: ExtractionConflict[];
  crawlCoverage: CrawlCoverage;
}

const EMPTY_EXTRACTION: ExtractedConferenceDetails = {
  extracted: false,
  overviewSummary: null,
  datesText: null,
  locationText: null,
  format: null,
  cfpStatus: null,
  cfpDeadline: null,
  submissionUrl: null,
  submissionRequirements: null,
  submissionTemplateUrl: null,
  submissionEmail: null,
  cfpSubmissionFormat: null,
  cfpLengthLimit: null,
  cfpReviewProcess: null,
  cfpNotificationDate: null,
  cfpTopics: [],
  agendaSessions: [],
  speakers: [],
  committee: [],
  sponsors: [],
  accommodationText: null,
  travelText: null,
  venueName: null,
  venueAddress: null,
  hotels: [],
  conferenceTitle: null,
  acronym: null,
  edition: null,
  year: null,
  organizingInstitution: null,
  topics: [],
  city: null,
  country: null,
  importantDates: [],
  registrationUrl: null,
  registrationFees: [],
  earlyBirdDeadline: null,
  publicationInfo: { proceedingsPublisher: null, journals: [], indexing: [], doi: null, isbn: null, issn: null },
  contactEmail: null,
  contactPhone: null,
  socialLinks: [],
  awards: [],
  provenance: {},
  conflicts: [],
  crawlCoverage: {
    pagesRead: [],
    pagesFailed: [],
    pdfsRead: [],
    urlsDiscovered: 0,
    categoriesFound: [],
    categoriesMissing: [],
  },
};

// Fetches the live search result's own page and asks the AI assistant to pull out only what's
// explicitly stated there — never invents details. Falls back to an honest "nothing extracted"
// shape (rather than throwing) whenever extraction can't run, so the UI can render the same
// honest-empty-state pattern used everywhere else instead of a hard error.
export async function extractConferenceDetails(url: string, title: string): Promise<ExtractedConferenceDetails> {
  try {
    const res = await fetch('/api/ai/extract-conference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url, title }),
      // Backstops the server's own deadline for answering with a first snapshot. The server no
      // longer holds this request open for the whole site — it replies as soon as the first round
      // of pages is read and keeps crawling in the background — so this only needs to cover that
      // first-response deadline (~15s) plus a safety margin.
      signal: AbortSignal.timeout(25000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return EMPTY_EXTRACTION;
    }
    return { ...EMPTY_EXTRACTION, ...data };
  } catch {
    return EMPTY_EXTRACTION;
  }
}

/** Asks for the crawl's current state for a URL whose first snapshot has already been rendered.
 *  Returns null when there's nothing newer to show, so a caller can simply keep its existing
 *  data rather than having to reason about a partial response. */
export async function fetchConferenceCrawlStatus(url: string): Promise<ExtractedConferenceDetails | null> {
  try {
    const res = await fetch(`/api/ai/extract-conference/status?url=${encodeURIComponent(url)}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    // `extracted` is absent on the "still starting up" and "no job here" replies, neither of which
    // carries content worth replacing what's already on screen with.
    if (!data || data.extracted !== true) return null;
    return { ...EMPTY_EXTRACTION, ...data };
  } catch {
    return null;
  }
}
