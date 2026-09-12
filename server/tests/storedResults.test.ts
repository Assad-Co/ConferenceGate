// What a published record turns into on a card.
//
// These records come out of the extraction database rather than the launch dataset, and what the
// extractor stored is whatever the page's own <title> tag said — which on most conference sites is
// assembled by a template, and so carries the site's navigation along with the conference's name.

import assert from "node:assert/strict";
import test from "node:test";
import { conferenceNameFrom } from "../braveSearch";

test("a page's navigation is not part of the conference's name", () => {
  // The card read "Home | Green Energy 2026 | Green Energy Conference" — a breadcrumb, an edition
  // and the series it belongs to, printed as though all three were the name.
  assert.equal(
    conferenceNameFrom("Home | Green Energy 2026 | Green Energy Conference", "greenenergyconf.org"),
    "Green Energy 2026"
  );
  assert.equal(conferenceNameFrom("Welcome | ECAI 2027", "ecai2027.org"), "ECAI 2027");
  // The site's own name is furniture too, wherever in the title it sits.
  assert.equal(conferenceNameFrom("AAPG | Events | ACE 2027", "aapg.org"), "ACE 2027");

  // The year decides between an edition and the series, because the edition is what is on screen.
  assert.equal(
    conferenceNameFrom("Symposium Series | Robotics Symposium 2027", "roboticssymposium.org"),
    "Robotics Symposium 2027"
  );
});

test("one conference named twice across a dash is one conference", () => {
  assert.equal(
    conferenceNameFrom("World Pharma Tech Summit 2027 – 5th World Pharma Tech Summit", "pharmatech.com"),
    "World Pharma Tech Summit 2027"
  );

  // Only when the halves really are the same event. A dash usually separates a name from something
  // the name does not say, and that half is not furniture.
  assert.equal(
    conferenceNameFrom("ICCS 2026 - International Conference on Circuits and Systems", "iccs.org"),
    "ICCS 2026 - International Conference on Circuits and Systems"
  );
  assert.equal(
    conferenceNameFrom("Black Hat Europe 2026 - Briefings", "blackhat.com"),
    "Black Hat Europe 2026 - Briefings"
  );
});

test("a title with nothing to strip is left exactly as the page wrote it", () => {
  for (const title of [
    "Gastech 2026",
    "2027 IEEE International Geoscience and Remote Sensing Symposium",
    "20th Vaccine Congress",
  ]) {
    assert.equal(conferenceNameFrom(title, "example.org"), title);
  }
  // A title that is nothing but navigation has no name hiding in it, and none is invented.
  assert.equal(conferenceNameFrom("Home", "example.org"), "Home");
  assert.equal(conferenceNameFrom("   ", "example.org"), "");
});
