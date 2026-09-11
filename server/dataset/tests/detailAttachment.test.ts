// A detail list describes conferences; it does not create them, and it must not describe the wrong
// one. These tests cover the join and what the detail page is handed at the end of it.

import assert from "node:assert/strict";
import test from "node:test";
import { buildLaunchDataset, type DetailSupply, type StructuredOutcome } from "../build";
import { mapCuratedRow, rowsFromCsv } from "../sources/curated";
import { rowsFromDetailCsv } from "../sources/curatedDetails";
import { parseCsv } from "../sources/curated";
import { fillGapsFromLaunchRecord, launchRecordToTabbedExtraction } from "../staticDataset";
import type { LaunchConferenceRecord } from "../types";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

const CONFERENCES = [
  "Conference Name,Event Type,Dates,Location,Country,Region,Partner Organizations,Website,Keynote Speakers,Technical/Program Committee",
  "AAPG International Conference & Exhibition (ICE) 2026,Conference,7-9 December 2026,Jakarta,Indonesia,Asia,AAPG,https://iceevent.org/2026/,Not yet announced,Not yet announced",
  "GeoGulf 2027,Conference,18-20 April 2027,Houston,United States,North America,AAPG,https://gcags.org/,Not yet announced,Not yet announced",
].join("\n");

const DETAIL_HEADER =
  '"Conference Name","Dates","Venue","Program/Agenda","Keynote Speakers","Technical/Program Committee","Pricing/Registration","Sponsors/Exhibitors","Website","Regional Safety Note"';

const DETAILS = [
  DETAIL_HEADER,
  '"AAPG International Conference & Exhibition (ICE) 2026","7-9 December 2026","Nusantara International Convention Exhibition (NICE), Tangerang Regency, Indonesia","3-day program across 7 themes.","Metee Saengsrichun (PTTEP) - Deepwater Exploration; Claudio Nini (ENI)","Herman Darman (Pertamina), Karthikeyan (Shell)","Not extracted - registration portal blocks automated access.","Principal Sponsor & Host: Pertamina (PHE)","https://iceevent.org/2026/",""',
  '"GeoGulf 2027","18-20 April 2027","Houston, Texas","Regional conference; program not yet published.","Not yet announced","Not yet announced","Not yet published","Not yet announced","https://gcags.org/",""',
  '"A Conference Nobody Has Heard Of","1-2 May 2027","Somewhere","x","Not yet announced","Not yet announced","Not yet published","Not yet announced","https://example.org/",""',
].join("\n");

function build(detailCsv = DETAILS) {
  const structured: StructuredOutcome[] = rowsFromCsv(CONFERENCES).map((row) => ({
    outcome: mapCuratedRow(row, { ...OPTIONS, sourceName: "aapg-test", sourceUrl: row.website }),
    sourceUrl: row.website,
    statedText: row.name,
  }));
  const supplies: DetailSupply[] = [{ source: "aapg-test-details", rows: rowsFromDetailCsv(parseCsv(detailCsv)) }];
  return buildLaunchDataset([], OPTIONS, structured, supplies);
}

const find = (records: LaunchConferenceRecord[], starts: string) =>
  records.find((record) => record.title.startsWith(starts))!;

test("a detail row reaches the conference it names, and one that names nothing is reported", () => {
  const result = build();
  assert.equal(result.detailsAttached, 2);
  assert.deepEqual(result.detailsUnmatched, [
    { title: "A Conference Nobody Has Heard Of", reason: "no_conference_with_this_title" },
  ]);

  const ice = find(result.dataset.records, "AAPG International");
  assert.equal(ice.details?.source, "aapg-test-details");
  assert.deepEqual(ice.details?.keynotes.items.map((person) => person.name),
    ["Metee Saengsrichun", "Claudio Nini"]);
  assert.equal(ice.details?.venueName, "Nusantara International Convention Exhibition (NICE)");
});

