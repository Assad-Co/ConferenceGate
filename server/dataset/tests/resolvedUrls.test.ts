// Websites found after the batch that named them was compiled.
//
// A correction, not an overwrite, and not a permit: the URL is screened exactly as any other,
// because a row asserting that something is a conference's website is the claim being checked.

import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../sources/curated";
import {
  applyResolvedUrls, isResolvedUrlHeader, rowsFromResolvedCsv,
} from "../sources/resolvedUrls";
import { conferenceLogoUrl } from "../staticDataset";
import type { LaunchConferenceRecord } from "../types";

const record = (over: Partial<LaunchConferenceRecord> = {}): LaunchConferenceRecord => ({
  id: "gastech-2026-bangkok", title: "Gastech 2026", acronym: null, series: null, edition: null,
  year: 2026, startDate: "2026-09-14", endDate: "2026-09-17", datePrecision: "day", datesText: null,
  city: "Bangkok", region: null, country: "Thailand", countryCode: "TH", worldRegion: "Asia",
  venue: null, format: "in-person", organization: null, category: null, categories: [], topics: [],
  keywords: [], description: null,
  sourceUrl: "https://www.rogtecmagazine.com/events-calendar/", sourceHost: "rogtecmagazine.com",
  sourceType: "third_party", officialUrl: null,
  evidence: { query: "q", resultTitle: "t", statedText: "s", retrievedAt: "2026-09-11", method: "web_search", externalId: null },
  provenance: {}, corroboratingSourceUrls: [], origin: "launch_dataset", details: null,
  ...over,
} as LaunchConferenceRecord);

test("a conference whose own site was found later links to it, and gains its logo", () => {
  const records = [record()];
  const outcome = applyResolvedUrls(records, [
    { title: "Gastech 2026", officialUrl: "https://www.gastechevent.com/", resolvedOn: "2026-09-11", method: "web_search", startDate: null, endDate: null, logoUrl: null },
  ]);
  assert.equal(outcome.applied, 1);
  assert.equal(records[0].officialUrl, "https://www.gastechevent.com/");
  assert.equal(records[0].sourceUrl, "https://www.gastechevent.com/");
  assert.equal(records[0].sourceHost, "gastechevent.com");
  assert.equal(records[0].sourceType, "official_site");
  assert.equal(conferenceLogoUrl(records[0]), "https://www.gastechevent.com/favicon.ico");
});

test("a record that already names its own site is not corrected", () => {
  // This file is a fallback for records that have nothing, never a second opinion about one that
  // read its website off the organiser's own page.
  const records = [record({ officialUrl: "https://www.gastechevent.com/", sourceUrl: "https://www.gastechevent.com/" })];
  const outcome = applyResolvedUrls(records, [
    { title: "Gastech 2026", officialUrl: "https://wrong.example/", resolvedOn: "2026-09-11", method: "web_search", startDate: null, endDate: null, logoUrl: null },
  ]);
  assert.equal(outcome.applied, 0);
  assert.equal(outcome.alreadyKnown, 1);
  assert.equal(records[0].officialUrl, "https://www.gastechevent.com/");
});

test("a resolved URL is screened like any other, and a refusal is reported", () => {
  for (const [url, why] of [
    ["https://www.iconf.com/conference/ICCS2026_8985", "a directory"],
    ["https://www.rogtecmagazine.com/events-calendar/", "an index of events"],
    ["https://example.org/events/conferences/all", "an index of events"],
    ["not a url", "unparseable"],
  ] as const) {
    const records = [record()];
    const outcome = applyResolvedUrls(records, [
      { title: "Gastech 2026", officialUrl: url, resolvedOn: "2026-09-11", method: "web_search", startDate: null, endDate: null, logoUrl: null },
    ]);
    assert.equal(outcome.applied, 0, `${url} was applied though it is ${why}`);
    assert.equal(outcome.refused.length, 1);
    assert.equal(records[0].officialUrl, null);
  }
});

test("a row naming no conference in the catalogue is reported rather than dropped", () => {
  const outcome = applyResolvedUrls([record()], [
    { title: "A Conference Nobody Has Heard Of", officialUrl: "https://real.example/", resolvedOn: "2026-09-11", method: "web_search", startDate: null, endDate: null, logoUrl: null },
  ]);
  assert.equal(outcome.applied, 0);
  assert.deepEqual(outcome.unmatched, ["A Conference Nobody Has Heard Of"]);
});

