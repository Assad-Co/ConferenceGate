// Every assertion here is a cell from the supplied AAPG detail list, and most of them are cells
// that would have published something false if read at face value.

import assert from "node:assert/strict";
import test from "node:test";
import {
  detailMatchKey, looksLikePersonName, mapCuratedDetailRow, parseCallForPapers, parseFees,
  parsePeople, parseSponsors,
  rowsFromDetailCsv, splitOutsideBrackets, splitVenue,
} from "../sources/curatedDetails";
import { parseCsv } from "../sources/curated";

const row = (over: Partial<Record<string, string>> = {}) => ({
  name: "Test Conference 2027", dates: "1-2 March 2027", venue: "", program: "",
  keynoteSpeakers: "", committee: "", pricing: "", sponsors: "", website: "", safetyNote: "",
  ...over,
});

test("a cell that withdraws what it just said is quoted, never structured", () => {
  // URTeC Latin America, verbatim. It names four companies and then says they are not this event's.
  // Reading the tier labels and stopping would have published four false sponsorships.
  const cell =
    "Hosted by YPF. Broader URTeC (main US 2026 event, separate conference) sponsor tiers are "
    + "published - Emerald: Chevron, ExxonMobil; Sapphire: Core Laboratories, Devon - but these are "
    + "NOT confirmed as sponsors of the Latin America Summit specifically.";
  assert.deepEqual(parseSponsors(cell), []);

  const detail = mapCuratedDetailRow(row({ sponsors: cell }), null);
  assert.equal(detail.sponsors.items.length, 0);
  assert.equal(detail.sponsors.unstructuredReason, "withdrawn_in_source");
  // The sentence survives in full, so a reader sees the withdrawal rather than a blank tab.
  assert.equal(detail.sponsors.text, cell);
});

test("a price range carried over from a previous edition is not this edition's price", () => {
  // 5th Edition Stratigraphic Traps of the Middle East. "~$350-$1,850" is real, published, and
  // about a different event.
  const cell =
    "Not yet published; prior editions have used similar tiered pricing (Non-Member/Member/"
    + "Presenter/Young Professional/Academia/Student) to other Middle East GTWs (~$350-$1,850 range) "
    + "- not confirmed for this specific edition.";
  assert.deepEqual(parseFees(cell).fees, []);
  const detail = mapCuratedDetailRow(row({ pricing: cell }), null);
  assert.equal(detail.fees.availability, "not_announced");
  assert.equal(detail.fees.unstructuredReason, "withdrawn_in_source");
});

test("a refund policy is not a registration category", () => {
  // The amount has to end the clause. "$100" sits mid-sentence in a refund rule, and an earlier
  // rule that merely looked for "text $number" published a fee called "Refund: full minus".
  const cell =
    "USD - Non-Member $1,850; Member (AAPG/EAGE/DGS/GSO/KGS) $1,650; Academia $500. "
    + "Fees include onsite documentation, coffee breaks, luncheons. "
    + "Refund: full minus $100 fee if cancelled 30+ days prior; no refund inside 30 days.";
  const { fees, currency } = parseFees(cell);
  assert.equal(currency, "USD");
  assert.deepEqual(fees.map((fee) => [fee.category, fee.amount]), [
    ["Non-Member", 1850], ["Member (AAPG/EAGE/DGS/GSO/KGS)", 1650], ["Academia", 500],
  ]);
  assert.equal(fees.some((fee) => fee.amount === 100), false, "the refund fee was published as a price");
});

