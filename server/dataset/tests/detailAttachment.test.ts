// A detail list describes conferences; it does not create them, and it must not describe the wrong
// one. These tests cover the join and what the detail page is handed at the end of it.

import assert from "node:assert/strict";
import test from "node:test";
import { buildLaunchDataset, type DetailSupply, type StructuredOutcome } from "../build";
import { mapCuratedRow, rowsFromCsv } from "../sources/curated";
import { rowsFromDetailCsv } from "../sources/curatedDetails";
import { parseCsv } from "../sources/curated";
import { launchRecordToTabbedExtraction } from "../staticDataset";
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