test("the header tells this file apart from the two others in the same directory", () => {
  // All three live in data/sources, and the oldest is read by column position — so a file of this
  // shape handed to it would file a URL as a date rather than fail.
  assert.equal(isResolvedUrlHeader(["conference_name", "official_url", "resolved_on", "method"]), true);
  assert.equal(isResolvedUrlHeader(["﻿conference_name", "official_url"]), true);
  assert.equal(isResolvedUrlHeader(["conference_name", "start_date", "website_or_source", "record_status"]), false);
  // A resolution file may state the organiser's dates without becoming an intake batch.
  assert.equal(isResolvedUrlHeader(["conference_name", "official_url", "start_date", "end_date"]), true);
  assert.equal(isResolvedUrlHeader(["Conference Name", "Event Type", "Dates", "Location"]), false);

  const rows = rowsFromResolvedCsv(parseCsv(
    'conference_name,official_url,resolved_on,method\n"Gastech 2026",https://www.gastechevent.com/,2026-09-11,web_search\n'
  ));
  assert.deepEqual(rows, [
    { title: "Gastech 2026", officialUrl: "https://www.gastechevent.com/", resolvedOn: "2026-09-11", method: "web_search", startDate: null, endDate: null, logoUrl: null },
  ]);
});

test("dates the organiser's own page states correct the row the record came from", () => {
  const listed = record();
  listed.officialUrl = null;
  listed.startDate = "2027-09-13";
  listed.endDate = "2027-09-15";
  listed.year = 2027;

  const outcome = applyResolvedUrls([listed], [
    {
      title: "Gastech 2026", officialUrl: "https://www.gastechevent.com/",
      resolvedOn: "2026-09-12", method: "web_search",
      startDate: "2027-10-13", endDate: "2027-10-15", logoUrl: null,
    },
  ]);

  assert.equal(listed.startDate, "2027-10-13");
  assert.equal(listed.endDate, "2027-10-15");
  assert.equal(listed.startMonth, 10);
  assert.equal(listed.datePrecision, "day");
  assert.deepEqual(outcome.redated, [{ title: "Gastech 2026", was: "2027-09-13", now: "2027-10-13" }]);
});

test("a resolution that states no date leaves the record's own dates alone", () => {
  const listed = record();
  listed.officialUrl = null;
  listed.startDate = "2026-09-07";

  const outcome = applyResolvedUrls([listed], [
    {
      title: "Gastech 2026", officialUrl: "https://www.gastechevent.com/",
      resolvedOn: "2026-09-12", method: "web_search",
      // "Not yet announced" is not a date, and neither is a year on its own.
      startDate: "2027", endDate: null, logoUrl: null,
    },
  ]);

  assert.equal(listed.startDate, "2026-09-07");
  assert.deepEqual(outcome.redated, []);
  assert.equal(outcome.applied, 1);
});

test("a supplied logo is the one mark a conference gets of its own", () => {
  // Every other mark in the catalogue is /favicon.ico on whatever host the conference's page sits
  // on, which is why fourteen Elsevier congresses showed one icon. A logo column is the only route
  // to a mark that belongs to this conference, so it applies whether or not the row also resolves
  // a website — a conference whose site is already known is the one most likely to need only this.
  const known = record();
  known.officialUrl = "https://www.gastechevent.com/";
  known.logoUrl = null;

  const outcome = applyResolvedUrls([known], [
    {
      title: "Gastech 2026", officialUrl: "", resolvedOn: "2026-09-12", method: "supplied",
      startDate: null, endDate: null, logoUrl: "https://www.gastechevent.com/brand/gastech.png",
    },
  ]);

  assert.equal(known.logoUrl, "https://www.gastechevent.com/brand/gastech.png");
  assert.equal(outcome.logos, 1);
  assert.equal(outcome.refused.length, 0, "a row supplying only a logo was refused as a bad URL");
});

test("a logo column is a claim, and is screened like any other", () => {
  const refusals = [
    "http://example.org/logo.png",
    "https://www.google.com/s2/favicons?domain=gastechevent.com",
    "https://logo.clearbit.com/gastechevent.com",
    "not a url",
  ];
  for (const url of refusals) {
    const target = record();
    target.logoUrl = null;
    const outcome = applyResolvedUrls([target], [
      { title: "Gastech 2026", officialUrl: "", resolvedOn: "2026-09-12", method: "supplied",
        startDate: null, endDate: null, logoUrl: url },
    ]);
    assert.equal(target.logoUrl, null, `${url} became a conference's logo`);
    assert.equal(outcome.logosRefused.length, 1);
  }
});