test("two prices are only split when the cell says which is which", () => {
  // Suriname states its own scheme, so $895/$995 is early-bird and standard rather than a guess.
  const declared = parseFees(
    "USD, tax included. Early Bird (pay by 18 Oct) / Standard: Professional Nonmembers $895/$995; "
    + "Student Members (limit 20) $150/$165."
  ).fees;
  assert.deepEqual(declared.map((fee) => [fee.category, fee.amount]), [
    ["Professional Nonmembers (Early Bird)", 895],
    ["Professional Nonmembers (Standard)", 995],
    ["Student Members (limit 20) (Early Bird)", 150],
    ["Student Members (limit 20) (Standard)", 165],
  ]);

  // With no such heading, a pair of amounts says nothing about what either one is, so neither is
  // stored. Half a price is worse than no price.
  assert.deepEqual(parseFees("Professional Nonmembers $895/$995").fees, []);

  // And a slash inside a membership list is not a two-column scheme.
  assert.deepEqual(
    parseFees("USD - Member (AAPG/DGS/GSO/KGS) $1,650").fees.map((fee) => fee.category),
    ["Member (AAPG/DGS/GSO/KGS)"]
  );
});

test("a sentence about a committee is not a member of it", () => {
  // AAPG Rocky Mountain Section, verbatim. It has a name-shaped subject and a parenthesised
  // affiliation, which is exactly the shape a real entry has.
  const cell =
    "Managed by the RMS Executive Committee (Section Officers + representatives of its 11 "
    + "affiliated societies); individual meeting-specific committee names not yet published.";
  assert.deepEqual(parsePeople(cell, "Committee Member"), []);
  const detail = mapCuratedDetailRow(row({ committee: cell }), null);
  assert.equal(detail.committee.availability, "not_announced");
  assert.equal(detail.committee.text, cell, "the source's own account of who runs it was discarded");
});

test("a note about the list's length is not a person on it", () => {
  const people = parsePeople(
    "Herman Darman (Pertamina), Karthikeyan (Shell), plus additional members (full list on site)",
    "Committee Member"
  );
  assert.deepEqual(people.map((person) => person.name), ["Herman Darman", "Karthikeyan"]);

  // Nor is a sentence explaining that the keynotes were not itemised.
  const suriname = parsePeople(
    "Welcome/Opening Remarks: Sharista Kalapnat-Kisoensingh (Exploration Manager - Offshore "
    + "Directorate, Staatsolie). Keynote talks from Staatsolie and Ministry representatives "
    + "(specific keynote names not fully itemized on site beyond opening remarks).",
    "Keynote Speaker"
  );
  assert.deepEqual(suriname.map((person) => person.name), ["Sharista Kalapnat-Kisoensingh"]);
  assert.equal(suriname[0].role, "Welcome/Opening Remarks");
  assert.equal(suriname[0].title, "Exploration Manager - Offshore Directorate");
  assert.equal(suriname[0].org, "Staatsolie");
});

test("a role comes from the heading that introduced the person", () => {
  const people = parsePeople(
    "Inaugural Keynote: Mohammed Al-Mazrui (Exploration Director, PDO). Technical Keynotes: "
    + "Simon Stewart (Aramco) - 'Structural Style Frontiers'; Wilfried Bauer (GUTech) - "
    + "'The Neoproterozoic Basement of Oman'.",
    "Keynote Speaker"
  );
  assert.deepEqual(people.map((person) => [person.name, person.role]), [
    ["Mohammed Al-Mazrui", "Inaugural Keynote"],
    ["Simon Stewart", "Technical Keynotes"],
    // No heading of its own, so it falls back to the column's own label rather than borrowing the
    // previous person's.
    ["Wilfried Bauer", "Keynote Speaker"],
  ]);
  assert.equal(people[1].topic, "Structural Style Frontiers");
});

test("an initial is not the end of a sentence", () => {
  // "K.L. Chong (TGS-Malaysia)" split at "L. " and stored a committee member called "Chong".
  const people = parsePeople("Sau Hooi Yee (Petronas), K.L. Chong (TGS-Malaysia)", "Committee Member");
  assert.deepEqual(people.map((person) => person.name), ["Sau Hooi Yee", "K.L. Chong"]);
});

