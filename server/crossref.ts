// CrossRef is a free, public index of published works — not a personal account system. Nobody
// signs up for it or has a profile there; it's queried by name like a search engine, with no API
// key and no registration required at all. That makes it the one option that needs literally
// nothing extra from the user beyond the name they already typed in at signup.
//
// Names collide, though, so results are never auto-attached — they come back as candidates for
// the person to confirm or dismiss, and only confirmed ones are ever shown as theirs.

const CROSSREF_CONTACT_EMAIL = process.env.CROSSREF_CONTACT_EMAIL || null;

// CrossRef's metadata is sourced from publishers' original XML records, which sometimes carry
// escaped entities straight through into the JSON API (a title or journal name literally
// containing "&amp;" instead of "&"). Decoded here so it never reaches the screen unescaped.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export interface CrossRefCandidate {
  doi: string;
  title: string;
  venue: string | null;
  year: string | null;
  url: string | null;
}

interface NameParts {
  firstNames: string[];
  familyName: string;
  fullNameLower: string;
}

function parseNameParts(fullName: string): NameParts {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const familyName = parts.length ? parts[parts.length - 1].toLowerCase() : "";
  const firstNames = parts.slice(0, -1).map((p) => p.toLowerCase());
  return {
    firstNames,
    familyName,
    fullNameLower: fullName.toLowerCase(),
  };
}

const searchCache = new Map<string, { data: CrossRefCandidate[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Searches CrossRef's public works index for conference proceedings papers by author name.
 * Never fabricates a value — any field CrossRef doesn't provide comes back as null. Returns []
 * (never throws) if the lookup fails or nothing plausible is found, so the UI can always render
 * the same honest-empty-state pattern used elsewhere. */
export async function searchCrossRefConferencePapers(fullName: string, force = false): Promise<CrossRefCandidate[]> {
  const name = fullName.trim();
  if (!name) return [];

  const cacheKey = name.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

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

    const userNameParts = parseNameParts(name);

    const candidates: CrossRefCandidate[] = [];
    for (const item of items) {
      const doi = item?.DOI;
      const title = Array.isArray(item?.title) ? item.title[0] : null;
      if (typeof doi !== "string" || typeof title !== "string" || !title.trim()) continue;

      // Strict relevance check: require family name match + at least one first name match.
      // This prevents matching papers by other people who happen to share the last name.
      const authors = Array.isArray(item?.author) ? item.author : [];
      const hasExactAuthor = authors.some((a: any) => {
        const authorFamily = typeof a?.family === "string" ? a.family.toLowerCase() : "";
        const authorGiven = typeof a?.given === "string" ? a.given.toLowerCase() : "";
        // Must match: last name AND (first name OR full given names contain user's first names)
        if (authorFamily !== userNameParts.familyName) return false;
        if (userNameParts.firstNames.length === 0) return true;
        return userNameParts.firstNames.some((firstName) => authorGiven.includes(firstName));
      });
      if (!hasExactAuthor) continue;

      const venue = Array.isArray(item?.["container-title"]) ? item["container-title"][0] : null;
      const dateParts = item?.published?.["date-parts"]?.[0] || item?.["published-print"]?.["date-parts"]?.[0];
      const year = Array.isArray(dateParts) && typeof dateParts[0] === "number" ? String(dateParts[0]) : null;
      const url = typeof item?.URL === "string" ? item.URL : null;

      candidates.push({
        doi,
        title: decodeHtmlEntities(title.trim()),
        venue: typeof venue === "string" ? decodeHtmlEntities(venue) : null,
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
