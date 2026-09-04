import assert from "node:assert/strict";
import test from "node:test";
import { GENERIC_EVENT_PAGE_RE } from "../controlledPublish";
import { topicsForBatch } from "../scale";

test("generic collection pages are blocked while individual event pages beneath them remain eligible", () => {
  assert.equal(GENERIC_EVENT_PAGE_RE.test(new URL("https://example.org/events").pathname), true);
  assert.equal(GENERIC_EVENT_PAGE_RE.test(new URL("https://example.org/category/medicine").pathname), true);
  assert.equal(GENERIC_EVENT_PAGE_RE.test(new URL("https://example.org/events/annual-congress-2027").pathname), false);
});

test("successive production batches rotate through the category taxonomy", () => {
  const first = topicsForBatch(1);
  const second = topicsForBatch(2);
  assert.equal(first.length, 6);
  assert.equal(second.length, 6);
  assert.notDeepEqual(first, second);
  assert.equal(new Set([...first, ...second]).size, 12);
});
