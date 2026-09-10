// The exact contents of one published conference's Sponsors tab, and what should happen to them.

import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeOrganisation, looksLikePerson, repairSponsorList } from "../repairSponsors";

test("the eighty-eight sponsors of World Pharma Tech Summit are sorted into what they are", () => {
  // Verbatim from the published record: an icon file, two words of page furniture, and four
  // speakers — three of whom were stored under their photograph's filename.
  const stored = [
    { name: "icon-feature-item-2.svg", logoUrl: "https://x.example/icon-feature-item-2.svg" },
    { name: "Network" },
    { name: "Honored" },
    { name: "Michelle Bridenbaker", logoUrl: "https://x.example/michelle.jpg" },
    { name: "Keith-Berelowitz" },
    { name: "Simon-Rebora.jpg", logoUrl: "https://x.example/Simon-Rebora.jpg" },
    { name: "Nan Fang" },
    { name: "Selina-Gaertner.jpg" },
    // The one real sponsor in the list must survive untouched.
    { name: "Novartis Pharmaceuticals", tier: "Gold" },
  ];

  const repair = repairSponsorList(stored, [{ name: "Existing Speaker" }]);

  // Moved on evidence: a filename that separates the person's names. "Michelle Bridenbaker" and
  // "Nan Fang" carry no such evidence and are shaped exactly like "Siemens Healthineers", so they
  // stay put — misfiling a person costs less than inventing a speaker out of a real sponsor.
  assert.equal(repair.droppedFurniture, 3, "the icon and the two furniture words were not dropped");
  assert.equal(repair.movedToSpeakers, 3);

  const moved = repair.speakers.map((s) => s.name);
  assert.deepEqual(moved, ["Existing Speaker", "Keith Berelowitz", "Simon Rebora", "Selina Gaertner"]);
  assert.deepEqual(
    repair.sponsors.map((s) => s.name),
    ["Michelle Bridenbaker", "Nan Fang", "Novartis Pharmaceuticals"]
  );

  // A person arrives with nothing the sponsor entry did not state — but keeps the photograph,
  // which it did.
  const simon = repair.speakers.find((s) => s.name === "Simon Rebora")!;
  assert.equal(simon.role, null);
  assert.equal(simon.org, null);
  assert.equal(simon.title, null);
  assert.equal(simon.imageUrl, "https://x.example/Simon-Rebora.jpg");
});

test("no organisation is ever moved into the speakers list", () => {
  // The property that actually matters. Several of these are NOT positively identifiable as
  // organisations — "Siemens Healthineers" carries no company suffix and is shaped exactly like a
  // personal name — and that is precisely why the rule requires evidence before moving anything.
  // Being unsure has to mean leaving it alone.
  for (const name of [
    "Novartis Pharmaceuticals", "Siemens Healthineers", "Politecnico di Torino",
    "American Chemical Society", "IEEE", "CERN", "Roche Diagnostics GmbH",
    "King Abdullah University", "Wellcome Trust", "Mayo Clinic", "Blue Ocean", "General Electric",
  ]) {
    assert.equal(looksLikePerson(name), false, `${name} would have been moved into the speakers list`);
  }

  // And the ones that DO carry a marker are recognised outright, so they can never be dropped.
  for (const name of [
    "Novartis Pharmaceuticals", "American Chemical Society", "IEEE",
    "Roche Diagnostics GmbH", "King Abdullah University", "Wellcome Trust",
  ]) {
    assert.equal(looksLikeOrganisation(name), true, `${name} was not recognised as an organisation`);
  }
});

test("a sponsor list with nothing wrong in it is left completely alone", () => {
  const clean = [{ name: "Pfizer", tier: "Platinum" }, { name: "Siemens Healthineers", tier: null }];
  const repair = repairSponsorList(clean, []);
  assert.equal(repair.changed, false, "a clean list was rewritten for no reason");
  assert.deepEqual(repair.sponsors, clean);
  assert.deepEqual(repair.speakers, []);
});

test("a person already in the speakers list is not added to it twice", () => {
  const repair = repairSponsorList(
    [{ name: "Nan-Fang.jpg" }],
    [{ name: "Nan Fang", role: "Keynote Speaker", org: "Tsinghua University" }]
  );
  assert.equal(repair.movedToSpeakers, 0);
  assert.equal(repair.speakers.length, 1);
  // And the richer existing entry keeps its role rather than being flattened by the sponsor one.
  assert.equal(repair.speakers[0].role, "Keynote Speaker");
});

test("anything the rules cannot place stays a sponsor", () => {
  // Not obviously an organisation, not shaped like a person, not furniture. Leaving it where it is
  // costs a misfiled row; moving it invents a speaker who may not exist.
  const repair = repairSponsorList([{ name: "Blue Ocean 2027 Initiative" }], []);
  assert.deepEqual(repair.sponsors.map((s) => s.name), ["Blue Ocean 2027 Initiative"]);
  assert.equal(repair.movedToSpeakers, 0);
});
