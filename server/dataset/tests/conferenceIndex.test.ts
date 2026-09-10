// A batch of two hundred conferences whose sources are mostly aggregators. Every assertion here is
// a row from that file, and most are rows that would have published something false at face value.

import assert from "node:assert/strict";
import test from "node:test";
import { isIndexHeader, mapIndexRow, readIndexCsv, rowsFromIndexCsv } from "../sources/conferenceIndex";
import { parseCsv, usableAsOfficialUrl } from "../sources/curated";

const OPTIONS = {
  retrievedAt: "2026-09-10", horizonStart: "2026-09-10", years: [2026, 2027, 2028],
  sourceName: "conferencegate-200",
};

const HEADER =
  "conference_name,acronym,category,sub_category,start_date,end_date,city,country,format,overview,"
  + "call_for_papers,cfp_deadline,fees_and_pricing,program_agenda,keynote_speakers,"
  + "technical_committee,sponsors,venue,accommodation,organizer,website_or_source,record_status,"
  + "data_quality_notes";

const ABSENT = "Not yet announced as of 10 Sep 2026";

const row = (over: Partial<Record<string, string>> = {}) => ({
  name: "2026 10th International Conference on Communications and Future Internet",
  acronym: "ICCFI 2026", category: "Technology", subCategory: "Communications & Future Internet",
  startDate: "2026-10-19", endDate: "2026-10-21", city: "Paris", country: "France",
  format: "In-person", overview: "International conference focused on communications & future internet.",
  callForPapers: "Call for papers / abstract submissions published.", cfpDeadline: "2026-06-10",
  fees: ABSENT, program: ABSENT, keynoteSpeakers: ABSENT, committee: ABSENT, sponsors: ABSENT,
  venue: "Paris, France", accommodation: ABSENT, organizer: ABSENT,
  website: "https://www.iconf.com/conference/ICCMB2027_9677",
  recordStatus: "DISCOVERY VERIFIED", qualityNotes: "Actual conference name taken from the cited source.",
  ...over,
});

test("a filtered search on a listing site is never a conference's website", () => {
  // Forty-six rows cite a URL like this. It returns whatever carries that tag today and describes
  // no conference in particular, so calling it the organiser's own page sends a reader to a list.
  assert.equal(usableAsOfficialUrl("https://www.iconf.com/conference?tags=Communication+Engineering"), false);
  // And the host is a listing site whatever the path, so even its per-event page is not official.
  assert.equal(usableAsOfficialUrl("https://www.iconf.com/conference/ICCMB2027_9677"), false);
  // A conference's own site still is.
  assert.equal(usableAsOfficialUrl("https://www.blackhat.com/us-26/"), true);

  const outcome = mapIndexRow(row(), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.officialUrl, null, "a listing was stored as the conference's website");
  assert.equal(outcome.record.sourceType, "directory_listing");
  // It is still kept as where the conference was found.
  assert.equal(outcome.record.sourceUrl, "https://www.iconf.com/conference/ICCMB2027_9677");
});

test("a row calling itself OFFICIAL VERIFIED while citing an aggregator is not official", () => {
  // Twenty-two rows claim official verification and a hundred and thirteen cite an aggregator.
  // Both cannot be true of one page, so the claim that can be checked is the one that counts.
  const claimed = mapIndexRow(row({ recordStatus: "OFFICIAL VERIFIED" }), OPTIONS);
  assert.equal(claimed.ok, true);
  if (claimed.ok) {
    assert.equal(claimed.record.sourceType, "directory_listing");
    assert.equal(claimed.record.officialUrl, null);
    // The compiler's own claim survives on the evidence, as what they believed.
    assert.equal(claimed.record.evidence.externalId, "OFFICIAL VERIFIED");
  }

  const real = mapIndexRow(
    row({ website: "https://www.blackhat.com/us-26/", recordStatus: "Discovery index" }),
    OPTIONS
  );
  assert.equal(real.ok, true);
  if (real.ok) {
    assert.equal(real.record.sourceType, "official_site");
    assert.equal(real.record.officialUrl, "https://www.blackhat.com/us-26/");
  }
});

test("a conference nobody has dated is refused rather than parked at an invented date", () => {
  // Fifteen rows name a real conference — COP31, the World Health Summit — with no date at all. A
  // catalogue is ordered and filtered by date, so a record with none cannot take a place in it.
  const undated = mapIndexRow(row({ name: "World Health Summit 2026", startDate: "", endDate: "" }), OPTIONS);
  assert.equal(undated.ok, false);
  if (!undated.ok) assert.equal(undated.reason, "no_start_date");

  // A month is enough to place it; a bare year is not.
  const monthOnly = mapIndexRow(row({ name: "UN Climate Change Conference COP32", startDate: "2027-11", endDate: "" }), OPTIONS);
  assert.equal(monthOnly.ok, true);
  if (monthOnly.ok) {
    assert.equal(monthOnly.record.startDate, null, "a month was turned into the first of that month");
    assert.equal(monthOnly.record.datePrecision, "month");
    assert.equal(monthOnly.record.year, 2027);
  }
  const yearOnly = mapIndexRow(row({ name: "ICLR 2027", startDate: "2027", endDate: "" }), OPTIONS);
  assert.equal(yearOnly.ok, false);
});

