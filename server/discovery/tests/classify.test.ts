import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyRelevance } from "../classify";
import { classifyCategories, primaryCategory } from "../categories";
import { extractFromHtml, pageText } from "../htmlExtract";
import { extractStructuredEvents } from "../structuredData";
import { normalizeEventType, normalizeFormat } from "../normalize";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

function classifyFixture(name: string, url: string) {
  const html = fixture(name);
  const structured = extractStructuredEvents(html, url);
  const raw = extractFromHtml(html, url, { seed: structured.events[0] ?? null });
  const text = pageText(html);
  const { eventType } = normalizeEventType(raw.eventTypeText, raw.title, raw.schemaType);
  return classifyRelevance({
    title: raw.title,
    description: raw.description,
    pageText: text,
    url,
    schemaType: raw.schemaType,
    eventType,
    format: normalizeFormat(raw.formatText),
    hasDate: !!(raw.datesText || raw.startDateText),
    hasLocation: !!(raw.locationText || raw.city || raw.country),
    nonProfessionalSchemaTypes: structured.nonProfessionalTypes,
  });
}

test("a real academic conference is accepted with its reasoning attached", () => {
  const verdict = classifyFixture("jsonld-conference.html", "https://imog2027.example.org/");
  assert.equal(verdict.isRelevantEvent, true);
  assert.ok(verdict.confidenceScore > 0.7);
  assert.match(verdict.classificationReason, /Accepted for:/);
});

test("a professional conference with no structured data is still accepted", () => {
  const verdict = classifyFixture("plain-html-conference.html", "https://gcwdr2027.example.org/");
  assert.equal(verdict.isRelevantEvent, true);
});

test("a concert is rejected", () => {
  const verdict = classifyFixture("concert-page.html", "https://example.com/live");
  assert.equal(verdict.isRelevantEvent, false);
  assert.match(verdict.classificationReason, /concert|music/i);
});

test("a roundup of many conferences is rejected as a listing", () => {
  const verdict = classifyFixture("listing-page.html", "https://example.com/top-25-engineering-conferences-2027");
  assert.equal(verdict.isRelevantEvent, false);
  assert.match(verdict.classificationReason, /roundup|directory|plural/i);
});

test("a past event described in the past tense scores lower than an upcoming one", () => {
  const past = classifyFixture("past-conference.html", "https://example.nl/coastal-2019");
  const upcoming = classifyFixture("plain-html-conference.html", "https://gcwdr2027.example.org/");
  assert.ok(past.confidenceScore < upcoming.confidenceScore);
});

test("categories map onto the existing taxonomy, several at once when they genuinely apply", () => {
  const results = classifyCategories({
    title: "International Conference on Artificial Intelligence in Medical Imaging",
    description: "Deep learning for radiology, clinical trials and diagnosis.",
    topics: ["machine learning", "medical imaging"],
    organizer: null,
  });
  const names = results.map((r) => r.category);
  assert.ok(names.includes("Artificial Intelligence & Machine Learning"));
  assert.ok(names.includes("Medicine & Oncology"));
  assert.equal(primaryCategory(results), "Artificial Intelligence & Machine Learning");
  assert.ok(results[0].evidence.length > 0, "a classification always carries the words that produced it");
});

test("categories reach the subject areas the platform already uses", () => {
  const petroleum = classifyCategories({
    title: "Offshore Drilling and Reservoir Engineering Congress",
    description: "Upstream petroleum operations and subsea systems.",
    topics: [],
    organizer: null,
  });
  assert.equal(primaryCategory(petroleum), "Petroleum & Energy");

  const cyber = classifyCategories({
    title: "European Cybersecurity and Cryptography Summit",
    description: "Threat intelligence and network security for critical infrastructure.",
    topics: [],
    organizer: null,
  });
  assert.equal(primaryCategory(cyber), "Cybersecurity & Privacy");

  const water = classifyCategories({
    title: "9th Gulf Conference on Water Desalination and Reuse",
    description: "Membrane technology, brine management and chemical engineering for water reuse.",
    topics: ["Membrane technology"],
    organizer: null,
  });
  assert.ok(water.length > 0, "an engineering conference gets at least one category");
});

test("a title with no subject signal produces no category rather than a wrong one", () => {
  const results = classifyCategories({ title: "Annual General Meeting", description: null, topics: [], organizer: null });
  assert.deepEqual(results, []);
  assert.equal(primaryCategory(results), null);
});
