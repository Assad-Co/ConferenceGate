// OpenAlex is a free, public scholarly index — no account, no signup, no API key required (an
// optional contact email just moves requests into OpenAlex's "polite pool" for faster, more
// reliable rate limits). Unlike Semantic Scholar, which leans heavily CS/AI, OpenAlex indexes
// every discipline, which matters for the industry conferences (petroleum geoscience, civil
// engineering, etc.) this platform actually serves.
//
// Names collide here too — results are candidates, never auto-attached.

const OPENALEX_CONTACT_EMAIL = process.env.OPENALEX_CONTACT_EMAIL || null;

export interface OpenAlexCandidate {
  id: string;
  title: string;
  venue: string | null;
  year: string | null;
  url: string | null;
}

// OpenAlex's raw_author_name.search filter is a relevance search, not an exact match — it can
// return a work whose authorship list merely scored well on some of the query's words rather
// than one that actually contains the searched person. Mirrors Semantic Scholar's check: last
// name must match, and at least one first/given name must match (or a single-letter initial).
function plausiblyMatchesName(candidateName: string, targetName: string): boolean {
  const candidateParts = candidateName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const targetParts = targetName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (candidateParts.length === 0 || targetParts.length === 0) return false;

  const candidateFamily = candidateParts[candidateParts.length - 1];
  const targetFamily = targetParts[targetParts.length - 1];
  if (candidateFamily !== targetFamily) return false;

  const candidateFirsts = candidateParts.slice(0, -1).map((p) => p.replace(/[^a-z]/g, ""));
  const targetFirsts = targetParts.slice(0, -1).map((p) => p.replace(/[^a-z]/g, ""));
  if (targetFirsts.length === 0 || candidateFirsts.length === 0) return true;
  return targetFirsts.some((t) =>
    candidateFirsts.some((c) => {
      if (c.length === 0 || t.length === 0) return false;
      if (c.length === 1 || t.length === 1) return c[0] === t[0]; // "A." initial vs "Assad"
      return c.includes(t) || t.includes(c);
    })
  );
}

const searchCache = new Map<string, { data: OpenAlexCandidate[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Searches OpenAlex's public works index for papers by author name. Never fabricates a value —
 * any field OpenAlex doesn't provide comes back as null. Returns [] (never throws) if the lookup
 * fails or nothing plausible is found, so the UI can always render the same honest-empty-state
 * pattern used elsewhere. */
export async function searchOpenAlexConferencePapers(fullName: string, force = false): Promise<OpenAlexCandidate[]> {
  const name = fullName.trim();
  if (!name) return [];

  const cacheKey = name.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const params = new URLSearchParams({
      filter: `raw_author_name.search:${name}`,
      per_page: "25",
    });
    if (OPENALEX_CONTACT_EMAIL) params.set("mailto", OPENALEX_CONTACT_EMAIL);

    const res = await fetch(`https://api.openalex.org/works?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    const items = Array.isArray(body?.results) ? body.results : [];
    if (!res.ok) return [];

    const candidates: OpenAlexCandidate[] = [];
    for (const item of items) {
      const title = item?.title || item?.display_name;
      const workId = item?.id;
      if (typeof title !== "string" || !title.trim() || typeof workId !== "string") continue;

      const authorships = Array.isArray(item?.authorships) ? item.authorships : [];
      const hasPlausibleAuthor = authorships.some((a: any) => {
        const rawName = typeof a?.raw_author_name === "string" ? a.raw_author_name : "";
        const displayName = typeof a?.author?.display_name === "string" ? a.author.display_name : "";
        return plausiblyMatchesName(rawName || displayName, name);
      });
      if (!hasPlausibleAuthor) continue;

      const doiUrl = typeof item?.doi === "string" ? item.doi : null;
      const rawDoi = doiUrl ? doiUrl.replace(/^https?:\/\/doi\.org\//i, "") : null;
      const venue =
        typeof item?.primary_location?.source?.display_name === "string"
          ? item.primary_location.source.display_name
          : null;
      const year = typeof item?.publication_year === "number" ? String(item.publication_year) : null;
      const landingPage =
        typeof item?.primary_location?.landing_page_url === "string" ? item.primary_location.landing_page_url : null;

      candidates.push({
        id: rawDoi ? `doi:${rawDoi}` : `openalex:${workId.replace("https://openalex.org/", "")}`,
        title: title.trim(),
        venue,
        year,
        url: doiUrl || landingPage || workId,
      });
    }

    searchCache.set(cacheKey, { data: candidates, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    return candidates;
  } catch {
    return [];
  }
}