test("people sharing one affiliation are each of them a person", () => {
  const shared = parsePeople(
    "Steve Chappell/Robert Clarke/Joshua Dixon (Wood Mackenzie) - International Shale Exploration; "
    + "Jonathan Salo & Simon Lang (Univ. Western Australia) - Bintuni Basin Stratigraphy; "
    + "John Kaldi (CO2CRC & Adelaide University) - CCS in ASEAN",
    "Keynote Speaker"
  );
  assert.deepEqual(shared.map((person) => person.name), [
    "Steve Chappell", "Robert Clarke", "Joshua Dixon", "Jonathan Salo", "Simon Lang", "John Kaldi",
  ]);
  assert.equal(shared[0].org, "Wood Mackenzie");
  assert.equal(shared[2].topic, "International Shale Exploration");
  // The "&" inside the brackets joins one organisation's name and must not have split it in two.
  assert.equal(shared[5].org, "CO2CRC & Adelaide University");
});

test("a sponsor needs a label saying it is one", () => {
  const sponsors = parseSponsors(
    "Principal Sponsor & Host: Pertamina (PHE). Sponsoring Organization: AAPG. Host Society: "
    + "Indonesian Petroleum Association (IPA). Full exhibitor list/floor plan on Expocad "
    + "(aapgseg.expocad.com/Events/cie26jk)."
  );
  assert.deepEqual(sponsors.map((sponsor) => [sponsor.name, sponsor.tier]), [
    ["Pertamina (PHE)", "Principal Sponsor & Host"],
    ["AAPG", "Sponsoring Organization"],
    ["Indonesian Petroleum Association (IPA)", "Host Society"],
  ]);

  // A label with several organisations behind it gives each of them the label.
  assert.deepEqual(
    parseSponsors("Platinum Sponsors: Aramco, Petroleum Development Oman (PDO). Exhibitors: Petex, SLB.")
      .map((sponsor) => [sponsor.name, sponsor.tier]),
    [
      ["Aramco", "Platinum Sponsors"], ["Petroleum Development Oman (PDO)", "Platinum Sponsors"],
      ["Petex", "Exhibitors"], ["SLB", "Exhibitors"],
    ]
  );

  // A sentence about the sponsorship programme names no sponsor, whatever money it mentions.
  assert.deepEqual(
    parseSponsors("Sponsorship tiers range Patron ($2,500+) to Principal ($30,000+), with items like Opening Reception ($20,000)."),
    []
  );
});

test("a city in the venue column stays a city", () => {
  // Half these rows have no venue yet and put the place there instead. Filed as a venue, every one
  // of them would have shown "Kuwait City" as the name of a building.
  assert.deepEqual(splitVenue("Kuwait City, Al Ahmadi, Kuwait", "Kuwait City"),
    { name: null, address: "Kuwait City, Al Ahmadi, Kuwait" });
  assert.deepEqual(splitVenue("Houston, Texas", "Houston"), { name: null, address: "Houston, Texas" });
  assert.deepEqual(splitVenue("TBD", null), { name: null, address: null });

  // And a real venue is still read as one.
  assert.deepEqual(splitVenue("Bush Convention Center, Midland, Texas", "Midland"),
    { name: "Bush Convention Center", address: "Midland, Texas" });
  assert.deepEqual(splitVenue("Crowne Plaza Muscat by IHG, Qurum Heights, Muscat, Oman", "Muscat"),
    { name: "Crowne Plaza Muscat by IHG", address: "Qurum Heights, Muscat, Oman" });
});

test("not announced and could not be read are different answers", () => {
  // The distinction the whole file turns on. Both leave the tab empty; only one of them means
  // anybody should go and look again.
  const notAnnounced = mapCuratedDetailRow(row({ keynoteSpeakers: "Not yet announced" }), null);
  assert.equal(notAnnounced.keynotes.availability, "not_announced");

  const unread = mapCuratedDetailRow(
    row({ pricing: "Not extracted - registration portal (iceevent.org/2026/registration-information) blocks automated access; check site directly for current member/non-member/student rates." }),
    null
  );
  assert.equal(unread.fees.availability, "unread");

  // An empty cell is nobody having said anything, which is also not "there is none".
  assert.equal(mapCuratedDetailRow(row(), null).sponsors.availability, "unread");
});

