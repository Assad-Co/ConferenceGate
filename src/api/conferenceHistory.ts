export interface ConferenceHistoryMatch {
  key: string;
  matched: boolean;
  confidence?: 'exact-title-year' | 'exact-title' | 'stored-title-match';
  title?: string;
  officialUrl?: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  city?: string | null;
  country?: string | null;
  venue?: string | null;
  organizer?: string | null;
  format?: 'in-person' | 'hybrid' | 'online' | null;
  category?: string | null;
  categories?: string[];
  topics?: string[];
  sections?: string[];
  cfpStatus?: string | null;
  cfpOpen?: boolean;
  prepared?: boolean;
}

interface ResolveRecord {
  key: string;
  title: string;
  year?: string | number | null;
}

const cache = new Map<string, Promise<ConferenceHistoryMatch | null>>();

function requestKey(title: string, year?: string | number | null) {
  return `${title.trim().toLowerCase()}|${year || ''}`;
}

export async function resolveConferenceHistoryRecord(
  title: string,
  year?: string | number | null,
): Promise<ConferenceHistoryMatch | null> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;
  const cacheKey = requestKey(cleanTitle, year);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const record: ResolveRecord = { key: cacheKey, title: cleanTitle, year };
    const response = await fetch('/api/search/conferences/history-match', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [record] }),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({ results: [] }));
    const match = Array.isArray(data?.results) ? data.results[0] : null;
    return match?.matched ? (match as ConferenceHistoryMatch) : null;
  })().catch(() => null);

  cache.set(cacheKey, promise);
  return promise;
}
