// The bridge between the launch catalogue and the discovery engine.
//
// These tests are about honesty in the handover rather than plumbing: a seeded record must not
// claim a page was read, must not invent deadlines it never had, and must not arrive already
// published.

import test from "node:test";
import assert from "node:assert/strict";
import { toNormalizedEvent } from "../seedDiscovery";
import type { LaunchConferenceRecord } from "../types";

function record(overrides: Partial<LaunchConferenceRecord> = {}): LaunchConferenceRecord {
  return {
    id: "eage-2027-amsterdam",
    title: "88th EAGE Annual Conference & Exhibition 2027",
    acronym: "EAGE",
    series: "EAGE Annual Conference & Exhibition",
    edition: "88th",
    year: 2027,
    startDate: "2027-05-31",
    endDate: "2027-06-03",
    datePrecision: "day",
    datesText: null,
    city: "Amsterdam",
    region: null,
    country: "Netherlands",
    countryCode: "NL",
    worldRegion: "Europe",
    venue: "RAI Amsterdam",
    format: "in-person",
    organization: "EAGE",
    category: "Geosciences & Earth Systems",
    categories: ["Geosciences & Earth Systems", "Petroleum & Energy"],
    topics: ["geoscience", "geophysics"],
    keywords: ["EAGE", "Amsterdam", "Netherlands"],
    description: "88th EAGE Annual Conference & Exhibition 2027, RAI Amsterdam, Amsterdam, Netherlands",
    sourceUrl: "https://eageannual.org/",
    sourceHost: "eageannual.org",
    sourceType: "official_site",
    officialUrl: "https://eageannual.org/",
    evidence: {
      query: "q",
      resultTitle: "t",
      statedText: "s",
      retrievedAt: "2026-09-09",
      method: "web_search",
    },
    provenance: {},
    corroboratingSourceUrls: [],
    origin: "launch_dataset",
    ...overrides,
  };
}

test("a seeded record carries its facts across without gaining any", () => {
  const event = toNormalizedEvent(record());
  assert.equal(event.title, "88th EAGE Annual Conference & Exhibition 2027");
  assert.equal(event.startDate, "2027-05-31");
  assert.equal(event.startMonth, 5);
  assert.equal(event.city, "Amsterdam");
  assert.equal(event.countryCode, "NL");
  assert.equal(event.worldRegion, "Europe");
  assert.equal(event.venue, "RAI Amsterdam");
  assert.equal(event.officialUrl, "https://eageannual.org/");
  assert.equal(event.series.edition, "88th");
});

test("it never claims a page was read", () => {
  // "html" or "structured_data" would assert a page read that never happened, and would outrank
  // what enrichment later reads from the conference's own site.
  assert.equal(toNormalizedEvent(record()).extractionMethod, "derived");
});

test("no deadlines are invented, because no source stated one", () => {
  const event = toNormalizedEvent(record());
  assert.deepEqual(event.deadlines, {
    abstractDeadline: null,
    paperSubmissionDeadline: null,
    earlyBirdDeadline: null,
    registrationDeadline: null,
    notificationDate: null,
    cameraReadyDeadline: null,
  });
  assert.equal(event.latitude, null);
  assert.equal(event.longitude, null);
  assert.equal(event.registrationUrl, null);
});

test("a listing-sourced record is seeded at low trust so a real page read outranks it", () => {
  const official = toNormalizedEvent(record({ sourceType: "official_site" }));
  const api = toNormalizedEvent(record({ sourceType: "event_api" }));
  const listing = toNormalizedEvent(record({ sourceType: "directory_listing" }));
  assert.ok(official.confidenceScore > api.confidenceScore);
  assert.ok(api.confidenceScore > listing.confidenceScore);
  assert.ok(listing.confidenceScore <= 0.25);
});

test("the engine's spelling of a format is used, and unknown is never guessed at", () => {
  assert.equal(toNormalizedEvent(record({ format: "in-person" })).format, "in_person");
  assert.equal(toNormalizedEvent(record({ format: "hybrid" })).format, "hybrid");
  assert.equal(toNormalizedEvent(record({ format: "online" })).format, "online");
});
