import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRIES,
  countriesInRegion,
  findCountryInText,
  normalizeCountry,
  regionForCountry,
  worldwideCountryNames,
} from "../countries";

test("worldwide geography covers sovereign states and major conference territories", () => {
  // 195 sovereign states plus independently represented conference territories/economies.
  assert.ok(COUNTRIES.length >= 210, `expected worldwide coverage, got ${COUNTRIES.length}`);
  for (const name of [
    "Saudi Arabia",
    "United Arab Emirates",
    "United States",
    "Brazil",
    "Nigeria",
    "Kazakhstan",
    "Papua New Guinea",
    "Timor-Leste",
    "Hong Kong",
    "Macao",
    "Puerto Rico",
  ]) {
    assert.ok(normalizeCountry(name), name);
  }
});

test("common global aliases resolve to one canonical country", () => {
  const cases: Array<[string, string]> = [
    ["KSA", "Saudi Arabia"],
    ["UAE", "United Arab Emirates"],
    ["U.S.A.", "United States"],
    ["UK", "United Kingdom"],
    ["Türkiye", "Turkey"],
    ["Ivory Coast", "Côte d'Ivoire"],
    ["Macao SAR", "Macao"],
    ["Macau", "Macao"],
    ["DPRK", "North Korea"],
    ["Republic of Korea", "South Korea"],
    ["Cape Verde", "Cabo Verde"],
    ["Swaziland", "Eswatini"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeCountry(input)?.name, expected, input);
  }
});

test("country detection works inside conference location prose", () => {
  assert.equal(findCountryInText("Riyadh Front, Riyadh, KSA")?.name, "Saudi Arabia");
  assert.equal(findCountryInText("Dubai World Trade Centre | UAE")?.name, "United Arab Emirates");
  assert.equal(findCountryInText("Abidjan, Côte d’Ivoire")?.name, "Côte d'Ivoire");
  assert.equal(findCountryInText("Macao SAR, China")?.name, "Macao");
});

test("regional lookup is canonical and broad", () => {
  assert.equal(regionForCountry("Bahrain"), "Middle East");
  assert.equal(regionForCountry("Brazil"), "South America");
  assert.equal(regionForCountry("New Zealand"), "Oceania");
  assert.ok(countriesInRegion("Africa").length >= 50);
  assert.ok(countriesInRegion("Europe").some((country) => country.name === "Portugal"));
});

test("worldwide country names are unique and sorted", () => {
  const names = worldwideCountryNames();
  assert.equal(names.length, new Set(names).size);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
