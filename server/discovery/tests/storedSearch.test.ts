import assert from "node:assert/strict";
import test from "node:test";
import { scoreStoredConferenceRecord } from "../../storedConferenceSearch";

const base = {
  title: "International Geoscience Congress 2027",
  acronym: "IGC 2027",
  topics: ["Carbon Capture", "Petroleum Engineering"],
  categories: ["Geosciences & Earth Systems"],
  keywords: ["CCUS"],
  description: "A research meeting for earth scientists.",
  organizer: "Society of Petroleum Engineers (SPE)",
  location: { city: "Dubai", country: "United Arab Emirates", region: "Middle East" },
  dates: { start_date: "2027-09-14", end_date: "2027-09-16" },
  officialUrl: "https://igc.example/2027",
  callForPapers: { abstract_submission_deadline: "September 1, 2027", topics_tracks: ["Reservoir modelling"] },
  programAgenda: { sessions: [{ title: "Machine Learning Workshop" }] },
  keynoteSpeakers: [{ name: "John Smith", affiliation: "University of Oxford" }],
  technicalCommittee: [{ name: "Aisha Rahman", role: "Program Chair" }],
  sponsorsExhibitors: [{ name: "ExxonMobil", sponsorship_level: "Gold" }],
  venueAccommodation: { venue_name: "Dubai World Trade Centre", accommodation: "Conference hotel" },
  feesPricing: { student_fee: "USD 200", pricing_text: "Student registration available" },
  community: { association: "SPE community" },
};

test("stored search covers identity, topics, organizer, location, and dates", () => {
  for (const query of ["IGC 2027", "Carbon Capture", "SPE", "Dubai", "Middle East 2027"]) {
    assert.notEqual(scoreStoredConferenceRecord(query, base), null, query);
  }
});

test("stored search covers CFP, program, people, sponsors, venue, and pricing", () => {
  for (const query of [
    "Abstract deadline September",
    "Machine Learning Workshop",
    "John Smith",
    "University of Oxford",
    "ExxonMobil",
    "Dubai World Trade Centre",
    "Student registration",
  ]) {
    assert.notEqual(scoreStoredConferenceRecord(query, base), null, query);
  }
});

test("direct title matches outrank incidental long-section matches", () => {
  const titleMatch = scoreStoredConferenceRecord("Geoscience", base)!;
  const incidental = scoreStoredConferenceRecord("Geoscience", {
    ...base,
    title: "Annual Research Forum",
    topics: [],
    categories: [],
    description: "",
    callForPapers: { notes: "Geoscience is mentioned incidentally in a long appendix." },
  })!;
  assert.ok(titleMatch > incidental);
});

test("records missing any meaningful query token are excluded", () => {
  assert.equal(scoreStoredConferenceRecord("ExxonMobil Canada", base), null);
});

test("natural-language worldwide search does not over-constrain results", () => {
  assert.notEqual(
    scoreStoredConferenceRecord("Find worldwide petroleum conferences in 2027", base),
    null
  );
});

test("regional discovery resolves region concepts from country data", () => {
  const bahrainRecord = {
    ...base,
    location: { city: "Manama", country: "Bahrain" },
  };
  assert.notEqual(scoreStoredConferenceRecord("GCC petroleum 2027", bahrainRecord), null);
  assert.notEqual(scoreStoredConferenceRecord("Middle East geoscience 2027", bahrainRecord), null);
});

test("semantic specialties bridge common professional search language", () => {
  const earthScienceRecord = {
    ...base,
    title: "Earth Science Research Meeting 2027",
    topics: ["Geology", "Geophysics", "Geochemistry"],
    categories: ["Earth Sciences"],
  };
  assert.notEqual(scoreStoredConferenceRecord("geoscience 2027", earthScienceRecord), null);
});

test("deeply prepared records win relevance ties without beating a direct identity match", () => {
  const deep = scoreStoredConferenceRecord("Carbon Capture", base)!;
  const thin = scoreStoredConferenceRecord("Carbon Capture", {
    ...base,
    callForPapers: null,
    programAgenda: null,
    keynoteSpeakers: null,
    technicalCommittee: null,
    sponsorsExhibitors: null,
    venueAccommodation: null,
    feesPricing: null,
    community: null,
  })!;
  assert.ok(deep > thin);

  const direct = scoreStoredConferenceRecord("International Geoscience Congress 2027", base)!;
  const incidental = scoreStoredConferenceRecord("International Geoscience Congress 2027", {
    ...base,
    title: "Other Meeting",
    acronym: "OM",
    topics: [],
    categories: [],
    description: "",
    callForPapers: { notes: "International Geoscience Congress 2027" },
  })!;
  assert.ok(direct > incidental);
});
