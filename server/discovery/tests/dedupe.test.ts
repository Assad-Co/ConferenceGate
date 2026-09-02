import { test } from "node:test";
import assert from "node:assert/strict";
import { bestDuplicate, scoreDuplicate, seriesKeyFor, titleSimilarity, type DuplicateCandidate } from "../dedupe";
import { validateEvent } from "../validate";
import { EMPTY_DEADLINES, type NormalizedEvent } from "../types";

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    title: "33rd International Meeting on Organic Geochemistry",
    acronym: "IMOG",
    description: "Researchers in petroleum geochemistry, source rock analysis and basin modelling meet in Lisbon.",
    startDate: "2027-09-12",
    endDate: "2027-09-17",
    startYear: 2027,
    startMonth: 9,
    datePrecision: "day",
    datesText: "12–17 September 2027",
    deadlines: { ...EMPTY_DEADLINES, abstractDeadline: "2027-02-15" },
    venue: "Centro de Congressos de Lisboa",
    venueAddress: null,
    city: "Lisbon",
    region: null,
    country: "Portugal",
    countryCode: "PT",
    rawLocation: "Centro de Congressos de Lisboa, Lisbon, Portugal",
    latitude: null,
    longitude: null,
    format: "in_person",
    eventType: "professional_meeting",
    originalEventType: "ConferenceEvent",
    organizer: "European Association of Organic Geochemists",
    organizerUrl: null,
    officialUrl: "https://imog2027.example.org/",
    registrationUrl: "https://imog2027.example.org/registration",
    submissionUrl: null,
    imageUrl: null,
    price: null,
    currency: null,
    language: "en",
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    topics: ["organic geochemistry"],
    categories: [{ category: "Geosciences & Earth Systems", confidence: 0.8, evidence: ["geochemistry"] }],
    series: { name: null, acronym: "IMOG", edition: "33", year: 2027 },
    sourceUrl: "https://imog2027.example.org/",
    sourceDomain: "imog2027.example.org",
    extractionMethod: "structured_data",
    confidenceScore: 0.9,
    relevance: {
      isRelevantEvent: true,
      classification: "professional_meeting",
      confidenceScore: 0.9,
      classificationReason: "Accepted for: states dates",
    },
    provenance: {},
    qualityFlags: [],
    contentHash: "abc123",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id: "dev_existing",
    title: "IMOG 2027 — International Meeting on Organic Geochemistry",
    normalized_title: "meeting organic geochemistry",
    acronym: "IMOG",
    start_date: "2027-09-12",
    end_date: "2027-09-17",
    start_year: 2027,
    start_month: 9,
    city: "Lisbon",
    country: "Portugal",
    organizer: "European Association of Organic Geochemists",
    official_url: "https://imog2027.example.org/",
    canonical_url: "imog2027.example.org",
    description: "Researchers in petroleum geochemistry, source rock analysis and basin modelling meet in Lisbon.",
    series_id: "acr:IMOG",
    ...overrides,
  };
}

test("the same conference from two sources merges", () => {
  const verdict = scoreDuplicate(makeEvent({ sourceUrl: "https://society.example.org/events/imog" }), makeCandidate());
  assert.equal(verdict.decision, "merge");
  assert.ok(verdict.score >= 0.85);
  assert.match(verdict.reason, /canonical URL|acronym|start date/);
});

test("two editions of one series are not duplicates of each other", () => {
  const next = makeEvent({
    title: "34th International Meeting on Organic Geochemistry",
    startDate: "2029-09-10",
    endDate: "2029-09-15",
    startYear: 2029,
    startMonth: 9,
    officialUrl: "https://imog2029.example.org/",
    sourceUrl: "https://imog2029.example.org/",
  });
  const verdict = scoreDuplicate(next, makeCandidate());
  assert.notEqual(verdict.decision, "merge");
  assert.match(verdict.reason, /different dates/);
});

test("same-name conferences in different countries stay separate", () => {
  const other = makeEvent({
    title: "International Meeting on Organic Geochemistry",
    city: "Tokyo",
    country: "Japan",
    startDate: "2027-11-01",
    endDate: "2027-11-03",
    startMonth: 11,
    officialUrl: "https://example.jp/imog",
    sourceUrl: "https://example.jp/imog",
    acronym: null,
  });
  assert.equal(scoreDuplicate(other, makeCandidate()).decision, "separate");
});

