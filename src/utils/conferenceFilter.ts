// The two rules that decide whether a conference survives the discovery filters.
//
// Extracted from DiscoveryEngine so they can be tested. Both were wrong in ways that produced the
// same symptom — an empty result set with nothing on screen explaining it — and neither was
// reachable by a test while it lived inside a component's render.

/** Only the fields the date rule needs, so a test does not have to build a whole Conference. */
export interface DateFilterInput {
  /** ISO start date, or null/empty when this catalogue never learned one. */
  start?: string | null;
}

export interface DateWindow {
  /** "YYYY-MM". The floor the reader gets whether or not they chose it. */
  effectiveStartMonth: string;
  /** "YYYY-MM", or "" when the reader set no upper bound. */
  endAtMonth: string;
}

/**
 * Whether a conference falls inside the reader's date window.
 *
 * The rule that matters is what happens when the start date is missing. `''.slice(0, 7)` is `''`,
 * and `'' < '2026-09'` is true in JavaScript, so the original comparison dropped every undated
 * record — silently, with no date filter applied, and with no way to tell that a filter had been
 * involved at all.
 *
 * Not knowing when a conference happens is not evidence that it has already happened. So the
 * default floor, which the reader never chose, never excludes on ignorance. An explicit upper
 * bound is different: asking for events before a date is a request for a window, and a record with
 * no date cannot be shown to be inside it.
 */
export function withinDateWindow(conference: DateFilterInput, window: DateWindow): boolean {
  const month = String(conference.start || "").slice(0, 7);
  const hasStatedMonth = month.length === 7;

  if (hasStatedMonth && month < window.effectiveStartMonth) return false;
  if (window.endAtMonth && (!hasStatedMonth || month > window.endAtMonth)) return false;
  return true;
}

export interface CountryOptionInput {
  location?: { country?: string | null; city?: string | null } | null;
}

/**
 * The countries a reader may filter by: exactly those some loaded conference is held in.
 *
 * The list used to be seeded from a static table of fifty-seven countries and merely augmented
 * with the loaded ones, so every country was on offer whether or not a single conference matched.
 * Choosing one that matched nothing filtered the list to nothing and said no more about it than
 * an empty page — a reader cannot tell that from a broken filter, and neither could we.
 *
 * `citiesByCountry` still supplies the cities for a country that IS present, so picking one offers
 * its whole city list rather than only the cities that happen to be in the current results.
 */
export function countryOptionsFor(
  conferences: CountryOptionInput[] | null | undefined,
  citiesByCountry: Record<string, string[]> = {}
): Array<{ country: string; cities: string[] }> {
  const byCountry = new Map<string, Set<string>>();
  for (const conference of conferences || []) {
    const country = conference?.location?.country?.trim();
    const city = conference?.location?.city?.trim();
    if (!country) continue;
    if (!byCountry.has(country)) byCountry.set(country, new Set(citiesByCountry[country] || []));
    if (city) byCountry.get(country)!.add(city);
  }
  return [...byCountry.entries()]
    .map(([country, cities]) => ({ country, cities: [...cities].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.country.localeCompare(b.country));
}

/** Case-insensitive substring match, the same test the country filter applies. */
export function matchesCountry(conference: CountryOptionInput, countryFilter: string): boolean {
  const term = countryFilter.trim().toLowerCase();
  if (!term) return true;
  return String(conference?.location?.country || "").toLowerCase().includes(term);
}
