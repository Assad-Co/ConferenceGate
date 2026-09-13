import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applySuppliedCorrections } from "../suppliedCorrections";

test("supplied corrections update four editions, preserve IDs and unrelated records", () => {
  const records = JSON.parse(fs.readFileSync("data/conferencegate-worldwide-2026-2028.json", "utf8")).records;
  const before = structuredClone(records);
  const csv = fs.readFileSync("data/corrections/verified-2026-09-13.csv", "utf8");
  const options = { retrievedAt: "2026-09-13", horizonStart: "2026-09-13", years: [2026, 2027, 2028] };
  assert.equal(applySuppliedCorrections(records, csv, options), 4);
  assert.equal(records.length, before.length);
  for (let i = 0; i < records.length; i++) {
    assert.equal(records[i].id, before[i].id);
    if (records[i].details?.source !== "verified-2026-09-13") assert.deepEqual(records[i], before[i]);
  }
  const pytorch = records.find(record => record.title === "PyTorch Conference North America 2026");
  assert.equal(pytorch.details.keynotes.items[0].name, "Mark Collier");
  assert.equal(pytorch.details.committee.items.length, 0);
  assert.match(pytorch.details.committee.text, /Jeff Daily/);
  assert.match(pytorch.officialUrl, /pytorch-conference-north-america/);
  const snapshot = structuredClone(records);
  assert.throws(() => applySuppliedCorrections(records, csv.replace("RSNA Annual Meeting 2026", "Unknown Event 2026"), options));
  assert.deepEqual(records, snapshot, "failed imports must be atomic");
});
