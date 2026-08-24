// Semantic Scholar is a free, public academic paper index — no account, no signup, works
// without a key (an optional key just raises the rate limit). Covers CS/AI/ML conferences
// (NeurIPS, ICML, ACL, etc.) especially well, including many papers that lack a DOI and so
// don't show up in CrossRef.
//
// Names collide here too — results are candidates, never auto-attached.

const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || null;

export interface SemanticScholarCandidate {
  id: string;
  title: string;
  venue: string | null;
  year: string | null;
  url: string | null;
}

function requestHeaders(): Record<string, string> {
  return SEMANTIC_SCHOLAR_API_KEY ? { "x-api-key": SEMANTIC_SCHOLAR_API_KEY } : {};
}

const searchCache = new Map<string, { data: SemanticScholarCandidate[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Searches Semantic Scholar for an author matching the given name and returns their real
 * conference papers (publicationTypes includes "Conference"). Never fabricates a value — any
 * field Semantic Scholar doesn't provide comes back as null. Returns [] (never throws) if the
 * lookup fails or nothing plausible is found. */
export async function searchSemanticScholarConferencePapers(fullName: string): Promise<SemanticScholarCandidate[]> {
  const name = fullName.trim();
  if (!name) return [];

  const cacheKey = name.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const searchRes = await fetch(
      `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(name)}&fields=name,paperCount`,
      { headers: requestHeaders() }
    );
    const searchText = await searchRes.text();
    const searchBody = searchText ? JSON.parse(searchText) : {};
    const authorCandidates = Array.isArray(searchBody?.data) ? searchBody.data : [];
    if (!searchRes.ok || authorCandidates.length === 0) return [];

    // Semantic Scholar's own author disambiguation is imperfect, so consider the top couple of
    // ranked matches rather than assuming the first result is the right person — the person
    // still confirms each paper individually either way.
    const nameLower = name.toLowerCase();
    const ranked = authorCandidates
      .filter((a: any) => typeof a?.authorId === "string")
      .sort((a: any, b: any) => {
        const aExact = typeof a.name === "string" && a.name.toLowerCase() === nameLower ? 1 : 0;
        const bExact = typeof b.name === "string" && b.name.toLowerCase() === nameLower ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return (b.paperCount || 0) - (a.paperCount || 0);
      })
      .slice(0, 2);

    const candidates: SemanticScholarCandidate[] = [];
    for (const author of ranked) {
      const papersRes = await fetch(
        `https://api.semanticscholar.org/graph/v1/author/${author.authorId}/papers?fields=title,year,venue,externalIds,publicationTypes,url&limit=50`,
        { headers: requestHeaders() }
      );
      const papersText = await papersRes.text();
      const papersBody = papersText ? JSON.parse(papersText) : {};
      const papers = Array.isArray(papersBody?.data) ? papersBody.data : [];
      if (!papersRes.ok) continue;

      for (const paper of papers) {
        const types = Array.isArray(paper?.publicationTypes) ? paper.publicationTypes : [];
        if (!types.includes("Conference")) continue;

        const title = paper?.title;
        const paperId = paper?.paperId;
        if (typeof title !== "string" || !title.trim() || typeof paperId !== "string") continue;

        const doi = paper?.externalIds?.DOI;
        candidates.push({
          id: `ss:${paperId}`,
          title: title.trim(),
          venue: typeof paper?.venue === "string" && paper.venue ? paper.venue : null,
          year: typeof paper?.year === "number" ? String(paper.year) : null,
          url: typeof doi === "string" && doi ? `https://doi.org/${doi}` : typeof paper?.url === "string" ? paper.url : null,
        });
      }
    }

    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    searchCache.set(cacheKey, { data: deduped, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    return deduped;
  } catch {
    return [];
  }
}