test("the venue column holding a city does not put a city in the venue field", () => {
  const outcome = mapIndexRow(row({ venue: "Paris, France", city: "Paris" }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.record.venue, null);

  const real = mapIndexRow(
    row({ venue: "University of Applied Sciences and Arts Northwestern Switzerland, Basel", city: "Basel" }),
    OPTIONS
  );
  assert.equal(real.ok, true);
  if (real.ok) {
    assert.equal(real.record.venue, "University of Applied Sciences and Arts Northwestern Switzerland");
  }
});

test("this batch's way of saying nothing is recognised as nothing", () => {
  // "Not yet announced as of 10 Sep 2026" appears 1,059 times. Stored as a value it would be the
  // most common speaker, sponsor and price in the catalogue.
  const outcome = mapIndexRow(row(), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const details = outcome.record.details!;
  for (const section of [details.keynotes, details.committee, details.sponsors, details.fees]) {
    assert.deepEqual(section.items, []);
    assert.equal(section.availability, "not_announced");
  }
  assert.equal(details.program.availability, "not_announced");
  assert.equal(outcome.record.organization, null);

  // And the other phrasings this file uses.
  const other = mapIndexRow(row({ keynoteSpeakers: "To be announced.", committee: "Not captured.", fees: "Pricing pending." }), OPTIONS);
  if (other.ok) {
    assert.equal(other.record.details!.keynotes.availability, "not_announced");
    assert.equal(other.record.details!.committee.availability, "not_announced");
    assert.equal(other.record.details!.fees.availability, "not_announced");
  }
});

test("a call for papers stated in its own columns beats reading it out of the programme", () => {
  const outcome = mapIndexRow(row(), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const cfp = outcome.record.details!.callForPapers!;
  assert.equal(cfp.abstractDeadline, "2026-06-10");
  assert.equal(cfp.status, "Open");
  assert.equal(cfp.text, "Call for papers / abstract submissions published.");

  // With nothing stated in either place, the section is absent rather than an empty shell.
  const none = mapIndexRow(row({ callForPapers: ABSENT, cfpDeadline: ABSENT, program: ABSENT }), OPTIONS);
  if (none.ok) assert.equal(none.record.details!.callForPapers, null);
});

test("a committee written as headings and bare names becomes a committee", () => {
  const outcome = mapIndexRow(
    row({ committee: "Advisory: Osamu Tabata; Arcady Zhukov. Conference Chair: Akihiko Fujiwara." }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(
    outcome.record.details!.committee.items.map((person) => [person.name, person.role]),
    [["Osamu Tabata", "Advisory"], ["Arcady Zhukov", "Advisory"], ["Akihiko Fujiwara", "Conference Chair"]]
  );
});

test("sponsors written as prose are shown as prose rather than split into invented names", () => {
  // "Sponsored by SAISE and University of Applied Sciences and Arts Northwestern Switzerland"
  // splits on " and " into two organisations that do not exist. The sentence is kept instead.
  const cell = "Sponsored by SAISE and University of Applied Sciences and Arts Northwestern Switzerland; "
    + "assisted by Hosei University and University of Macau.";
  const outcome = mapIndexRow(row({ sponsors: cell }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.record.details!.sponsors.items, []);
  assert.equal(outcome.record.details!.sponsors.text, cell);
  assert.equal(outcome.record.details!.sponsors.availability, "stated");
});

test("the header decides which reader gets a file", () => {
  // Both shapes live in data/sources, and the older one is read by column position — so a file of
  // this shape handed to it would file a category as a date rather than fail.
  assert.equal(isIndexHeader(parseCsv(HEADER)[0]), true);
  assert.equal(
    isIndexHeader(["Conference Name", "Event Type", "Dates", "Location", "Country"]),
    false
  );
  // A byte-order mark on the first column must not hide it.
  assert.equal(isIndexHeader(["﻿conference_name", "start_date", "website_or_source", "record_status"]), true);
});

test("the supplied file reads end to end, and reports what it refused", () => {
  const csv = [
    HEADER,
    `"Real Conference 2027",RC27,Tech,Sub,2027-03-01,2027-03-03,Basel,Switzerland,In-person,"An overview.","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}",Basel,"${ABSENT}","${ABSENT}",https://realconf.example/2027/,"OFFICIAL VERIFIED","Notes."`,
    `"Undated Conference 2027",UC27,Tech,Sub,,,Basel,Switzerland,In-person,"An overview.","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}","${ABSENT}",Basel,"${ABSENT}","${ABSENT}",https://example.org/,"Discovery index","Notes."`,
  ].join("\n");

  const rows = rowsFromIndexCsv(parseCsv(csv));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].acronym, "RC27");

  const { records, refused } = readIndexCsv(csv, OPTIONS);
  assert.deepEqual(records.map((record) => record.title), ["Real Conference 2027"]);
  assert.deepEqual(refused, [{ title: "Undated Conference 2027", reason: "no_start_date" }]);
  assert.equal(records[0].officialUrl, "https://realconf.example/2027/");
  assert.equal(records[0].details?.source, "conferencegate-200");
});