test("a title that matches the wrong edition is refused rather than attached", () => {
  // Conference titles repeat across years. Attaching by title alone would file one edition's
  // programme under another's — the mistake a production sample made before the guard existed.
  const wrongYear = build([
    DETAIL_HEADER,
    '"AAPG International Conference & Exhibition (ICE) 2026","7-9 December 2027","Jakarta","x","Not yet announced","Not yet announced","Not yet published","Not yet announced","https://iceevent.org/2026/",""',
  ].join("\n"));
  assert.equal(wrongYear.detailsAttached, 0);
  assert.deepEqual(wrongYear.detailsUnmatched, [
    { title: "AAPG International Conference & Exhibition (ICE) 2026", reason: "dates_disagree_with_the_record" },
  ]);

  // A different month of the right year is refused too.
  const wrongMonth = build([
    DETAIL_HEADER,
    '"GeoGulf 2027","18-20 June 2027","Houston, Texas","x","Not yet announced","Not yet announced","Not yet published","Not yet announced","https://gcags.org/",""',
  ].join("\n"));
  assert.deepEqual(wrongMonth.detailsUnmatched.map((entry) => entry.reason), ["dates_disagree_with_the_record"]);
});

test("the detail page is told about each section separately", () => {
  const ice = find(build().dataset.records, "AAPG International");
  const payload = launchRecordToTabbedExtraction(ice) as any;

  assert.deepEqual(payload.sectionAvailability, {
    call_for_papers: "unread",
    program_agenda: "stated",
    keynote_speakers: "stated",
    technical_committee: "stated",
    sponsors_exhibitors: "stated",
    venue_accommodation: "stated",
    // The registration portal refused an automated reader. That is not "this conference is free"
    // and not "prices are not announced"; it is the one state that means look again.
    fees_pricing: "unread",
    community: "unread",
  });
  // The whole-record flag is only true when nothing at all was supplied, so a page with twelve
  // speakers on it can no longer announce that none of its sections were read.
  assert.equal(payload.sectionsNotRead, false);
  assert.deepEqual(payload.extraction_metadata.sections_not_read,
    ["call_for_papers", "fees_pricing", "community"]);

  assert.equal(payload.keynote_speakers.length, 2);
  assert.equal(payload.keynote_speakers[0].topic, "Deepwater Exploration");
  assert.equal(payload.technical_committee.length, 2);
  assert.equal(payload.sponsors_exhibitors[0].tier, "Principal Sponsor & Host");
  assert.equal(payload.program_agenda.overview, "3-day program across 7 themes.");
  // The cell the fees could not be read from is passed through, so the tab can say why.
  assert.match(payload.section_notes.fees_pricing, /blocks automated access/);
  // The same map reaches a later migration through the metadata, so both readers agree.
  assert.deepEqual(payload.extraction_metadata.section_availability, payload.sectionAvailability);
});

test("a conference nobody supplied details for still says so honestly", () => {
  const bare = build([DETAIL_HEADER].join("\n"));
  const payload = launchRecordToTabbedExtraction(find(bare.dataset.records, "GeoGulf")) as any;
  assert.equal(payload.sectionsNotRead, true);
  assert.equal(payload.detailsReady, false);
  assert.deepEqual(payload.keynote_speakers, []);
  assert.deepEqual(payload.section_notes, {});
});

test("a supplied section with nothing in it is not the same as one nobody supplied", () => {
  const geogulf = find(build().dataset.records, "GeoGulf");
  const payload = launchRecordToTabbedExtraction(geogulf) as any;
  // The list covered GeoGulf and said the organiser has announced nothing yet. That is a fact
  // about the conference, and it reads differently from "nobody looked".
  assert.equal(payload.sectionAvailability.keynote_speakers, "not_announced");
  assert.equal(payload.sectionAvailability.community, "unread");
  assert.equal(payload.sectionsNotRead, false);
});