test("a middling match is queued for review rather than merged or dropped", () => {
  const similar = makeEvent({
    title: "International Meeting on Organic Geochemistry",
    acronym: null,
    officialUrl: "https://another.example.org/imog",
    sourceUrl: "https://another.example.org/imog",
    startDate: null,
    endDate: null,
    datePrecision: "month",
    organizer: null,
    description: null,
  });
  const verdict = scoreDuplicate(similar, makeCandidate());
  assert.equal(verdict.decision, "review");
});

test("bestDuplicate picks the strongest match and ignores unrelated records", () => {
  const unrelated = makeCandidate({
    id: "dev_unrelated",
    title: "European Congress on Cardiology",
    acronym: "ECC",
    city: "Vienna",
    country: "Austria",
    canonical_url: "ecc.example.org",
    official_url: "https://ecc.example.org/",
    series_id: "acr:ECC",
    description: null,
  });
  const match = bestDuplicate(makeEvent({ sourceUrl: "https://listing.example.org/imog" }), [unrelated, makeCandidate()]);
  assert.ok(match);
  assert.equal(match!.candidate.id, "dev_existing");
});

test("title similarity ignores years and edition numbers", () => {
  // The acronym in one title and not the other keeps this below a perfect score, which is right:
  // it lands in the "similar" band where other signals decide, not the "identical" band.
  assert.ok(titleSimilarity("IMOG 2027 Organic Geochemistry Meeting", "34th Organic Geochemistry Meeting 2029") > 0.7);
  assert.equal(titleSimilarity("Organic Geochemistry Meeting 2027", "Organic Geochemistry Meeting 2029"), 1);
  assert.ok(titleSimilarity("Congress on Cardiology", "Symposium on Marine Robotics") < 0.2);
});

test("series keys group editions and separate different conferences", () => {
  assert.equal(
    seriesKeyFor({ title: "33rd IMOG 2027", acronym: "IMOG", organizer: null }),
    seriesKeyFor({ title: "34th IMOG 2029", acronym: "IMOG", organizer: null })
  );
  assert.notEqual(
    seriesKeyFor({ title: "Congress on Cardiology", acronym: null, organizer: null }),
    seriesKeyFor({ title: "Symposium on Robotics", acronym: null, organizer: null })
  );
});

// -------------------------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------------------------

const NOW = new Date("2026-09-02T00:00:00Z");

test("a coherent upcoming conference validates", () => {
  const result = validateEvent(makeEvent(), { targetYears: [2026, 2027, 2028], sourceTrust: 0.9, now: NOW });
  assert.equal(result.valid, true);
  assert.equal(result.status, "validated", "Phase 1 holds even good records rather than auto-publishing");
});

test("nothing is auto-published unless auto-publish is explicitly allowed", () => {
  const published = validateEvent(makeEvent(), {
    targetYears: [2026, 2027, 2028],
    sourceTrust: 0.9,
    now: NOW,
    allowAutoPublish: true,
  });
  assert.equal(published.status, "published");
});

test("an end date before the start date is rejected", () => {
  const result = validateEvent(makeEvent({ endDate: "2027-09-01" }), {
    targetYears: [2027],
    sourceTrust: 0.9,
    now: NOW,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("end_date_before_start_date"));
});

test("a conference that has already happened is marked expired", () => {
  const result = validateEvent(makeEvent({ startDate: "2019-04-03", endDate: "2019-04-05", startYear: 2019 }), {
    targetYears: [2026, 2027, 2028],
    sourceTrust: 0.9,
    now: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.status, "expired");
});

test("a passed abstract deadline does not reject an upcoming conference", () => {
  const result = validateEvent(makeEvent({ deadlines: { ...EMPTY_DEADLINES, abstractDeadline: "2026-01-10" } }), {
    targetYears: [2026, 2027, 2028],
    sourceTrust: 0.9,
    now: NOW,
  });
  assert.equal(result.valid, true, "a closed call for papers is not a reason to drop the conference");
  assert.ok(result.qualityFlags.includes("abstract_deadline_passed"));
});

test("thin records are flagged neutrally and held for review, never accused of anything", () => {
  const result = validateEvent(
    makeEvent({
      organizer: null,
      country: null,
      city: null,
      description: null,
      officialUrl: null,
      format: "unknown",
      confidenceScore: 0.4,
      categories: [],
    }),
    { targetYears: [2026, 2027, 2028], sourceTrust: 0.5, now: NOW }
  );
  assert.equal(result.status, "needs_review");
  for (const flag of ["missing_organizer", "unverifiable_location", "low_source_confidence", "low_trust_source"]) {
    assert.ok(result.qualityFlags.includes(flag), flag);
  }
  assert.ok(
    result.qualityFlags.every((flag) => !/fraud|fake|scam|predatory/i.test(flag)),
    "flags describe missing data, never make accusations"
  );
});
