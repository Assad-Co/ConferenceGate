// Extraction tests run entirely on fixtures — no live site is contacted, so a conference site
// redesigning its pages can never turn this suite red for the wrong reason (section 35).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractStructuredEvents } from "../structuredData";
import { extractFromHtml, findImportantDates, pageText } from "../htmlExtract";
import { parseHtml, findFirst, textOf, canonicalLink } from "../html";
import { groundAiExtraction } from "../aiExtract";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

test("JSON-LD: reads every field the organiser published", () => {
  const { events } = extractStructuredEvents(fixture("jsonld-conference.html"), "https://imog2027.example.org/");
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.method, "structured_data");
  assert.equal(event.schemaType, "conferenceevent");
  assert.match(event.title!, /International Meeting on Organic Geochemistry/);
  assert.equal(event.startDateText, "2027-09-12");
  assert.equal(event.endDateText, "2027-09-17");
  assert.equal(event.city, "Lisbon");
  assert.equal(event.country, "Portugal");
  assert.equal(event.venue, "Centro de Congressos de Lisboa");
  assert.equal(event.latitude, 38.7045);
  assert.equal(event.formatText, "in_person");
  assert.equal(event.organizer, "European Association of Organic Geochemists");
  assert.equal(event.organizerUrl, "https://eaog.example.org/");
  assert.equal(event.registrationUrl, "https://imog2027.example.org/registration");
  assert.equal(event.price, "790");
  assert.equal(event.currency, "EUR");
  assert.equal(event.language, "en");
  assert.deepEqual(event.topics, ["organic geochemistry", "petroleum systems", "basin modelling"]);
  assert.ok(event.confidence > 0.8, "a complete structured record should be highly confident");
});

test("microdata: nested Place and PostalAddress resolve to city and country", () => {
  const { events } = extractStructuredEvents(fixture("microdata-conference.html"), "https://example.org/congress");
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.title, "African Renewable Energy Congress 2027");
  assert.equal(event.startDateText, "2027-03-08");
  assert.equal(event.endDateText, "2027-03-10");
  assert.equal(event.city, "Nairobi");
  assert.equal(event.country, "Kenya");
  assert.equal(event.venue, "Nairobi Convention Centre");
});

test("RDFa: typeof/property attributes are read", () => {
  const { events } = extractStructuredEvents(fixture("rdfa-conference.html"), "https://example.sg/symposium");
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Asia-Pacific Symposium on Robotics and Automation 2027");
  assert.equal(events[0].startDateText, "2027-11-04");
  assert.equal(events[0].country, "Singapore");
});

test("a MusicEvent is reported as a non-professional type, not extracted as a conference", () => {
  const result = extractStructuredEvents(fixture("concert-page.html"), "https://example.com/live");
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.nonProfessionalTypes, ["musicevent"]);
});

test("a page with no structured data yields no structured events", () => {
  const result = extractStructuredEvents(fixture("plain-html-conference.html"), "https://gcwdr2027.example.org/");
  assert.equal(result.events.length, 0);
  assert.equal(result.sawAnyStructuredData, false);
});

test("deterministic HTML: labelled values are read by label, not by position", () => {
  const raw = extractFromHtml(fixture("plain-html-conference.html"), "https://gcwdr2027.example.org/");
  assert.equal(raw.method, "html");
  assert.match(raw.title!, /Gulf Conference on Water Desalination and Reuse/);
  assert.equal(raw.datesText, "22–24 February 2027");
  assert.equal(raw.venue, "Doha Exhibition and Convention Center");
  assert.equal(raw.locationText, "Doha, Qatar");
  assert.equal(raw.organizer, "Gulf Water Engineering Society");
  assert.equal(raw.formatText, "In-person");
  assert.equal(raw.contactName, "Dr Layla Mansour");
  assert.equal(raw.contactEmail, "secretariat@gcwdr2027.example.org");
  assert.equal(raw.contactPhone, "+974 4412 8890");
  assert.ok(raw.topics.includes("Membrane technology"));
  assert.equal(raw.registrationUrl, "https://gcwdr2027.example.org/register");
});