test("a published record that has not been crawled deep keeps the curated sections", () => {
  // The regression this exists to stop. A record is published the moment its title, date and
  // country verify — long before anything reads its speakers page — and the detail route serves the
  // stored row in preference to the catalogue. Served alone it replaced a curated committee with an
  // empty tab, which is exactly the "(0) speakers" the whole project refuses to print.
  const ice = find(build().dataset.records, "AAPG International");
  const justPublished = {
    extracted: true,
    overview: { conference_name: "AAPG International Conference & Exhibition (ICE) 2026" },
    keynote_speakers: [],
    technical_committee: [],
    sponsors_exhibitors: [],
    program_agenda: { sessions: [] },
    fees_pricing: { registration_fees: [] },
    venue_accommodation: {},
    sectionAvailability: { keynote_speakers: "unread" },
  };

  const merged = fillGapsFromLaunchRecord(justPublished, ice) as any;
  assert.equal(merged.keynote_speakers.length, 2);
  assert.equal(merged.technical_committee.length, 2);
  assert.equal(merged.sponsors_exhibitors[0].tier, "Principal Sponsor & Host");
  assert.equal(merged.program_agenda.overview, "3-day program across 7 themes.");
  assert.equal(merged.venue_accommodation.venue_name, "Nusantara International Convention Exhibition (NICE)");
  // The tab state follows the content that arrived with it.
  assert.equal(merged.sectionAvailability.keynote_speakers, "stated");
  assert.equal(merged.sectionsNotRead, false);
  // And the payload says which tabs came from the list rather than a crawl.
  assert.deepEqual(merged.extraction_metadata.sections_filled_from_launch_dataset, [
    "keynote_speakers", "technical_committee", "sponsors_exhibitors", "program_agenda",
    "venue_accommodation",
  ]);
});

test("a crawled section is never overwritten by the curated one", () => {
  // The other direction, and the more important one: the conference's own pages outrank any list,
  // so anything already read stays exactly as it was read. Gaps are filled; values are not.
  const ice = find(build().dataset.records, "AAPG International");
  const crawled = {
    extracted: true,
    keynote_speakers: [{ name: "Someone The Site Actually Named", role: "Keynote" }],
    technical_committee: [],
    sponsors_exhibitors: [{ name: "A Sponsor The Site Listed", tier: "Gold" }],
    program_agenda: { sessions: [{ title: "Opening plenary" }] },
    fees_pricing: { registration_fees: [{ category: "Member", amount: 900, currency: "USD" }] },
    venue_accommodation: { venue_name: "A Venue The Site Named", address: "Somewhere" },
  };

  const merged = fillGapsFromLaunchRecord(crawled, ice) as any;
  assert.deepEqual(merged.keynote_speakers.map((p: any) => p.name), ["Someone The Site Actually Named"]);
  assert.deepEqual(merged.sponsors_exhibitors.map((s: any) => s.name), ["A Sponsor The Site Listed"]);
  assert.deepEqual(merged.program_agenda.sessions, [{ title: "Opening plenary" }]);
  assert.equal(merged.program_agenda.overview, undefined, "a read programme was given a list's prose");
  assert.equal(merged.fees_pricing.registration_fees[0].amount, 900);
  assert.equal(merged.venue_accommodation.venue_name, "A Venue The Site Named");
  // Only the one genuinely empty section was filled.
  assert.deepEqual(merged.extraction_metadata.sections_filled_from_launch_dataset, ["technical_committee"]);
});

test("a stored record with nothing to add back is returned untouched", () => {
  // No curated list covered this conference, so there is nothing to fill from and the stored row
  // must come back as the same object rather than a rebuilt one carrying invented metadata.
  const uncovered = find(build([DETAIL_HEADER].join("\n")).dataset.records, "GeoGulf");
  const stored = { extracted: true, keynote_speakers: [], technical_committee: [] };
  assert.equal(fillGapsFromLaunchRecord(stored, uncovered), stored);
});

test("a sentence that reports an absence is shown as one, not as the thing itself", () => {
  // "Regional conference; program not yet published." says two things, and only one of them is a
  // programme. It is not served as the programme — the tab says the organiser has not published one
  // — but the sentence survives so a reader can see what the source actually said.
  const geogulf = find(build().dataset.records, "GeoGulf");
  const payload = launchRecordToTabbedExtraction(geogulf) as any;
  assert.equal(payload.sectionAvailability.program_agenda, "not_announced");
  assert.equal(payload.program_agenda.overview, null);
  assert.equal(payload.section_notes.program_agenda, "Regional conference; program not yet published.");

  // Nothing is filled from it either, because there is nothing in it to fill with.
  const merged = fillGapsFromLaunchRecord({ extracted: true, keynote_speakers: [] }, geogulf) as any;
  assert.deepEqual(merged.keynote_speakers, []);
});

