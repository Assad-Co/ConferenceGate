// OpenAlex's conference sources, used as a seed list of conference SERIES.
//
// This is the one source that needs no key, no account and no quota, and it answers a question none
// of the others do: which conference series actually exist, in every discipline, worldwide. That is
// the enumeration problem — search discovery could only ever find conferences somebody had already
// thought to query for.
//
// What it does NOT give, stated plainly because the distinction matters: OpenAlex is bibliographic
// and backward-looking. It knows that IEEE ICRA is a real series with decades of proceedings. It
// does not know that ICRA 2027 is in Santa Clara in March. So this produces SERIES, never records —
// names, acronyms and homepages that other sources then resolve to a dated edition.
//
// A `mailto` is sent on every request because that is what OpenAlex asks for in return for the
// free, unmetered service, and it puts us in their faster pool.

const API_BASE = "https://api.openalex.org/sources";

export interface OpenAlexSource {
  id?: string;
  display_name?: string;
  abbreviated_title?: string | null;
  alternate_titles?: string[];
  type?: string;
  homepage_url?: string | null;
  country_code?: string | null;
  works_count?: number;
  cited_by_count?: number;
  topics?: Array<{ display_name?: string }>;
  x_concepts?: Array<{ display_name?: string }>;
}

export interface OpenAlexPage {
  results?: OpenAlexSource[];
  meta?: { count?: number; next_cursor?: string | null; per_page?: number };
}

/** A recurring conference, as opposed to one dated edition of it. */
export interface ConferenceSeries {
  id: string;
  name: string;
  acronym: string | null;
  alternateNames: string[];
  homepageUrl: string | null;
  countryCode: string | null;
  /** How much has been published there. A rough, honest proxy for how established a series is. */
  worksCount: number;
  citedByCount: number;
  topics: string[];
  source: "openalex";
}

export interface OpenAlexFetchOptions {
  /** Ceiling on series pulled, so a first run is bounded. */
  maxSeries?: number;
  /** OpenAlex caps per-page at 200. */
  pageSize?: number;
  /** Only series with at least this many works — filters out one-off proceedings entries. */
  minWorks?: number;
  fetchImpl?: typeof fetch;
  onPage?: (page: OpenAlexPage, pageNumber: number) => void;
}

/** Cursor-paginated fetch of every source OpenAlex types as a conference. */
export async function fetchOpenAlexConferenceSeries(
  options: OpenAlexFetchOptions = {}
): Promise<OpenAlexSource[]> {
  const doFetch = options.fetchImpl || fetch;
  const maxSeries = Math.max(1, options.maxSeries ?? 20000);
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 200), 200);
  const minWorks = Math.max(0, options.minWorks ?? 25);
  const contact = process.env.OPENALEX_CONTACT_EMAIL?.trim();

  const collected: OpenAlexSource[] = [];
  let cursor: string | null = "*";
  let pageNumber = 0;

  while (cursor && collected.length < maxSeries) {
    const url = new URL(API_BASE);
    url.searchParams.set("filter", `type:conference,works_count:>${minWorks}`);
    url.searchParams.set("per-page", String(pageSize));
    url.searchParams.set("cursor", cursor);
    url.searchParams.set(
      "select",
      "id,display_name,abbreviated_title,alternate_titles,type,homepage_url,country_code,works_count,cited_by_count,topics"
    );
    if (contact) url.searchParams.set("mailto", contact);

    const response: Response = await doFetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAlex responded ${response.status}: ${body.slice(0, 300)}`);
    }
    const page = (await response.json()) as OpenAlexPage;
    pageNumber += 1;
    options.onPage?.(page, pageNumber);
    for (const source of page.results || []) {
      collected.push(source);
      if (collected.length >= maxSeries) break;
    }
    cursor = page.meta?.next_cursor || null;
  }

  return collected;
}

/** An all-caps token that reads as a conference acronym, e.g. "ICRA" out of "ICRA". */
function acronymOf(source: OpenAlexSource): string | null {
  const abbreviated = source.abbreviated_title?.trim();
  if (abbreviated && /^[A-Z][A-Za-z0-9&/-]{1,15}$/.test(abbreviated)) return abbreviated;
  const parenthetical = source.display_name?.match(/\(([A-Z][A-Z0-9]{1,11})\)/);
  return parenthetical ? parenthetical[1] : null;
}

/**
 * Maps one OpenAlex source to a series, or null when it is not usable.
 *
 * Refused rather than kept: anything OpenAlex does not type as a conference, and anything with no
 * usable name. Nothing here invents an acronym or a homepage the record did not carry.
 */
export function mapOpenAlexSeries(source: OpenAlexSource): ConferenceSeries | null {
  if (source.type && source.type !== "conference") return null;
  const name = (source.display_name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length < 3) return null;
  const id = (source.id || "").trim();
  if (!id) return null;

  const homepage = (source.homepage_url || "").trim();
  return {
    id,
    name,
    acronym: acronymOf(source),
    alternateNames: (source.alternate_titles || []).map((title) => String(title).trim()).filter(Boolean).slice(0, 8),
    homepageUrl: /^https?:\/\//i.test(homepage) ? homepage : null,
    countryCode: source.country_code?.trim()?.toUpperCase() || null,
    worksCount: Number(source.works_count) || 0,
    citedByCount: Number(source.cited_by_count) || 0,
    topics: (source.topics || []).map((topic) => topic?.display_name || "").filter(Boolean).slice(0, 8),
    source: "openalex",
  };
}
