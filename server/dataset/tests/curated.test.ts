// A curated list looks authoritative in every cell, including the cells that state an absence.

import assert from "node:assert/strict";
import test from "node:test";
import {
  mapCuratedRow, parseCuratedDates, rowsFromCsv, splitCuratedLocation, statedOrNull,
  usableAsOfficialUrl,
} from "../sources/curated";

const OPTIONS = {
  years: [2026, 2027, 2028],
  horizonStart: "2026-09-01",
  sourceName: "aapg-2026-2027",
  sourceUrl: "curated:aapg-2026-2027",
} as any;

const row = (over: Partial<Record<string, string>> = {}) => ({
  name: "5th Edition Stratigraphic Traps of the Middle East",
  eventType: "Workshop (GTW)",
  dates: "23-25 November 2026",
  location: "Manama",
  country: "Bahrain",
  region: "Middle East",
  partners: "AAPG",
  website: "https://www.aapg.org/event-details/5th-edition-stratigraphic-traps-of-the-middle-east/",
  keynoteSpeakers: "Not yet announced",
  committee: "Not yet announced (see event brochure)",
  ...over,
});

test('"Not yet announced" is an absence, not a value', () => {
  // Every one of these is a real cell from the supplied list. A tidy spreadsheet makes this
  // mistake easier than a scraped page does, because the cell is neatly filled in.
  for (const stated of [
    "Not yet announced", "Not yet announced (see event brochure)", "TBD", "TBA", "N/A",
    "To be confirmed", "to be determined", "  ",
  ]) {
    assert.equal(statedOrNull(stated), null, `${JSON.stringify(stated)} was stored as a value`);
  }
  // And a real value survives untouched, including one that merely starts with a similar word.
  assert.equal(statedOrNull("Nottingham"), "Nottingham");
  assert.equal(statedOrNull("AAPG, EAGE"), "AAPG, EAGE");
});

test("a month-only date never invents a day", () => {
  assert.deepEqual(parseCuratedDates("May 2027"), {
    startDate: null, endDate: null, startYear: 2027, startMonth: 5, precision: "month",
  });
  // "Venecon 2027, June 2027" must not become the first of June.
  assert.equal(parseCuratedDates("June 2027").startDate, null);

  assert.deepEqual(parseCuratedDates("2-3 September 2026"), {
    startDate: "2026-09-02", endDate: "2026-09-03", startYear: 2026, startMonth: 9, precision: "day",
  });
  assert.deepEqual(parseCuratedDates("12-16 September 2026").endDate, "2026-09-16");
  assert.equal(parseCuratedDates("").precision, null);
  assert.equal(parseCuratedDates("sometime next spring").precision, null);
});

test("a venue in the location cell stays a venue", () => {
  // "Barceló México Reforma" is a hotel. Filed as a city it puts a hotel in the location filter.
  assert.deepEqual(splitCuratedLocation("Mexico City (Barceló México Reforma)"),
    { city: "Mexico City", venue: "Barceló México Reforma" });
  assert.deepEqual(splitCuratedLocation("Stillwater, Oklahoma State University"),
    { city: "Stillwater", venue: "Oklahoma State University" });
  assert.deepEqual(splitCuratedLocation("Manama"), { city: "Manama", venue: null });
  assert.deepEqual(splitCuratedLocation("TBD"), { city: null, venue: null });
});

test("a society's events calendar is where the conference was found, not where it lives", () => {
  // Three rows of the supplied list point here. It is the society's calendar of all its events.
  assert.equal(usableAsOfficialUrl("https://www.aapg.org/events/calendar/"), false);
  assert.equal(usableAsOfficialUrl("https://example.org/events/"), false);
  assert.equal(usableAsOfficialUrl("https://10times.com/some-conference"), false);
  // A conference's own page on the same society domain is fine.
  assert.equal(usableAsOfficialUrl(
    "https://www.aapg.org/event-details/5th-edition-stratigraphic-traps-of-the-middle-east/"), true);
  assert.equal(usableAsOfficialUrl("https://iceevent.org/2026/"), true);

  const calendarRow = mapCuratedRow(
    row({ name: "AAPG Eastern Section Annual Meeting 2026", dates: "26-27 October 2026",
          location: "Canonsburg", country: "United States",
          website: "https://www.aapg.org/events/calendar/" }),
    OPTIONS
  );
  assert.equal(calendarRow.ok, true, "the conference is real and must still be kept");
  if (calendarRow.ok) {
    assert.equal(calendarRow.record.officialUrl, null, "a calendar was stored as the official site");
    assert.equal(calendarRow.record.sourceUrl, "https://www.aapg.org/events/calendar/");
  }
});

