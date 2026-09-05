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
