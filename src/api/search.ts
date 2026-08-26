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

export interface ExtractedConferenceDetails {
  extracted: boolean;
  isFallback?: boolean;
  fetchFailed?: boolean;
  sourceUrl?: string;
  overviewSummary: string | null;
  datesText: string | null;
  locationText: string | null;
  format: string | null;
  cfpStatus: string | null;
  cfpDeadline: string | null;
  submissionUrl: string | null;
  submissionRequirements: string | null;
  submissionTemplateUrl: string | null;
  agendaSessions: AgendaSessionExtract[];
  speakers: PersonExtract[];
  committee: PersonExtract[];
  sponsors: SponsorExtract[];
  accommodationText: string | null;
  travelText: string | null;
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
  agendaSessions: [],
  speakers: [],
  committee: [],
  sponsors: [],
  accommodationText: null,
  travelText: null,
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
