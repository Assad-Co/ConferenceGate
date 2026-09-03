// The query matrix decides what search discovery can possibly find. If it is skewed towards
// North America and Europe, the whole engine is, however good everything downstream is — so the
// spread is asserted here rather than hoped for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planSearchQueries } from "../providers/searchProvider";
import { normalizeCountry } from "../countries";
import { markdownToDocument, MIN_EXTRACTABLE_TEXT_CHARS } from "../readPage";
import { pageText } from "../htmlExtract";

test("queries span every world region, not just the wealthy ones", () => {
  const planned = planSearchQueries({ targetYears: [2026, 2027, 2028], maxQueries: 28 });
  assert.equal(planned.length, 28);

  const regions = new Set(planned.map((item) => item.region));
  for (const region of ["Europe", "North America", "South America", "Middle East", "Africa", "Asia", "Oceania"]) {
    assert.ok(regions.has(region), `no query targets ${region}`);
  }

  // No single region may dominate: with seven regions rotating, none should exceed ~2x its share.
  const counts = new Map<string, number>();
  for (const item of planned) counts.set(item.region, (counts.get(item.region) || 0) + 1);
  const fairShare = planned.length / 7;
  for (const [region, count] of counts) {
    assert.ok(count <= fairShare * 2, `${region} takes ${count} of ${planned.length} queries`);
  }
});

test("every query names a real, resolvable country", () => {
  for (const item of planSearchQueries({ targetYears: [2027], maxQueries: 20 })) {
    assert.ok(normalizeCountry(item.country), `${item.country} does not resolve`);
    assert.ok(item.query.includes(item.country));
  }
});

test("the priority year gets roughly half the queries", () => {
  const planned = planSearchQueries({ targetYears: [2026, 2027, 2028], maxQueries: 24 });
  const share = planned.filter((item) => item.year === 2027).length / planned.length;
  assert.ok(share >= 0.45 && share <= 0.6, `2027 got ${(share * 100).toFixed(0)}% of queries`);
  // The other years are still represented — this is not a 2027-only engine.
  assert.ok(planned.some((item) => item.year === 2026));
  assert.ok(planned.some((item) => item.year === 2028));
});

test("queries steer away from roundups and towards a conference's own site", () => {
  for (const item of planSearchQueries({ targetYears: [2027], maxQueries: 6 })) {
    assert.match(item.query, /call for papers/);
    assert.match(item.query, /-"top conferences"/);
    assert.match(item.query, /\b2027\b/);
  }
});

test("planning is deterministic, so two runs' yields are comparable", () => {
  const a = planSearchQueries({ targetYears: [2026, 2027, 2028], maxQueries: 15 });
  const b = planSearchQueries({ targetYears: [2026, 2027, 2028], maxQueries: 15 });
  assert.deepEqual(a, b);
});

test("explicit topics override the default taxonomy sweep", () => {
  const planned = planSearchQueries({ targetYears: [2027], maxQueries: 8, topics: ["Hydrogen Storage"] });
  assert.ok(planned.every((item) => item.subject === "Hydrogen Storage"));
  assert.ok(new Set(planned.map((item) => item.country)).size > 1, "one topic still sweeps many countries");
});

test("reader markdown becomes a document the extractors can actually read", () => {
  const markdown = [
    "Title: 9th Gulf Conference on Water Desalination",
    "URL Source: https://example.org/gcwdr",
    "",
    "Markdown Content:",
    "# 9th Gulf Conference on Water Desalination",
    "",
    "**Dates:** 22–24 February 2027",
    "",
    "**Location:** Doha, Qatar",
    "",
    "## Important dates",
    "",
    "- Abstract submission deadline: 30 September 2026",
    "- Early bird registration: 20 December 2026",
  ].join("\n");

  const html = markdownToDocument(markdown);
  assert.match(html, /<title>9th Gulf Conference on Water Desalination<\/title>/);
  assert.match(html, /<h1>9th Gulf Conference on Water Desalination<\/h1>/);
  assert.match(html, /<h2>Important dates<\/h2>/, "markdown headings survive as real headings");
  assert.match(html, /<li>Abstract submission deadline: 30 September 2026<\/li>/);

  const text = pageText(html);
  assert.ok(text.includes("22–24 February 2027"));
  assert.ok(text.includes("Doha, Qatar"));
});

test("markdown with no title line still yields a document", () => {
  const html = markdownToDocument("Some plain reader output about a congress in Nairobi.");
  assert.match(html, /<title><\/title>/);
  assert.ok(pageText(html).includes("Nairobi"));
});

test("the thin-page threshold is a real number the read chain can act on", () => {
  assert.ok(MIN_EXTRACTABLE_TEXT_CHARS >= 200 && MIN_EXTRACTABLE_TEXT_CHARS <= 2000);
});
