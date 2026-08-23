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
