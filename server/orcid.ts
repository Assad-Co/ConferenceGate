// ORCID is a real, public researcher-identifier system — people link their own conference
// papers, abstracts, and presentations to their ORCID iD, and ORCID's Public API exposes that
// record read-only for free. Unlike LinkedIn, registering an API client at orcid.org/developer-
// tools doesn't require a public company page tied to anyone's personal identity.
//
// The client credentials below authenticate Conference Gate's *server* to ORCID's read-public
// API — they are not tied to any individual user and never grant write access or anything
// beyond public data.

const ORCID_CLIENT_ID = process.env.ORCID_CLIENT_ID || null;
const ORCID_CLIENT_SECRET = process.env.ORCID_CLIENT_SECRET || null;

export function isOrcidConfigured(): boolean {
  return !!(ORCID_CLIENT_ID && ORCID_CLIENT_SECRET);
}

const ORCID_ID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** Accepts a bare ORCID iD ("0000-0002-1825-0097") or a full https://orcid.org/... URL, and
 * returns the canonical iD — or null if it doesn't match ORCID's real format. Never guesses one. */
export function normalizeOrcidId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^https?:\/\/(www\.)?orcid\.org\//i, "").toUpperCase();
  return ORCID_ID_RE.test(value) ? value : null;
}

let cachedAppToken: { token: string; expiresAt: number } | null = null;

async function getOrcidAppToken(): Promise<string | null> {
  if (!ORCID_CLIENT_ID || !ORCID_CLIENT_SECRET) return null;
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now()) return cachedAppToken.token;

  try {
    const res = await fetch("https://orcid.org/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: ORCID_CLIENT_ID,
        client_secret: ORCID_CLIENT_SECRET,
        grant_type: "client_credentials",
        scope: "/read-public",
      }),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok || typeof body.access_token !== "string") {
      return null;
    }
    const ttlMs = (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
    cachedAppToken = { token: body.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
    return cachedAppToken.token;
  } catch {
    return null;
  }
}

export interface OrcidWork {
  title: string;
  type: string;
  year: string | null;
  venue: string | null;
  url: string | null;
}

const CONFERENCE_WORK_TYPES = ["conference-paper", "conference-abstract", "conference-poster"];

function normalizeWorkType(rawType: unknown): string {
  return typeof rawType === "string" ? rawType.toLowerCase().replace(/_/g, "-") : "";
}

const worksCache = new Map<string, { data: OrcidWork[]; expiresAt: number }>();
const WORKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Fetches an ORCID iD's real, public "works" — self-reported by the person on their own ORCID
 * record — and returns only the conference-related ones (papers, abstracts, posters). Every
 * field ORCID doesn't provide comes back as null rather than a guessed value. Returns [] if
 * ORCID isn't configured, the lookup fails, or the person has no public conference works — never
 * throws, so the UI can always render the same honest-empty-state pattern used elsewhere. */
export async function fetchOrcidConferenceWorks(orcidId: string): Promise<OrcidWork[]> {
  const cached = worksCache.get(orcidId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const token = await getOrcidAppToken();
  if (!token) return [];

  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/works`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok || !Array.isArray(body.group)) return [];

    const works: OrcidWork[] = [];
    for (const group of body.group) {
      const summary = group?.["work-summary"]?.[0];
      if (!summary) continue;

      const type = normalizeWorkType(summary.type);
      if (!CONFERENCE_WORK_TYPES.includes(type)) continue;

      const title = summary.title?.title?.value;
      if (typeof title !== "string" || !title.trim()) continue;

      const year = summary["publication-date"]?.year?.value;
      const venue = summary["journal-title"]?.value;
      const externalIds = summary["external-ids"]?.["external-id"];
      const linkedId = Array.isArray(externalIds)
        ? externalIds.find((entry: any) => entry?.["external-id-url"]?.value)
        : null;

      works.push({
        title: title.trim(),
        type,
        year: typeof year === "string" ? year : null,
        venue: typeof venue === "string" ? venue : null,
        url: linkedId?.["external-id-url"]?.value || null,
      });
    }

    works.sort((a, b) => (b.year || "").localeCompare(a.year || ""));
    worksCache.set(orcidId, { data: works, expiresAt: Date.now() + WORKS_CACHE_TTL_MS });
    return works;
  } catch {
    return [];
  }
}
