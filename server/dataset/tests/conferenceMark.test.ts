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
  //
  // The card scale came down a step when the results card swapped its growable panel for a fixed
  // 112px tile: GASTECH at the old text-2xl measured about 100px in 88px of room and was clipped
  // at both ends. The hero scale is the detail page's and is unchanged.
  assert.equal(markSizeClass("G2"), "text-2xl sm:text-3xl");
  assert.equal(markSizeClass("GASTECH"), "text-sm sm:text-base");
  assert.equal(markSizeClass("GOLDSCHMIDT"), "text-[10px] sm:text-xs");
  assert.match(markSizeClass("G2", "hero"), /text-5xl/);
  assert.match(markSizeClass("GOLDSCHMIDT", "hero"), /text-xl/);

  // One mark per bucket, so each step down is a real step rather than two names sharing a size.
  const steps = ["ABC", "ABCDE", "ABCDEFG", "ABCDEFGHI", "ABCDEFGHIJK"].map((mark) => markSizeClass(mark));
  assert.equal(new Set(steps).size, steps.length);
});

test("the society that runs a conference is not the conference's mark", () => {
  // Five AAPG events open with AAPG, and it is the longest acronym in every one, so every card read
  // AAPG — the society, not the event. A reader could not tell the Eastern Section meeting from the
  // Rocky Mountain one. It is the same failure the UN/COP31 rule already covers, arriving by a
  // different route: there the organiser's acronym was shorter, here it is longer.
  assert.equal(conferenceInitials("AAPG Eastern Section Annual Meeting 2026", "AAPG"), "EASTERN");
  assert.equal(conferenceInitials("AAPG Rocky Mountain Section Annual Meeting 2026", "AAPG"), "ROCKY");

  // Spelled out in the record and abbreviated in the title is still the same society.
  assert.equal(
    conferenceInitials("AAPG Eastern Section Annual Meeting 2026", "American Association of Petroleum Geologists"),
    "EASTERN"
  );

  // A society sharing the billing is no more the event's name than the first one is, and GTW names
  // a kind of workshop rather than one — so what is left is what the workshop is actually about.
  assert.equal(conferenceInitials("5th Edition AAPG/EAGE Hydrocarbon Seals of the Middle East GTW", "AAPG"), "SEALS");
  assert.equal(conferenceInitials("3rd Edition AAPG/EAGE Maximizing Asset Value GTW", "AAPG"), "ASSET");

  // An acronym that is the event's own survives, even alongside its organiser's.
  assert.equal(conferenceInitials("AAPG International Conference & Exhibition (ICE) 2026", "AAPG"), "ICE");
  assert.equal(conferenceInitials("UN Climate Change Conference COP31", "UNFCCC"), "COP31");
  // And with no organiser named, nothing changes.
  assert.equal(conferenceInitials("Gastech 2026"), "GASTECH");
});

test("a series prefix does not become the mark of every event in the series", () => {
  // Ten Cell Press symposia share one prefix; read from the front, all ten cards said CELL. What
  // separates them is the subject the prefix introduces.
  assert.equal(conferenceInitials("Cell Press Symposia: Functional RNAs"), "RNAS");
  assert.equal(conferenceInitials("Cell Press Symposia: Drugging the Undruggable"), "DRUGGING");
  assert.equal(conferenceInitials("Cell Press Symposia: Hallmarks of Aging"), "HALLMARKS");

  // A prefix carrying its own edition number is the name, not a label, and is kept.
  assert.equal(
    conferenceInitials("EPIDEMICS 11: 11th International Conference on Infectious Disease Dynamics"),
    "EPIDEMICS"
  );
  // A colon that is not introducing a series is left alone.
  assert.equal(conferenceInitials("15th NIZO Dairy Conference: Innovations in Milk Proteins"), "NIZO");
});

test("two societies joined by a slash are two words, not one", () => {
  // Stripping the slash produced AAPGEAGE, which is neither of them and named nothing.
  assert.deepEqual(distinctiveWords("AAPG/EAGE Hydrocarbon Seals"), ["AAPG", "EAGE", "Hydrocarbon", "Seals"]);
});
