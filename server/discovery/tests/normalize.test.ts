import { test } from "node:test";
import assert from "node:assert/strict";
import { findCountryInText, normalizeCountry } from "../countries";
import {
  canonicalizeUrl,
  cleanDescription,
  extractAcronym,
  extractEdition,
  normalizeDates,
  normalizeDeadlines,
  normalizeEventType,
  normalizeFormat,
  normalizeLocation,
  normalizeTitle,
} from "../normalize";
import { emptyRawExtraction } from "../types";

test("country aliases resolve to Conference Gate's own spelling", () => {
  for (const alias of ["USA", "U.S.", "United States of America", "us", "america"]) {
    assert.equal(normalizeCountry(alias)?.name, "United States", alias);
  }
  for (const alias of ["UK", "U.K.", "Great Britain", "England", "Scotland"]) {
    assert.equal(normalizeCountry(alias)?.name, "United Kingdom", alias);
  }
  for (const alias of ["UAE", "Emirates", "AE", "ARE"]) {
    assert.equal(normalizeCountry(alias)?.name, "United Arab Emirates", alias);
  }
  for (const alias of ["Republic of Korea", "Korea", "KR"]) {
    assert.equal(normalizeCountry(alias)?.name, "South Korea", alias);
  }
  assert.equal(normalizeCountry("Czech Republic")?.name, "Czechia");
  assert.equal(normalizeCountry("Türkiye")?.name, "Turkey");
  assert.equal(normalizeCountry("Deutschland")?.name, "Germany");
});

test("an unrecognised country resolves to nothing rather than a guess", () => {
  assert.equal(normalizeCountry("Freedonia"), null);
  // A two-letter token only resolves as an exact ISO code ("AT" is Austria's). Prose is read by
  // findCountryInText, which never matches on codes — so an ordinary "at" cannot become a country.
  assert.equal(findCountryInText("The workshop is held at the university"), null);
  assert.equal(normalizeCountry(""), null);
  assert.equal(normalizeCountry(null), null);
});

test("a country is found inside a longer location string", () => {
  assert.equal(findCountryInText("Doha, Qatar")?.name, "Qatar");
  assert.equal(findCountryInText("Austin, TX, USA")?.name, "United States");
  assert.equal(findCountryInText("Held at the Barbican Centre in London, United Kingdom")?.name, "United Kingdom");
  assert.equal(findCountryInText("Somewhere unspecified"), null);
});

test("regions carry through for global coverage reporting", () => {
  assert.equal(normalizeCountry("Kenya")?.region, "Africa");
  assert.equal(normalizeCountry("Brazil")?.region, "South America");
  assert.equal(normalizeCountry("Qatar")?.region, "Middle East");
  assert.equal(normalizeCountry("Australia")?.region, "Oceania");
});

test("format is only what the page said", () => {
  assert.equal(normalizeFormat("In-person"), "in_person");
  assert.equal(normalizeFormat("Fully virtual event"), "online");
  assert.equal(normalizeFormat("Hybrid"), "hybrid");
  assert.equal(normalizeFormat("online and in-person"), "hybrid");
  assert.equal(normalizeFormat(null, null), "unknown", "silence is never in-person");
  assert.equal(normalizeFormat("A conference about geoscience"), "unknown");
});

test("event types normalize into the controlled taxonomy, keeping the original wording", () => {
  assert.equal(normalizeEventType("9th International Congress on Water").eventType, "congress");
  assert.equal(normalizeEventType("Asia-Pacific Symposium on Robotics").eventType, "symposium");
  assert.equal(normalizeEventType("Global AI Summit 2027").eventType, "summit");
  assert.equal(normalizeEventType("Annual Meeting of the Society").eventType, "professional_meeting");
  assert.equal(normalizeEventType("Advanced Reservoir Modelling Workshop").eventType, "workshop");
  assert.equal(normalizeEventType("Hannover Trade Show").eventType, "exhibition");
  assert.equal(normalizeEventType("CPD accredited training day").eventType, "continuing_professional_development");
  const other = normalizeEventType("Open Day");
  assert.equal(other.eventType, "other");
  assert.equal(other.originalEventType, "Open Day", "the source's own wording is kept");
});

test("location splits into venue, city, region and country and preserves the raw string", () => {
  const raw = emptyRawExtraction("html");
  raw.locationText = "Doha Exhibition and Convention Center, Doha, Qatar";
  const location = normalizeLocation(raw);
  assert.equal(location.country, "Qatar");
  assert.equal(location.countryCode, "QA");
  assert.equal(location.city, "Doha");
  assert.equal(location.rawLocation, "Doha Exhibition and Convention Center, Doha, Qatar");
});

