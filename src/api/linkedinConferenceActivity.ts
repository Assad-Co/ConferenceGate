export interface LinkedInConferenceSignal {
  id: string;
  kind: 'PAST_CONFERENCE' | 'UPCOMING_CONFERENCE' | 'CONFERENCE_ROLE' | 'PAPER_ABSTRACT' | 'CONFERENCE_MENTION';
  label: string;
  conferenceName?: string | null;
  role: string | null;
  year: number | null;
  sourceUrl: string | null;
  evidenceText: string;
  confidence: number;
  memberClaimed: boolean;
  repostOrQuote: boolean;
  verified: false;
}

export interface LinkedInCallSignal {
  id: string;
  kind: 'CALL_FOR_PAPERS' | 'CALL_FOR_ABSTRACTS' | 'REGISTRATION';
  label: string;
  year: number | null;
  sourceUrl: string | null;
  evidenceText: string;
  confidence: number;
  repostOrQuote: boolean;
  verified: false;
}

export interface LinkedInConferenceActivity {
  linkedinUrl: string;
  conferenceActivity: LinkedInConferenceSignal[];
  callsForPapers: LinkedInCallSignal[];
  sourceActor: string;
  consentedAt: string;
  fetchedAt: string;
}

export interface LinkedInConferenceImportResult {
  activity: LinkedInConferenceActivity;
  imported: boolean;
  counts: {
    posts: number;
    conferenceActivity: number;
    callsForPapers: number;
    explicitMemberClaims: number;
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function fetchLinkedInConferenceActivity(): Promise<{
  activity: LinkedInConferenceActivity | null;
  apifyConfigured: boolean;
}> {
  const response = await fetch('/api/linkedin-conference/me', {
    credentials: 'include',
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(body.error || 'Could not load LinkedIn conference activity.');
  return body;
}

export async function refreshLinkedInConferenceActivity(
  linkedinUrl: string,
): Promise<LinkedInConferenceImportResult> {
  const response = await fetch('/api/linkedin-conference/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, linkedinUrl }),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(body.error || 'Could not import LinkedIn conference activity.');
  return body;
}