test("looksLikePersonName separates a name from a sentence by its words", () => {
  for (const name of ["Sau Hooi Yee", "K.L. Chong", "Mohammed Al-Mazrui", "Karthikeyan", "Nan Fang"]) {
    assert.equal(looksLikePersonName(name), true, `${name} was rejected as a name`);
  }
  for (const sentence of [
    "Managed by the RMS Executive Committee", "plus additional members",
    "Keynote talks from Staatsolie and Ministry representatives", "Theme Chairs also include",
    "Full exhibitor list", "Not yet announced",
  ]) {
    assert.equal(looksLikePersonName(sentence), false, `${sentence} would have been stored as a person`);
  }
});

test("brackets protect their contents from every split", () => {
  assert.deepEqual(splitOutsideBrackets("A (x, y), B", [", "]), ["A (x, y)", "B"]);
  assert.deepEqual(splitOutsideBrackets("one. two", [". "]), ["one", "two"]);
});

test("the supplied detail file parses into the columns it declares", () => {
  const csv = [
    '"Conference Name","Dates","Venue","Program/Agenda","Keynote Speakers","Technical/Program Committee","Pricing/Registration","Sponsors/Exhibitors","Website","Regional Safety Note"',
    '"GeoGulf 2027","18-20 April 2027","Houston, Texas","Regional conference; program not yet published.","Not yet announced","Not yet announced","Not yet published","Not yet announced","https://gcags.org/",""',
  ].join("\n");
  const rows = rowsFromDetailCsv(parseCsv(csv));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "GeoGulf 2027");
  assert.equal(rows[0].website, "https://gcags.org/");
  assert.equal(rows[0].safetyNote, "");
  assert.equal(detailMatchKey("AAPG International Conference & Exhibition (ICE) 2026"),
    "aapg international conference exhibition ice 2026");
});

test("a call for papers is read from the programme, and only from a clause about one", () => {
  // WTGS, verbatim. The deadline, the address and the word limit were sitting in the Program tab's
  // prose while the Call for Papers tab said nothing at all.
  const wtgs = parseCallForPapers(
    "Theme: 'A Century Beneath the Surface'. Sun 9/13: FREE all-day short course, Icebreaker. "
    + "Call for Papers: abstracts due 26 June 2026 to submissions@wtgs.org, 500-word max, "
    + "20+5 min oral slots."
  );
  assert.equal(wtgs?.abstractDeadline, "2026-06-26");
  assert.equal(wtgs?.submissionEmail, "submissions@wtgs.org");
  assert.equal(wtgs?.lengthLimit, "500-word max");
  // The source said neither open nor closed, so neither is claimed — the reader has the date.
  assert.equal(wtgs?.status, null);

  assert.equal(parseCallForPapers("Call for Abstracts closed 1 September 2026 (no extensions).")?.status, "Closed");
  const open = parseCallForPapers("Call for poster abstracts open, deadline 9 November 2026 (send to cnavarro@aapg.org).");
  assert.equal(open?.status, "Open");
  assert.equal(open?.abstractDeadline, "2026-11-09");
  assert.equal(open?.submissionEmail, "cnavarro@aapg.org");
});

test("a short course's registration deadline is not the date abstracts are due", () => {
  // Structural Styles of the Middle East, verbatim. Two dates, two fees, one email-shaped string —
  // and not one word about a call for papers. Reading a date out of it would have published a
  // submission deadline the conference never set.
  const notACall = parseCallForPapers(
    "Includes poster session, breakout sessions, and an optional one-day short course "
    + "'Interpretation of Structural Styles - Enhanced Through Generative AI' (11 Oct, instructor "
    + "Pascal Richard/PRgeology, fee $590, registration deadline 15 September 2026) and a 2-day "
    + "field trip (15-16 Oct, fee $550; registration deadline 1 September 2026)."
  );
  assert.equal(notACall, null);

  // A programme with no call for papers in it at all yields nothing rather than an empty shell.
  assert.equal(parseCallForPapers("3-day program across 7 themes. Opening Ceremony, posters."), null);
  assert.equal(parseCallForPapers(""), null);
});
