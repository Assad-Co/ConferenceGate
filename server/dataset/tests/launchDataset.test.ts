import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchDataset, toCsv, buildSearchIndexEntry } from "../build";
import type { HarvestEvidence } from "../parseEvidence";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

function row(url: string, stated: string, org: string | null = null): HarvestEvidence {
  return { query: "q", title: "t", url, stated, org };
}

test("two sources describing one conference merge, keeping the official one", () => {
  const result = buildLaunchDataset(
    [
      row("https://10times.com/eage-annual", "EAGE Annual 2027, Amsterdam, Netherlands, 31 May - 3 June 2027"),
      row("https://eageannual.org/", "88th EAGE Annual Conference & Exhibition 2027, RAI Amsterdam, Amsterdam, Netherlands, 31 May - 3 June 2027", "EAGE"),
    ],
    OPTIONS
  );
  assert.equal(result.dataset.records.length, 1);
  assert.equal(result.duplicatesMerged, 1);
  const record = result.dataset.records[0];
  assert.equal(record.sourceType, "official_site");
  assert.equal(record.sourceUrl, "https://eageannual.org/");
  assert.equal(record.venue, "RAI Amsterdam");
  assert.deepEqual(record.corroboratingSourceUrls, ["https://10times.com/eage-annual"]);
});

test("a weaker source fills gaps but never overwrites what the stronger one stated", () => {
  const result = buildLaunchDataset(
    [
      row("https://example-conf.org/", "Example Congress 2027, Lisbon, Portugal, March 3-5, 2027"),
      row("https://10times.com/example", "Example Congress 2027, Wrong Venue Hall, Lisbon, Portugal, March 3-5, 2027", "Example Society"),
    ],
    OPTIONS
  );
  assert.equal(result.dataset.records.length, 1);
  const record = result.dataset.records[0];
  assert.equal(record.city, "Lisbon");
  // The official source named no venue and no organiser, so the listing's are taken as fills.
  assert.equal(record.venue, "Wrong Venue Hall");
  assert.equal(record.organization, "Example Society");
});

test("two editions of one series in different cities stay two records", () => {
  const result = buildLaunchDataset(
    [
      row("https://gartner.example/one", "Gartner Security Summit 2027, Mumbai, India, March 8-9, 2027"),
      row("https://gartner.example/two", "Gartner Security Summit 2027, Sydney, Australia, March 15-16, 2027"),
    ],
    OPTIONS
  );
  assert.equal(result.dataset.records.length, 2);
  assert.equal(result.duplicatesMerged, 0);
});

test("records are ordered soonest first and rejections are reported with a reason", () => {
  const result = buildLaunchDataset(
    [
      row("https://later.example/", "Later Conference 2027, Rome, Italy, December 1-3, 2027"),
      row("https://sooner.example/", "Sooner Conference 2027, Rome, Italy, January 5-7, 2027"),
      row("https://nodate.example/", "Undated Conference, Rome, Italy"),
    ],
    OPTIONS
  );
  assert.deepEqual(result.dataset.records.map((record) => record.title), [
    "Sooner Conference 2027",
    "Later Conference 2027",
  ]);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].reason, "no_date");
  assert.equal(result.rejections[0].sourceUrl, "https://nodate.example/");
});

test("the search index carries acronym, organiser, place and year in its haystack", () => {
  const result = buildLaunchDataset(
    [row("https://www.atce.org/", "SPE ATCE 2026 Annual Technical Conference and Exhibition, Houston, Texas, USA, October 21-23, 2026", "SPE")],
    OPTIONS
  );
  const entry = buildSearchIndexEntry(result.dataset.records[0]);
  for (const needle of ["spe", "atce", "houston", "united states", "north america", "2026"]) {
    assert.ok(entry.haystack.includes(needle), `haystack is missing ${needle}`);
  }
});

test("CSV output quotes cells containing commas and repeats no header", () => {
  const result = buildLaunchDataset(
    [row("https://example-conf.org/", "International Conference on Geology, Geophysics and Geochemistry, Paris, France, May 17-18, 2027")],
    OPTIONS
  );
  const csv = toCsv(result.dataset.records);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("id,title,acronym,"));
  assert.ok(lines[1].includes('"International Conference on Geology, Geophysics and Geochemistry"'));
});

test("rebuilding the same evidence produces the same identifiers", () => {
  const evidence = [row("https://example-conf.org/", "Example Congress 2027, Lisbon, Portugal, March 3-5, 2027")];
  const first = buildLaunchDataset(evidence, OPTIONS);
  const second = buildLaunchDataset(evidence, OPTIONS);
  assert.deepEqual(
    first.dataset.records.map((record) => record.id),
    second.dataset.records.map((record) => record.id)
  );
});
