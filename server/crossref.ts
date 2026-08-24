// CrossRef is a free, public index of published works — not a personal account system. Nobody
// signs up for it or has a profile there; it's queried by name like a search engine, with no API
// key and no registration required at all. That makes it the one option that needs literally
// nothing extra from the user beyond the name they already typed in at signup.
//
// Names collide, though, so results are never auto-attached — they come back as candidates for
// the person to confirm or dismiss, and only confirmed ones are ever shown as theirs.

const CROSSREF_CONTACT_EMAIL = process.env.CROSSREF_CONTACT_EMAIL || null;

export interface CrossRefCandidate {
  doi: string;
  title: string;
  venue: string | null;
  year: string | null;
  url: string | null;
}

function familyNamesOf(fullName: string): string[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length ? [parts[parts.length - 1].toLowerCase()] : [];
}

const searchCache = new Map<string, { data: CrossRefCandidate[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Searches CrossRef's public works index for conference proceedings papers by author name.
 * Never fabricates a value — any field CrossRef doesn't provide comes back as null. Returns []
 * (never throws) if the lookup fails or nothing plausible is found, so the UI can always render
 * the same honest-empty-state pattern used elsewhere. */
export async function searchCrossRefConferencePapers(fullName: string): Promise<CrossRefCandidate[]> {
  const name = fullName.trim();
  if (!name) return [];

  const cacheKey = name.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const params = new URLSearchParams({
      "query.author": name,
      filter: "type:proceedings-article",
      rows: "20",
    });
    if (CROSSREF_CONTACT_EMAIL) params.set("mailto", CROSSREF_CONTACT_EMAIL);

    const res = await fetch(`https://api.crossref.org/works?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    const items = body?.message?.items;
    if (!res.ok || !Array.isArray(items)) return [];

    const familyNames = familyNamesOf(name);

    const candidates: CrossRefCandidate[] = [];
    for (const item of items) {
      const doi = item?.DOI;
      const title = Array.isArray(item?.title) ? item.title[0] : null;
      if (typeof doi !== "string" || typeof title !== "string" || !title.trim()) continue;

      // Light relevance check — CrossRef's own ranking already does the real matching; this
      // just filters out results with no author whose family name matches at all.
      const authors = Array.isArray(item?.author) ? item.author : [];
      const hasPlausibleAuthor =
        familyNames.length === 0 ||
        authors.some((a: any) => typeof a?.family === "string" && familyNames.includes(a.family.toLowerCase()));
      if (!hasPlausibleAuthor) continue;

      const venue = Array.isArray(item?.["container-title"]) ? item["container-title"][0] : null;
      const dateParts = item?.published?.["date-parts"]?.[0] || item?.["published-print"]?.["date-parts"]?.[0];
      const year = Array.isArray(dateParts) && typeof dateParts[0] === "number" ? String(dateParts[0]) : null;
      const url = typeof item?.URL === "string" ? item.URL : null;

      candidates.push({
        doi,
        title: title.trim(),
        venue: typeof venue === "string" ? venue : null,
        year,
        url,
      });
    }

    searchCache.set(cacheKey, { data: candidates, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    return candidates;
  } catch {
    return [];
  }
}
