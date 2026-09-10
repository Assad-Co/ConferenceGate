// Three conferences found on one society calendar are three conferences.
//
// The supplied AAPG list gives `https://www.aapg.org/events/calendar/` as the website for three of
// its rows, because that listing is the only page the society published for them. The dataset
// builder is right to refuse it as their official URL, and the record keeps it as provenance —
// which left three records sharing one link. Search treated a repeated link as proof of a repeated
// conference and returned one of the three: "Energy Opportunities Conference 2027" and
// "Venecon 2027" disappeared from Discover and from the browse view entirely.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLaunchDataset, type StructuredOutcome } from "../build";
import { mapCuratedRow, rowsFromCsv } from "../sources/curated";
import {
  findLaunchRecordByUrl, LAUNCH_DATASET_FILE, LAUNCH_INDEX_FILE, resetLaunchDatasetCache,
  urlIdentifiesOneLaunchRecord,
} from "../staticDataset";
import { browseStoredConferences, searchConferences } from "../../braveSearch";

const CALENDAR = "https://www.aapg.org/events/calendar/";
const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

// Verbatim shape of the supplied list, including the three rows that name only the calendar.
const CSV = [
  "Conference Name,Event Type,Dates,Location,Country,Region,Partner Organizations,Website,Keynote Speakers,Technical/Program Committee",
  `AAPG Eastern Section Annual Meeting 2026,Section Meeting,26-27 October 2026,Canonsburg,United States,North America,AAPG,${CALENDAR},Not yet announced,Not yet announced`,
  `Energy Opportunities Conference 2027,Conference,18-19 May 2027,Cartagena,Colombia,Latin America,AAPG,${CALENDAR},Not yet announced,Not yet announced`,
  `Suriname Technical Symposium 2026,Symposium,18-19 November 2026,Paramaribo,Suriname,Latin America,AAPG,https://www.aapg.org/event-details/suriname-technical-symposium-2026/,Not yet announced,Not yet announced`,
].join("\n");

const structured: StructuredOutcome[] = rowsFromCsv(CSV).map((row) => ({
  outcome: mapCuratedRow(row, { ...OPTIONS, sourceName: "aapg-test", sourceUrl: row.website }),
  sourceUrl: row.website,
  statedText: [row.name, row.dates, row.location, row.country].join(", "),
}));

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-sourced-"));
const built = buildLaunchDataset([], OPTIONS, structured);
fs.writeFileSync(path.join(directory, LAUNCH_DATASET_FILE), JSON.stringify(built.dataset));
fs.writeFileSync(path.join(directory, LAUNCH_INDEX_FILE), JSON.stringify(built.index));
process.env.LAUNCH_DATASET_DIR = directory;
resetLaunchDatasetCache();

test("the calendar is kept as provenance and refused as the conference's own page", () => {
  const onTheCalendar = built.dataset.records.filter((record) => record.sourceUrl === CALENDAR);
  assert.equal(onTheCalendar.length, 2, "both calendar-sourced rows must survive the build");
  for (const record of onTheCalendar) {
    assert.equal(record.officialUrl, null, "a calendar of every event was stored as one event's site");
  }
});

test("two conferences sharing a calendar URL both reach the reader", async () => {
  const results = await searchConferences("AAPG");
  const titles = results.map((result) => result.title);
  assert.ok(titles.includes("AAPG Eastern Section Annual Meeting 2026"), titles.join(" | "));
  assert.ok(
    titles.includes("Energy Opportunities Conference 2027"),
    `the second conference on the shared calendar was dropped: ${titles.join(" | ")}`
  );
});

test("browsing lists them too, since the browse view dedupes the same way", async () => {
  const titles = (await browseStoredConferences(60)).map((result) => result.title);
  assert.ok(titles.includes("Energy Opportunities Conference 2027"), titles.join(" | "));
});

test("a conference with its own page is still deduplicated by that page", async () => {
  // The rule only loosens where the link says nothing about identity. A record whose link IS its
  // own page must still collapse with a second row carrying the same page, or one conference
  // published twice would be shown twice.
  const results = await searchConferences("Suriname");
  const suriname = results.filter((result) => result.title.startsWith("Suriname Technical Symposium"));
  assert.equal(suriname.length, 1);
  assert.equal(suriname[0].linkIsConferencePage, true);
});

test("opening one of them shows that one, not whichever was read from the file last", () => {
  // Keying the detail page on the URL alone kept a single record per URL, so two of the three
  // conferences on this calendar opened a third conference's page — a reader clicking
  // "Energy Opportunities Conference 2027" read about the Eastern Section meeting.
  assert.equal(urlIdentifiesOneLaunchRecord(CALENDAR), false);

  const energy = findLaunchRecordByUrl(CALENDAR, "Energy Opportunities Conference 2027");
  assert.equal(energy?.title, "Energy Opportunities Conference 2027");
  assert.equal(energy?.country, "Colombia");

  const eastern = findLaunchRecordByUrl(CALENDAR, "AAPG Eastern Section Annual Meeting 2026");
  assert.equal(eastern?.title, "AAPG Eastern Section Annual Meeting 2026");
  assert.equal(eastern?.country, "United States");
});

test("an ambiguous URL with no title names no conference rather than an arbitrary one", () => {
  assert.equal(findLaunchRecordByUrl(CALENDAR), null);
  assert.equal(findLaunchRecordByUrl(CALENDAR, "A conference that is not on this calendar"), null);

  // A URL belonging to exactly one conference still opens without a title, as every other record
  // in the catalogue does.
  const own = "https://www.aapg.org/event-details/suriname-technical-symposium-2026/";
  assert.equal(urlIdentifiesOneLaunchRecord(own), true);
  assert.equal(findLaunchRecordByUrl(own)?.country, "Suriname");
});
