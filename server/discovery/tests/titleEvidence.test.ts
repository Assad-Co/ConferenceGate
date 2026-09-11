// Whether a page the crawler read is the conference whose record it was read for.
//
// This decides what the unattended pass accepts, and it was refusing nearly everything: a sampled
// cycle reported title_does_not_match_record on 9 of 24 attempts, and the pages behind them were
// the right conferences. Every title here is one a real conference publishes on its own site.

import assert from "node:assert/strict";
import test from "node:test";
import { titleAcronyms, titleEvidenceScore } from "../sourceClassification";

const VERIFIES = 0.55;

test("a conference that titles its own page with its acronym is the same conference", () => {
  // normalizeTitle strips "international", "conference", "annual" and the year, so a stored name
  // written out in full and a page headed with the acronym share no token whatsoever.
  const pairs: [string, string][] = [
    ["2026 6th International Conference on Intelligent Technology and Embedded Systems", "ICITES 2026 | 杭州"],
    ["2026 8th International Conference on Circuits and Systems", "ICCS 2026 | 杭州"],
    ["2026 9th International Conference on Healthcare Service Management", "ICHSM 2026"],
    // PREE is the initials of the last four words, not of the whole title — both shapes are common
    // and neither is derivable from the other, so every suffix is offered.
    ["2026 4th International Conference on Power and Renewable Energy Engineering", "4th PREE | Tokyo, Japan"],
  ];
  for (const [stored, page] of pairs) {
    assert.ok(titleEvidenceScore(stored, page) >= VERIFIES, `refused its own page: ${page}`);
  }
});

test("a conference whose name is one word can be matched at all", () => {
  // Two shared tokens were required unless both sides were a single token, so a one-word name
  // against a page that says anything else about itself scored zero — forever.
  assert.ok(titleEvidenceScore("Gastech 2026", "Gastech Exhibition & Conference 2026 | BITEC – BANGKOK") >= VERIFIES);
  assert.ok(titleEvidenceScore("ADIPEC 2026", "ADIPEC | Abu Dhabi International Petroleum Exhibition and Conference") >= VERIFIES);
  // A short or common word alone is not enough to identify anything: "Expo" normalizes to four
  // letters and would otherwise match every exhibition centre on the web.
  assert.ok(titleEvidenceScore("Expo 2026", "Expo Centre Events and Exhibitions") < VERIFIES);
});

test("a page that is a different conference is still refused", () => {
  // The whole point of the guard. Loosening it to accept acronyms must not let one event's
  // programme be filed under another's.
  const wrong: [string, string][] = [
    ["2026 8th International Conference on Circuits and Systems", "ICITES 2026 | 杭州"],
    ["Gastech 2026", "ADIPEC 2026 Abu Dhabi International Petroleum Exhibition"],
    ["Gastech 2026", "Oil & Gas Industry News and Events"],
    ["2026 6th International Conference on Intelligent Technology and Embedded Systems", "IEEE Xplore Digital Library"],
    ["Goldschmidt 2027 Conference", "EAGE Annual Conference & Exhibition"],
    ["World Health Summit 2026", "World Economic Forum Annual Meeting"],
    ["ICCS 2026", "ICCV 2026 International Conference on Computer Vision"],
  ];
  for (const [stored, page] of wrong) {
    assert.ok(titleEvidenceScore(stored, page) < VERIFIES, `accepted a different conference: ${page}`);
  }
});

test("an acronym is built from the words of a name, not from its ordinal or year", () => {
  const acronyms = titleAcronyms("2026 4th International Conference on Power and Renewable Energy Engineering");
  assert.ok(acronyms.has("icpree"), "the whole name");
  assert.ok(acronyms.has("pree"), "the suffix its organisers actually use");
  assert.ok(!acronyms.has("24icpree"), "the year and ordinal are not letters of the name");
  // Two letters is a coincidence rather than a name, and nothing absurdly long is offered.
  for (const acronym of acronyms) {
    assert.ok(acronym.length >= 3 && acronym.length <= 12, `implausible acronym: ${acronym}`);
  }
});