test("an absence phrase is never served as a programme or a price", () => {
  // A section whose cell says "Not yet announced as of 10 Sep 2026" has nothing to show, and the
  // phrase itself is not content. Passed through as prose it appeared in the Fees panel as though
  // it were a pricing note, and in the Program tab as though it were the programme.
  const csv = [
    DETAIL_HEADER,
    '"GeoGulf 2027","18-20 April 2027","Houston, Texas","Not yet announced as of 10 Sep 2026","Not yet announced","Not yet announced","Not yet announced as of 10 Sep 2026","Not yet announced","https://gcags.org/",""',
  ].join("\n");
  const payload = launchRecordToTabbedExtraction(find(build(csv).dataset.records, "GeoGulf")) as any;

  assert.equal(payload.program_agenda.overview, null);
  assert.equal(payload.fees_pricing.pricing_text, null);
  assert.equal(payload.sectionAvailability.program_agenda, "not_announced");
  assert.equal(payload.sectionAvailability.fees_pricing, "not_announced");
});

test("a section the source described in a sentence keeps that sentence as its content", () => {
  // Most conferences describe their sponsors and committee rather than listing them — "Exhibit and
  // sponsor program available", "Program committees and EDUCAUSE staff curate content" — and
  // nothing structures out of those without inventing organisations. The sentence IS the content,
  // and the page has to be able to tell it apart from an absence to show it as one.
  const csv = [
    DETAIL_HEADER,
    '"GeoGulf 2027","18-20 April 2027","Houston, Texas","Higher-ed IT strategy, cybersecurity and leadership sessions.","Featured speakers published by the organiser.","Program committees and staff curate content.","Not yet announced","Exhibit and sponsor program available.","https://gcags.org/",""',
  ].join("\n");
  const payload = launchRecordToTabbedExtraction(find(build(csv).dataset.records, "GeoGulf")) as any;

  for (const section of ["program_agenda", "keynote_speakers", "technical_committee", "sponsors_exhibitors"]) {
    assert.equal(payload.sectionAvailability[section], "stated", `${section} was read as an absence`);
    assert.ok(payload.section_notes[section], `${section} lost the sentence it was described in`);
  }
  // Structured lists stay empty rather than being invented out of the prose.
  assert.deepEqual(payload.keynote_speakers, []);
  assert.deepEqual(payload.sponsors_exhibitors, []);
  // The one that genuinely says nothing is still an absence.
  assert.equal(payload.sectionAvailability.fees_pricing, "not_announced");
});

test("shipping only described conferences holds back the rest rather than losing them", () => {
  // The catalogue ships only conferences whose tabs have something behind them, because a card
  // offering a Speakers chip for a conference nobody has described is a promise the detail page
  // cannot keep. What is held back is real, so the builder still reports how much.
  const described = build();
  const all = buildLaunchDataset(
    [],
    { ...OPTIONS },
    rowsFromCsv(CONFERENCES).map((row) => ({
      outcome: mapCuratedRow(row, { ...OPTIONS, sourceName: "aapg-test", sourceUrl: row.website }),
      sourceUrl: row.website,
      statedText: row.name,
    })),
    [{ source: "aapg-test-details", rows: rowsFromDetailCsv(parseCsv(DETAILS)) }]
  );
  assert.equal(all.withoutDetail, 0, "nothing is held back unless asked for");
  assert.equal(all.dataset.records.length, described.dataset.records.length);

  // ICE 2026 has a programme, speakers, a committee and sponsors; GeoGulf's every section says the
  // organiser has announced nothing yet, so only one of the two is shipped.
  const shipped = buildLaunchDataset(
    [],
    { ...OPTIONS, publishOnlyDescribed: true },
    rowsFromCsv(CONFERENCES).map((row) => ({
      outcome: mapCuratedRow(row, { ...OPTIONS, sourceName: "aapg-test", sourceUrl: row.website }),
      sourceUrl: row.website,
      statedText: row.name,
    })),
    [{ source: "aapg-test-details", rows: rowsFromDetailCsv(parseCsv(DETAILS)) }]
  );
  assert.deepEqual(shipped.dataset.records.map((record) => record.title), [
    "AAPG International Conference & Exhibition (ICE) 2026",
  ]);
  assert.equal(shipped.withoutDetail, 1);
  // The search index is built from what ships, not from what was held back.
  assert.equal(shipped.index.count, 1);
  assert.equal(shipped.index.entries.length, 1);
});
