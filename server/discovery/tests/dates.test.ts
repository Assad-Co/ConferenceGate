// Date parsing is where a discovery engine most easily starts lying: an ambiguous numeric date
// resolved by convention, or a month-only date silently promoted to the 1st. These tests pin down
// both the formats that must parse and the ones that must deliberately refuse to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isFutureMonth, isFutureOrToday, parseDateRange, parseSingleDate } from "../dates";

test("parses ISO dates", () => {
  const single = parseDateRange("2027-05-12");
  assert.equal(single.startDate, "2027-05-12");
  assert.equal(single.endDate, "2027-05-12");
  assert.equal(single.precision, "day");

  const range = parseDateRange("2027-05-12/2027-05-14");
  assert.equal(range.startDate, "2027-05-12");
  assert.equal(range.endDate, "2027-05-14");

  const withTime = parseDateRange("2027-05-12T09:00:00Z");
  assert.equal(withTime.startDate, "2027-05-12");
});

test("parses day-first ranges in the forms conference sites use", () => {
  for (const text of [
    "12–14 May 2027",
    "12-14 May 2027",
    "12 to 14 May 2027",
    "12th to 14th May 2027",
    "12th–14th May 2027",
  ]) {
    const parsed = parseDateRange(text);
    assert.equal(parsed.startDate, "2027-05-12", `start for "${text}"`);
    assert.equal(parsed.endDate, "2027-05-14", `end for "${text}"`);
    assert.equal(parsed.rawText, text, "original text is preserved for auditing");
  }
});

test("parses month-first ranges", () => {
  const compact = parseDateRange("May 12-14, 2027");
  assert.equal(compact.startDate, "2027-05-12");
  assert.equal(compact.endDate, "2027-05-14");

  const crossMonth = parseDateRange("May 30 – June 2, 2027");
  assert.equal(crossMonth.startDate, "2027-05-30");
  assert.equal(crossMonth.endDate, "2027-06-02");
});

test("parses ranges that cross a year boundary", () => {
  const parsed = parseDateRange("28 December 2027 – 3 January 2028");
  assert.equal(parsed.startDate, "2027-12-28");
  assert.equal(parsed.endDate, "2028-01-03");
});

test("parses single dates written either way round", () => {
  assert.equal(parseDateRange("12 May 2027").startDate, "2027-05-12");
  assert.equal(parseDateRange("May 12, 2027").startDate, "2027-05-12");
  assert.equal(parseDateRange("1 Sept. 2027").startDate, "2027-09-01");
});

test("parses non-English month names", () => {
  assert.equal(parseDateRange("12 mai 2027").startDate, "2027-05-12");
  assert.equal(parseDateRange("3 de outubro de 2027")?.startDate, "2027-10-03");
  assert.equal(parseDateRange("15 Oktober 2027").startDate, "2027-10-15");
});

test("refuses to resolve an ambiguous numeric date", () => {
  // 05/06/2027 could be 5 June or 6 May. Guessing would be a fabricated fact, so no day is
  // reported at all — only the year, at year precision.
  const ambiguous = parseDateRange("05/06/2027");
  assert.equal(ambiguous.startDate, null);
  assert.equal(ambiguous.precision, "year");
  assert.equal(ambiguous.startYear, 2027);
});

test("resolves a numeric date when the day settles the order", () => {
  assert.equal(parseDateRange("25/12/2027").startDate, "2027-12-25");
  assert.equal(parseDateRange("12/25/2027").startDate, "2027-12-25");
});

test("a month with no day stays a month, never the 1st", () => {
  const parsed = parseDateRange("May 2027");
  assert.equal(parsed.startDate, null, "no day was stated, so no day is invented");
  assert.equal(parsed.startYear, 2027);
  assert.equal(parsed.startMonth, 5);
  assert.equal(parsed.precision, "month");
});

test("a bare year is kept at year precision", () => {
  const parsed = parseDateRange("Coming in 2028");
  assert.equal(parsed.startDate, null);
  assert.equal(parsed.startYear, 2028);
  assert.equal(parsed.precision, "year");
});

test("rejects impossible calendar dates rather than rolling them forward", () => {
  assert.equal(parseDateRange("31 February 2027").startDate, null);
});

test("returns nulls for text with no date", () => {
  const parsed = parseDateRange("Registration is now open");
  assert.equal(parsed.startDate, null);
  assert.equal(parsed.startYear, null);
  assert.equal(parsed.precision, null);
});

test("parseSingleDate only answers at day precision", () => {
  assert.equal(parseSingleDate("15 January 2027"), "2027-01-15");
  assert.equal(parseSingleDate("January 2027"), null);
  assert.equal(parseSingleDate(null), null);
});

test("future checks compare against a supplied clock", () => {
  const now = new Date("2026-09-02T00:00:00Z");
  assert.equal(isFutureOrToday("2026-09-02", now), true);
  assert.equal(isFutureOrToday("2026-09-01", now), false);
  assert.equal(isFutureMonth(2026, 9, now), true);
  assert.equal(isFutureMonth(2026, 8, now), false);
  assert.equal(isFutureMonth(2027, 1, now), true);
});
