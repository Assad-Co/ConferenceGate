// The mark a conference wears when it has no logo — two thirds of the catalogue.
//
// This lives under src/ because it is a rendering concern, and is tested here because this is the
// runner the project has. Everything it asserts is a card that shipped looking wrong.

import assert from "node:assert/strict";
import test from "node:test";
import { conferenceInitials, distinctiveWords, markSizeClass } from "../../../src/utils/conferenceMark";

test("a mark names the conference rather than spelling out its ordinal", () => {
  // Both of these reached a reader. A letter from every word is not a name: "G2" and "2V" say
  // nothing about a conference, on the card of one that has no logo to show instead.
  assert.equal(conferenceInitials("Gastech 2026"), "GASTECH");
  assert.equal(conferenceInitials("20th Vaccine Congress"), "VACCINE");
});

test("an acronym the title states is the mark, and the longest one wins", () => {
  assert.equal(conferenceInitials("ADIPEC 2026 Abu Dhabi International Petroleum Exhibition"), "ADIPEC");
  assert.equal(conferenceInitials("EDUCAUSE Annual Conference 2026"), "EDUCAUSE");
  // Opening with the organiser and closing with the conference: a card headed UN could be any of
  // a hundred events, so the acronym that names this one is the one that shows.
  assert.equal(conferenceInitials("UN Climate Change Conference COP31"), "COP31");
});

test("a two-letter acronym never beats a word the title already gave", () => {
  // "Gartner IT Symposium/Xpo" headed IT says nothing; the name it is known by is in the title.
  assert.equal(conferenceInitials("Gartner IT Symposium/Xpo"), "GARTNER");
  assert.equal(conferenceInitials("Pharma R&D 2027, 9th International Conference"), "PHARMA");
});

test("one long word is the whole name, not its first letter", () => {
  // Reduced to "G" and "S" because the only word distinguishing them ran past the width the panel
  // was sized for. The panel grows instead.
  assert.equal(conferenceInitials("Goldschmidt 2027 Conference"), "GOLDSCHMIDT");
  assert.equal(conferenceInitials("SuperReturn International 2027"), "SUPERRETURN");
  // Where two words share the work, their initials still say more than either truncated would.
  assert.equal(conferenceInitials("International Conference on Artificial Intelligence"), "AI");
});

test("the words every conference shares cannot distinguish one", () => {
  assert.deepEqual(
    distinctiveWords("2026 9th International Conference on Healthcare Service Management"),
    ["Healthcare", "Service", "Management"]
  );
  // "Annual Meeting with Materials Science & Technology" was headed WITH.
  assert.equal(conferenceInitials("Annual Meeting with Materials Science & Technology"), "MATERIALS");
  // A title of nothing but shared words falls back to its own initials rather than a stand-in:
  // there is nothing distinctive to find, and letters from this title still beat a generic word.
  assert.equal(conferenceInitials("The Annual Conference"), "TAC");
  assert.equal(conferenceInitials(""), "CONF");
});

test("a mark is sized so it fits the panel it sits in", () => {
  // "GASTECH" does not fit where "G2" did.
  assert.match(markSizeClass("G2"), /text-3xl/);
  assert.match(markSizeClass("GASTECH"), /text-xl/);
  assert.match(markSizeClass("GOLDSCHMIDT"), /text-sm/);
  assert.match(markSizeClass("G2", "hero"), /text-5xl/);
  assert.match(markSizeClass("GOLDSCHMIDT", "hero"), /text-xl/);
});