test("a place the source says is undecided is not the same as a place it forgot to state", () => {
  // A conference needs a place to be worth listing — a reader filtering by Germany must not be
  // handed events that might be anywhere. But "TBD" is the organiser saying the venue is not chosen
  // yet, which is a fact about a real conference with real dates, and refusing on it dropped AAPG's
  // Geological Process-Based Forward Modeling out of the catalogue altogether.
  const undecided = mapCuratedRow(
    row({ name: "3rd Edition Geological Process-Based Forward Modeling", dates: "May 2027",
          location: "TBD", country: "TBD", region: "TBD",
          website: "https://www.aapg.org/event-details/3rd-edition-geological-process-based-forward-modeling/" }),
    OPTIONS
  );
  assert.equal(undecided.ok, true);
  if (undecided.ok) {
    // Kept, and still empty-handed about where it is. Nothing is guessed to fill the columns.
    assert.equal(undecided.record.city, null);
    assert.equal(undecided.record.country, null);
    assert.equal(undecided.record.countryCode, null);
    assert.equal(undecided.record.worldRegion, null);
    assert.ok(undecided.record.officialUrl, "kept only because it carries the conference's own page");
  }

  // An empty cell is a gap in the list, not a statement about the conference, and is still refused.
  const blank = mapCuratedRow(
    row({ location: "", country: "", region: "", website: "https://example.org/some-conference/" }),
    OPTIONS
  );
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.equal(blank.reason, "no_location");

  // And a stated "TBD" with no page of its own gives a reader nowhere to go for the place we do
  // not have, so it is refused too.
  const noPage = mapCuratedRow(
    row({ location: "TBD", country: "TBD", website: "https://www.aapg.org/events/calendar/" }),
    OPTIONS
  );
  assert.equal(noPage.ok, false);
  if (!noPage.ok) assert.equal(noPage.reason, "no_location");
});

test("a well-formed row keeps exactly what the list stated", () => {
  const outcome = mapCuratedRow(row(), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const record = outcome.record;

  assert.equal(record.startDate, "2026-11-23");
  assert.equal(record.endDate, "2026-11-25");
  assert.equal(record.city, "Manama");
  assert.equal(record.country, "Bahrain");
  assert.equal(record.countryCode, "BH");
  assert.equal(record.organization, "AAPG");
  assert.equal(record.datesText, "23-25 November 2026");
  assert.ok(record.officialUrl);
  assert.equal(record.origin, "launch_dataset");
  // The world region is derived from the validated country, never taken from the sheet's own
  // "Region" column — that column says "Middle East", which is the society's grouping.
  assert.equal(record.worldRegion, "Middle East");
});

test("the supplied file parses, quoted commas and all", () => {
  const csv = [
    "Conference Name,Event Type,Dates,Location,Country,Region,Partner Organizations,Website,Keynote Speakers,Technical/Program Committee",
    '5th Edition AAPG/EAGE Hydrocarbon Seals GTW,GTW,28-30 September 2026,Kuwait City,Kuwait,Middle East,"AAPG, EAGE",https://example.org/gtw/,Not yet announced,Not yet announced',
  ].join("\n");
  const rows = rowsFromCsv(csv);
  assert.equal(rows.length, 1);
  // The quoted field holds a comma and must not have split into two columns.
  assert.equal(rows[0].partners, "AAPG, EAGE");
  assert.equal(rows[0].website, "https://example.org/gtw/");
});

test("an index of many conferences is never one conference's own page", () => {
  // Both of these reached a reader as the conference's own website. Gastech 2026's card linked to
  // a trade magazine's events calendar, and the 20th Vaccine Congress's to a list of every
  // conference its publisher runs — each marked as the organiser's page, which is what makes it
  // worse than an ordinary bad link.
  assert.equal(usableAsOfficialUrl("https://www.rogtecmagazine.com/events-calendar/"), false);
  assert.equal(usableAsOfficialUrl("https://www.elsevier.com/en-gb/events/conferences/all"), false);
  assert.equal(usableAsOfficialUrl("https://www.siggraph.org/siggraph-events/conferences/"), false);
  assert.equal(usableAsOfficialUrl("https://example.org/events/upcoming"), false);
  assert.equal(usableAsOfficialUrl("https://example.org/conference-listings"), false);

  // A page about one conference on that same publisher's site is still that conference's page.
  assert.equal(usableAsOfficialUrl("https://www.elsevier.com/events/conferences/all/food-chemistry-conference"), true);
  // And a conference's own site is untouched, year segment and all.
  assert.equal(usableAsOfficialUrl("https://www.adipec.com/"), true);
  assert.equal(usableAsOfficialUrl("https://iceevent.org/2026/"), true);
  assert.equal(usableAsOfficialUrl("https://www.blackhat.com/us-26/"), true);
});