test("a US state abbreviation is resolved without eating the city", () => {
  const raw = emptyRawExtraction("html");
  raw.locationText = "Austin, TX, USA";
  const location = normalizeLocation(raw);
  assert.equal(location.city, "Austin");
  assert.equal(location.region, "Texas");
  assert.equal(location.country, "United States");
});

test('"Online" is not treated as a city', () => {
  const raw = emptyRawExtraction("html");
  raw.locationText = "Online";
  const location = normalizeLocation(raw);
  assert.equal(location.city, null);
  assert.equal(location.country, null);
  assert.equal(location.rawLocation, "Online");
});

test("event dates are taken from the event, never from a deadline row", () => {
  const raw = emptyRawExtraction("html");
  raw.importantDates = [
    { label: "Abstract submission deadline", text: "15 February 2027" },
    { label: "Conference dates", text: "12–14 September 2027" },
    { label: "Notification of acceptance", text: "30 April 2027" },
  ];
  const dates = normalizeDates(raw);
  assert.equal(dates.startDate, "2027-09-12");
  assert.equal(dates.endDate, "2027-09-14");
});

test("deadlines are sorted into their own separate fields", () => {
  const raw = emptyRawExtraction("html");
  raw.importantDates = [
    { label: "Abstract submission deadline", text: "30 September 2026" },
    { label: "Full paper submission", text: "10 January 2027" },
    { label: "Early bird registration", text: "20 December 2026" },
    { label: "Registration deadline", text: "1 February 2027" },
    { label: "Notification of acceptance", text: "15 November 2026" },
    { label: "Camera-ready version due", text: "1 February 2027" },
  ];
  const deadlines = normalizeDeadlines(raw, "2027-02-22");
  assert.equal(deadlines.abstractDeadline, "2026-09-30");
  assert.equal(deadlines.paperSubmissionDeadline, "2027-01-10");
  assert.equal(deadlines.earlyBirdDeadline, "2026-12-20");
  assert.equal(deadlines.registrationDeadline, "2027-02-01");
  assert.equal(deadlines.notificationDate, "2026-11-15");
  assert.equal(deadlines.cameraReadyDeadline, "2027-02-01");
});

test("a 'deadline' identical to the event's own start date is not stored as a deadline", () => {
  const raw = emptyRawExtraction("html");
  raw.importantDates = [{ label: "Registration deadline", text: "22 February 2027" }];
  assert.equal(normalizeDeadlines(raw, "2027-02-22").registrationDeadline, null);
});

test("descriptions are cleaned of boilerplate but not rewritten", () => {
  const cleaned = cleanDescription(
    "This site uses cookies. The 9th Gulf Conference on Water Desalination convenes engineers and utilities working on membrane technology across the Gulf region. All rights reserved."
  );
  assert.ok(cleaned);
  assert.ok(!cleaned!.includes("cookies"));
  assert.ok(!cleaned!.includes("All rights reserved"));
  assert.ok(cleaned!.includes("membrane technology"));
});

test("acronyms and editions come from the title, never from a count", () => {
  assert.equal(extractAcronym("33rd International Meeting on Organic Geochemistry (IMOG 2027)"), "IMOG");
  assert.equal(extractAcronym("International Meeting on Organic Geochemistry (IMOG)"), "IMOG");
  assert.equal(extractAcronym("ICSE 2027: International Conference on Software Engineering"), "ICSE");
  assert.equal(extractAcronym("A conference about water"), null);
  assert.equal(extractEdition("9th Gulf Conference on Water Desalination", null), "9");
  assert.equal(extractEdition("Gulf Conference on Water", null), null);
});

test("normalized titles collapse editions of one series", () => {
  assert.equal(
    normalizeTitle("The 33rd International Meeting on Organic Geochemistry 2027"),
    normalizeTitle("34th International Meeting on Organic Geochemistry 2029")
  );
});

test("canonical URLs strip tracking, www, trailing slashes and index pages", () => {
  assert.equal(canonicalizeUrl("https://WWW.Example.org/Event/index.html?utm_source=x&id=7"), "example.org/event?id=7");
  assert.equal(canonicalizeUrl("http://example.org/event/"), "example.org/event");
  assert.equal(canonicalizeUrl("not a url"), null);
});
