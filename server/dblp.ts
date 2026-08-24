// DBLP is the standard, free, zero-signup computer-science bibliography — searchable by author
// name with no key, no account, and no registration at all. Its own type field cleanly labels
// conference papers ("Conference and Workshop Papers"), which is a more explicit signal than
// CrossRef or Semantic Scholar have to infer.
//
// Names collide here too — results are candidates, never auto-attached.

export interface DblpCandidate {
  id: string;
  title: string;
  venue: string | null;
  year: string | null;
  url: string | null;
}

const searchCache = new Map<string, { data: DblpCandidate[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Searches DBLP for conference/workshop papers by author name (using DBLP's own `author:Name:`
 * query syntax to constrain to that specific author). Never fabricates a value — any field DBLP
 * doesn't provide comes back as null. Returns [] (never throws) if the lookup fails or nothing
 * is found. */
export async function searchDblpConferencePapers(fullName: string): Promise<DblpCandidate[]> {
  const name = fullName.trim();
  if (!name) return [];

  const cacheKey = name.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const authorQuery = `author:${name.replace(/\s+/g, "_")}:`;
    const res = await fetch(`https://dblp.org/search/publ/api?q=${encodeURIComponent(authorQuery)}&format=json&h=30`, {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    const hits = body?.result?.hits?.hit;
    if (!res.ok || !Array.isArray(hits)) return [];

    const candidates: DblpCandidate[] = [];
    for (const hit of hits) {
      const info = hit?.info;
      if (!info || info.type !== "Conference and Workshop Papers") continue;

      const key = info.key;
      const rawTitle = info.title;
      if (typeof key !== "string" || typeof rawTitle !== "string" || !rawTitle.trim()) continue;

      candidates.push({
        id: `dblp:${key}`,
        title: rawTitle.trim().replace(/\.$/, ""),
        venue: typeof info.venue === "string" && info.venue ? info.venue : null,
        year: typeof info.year === "string" ? info.year : null,
        url: typeof info.doi === "string" && info.doi ? `https://doi.org/${info.doi}` : typeof info.url === "string" ? info.url : null,
      });
    }

    searchCache.set(cacheKey, { data: candidates, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    return candidates;
  } catch {
    return [];
  }
}
