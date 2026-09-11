// A batch of two hundred conferences whose sources are mostly aggregators. Every assertion here is
// a row from that file, and most are rows that would have published something false at face value.

import assert from "node:assert/strict";
import test from "node:test";
import { isIndexHeader, mapIndexRow, readIndexCsv, rowsFromIndexCsv, suppliedLogoUrl } from "../sources/conferenceIndex";
import { siteIconUrl } from "../staticDataset";
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
  // The second revision's columns. Blank here, which is the first revision's shape and must keep
  // reading exactly as it did.
  sourceUrl: "", officialUrl: "", domainType: "", logoUrl: "", logoSourceType: "",
  cfpUrl: "", registrationUrl: "", programUrl: "", committeeUrl: "",
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

test("two ISO dates are a range, not a phrase that hides the end date", () => {
  // This shape states dates as start_date and end_date and never as prose. Copying the start date
  // into the dates phrase gave the page something to print, so it printed that — and every one of
  // these two hundred conferences showed a single day where the source had given three.
  const outcome = mapIndexRow(row({ startDate: "2027-02-17", endDate: "2027-02-19" }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.datesText, null, "a bare start date was stored as the dates phrase");
  assert.equal(outcome.record.startDate, "2027-02-17");
  assert.equal(outcome.record.endDate, "2027-02-19");
});

test("a later revision's resolved official site is used, and the listing it was found on is kept", () => {
  // The second revision of this batch went back and resolved each conference's own site, leaving
  // the directory behind in a column of its own. Both matter: the resolved site is where a reader
  // should be sent and what the engine should read, and the listing is where these dates were
  // actually stated — a record claiming the organiser's page said them would be wrong.
  const outcome = mapIndexRow(row({
    website: "https://www.iccfi.org/",
    sourceUrl: "https://www.iconf.com/conference?tags=Communication+Engineering",
    officialUrl: "https://www.iccfi.org/",
    domainType: "conference_owned_domain",
  }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.officialUrl, "https://www.iccfi.org/");
  assert.equal(outcome.record.sourceUrl, "https://www.iccfi.org/");
  assert.equal(outcome.record.sourceType, "official_site");
  assert.equal(outcome.record.provenance.dates.sourceUrl,
    "https://www.iconf.com/conference?tags=Communication+Engineering",
    "the dates were credited to a page that never stated them");
});

test("a column calling a URL official does not make it so", () => {
  // domain_type is the compiler's finding, and a finding is screened rather than believed. Thirty-
  // six of these rows resolve to an entry in a publisher's event index; it is the best page there
  // is for that conference and worth linking, but it is not the conference's own site, so nothing
  // may take a logo from the publisher's domain.
  const outcome = mapIndexRow(row({
    website: "", sourceUrl: "https://www.elsevier.com/events/conferences/all",
    officialUrl: "https://www.elsevier.com/events/conferences/all/food-chemistry-conference",
    domainType: "conference_owned_domain",
  }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(siteIconUrl(outcome.record.officialUrl), null, "a publisher's icon became a conference's logo");

  // And a row that resolved nothing keeps the listing as its source, rather than being refused.
  const unresolved = mapIndexRow(row({
    website: "", officialUrl: "", domainType: "listing_only_unresolved",
    sourceUrl: "https://www.iconf.com/conference?tags=Mechanical+Engineering",
  }), OPTIONS);
  assert.equal(unresolved.ok, true);
  if (!unresolved.ok) return;
  assert.equal(unresolved.record.officialUrl, null);
  assert.equal(unresolved.record.sourceUrl, "https://www.iconf.com/conference?tags=Mechanical+Engineering");
});

test("a favicon service's URL is not a logo the source supplied", () => {
  // Every logo_url in this revision is Google's favicon service pointed at the resolved domain, and
  // the file says so itself in logo_source_type. It is not the organiser's image, and taking it
  // would put a request to a third party on the page for every card a reader scrolls past — for an
  // icon this catalogue already derives from the organiser's own server.
  assert.equal(suppliedLogoUrl("https://www.google.com/s2/favicons?domain=www.iccfi.org&sz=256",
    "official-domain favicon fallback"), null);
  assert.equal(suppliedLogoUrl("https://www.google.com/s2/favicons?domain=x.org&sz=256", ""), null);
  assert.equal(suppliedLogoUrl("https://icons.duckduckgo.com/ip3/x.org.ico", ""), null);
  assert.equal(suppliedLogoUrl("", ""), null);
  assert.equal(suppliedLogoUrl("Not yet announced", ""), null);

  // An image the organiser actually publishes is a fact, and is kept.
  assert.equal(
    suppliedLogoUrl("https://www.iccfi.org/images/logo.png", "organiser logo"),
    "https://www.iccfi.org/images/logo.png"
  );
  const outcome = mapIndexRow(row({
    website: "https://www.iccfi.org/", officialUrl: "https://www.iccfi.org/",
    logoUrl: "https://www.iccfi.org/images/logo.png", logoSourceType: "organiser logo",
  }), OPTIONS);
  if (outcome.ok) assert.equal(outcome.record.logoUrl, "https://www.iccfi.org/images/logo.png");
});

test("a page the source named for a section is carried to that section", () => {
  const outcome = mapIndexRow(row({
    website: "https://www.iccfi.org/", officialUrl: "https://www.iccfi.org/",
    cfpUrl: "https://www.iccfi.org/cfp", registrationUrl: "https://www.iccfi.org/register",
  }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.details!.callForPapers!.url, "https://www.iccfi.org/cfp");
  assert.equal(outcome.record.details!.registrationUrl, "https://www.iccfi.org/register");
});
