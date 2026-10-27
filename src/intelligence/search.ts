import type { LiveSearchResult } from "../api/search";
import { isoDate, normalize, matchesQuery } from "./engine";

/** Quoted phrases stay exact; unquoted concepts support the documented topic synonyms. */
export function smartSearch(
  results: LiveSearchResult[],
  query: string,
  country: string,
  from: string,
  to: string,
  cfpOnly: boolean,
) {
  return results.filter((r) => {
    const text = normalize(
      [
        r.title,
        r.description,
        r.organization,
        r.category,
        ...(r.categories || []),
      ].join(" "),
    );
    if (country && normalize(r.location?.country) !== normalize(country))
      return false;
    if ((from || to) && !isoDate(r.startDate)) return false;
    if ((from && r.startDate! < from) || (to && r.startDate! > to))
      return false;
    if (cfpOnly && !r.cfpOpen) return false;
    return matchesQuery(text, query);
  });
}
