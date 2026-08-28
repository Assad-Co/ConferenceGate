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

export interface ExtractedConferenceDetails {
  extracted: boolean;
  isFallback?: boolean;
  fetchFailed?: boolean;
  /** True when the site couldn't be read AND this host has no browser available to retry with —
   *  a fixable deployment gap rather than a site that genuinely defeated us. */
  browserRenderingUnavailable?: boolean;
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
