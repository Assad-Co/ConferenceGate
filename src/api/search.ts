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
  /** Some or all of these details came from sites other than the conference's own — used when the
   *  official site blocks us or says very little. Weaker than the organiser's own word, so it is
   *  always disclosed; per-field `provenance` names exactly which source each value came from. */
  sourcedFromOpenWeb?: boolean;
  /** The conference's own website could not be read at all, and everything here was gathered
   *  elsewhere. */
  officialSiteUnreadable?: boolean;
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
  overview?: Record<string, any>;
  call_for_papers?: Record<string, any>;
  program_agenda?: { sessions?: any[] };
  keynote_speakers?: any[];
  technical_committee?: any[];
  sponsors_exhibitors?: any[];
  venue_accommodation?: Record<string, any>;
  community?: Record<string, any>;
  extraction_metadata?: Record<string, any>;
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

// Normalizes the canonical tab-owned payload into the existing view model. Every legacy field is
// sourced from its owning tab, so a component cannot accidentally render CFP data in Overview or
// speaker-like committee members in Keynote Speakers.
function normalizeTabbedExtraction(data: any): ExtractedConferenceDetails {
  const overview = data?.overview || {};
  const cfp = data?.call_for_papers || {};
  const program = data?.program_agenda || {};
  const venue = data?.venue_accommodation || {};
  const community = data?.community || {};
  const speakers = Array.isArray(data?.keynote_speakers) ? data.keynote_speakers : data?.speakers;
  const committee = Array.isArray(data?.technical_committee) ? data.technical_committee : data?.committee;
  const sponsors = Array.isArray(data?.sponsors_exhibitors) ? data.sponsors_exhibitors : data?.sponsors;
  return {
    ...EMPTY_EXTRACTION,
    ...data,
    conferenceTitle: overview.conference_name ?? data?.conferenceTitle ?? null,
    acronym: overview.acronym ?? data?.acronym ?? null,
    edition: overview.edition ?? data?.edition ?? null,
    overviewSummary: overview.description ?? data?.overviewSummary ?? null,
    datesText: overview.dates_text ?? data?.datesText ?? null,
    city: overview.city ?? data?.city ?? null,
    country: overview.country ?? data?.country ?? null,
    format: overview.format ?? data?.format ?? null,
    organizingInstitution: overview.organizer ?? data?.organizingInstitution ?? null,
    topics: overview.topics ?? data?.topics ?? [],
    contactEmail: overview.contact_email ?? data?.contactEmail ?? null,
    importantDates: overview.important_dates ?? data?.importantDates ?? [],
    cfpStatus: cfp.status ?? data?.cfpStatus ?? null,
    cfpDeadline: cfp.abstract_submission_deadline ?? data?.cfpDeadline ?? null,
    cfpNotificationDate: cfp.notification_date ?? data?.cfpNotificationDate ?? null,
    submissionRequirements: cfp.submission_guidelines ?? data?.submissionRequirements ?? null,
    submissionUrl: cfp.submission_url ?? data?.submissionUrl ?? null,
    submissionEmail: cfp.submission_email ?? data?.submissionEmail ?? null,
    submissionTemplateUrl: cfp.submission_template_url ?? data?.submissionTemplateUrl ?? null,
    cfpSubmissionFormat: cfp.submission_format ?? data?.cfpSubmissionFormat ?? null,
    cfpLengthLimit: cfp.length_limit ?? data?.cfpLengthLimit ?? null,
    cfpReviewProcess: cfp.review_process ?? data?.cfpReviewProcess ?? null,
    cfpTopics: cfp.topics_tracks ?? data?.cfpTopics ?? [],
    publicationInfo: cfp.publication_information ?? data?.publicationInfo ?? EMPTY_EXTRACTION.publicationInfo,
    agendaSessions: program.sessions ?? data?.agendaSessions ?? [],
    speakers: (speakers || []).map((x: any) => ({
      ...x,
      name: x.name ?? x.full_name,
      org: x.org ?? x.organization,
      role: x.role ?? x.speaker_type,
      imageUrl: x.imageUrl ?? x.photo_url,
    })),
    committee: (committee || []).map((x: any) => ({ ...x, org: x.org ?? x.organization })),
    sponsors: (sponsors || []).map((x: any) => ({
      ...x,
      tier: x.tier ?? x.sponsorship_level,
      logoUrl: x.logoUrl ?? x.logo_url,
    })),
    venueName: venue.venue_name ?? data?.venueName ?? null,
    venueAddress: venue.address ?? data?.venueAddress ?? null,
    hotels: venue.hotels ?? data?.hotels ?? [],
    accommodationText: venue.accommodation ?? data?.accommodationText ?? null,
    travelText: venue.travel_information ?? data?.travelText ?? null,
    socialLinks: community.social_media ?? data?.socialLinks ?? [],
  };
}

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
    return normalizeTabbedExtraction(data);
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
    return normalizeTabbedExtraction(data);
  } catch {
    return null;
  }
}
