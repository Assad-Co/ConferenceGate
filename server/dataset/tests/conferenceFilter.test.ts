// The reported bug: country = Germany, every other filter at its default, zero conferences shown.

import assert from "node:assert/strict";
import test from "node:test";
import {
  countryOptionsFor, matchesCountry, withinDateWindow,
} from "../../../src/utils/conferenceFilter";

const GERMANY = [
  { title: "International Supply Chain Conference", start: "2026-10-21", location: { country: "Germany", city: "Berlin" } },
  { title: "Routes World 2026", start: "2026-10-21", location: { country: "Germany", city: "Hamburg" } },
  { title: "Future Power Grids Conference 2027", start: "2027-01-26", location: { country: "Germany", city: "Berlin" } },
];
const ELSEWHERE = [
  { title: "Gastech 2026", start: "2026-09-14", location: { country: "United States", city: "Houston" } },
];

/** The default the reader is given without choosing it. */
const DEFAULT_WINDOW = { effectiveStartMonth: "2026-09", endAtMonth: "" };

test("filtering by country alone, with no date range, returns that country's conferences", () => {
  const all = [...GERMANY, ...ELSEWHERE];
  const shown = all.filter((c) => matchesCountry(c, "Germany") && withinDateWindow(c, DEFAULT_WINDOW));
  assert.equal(shown.length, 3, "the reported bug: Germany with no other filter returned nothing");
  assert.deepEqual(shown.map((c) => c.location.country), ["Germany", "Germany", "Germany"]);
});

test("country plus a date range that should match still returns them", () => {
  const window = { effectiveStartMonth: "2026-10", endAtMonth: "2027-02" };
  const shown = [...GERMANY, ...ELSEWHERE]
    .filter((c) => matchesCountry(c, "Germany") && withinDateWindow(c, window));
  assert.deepEqual(shown.map((c) => c.title), [
    "International Supply Chain Conference", "Routes World 2026", "Future Power Grids Conference 2027",
  ]);

  // And a range that genuinely excludes them still excludes them.
  const narrow = { effectiveStartMonth: "2027-06", endAtMonth: "2027-12" };
  assert.equal(GERMANY.filter((c) => withinDateWindow(c, narrow)).length, 0);
});

test("a conference with no stated start date is not silently dropped by the default floor", () => {
  // `''.slice(0, 7)` is `''`, and `'' < '2026-09'` is true, so this record was excluded by a date
  // filter the reader never applied. Not knowing when it happens is not evidence that it has.
  const undated = { title: "Symposium with dates to be confirmed", start: null, location: { country: "Germany" } };
  assert.equal(withinDateWindow(undated, DEFAULT_WINDOW), true);
  assert.equal(withinDateWindow({ start: "" }, DEFAULT_WINDOW), true);
  assert.equal(withinDateWindow({}, DEFAULT_WINDOW), true);

  // But an upper bound the reader chose IS a request for a window, and an undated record cannot be
  // shown to fall inside it.
  assert.equal(withinDateWindow(undated, { effectiveStartMonth: "2026-09", endAtMonth: "2027-06" }), false);
});

test("the country list offers only countries some loaded conference is actually held in", () => {
  const cities = { Germany: ["Berlin", "Cologne", "Frankfurt", "Hamburg", "Munich"], Japan: ["Tokyo"] };

  // Nothing loaded, so nothing to offer. Offering all fifty-seven here is what produced a filter
  // that returned zero and looked broken.
  assert.deepEqual(countryOptionsFor([], cities), []);

  const options = countryOptionsFor([...GERMANY, ...ELSEWHERE], cities);
  assert.deepEqual(options.map((o) => o.country), ["Germany", "United States"]);
  assert.equal(options.some((o) => o.country === "Japan"), false, "a country with no conferences was offered");

  // A country that IS present keeps its whole city list, not only the cities in these results.
  const germany = options.find((o) => o.country === "Germany")!;
  assert.deepEqual(germany.cities, ["Berlin", "Cologne", "Frankfurt", "Hamburg", "Munich"]);
  // A city seen in the data but missing from the static table is still added.
  const withNewCity = countryOptionsFor(
    [{ location: { country: "Germany", city: "Leipzig" } }], cities
  )[0];
  assert.ok(withNewCity.cities.includes("Leipzig"));
});

test("a record with no country never matches a country filter, and never blocks one", () => {
  const noCountry = { title: "Online only", start: "2027-03-01", location: { country: null, city: null } };
  assert.equal(matchesCountry(noCountry, "Germany"), false);
  // With no country chosen, everything passes the country test.
  assert.equal(matchesCountry(noCountry, ""), true);
  assert.equal(matchesCountry(noCountry, "   "), true);
});
