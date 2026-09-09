import test from "node:test";
import assert from "node:assert/strict";
import { parseHarvestEvidence, splitTitleParts, classifySource } from "../parseEvidence";
import type { HarvestEvidence } from "../parseEvidence";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

function evidence(overrides: Partial<HarvestEvidence>): HarvestEvidence {
  return {
    query: "test query",
    title: "Result title",
    url: "https://example-conference.org/",
    stated: "",
    org: null,
    ...overrides,
  };
}

test("reads title, dates, city, country and venue out of one stated sentence", () => {
  const outcome = parseHarvestEvidence(
    evidence({
      url: "https://www.aiche.org/conferences/aiche-annual-meeting/2027",
      stated:
        "2027 AIChE Annual Meeting, San Diego Convention Center, San Diego, CA, USA, October 31 - November 4, 2027",
      org: "AIChE",
    }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const record = outcome.record;
  assert.equal(record.title, "2027 AIChE Annual Meeting");
  assert.equal(record.venue, "San Diego Convention Center");
  assert.equal(record.city, "San Diego");
  assert.equal(record.region, "CA");
  assert.equal(record.country, "United States");
  assert.equal(record.countryCode, "US");
  assert.equal(record.worldRegion, "North America");
  assert.equal(record.startDate, "2027-10-31");
  assert.equal(record.endDate, "2027-11-04");
  assert.equal(record.year, 2027);
  assert.equal(record.organization, "AIChE");
});

test("a conference name containing commas is not truncated at the first one", () => {
  const outcome = parseHarvestEvidence(
    evidence({
      stated:
        "International Conference on Geology, Geophysics and Geochemistry, Paris, France, May 17-18, 2027",
    }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.title, "International Conference on Geology, Geophysics and Geochemistry");
  assert.equal(outcome.record.city, "Paris");
  assert.equal(outcome.record.country, "France");
  assert.equal(outcome.record.venue, null);
});

test("a segment naming the city that follows it is read as the venue", () => {
  const outcome = parseHarvestEvidence(
    evidence({ stated: "ACM IUI 2027, Helsinki Congress Paasitorni, Helsinki, Finland, February 8-11, 2027" }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.venue, "Helsinki Congress Paasitorni");
  assert.equal(outcome.record.city, "Helsinki");
  assert.equal(outcome.record.title, "ACM IUI 2027");
});

test("the acronym is recorded without being cut out of the title", () => {
  // Stripping it produced titles like "Annual Conference" and "International Convention", which
  // name no conference at all.
  assert.deepEqual(splitTitleParts("NCCN 2027 Annual Conference"), {
    title: "NCCN 2027 Annual Conference",
    acronym: "NCCN",
    edition: null,
  });
  assert.deepEqual(splitTitleParts("88th EAGE Annual Conference & Exhibition 2027"), {
    title: "88th EAGE Annual Conference & Exhibition 2027",
    acronym: null,
    edition: "88th",
  });
});

test("no date the parser is sure of means no record", () => {
  // A bare year is not a date anyone can attend: it is refused for being too coarse rather than
  // rounded to a month or a day the source never named.
  const bareYear = parseHarvestEvidence(
    evidence({ stated: "Computer Vision Conference 2027, Amsterdam, Netherlands" }),
    OPTIONS
  );
  assert.equal(bareYear.ok, false);
  if (bareYear.ok) return;
  assert.equal(bareYear.reason, "date_precision_too_coarse");

  const noDate = parseHarvestEvidence(
    evidence({ stated: "Computer Vision Conference, Amsterdam, Netherlands" }),
    OPTIONS
  );
  assert.equal(noDate.ok, false);
  if (noDate.ok) return;
  assert.equal(noDate.reason, "no_date");
});

test("a submission deadline is never promoted to the event's dates", () => {
  // The only date in this sentence is labelled a deadline and sits in a year the dataset does not
  // cover; accepting it would file the conference under the wrong year entirely.
  const outcome = parseHarvestEvidence(
    evidence({ stated: "CVPR 2027, Seattle, Washington, USA, paper submission deadline November 13, 2025" }),
    OPTIONS
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, "year_out_of_range:2025");
});

test("a conference that has already finished is not launch inventory", () => {
  const outcome = parseHarvestEvidence(
    evidence({ stated: "SPE Improved Oil Recovery Conference 2026, Tulsa, Oklahoma, USA, April 21-23, 2026" }),
    OPTIONS
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, "already_finished");
});

test("a record with neither city nor country is refused unless it is online", () => {
  const refused = parseHarvestEvidence(
    evidence({ stated: "PRC Europe 2027 Petrochemical and Refining Congress, Vosendorf, May 24-25, 2027" }),
    OPTIONS
  );
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, "no_location");
});

test("a listing host is never promoted to an official URL", () => {
  const outcome = parseHarvestEvidence(
    evidence({
      url: "https://conferenceindex.org/event/international-conference-on-water-icw-2027-march-dubai-ae",
      stated: "ICW 2027 International Conference on Water, Dubai, United Arab Emirates, March 22-23, 2027",
    }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.sourceType, "directory_listing");
  assert.equal(outcome.record.officialUrl, null);
  assert.equal(outcome.record.provenance.title.confidence, "Low");
});

test("source strength is read from the host", () => {
  assert.equal(classifySource("https://www.atce.org/"), "official_site");
  assert.equal(classifySource("https://10times.com/some-event"), "directory_listing");
  assert.equal(classifySource("https://en.wikipedia.org/wiki/Arab_Health"), "reference");
});

test("a hybrid event is recorded as hybrid, and the source text is preserved whole", () => {
  const stated =
    "IPHC 2027 International Public Health Conference, Village Hotel Changi, Singapore, Singapore, March 15-17, 2027, hybrid event";
  const outcome = parseHarvestEvidence(evidence({ stated }), OPTIONS);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.format, "hybrid");
  assert.equal(outcome.record.description, stated);
  assert.equal(outcome.record.evidence.statedText, stated);
  assert.equal(outcome.record.evidence.method, "web_search");
});

test("a month-only date keeps its precision rather than inventing a day", () => {
  const outcome = parseHarvestEvidence(
    evidence({ stated: "IEEE ICRA 2028 International Conference on Robotics and Automation, Guadalajara, Mexico, May 2028" }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.datePrecision, "month");
  assert.equal(outcome.record.startDate, null);
  assert.equal(outcome.record.year, 2028);
});

test("segment zero is the conference's name, never its city", () => {
  // "California, United States" states a state and a country and no city at all. Filling the city
  // with the conference's own title is worse than leaving it empty.
  const outcome = parseHarvestEvidence(
    evidence({ stated: "ICLR 2027 International Conference on Learning Representations, California, United States, April 26-30, 2027" }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.city, null);
  assert.equal(outcome.record.region, "California");
  assert.equal(outcome.record.country, "United States");
  assert.equal(outcome.record.title, "ICLR 2027 International Conference on Learning Representations");
});

test("a building named where the city would be is recorded as the venue, not the city", () => {
  const outcome = parseHarvestEvidence(
    evidence({ stated: "CIF International Conference 2027, European University Cyprus, Cyprus, October 27-31, 2027" }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.venue, "European University Cyprus");
  assert.equal(outcome.record.city, null);
  assert.equal(outcome.record.country, "Cyprus");
});

test("a name that opens with an edition ordinal is not mistaken for a venue", () => {
  // "4th Honolulu Education Conference" mentions the city, which is otherwise a venue signal.
  const outcome = parseHarvestEvidence(
    evidence({ stated: "HEC 2027, 4th Honolulu Education Conference, Honolulu, Hawaii, USA, March 10-12, 2027" }),
    OPTIONS
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.title, "HEC 2027, 4th Honolulu Education Conference");
  assert.equal(outcome.record.venue, null);
  assert.equal(outcome.record.city, "Honolulu");
  assert.equal(outcome.record.region, "Hawaii");
});
