export interface OrganizationEventFeedback {
  id: string;
  conferenceTitle: string;
  role: string;
  overallScore: number;
  comment: string;
  date: string;
  verified: boolean;
}

export interface OrganizationSponsorFeedback {
  id: string;
  reviewerOrganization: string;
  conferenceTitle: string;
  overallScore: number;
  legacyRating: number;
  ratings: Record<string, number>;
  comment: string;
  date: string;
  verified: true;
}

export interface OrganizationRanking {
  rank: number | null;
  score: number;
  status: 'unranked' | 'provisional' | 'ranked' | 'established';
  confidenceLabel: 'Not ranked' | 'Emerging' | 'Moderate' | 'High';
  bayesianReputation: number;
  rawReputation: number;
  qualityScore: number;
  confidenceScore: number;
  recencyScore: number;
  historyScore: number;
  eventHistoryScore: number;
  sponsorshipHistoryScore: number;
  eventHistoryCount: number;
  sponsorshipHistoryCount: number;
  verifiedCount: number;
  lastVerifiedActivity: string | null;
}

export interface OrganizationProfile {
  key: string;
  name: string;
  roles: Array<'organizer' | 'sponsor'>;
  logo: string | null;
  description: string;
  industry: string;
  city: string;
  country: string;
  eventReputation: {
    score: number;
    verifiedCount: number;
    nameMatchCount: number;
  };
  sponsorReputation: {
    score: number;
    verifiedCount: number;
  };
  combinedReputation: {
    score: number;
    verifiedCount: number;
  };
  ranking: OrganizationRanking;
  verifiedEventFeedback: OrganizationEventFeedback[];
  nameMatchedEventFeedback: OrganizationEventFeedback[];
  sponsorFeedback: OrganizationSponsorFeedback[];
}

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load organization directory.');
  return data;
}

export async function fetchOrganizationDirectory(options: {
  q?: string;
  role?: 'organizer' | 'sponsor';
  sort?: 'rank' | 'reputation' | 'reviews' | 'name';
  limit?: number;
} = {}): Promise<OrganizationProfile[]> {
  const params = new URLSearchParams();
  if (options.q?.trim()) params.set('q', options.q.trim());
  if (options.role) params.set('role', options.role);
  if (options.sort) params.set('sort', options.sort);
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/discovery/organizations${suffix}`, { credentials: 'include' });
  const data = await parseResponse(res);
  return Array.isArray(data.profiles) ? data.profiles : [];
}