test("contact name and phone stay separate fields", () => {
  const raw = extractFromHtml(fixture("plain-html-conference.html"), "https://gcwdr2027.example.org/");
  assert.ok(!/\d/.test(raw.contactName!), "a contact name never absorbs a phone number");
  assert.ok(/\d/.test(raw.contactPhone!));
});

test("important dates are read as label/value pairs", () => {
  const root = parseHtml(fixture("plain-html-conference.html"));
  const dates = findImportantDates(root);
  const labels = dates.map((entry) => entry.label.toLowerCase());
  assert.ok(labels.some((label) => label.includes("abstract submission deadline")));
  assert.ok(labels.some((label) => label.includes("notification")));
  assert.ok(labels.some((label) => label.includes("early bird")));
  for (const entry of dates) assert.match(entry.text, /\d/);
});

test("missing values stay null rather than being filled in", () => {
  const raw = extractFromHtml(
    "<html><head><title>Some Institute</title></head><body><h1>Welcome</h1><p>We are a research institute working across many fields of science and engineering.</p></body></html>",
    "https://example.org/"
  );
  assert.equal(raw.datesText, null);
  assert.equal(raw.city, null);
  assert.equal(raw.country, null);
  assert.equal(raw.formatText, null, "no format stated means no format, not in-person");
  assert.equal(raw.contactEmail, null);
  assert.deepEqual(raw.topics, []);
});

test("malformed markup is parsed as far as it goes rather than throwing", () => {
  const html = fixture("malformed.html");
  const raw = extractFromHtml(html, "https://example.is/symposium");
  assert.match(raw.title!, /Malformed Markup/);
  assert.equal(raw.datesText, "5–7 October 2027");
  // The JSON-LD in this fixture has a trailing comma; the repair path should still read it.
  const structured = extractStructuredEvents(html, "https://example.is/symposium");
  assert.equal(structured.events.length, 1);
  assert.equal(structured.events[0].startDateText, "2027-10-05");
});

test("page text drops navigation, cookie banners and scripts", () => {
  const text = pageText(fixture("plain-html-conference.html"));
  assert.ok(!text.includes("Log in"), "navigation is not page content");
  assert.ok(!text.includes("All rights reserved"), "footer boilerplate is not page content");
  assert.ok(text.includes("Doha Exhibition and Convention Center"));
});

test("the canonical link is read when the page declares one", () => {
  const root = parseHtml(fixture("jsonld-conference.html"));
  assert.equal(canonicalLink(root, "https://imog2027.example.org/programme"), "https://imog2027.example.org/");
});

test("the HTML parser keeps element nesting", () => {
  const root = parseHtml("<div><section><p>Inner <em>text</em></p></section></div>");
  const section = findFirst(root, (node) => node.tag === "section");
  assert.ok(section);
  assert.equal(textOf(section!), "Inner text");
});

test("AI output is discarded when the page does not support it", () => {
  const text = "The Baltic Symposium on Marine Robotics takes place in Gdansk on 4 June 2027.";
  const { extraction, droppedFields } = groundAiExtraction(
    {
      title: "The Baltic Symposium on Marine Robotics",
      city: "Gdansk",
      // Nothing on the page says Poland, or gives this email, or this URL. All three are dropped.
      country: "Poland",
      contact_email: "chair@invented.example.com",
      registration_url: "https://invented.example.com/register",
      topics: ["Marine Robotics", "Quantum Computing"],
    },
    text,
    "https://example.pl/baltic"
  );
  assert.ok(extraction);
  assert.equal(extraction!.city, "Gdansk");
  assert.equal(extraction!.country, null, "a country the page never states is not kept");
  assert.equal(extraction!.contactEmail, null);
  assert.equal(extraction!.registrationUrl, null);
  assert.deepEqual(extraction!.topics, ["Marine Robotics"], "only topics the page contains survive");
  assert.ok(droppedFields.includes("country"));
  assert.ok(droppedFields.includes("contact_email"));
});
