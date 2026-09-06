// Deep conference sections: what the extractor must read, and — more importantly — what it must
// refuse to read. Most of these tests are about the second half.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { dbAll, dbGet, dbRun } from "../../db";
import { configureDomainLimits } from "../httpClient";
import { initDiscoverySchema } from "../schema";
import { fetchRobots, isPathAllowed } from "../robots";
import { newReadBudget, readPage } from "../readPage";
import { runEnrichment } from "../enrichment";
import { publishDiscoveredConferences, toExtractedConferenceRecord } from "../publish";
import {
  collectDeepSections, deepSectionsMissing, storeDeepSections, storedSectionIsEmpty,
  buildDeepCoverageReport,
} from "../deepEnrichment";
import {
  extractDeepSections, findSectionPages, looksLikeAffiliation, looksLikePersonName,
  looksLikeSponsorName, looksLikeUiText, sectionForHeading, speakerRoleFromHeading, tierFromHeading,
} from "../deepSections";
import { candidateUrlBelongsToEvent, eventIdentityFrom, pageBelongsToEvent } from "../eventIdentity";

// The SSRF guard blocks loopback, as it should. Fixture tests inject their own guard rather than
// weakening it, and it doubles as a hard stop on any test reaching a real host.
const localGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);

// ---------------------------------------------------------------------------------------------
// What a person is
// ---------------------------------------------------------------------------------------------

test("a person's name is told apart from a section label, a company and a sentence", () => {
  for (const name of ["Amara Okafor", "Prof. Lars Henriksen", "Mei-Ling Chen", "Rafael da Silva", "Ingrid Sørensen"]) {
    assert.ok(looksLikePersonName(name), `${name} should read as a person`);
  }
  for (const notPerson of [
    "Gold Sponsors", "Keynote Speakers", "Organising Committee", "Acme Instruments Ltd",
    "University of Lagos", "Register now", "Important Dates", "Read more", "2027", "",
    "j smith", "Contact", "Call for Papers",
  ]) {
    assert.ok(!looksLikePersonName(notPerson), `${notPerson} must not be read as a person`);
  }
});

test("an affiliation is recorded from a marker or a label, and never merely from proximity", () => {
  assert.ok(looksLikeAffiliation("University of Lagos"));
  assert.ok(looksLikeAffiliation("Norwegian Institute of Technology"));
  assert.ok(looksLikeAffiliation("Universidade de São Paulo"));
  // No organisation marker: only the page separating the field out makes this evidence.
  assert.ok(!looksLikeAffiliation("Barcelona"));
  assert.ok(looksLikeAffiliation("Barcelona", true));
  assert.ok(!looksLikeAffiliation("speaker@example.org", true));
});

test("a heading is filed under exactly one section, and a programme committee is a committee", () => {
  assert.equal(sectionForHeading("Technical Program Committee"), "committee");
  assert.equal(sectionForHeading("Organising Committee"), "committee");
  assert.equal(sectionForHeading("Keynote Speakers"), "speakers");
  assert.equal(sectionForHeading("Gold Sponsors"), "sponsors");
  assert.equal(sectionForHeading("Conference Programme"), "program");
  assert.equal(sectionForHeading("Important Dates"), "importantDates");
  assert.equal(sectionForHeading("Registration fees"), null);
  assert.equal(speakerRoleFromHeading("Keynote Speakers"), "Keynote");
  assert.equal(speakerRoleFromHeading("Invited Talks"), "Invited");
  assert.equal(speakerRoleFromHeading("Our Speakers"), "Speaker");
  assert.equal(tierFromHeading("Platinum Sponsors"), "Platinum");
  assert.equal(tierFromHeading("Sponsors"), null);
});

// ---------------------------------------------------------------------------------------------
// One page in, one set of sections out
// ---------------------------------------------------------------------------------------------

const SPEAKERS_HTML = `<html><body>
<h1>ICMLA 2027</h1>
<h2>Keynote Speakers</h2>
<div class="speaker-card">
  <img src="/img/okafor.jpg" alt="">
  <h3 class="speaker-name">Prof. Amara Okafor</h3>
  <p class="affiliation">University of Lagos</p>
  <p class="talk">“Federated Learning at Continental Scale”</p>
</div>
<h3>Invited Speakers</h3>
<ul>
  <li>Mei-Ling Chen, Academia Sinica</li>
  <li>Kwame Boateng</li>
  <li>Registration closes 4 May</li>
</ul>
<h2>Attendees</h2>
<ul><li>Jane Ordinary</li><li>Peter Attendee</li></ul>
</body></html>`;

test("speakers take their role from the heading above them, and their affiliation only when stated", () => {
  const { speakers } = extractDeepSections(SPEAKERS_HTML, "https://icmla27.example/speakers");
  const byName = new Map(speakers.map((speaker) => [speaker.name, speaker]));

  assert.equal(byName.get("Amara Okafor")?.role, "Keynote");
  assert.equal(byName.get("Amara Okafor")?.org, "University of Lagos");
  assert.equal(byName.get("Amara Okafor")?.presentation_title, "“Federated Learning at Continental Scale”");
  assert.equal(byName.get("Amara Okafor")?.source_url, "https://icmla27.example/speakers");
  assert.equal(byName.get("Mei-Ling Chen")?.role, "Invited", "the nearer heading wins over the broader one");

  // Named with no affiliation anywhere: the field stays empty rather than borrowing a neighbour's.
  assert.ok(byName.has("Kwame Boateng"));
  assert.equal(byName.get("Kwame Boateng")?.org, null);

  // A different heading owns these, so they are not speakers however person-shaped they look.
  assert.ok(!byName.has("Jane Ordinary"), "attendees are not speakers");
  assert.ok(!byName.has("Peter Attendee"));
  assert.ok(!speakers.some((speaker) => /Registration/i.test(speaker.name)));
});

test("a committee table supplies names, affiliations and the roles it names", () => {
  const { committee } = extractDeepSections(`<html><body>
    <h2>Scientific Committee</h2>
    <table>
      <tr><th>Name</th><th>Affiliation</th><th>Role</th></tr>
      <tr><td>Ingrid Sørensen</td><td>KTH Royal Institute of Technology</td><td>General Chair</td></tr>
      <tr><td>Yusuf Demir</td><td>Middle East Technical University</td><td>Programme Chair</td></tr>
    </table></body></html>`, "https://icmla27.example/committee");
  assert.equal(committee.length, 2);
  assert.equal(committee[0].name, "Ingrid Sørensen");
  assert.equal(committee[0].org, "KTH Royal Institute of Technology");
  assert.equal(committee[0].role, "General Chair");
  assert.equal(committee[1].role, "Programme Chair");
});

test("sponsors carry their tier and kind, and the organiser is never one of them", () => {
  const { sponsors } = extractDeepSections(`<html><body>
    <h1>Sponsors and Exhibitors</h1>
    <h2>Organised by</h2>
    <ul><li><a href="/host"><img src="/logos/host.png" alt="Helsinki Systems Society logo"></a></li></ul>
    <h2>Gold Sponsors</h2>
    <div><a href="https://acme.example"><img src="/logos/acme.png" alt="Acme Instruments logo"></a></div>
    <h2>Exhibitors</h2>
    <ul><li>Baltic Photonics</li><li>Read more</li></ul>
    </body></html>`, "https://icmla27.example/sponsors");

  const names = sponsors.map((sponsor) => sponsor.name);
  assert.deepEqual(names.sort(), ["Acme Instruments", "Baltic Photonics"]);
  assert.ok(!names.includes("Helsinki Systems Society"), "an organiser must never be read as a sponsor");
  assert.ok(!names.includes("Read more"), "navigation is not a sponsor");
  const acme = sponsors.find((sponsor) => sponsor.name === "Acme Instruments")!;
  assert.equal(acme.tier, "Gold");
  assert.equal(acme.classification, "sponsor");
  assert.equal(acme.logoUrl, "https://icmla27.example/logos/acme.png");
  assert.equal(sponsors.find((sponsor) => sponsor.name === "Baltic Photonics")?.classification, "exhibitor");
});

test("a programme table yields sessions, tracks, session types and the dates beside them", () => {
  const { program, community } = extractDeepSections(`<html><body>
    <h1>Programme</h1>
    <h2>Track A: Machine Learning</h2>
    <table>
      <tr><th>Time</th><th>Session</th><th>Room</th><th>Speaker</th></tr>
      <tr><td>09:00 - 09:45</td><td>Opening keynote</td><td>Aula Magna</td><td>Amara Okafor</td></tr>
      <tr><td>10:00 - 11:30</td><td>Workshop: Reproducible pipelines</td><td>Room 2</td><td></td></tr>
    </table>
    <h2>Important Dates</h2>
    <ul><li>Abstract deadline: 15 March 2027</li><li>Notification of acceptance: 30 April 2027</li></ul>
    <footer><a href="https://twitter.com/icmla27">Follow us</a><span class="social">#ICMLA27</span></footer>
    </body></html>`, "https://icmla27.example/program");

  assert.equal(program?.sessions.length, 2);
  assert.equal(program?.sessions[0].time, "09:00 - 09:45");
  assert.equal(program?.sessions[0].title, "Opening keynote");
  assert.equal(program?.sessions[0].location, "Aula Magna");
  assert.equal(program?.sessions[0].speakerName, "Amara Okafor");
  assert.equal(program?.sessions[0].session_type, "keynote");
  assert.equal(program?.sessions[1].session_type, "workshop");
  assert.deepEqual(program?.tracks, ["Track A: Machine Learning"]);
  assert.equal(program?.important_dates.length, 2);
  assert.equal(program?.important_dates[0].isDeadline, true);
  assert.deepEqual(community?.social_media, [{ platform: "X", url: "https://twitter.com/icmla27" }]);
  assert.equal(community?.hashtag, "#ICMLA27");
});

test("schema.org is read first, and an organizer is not turned into a sponsor", () => {
  const result = extractDeepSections(`<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ConferenceEvent","name":"NordicBio 2027",
     "performer":[{"@type":"Person","name":"Elin Vasquez","affiliation":{"@type":"Organization","name":"Karolinska Institutet"}}],
     "sponsor":[{"@type":"Organization","name":"Nordisk Biotek"}],
     "organizer":{"@type":"Organization","name":"Nordic Bio Society"},
     "subEvent":[{"@type":"Event","name":"Poster session","startDate":"2027-06-11T14:00","location":{"name":"Hall B"}}]}
    </script></head><body><h1>NordicBio 2027</h1></body></html>`, "https://nordicbio.example/");

  assert.equal(result.speakers[0].name, "Elin Vasquez");
  assert.equal(result.speakers[0].org, "Karolinska Institutet");
  assert.equal(result.speakers[0].role, null, "schema.org says they perform, not that they keynote");
  assert.deepEqual(result.sponsors.map((sponsor) => sponsor.name), ["Nordisk Biotek"]);
  assert.equal(result.program?.sessions[0].title, "Poster session");
  assert.equal(result.program?.sessions[0].location, "Hall B");
});

test("only same-domain HTML pages are followed", () => {
  const found = findSectionPages(`<nav>
    <a href="/program">Programme</a><a href="/speakers">Speakers</a>
    <a href="/register">Register</a><a href="https://elsewhere.example/speakers">Partner site</a>
    <a href="/program.pdf">PDF programme</a><a href="mailto:chair@icmla27.example">Mail</a></nav>`,
    "https://icmla27.example/");
  const urls = found.map((candidate) => candidate.url);
  assert.deepEqual(urls.sort(), ["https://icmla27.example/program", "https://icmla27.example/speakers"]);
});

// ---------------------------------------------------------------------------------------------
// End to end, over real HTTP, through the production enrichment pass
//
// A small conference site with its programme, speakers, committee and sponsors on separate pages —
// which is how conferences are actually built, and the reason landing-page-only enrichment left
// all five sections at zero. robots.txt disallows /committee, so that section must stay empty
// while the others fill: the deep pass is not a special case that gets to ignore it.
// ---------------------------------------------------------------------------------------------

const CONFERENCE_PAGES: Record<string, string> = {
  "/robots.txt": "User-agent: *\nDisallow: /committee\n",
  "/": `<html><head><title>Baltic Photonics Congress 2027</title>
    <link rel="canonical" href="__ORIGIN__/">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ConferenceEvent","name":"Baltic Photonics Congress 2027",
     "url":"__ORIGIN__/","startDate":"2027-09-14","endDate":"2027-09-17",
     "location":{"@type":"Place","name":"Tallinn Creative Hub",
       "address":{"@type":"PostalAddress","addressLocality":"Tallinn","addressCountry":"Estonia"}},
     "organizer":{"@type":"Organization","name":"Baltic Optical Society"}}
    </script></head><body>
    <h1>Baltic Photonics Congress 2027</h1>
    <p>The Baltic Photonics Congress 2027 takes place in Tallinn, Estonia from 14 to 17 September 2027.
      The congress brings together researchers working on integrated optics, fibre sensing and quantum
      photonics for four days of talks, workshops and laboratory demonstrations at the Tallinn Creative Hub.</p>
    <p>Registration opens in March 2027. Authors are invited to submit abstracts of up to two pages
      through the submission system, and accepted contributions appear in the congress proceedings.</p>
    <nav><a href="/registration">Registration</a><a href="/program">Programme</a>
      <a href="/speakers">Speakers</a><a href="/committee">Committee</a>
      <a href="/sponsors">Sponsors</a><a href="/venue">Venue</a></nav>
    <p>Organised by the Baltic Optical Society.</p></body></html>`,
  "/program": `<html><body><h1>Programme</h1>
    <h2>Track B: Integrated Optics</h2>
    <table>
      <tr><th>Time</th><th>Session</th><th>Room</th></tr>
      <tr><td>09:30 - 10:15</td><td>Opening plenary</td><td>Hall A</td></tr>
      <tr><td>11:00 - 12:30</td><td>Workshop: Waveguide fabrication</td><td>Lab 3</td></tr>
    </table>
    <h2>Important Dates</h2>
    <ul><li>Abstract deadline: 12 April 2027</li></ul></body></html>`,
  "/speakers": `<html><body><h1>Speakers</h1>
    <h2>Keynote Speakers</h2>
    <div class="speaker"><h3 class="speaker-name">Dr. Kadri Tamm</h3>
      <p class="affiliation">Tallinn University of Technology</p></div>
    <div class="speaker"><h3 class="speaker-name">Janusz Wojcik</h3>
      <p class="affiliation">Wroclaw Institute of Photonics</p></div>
    </body></html>`,
  "/committee": `<html><body><h1>Committee</h1>
    <h2>Scientific Committee</h2>
    <table><tr><th>Name</th><th>Affiliation</th><th>Role</th></tr>
      <tr><td>Liisa Kask</td><td>University of Tartu</td><td>General Chair</td></tr></table>
    </body></html>`,
  "/sponsors": `<html><body><h1>Sponsors</h1>
    <h2>Platinum Sponsors</h2>
    <div><a href="https://northlight.example"><img src="/logos/nl.png" alt="Northlight Optics logo"></a></div>
    <h2>Exhibitors</h2><ul><li>Gulf Coast Lasers</li></ul></body></html>`,
};

/** These fixtures live for one test. Left behind, they become other files' sample rows. */
async function forgetEvent(eventId: string): Promise<void> {
  for (const table of ["discovery_event_fields", "discovery_event_changes", "discovery_event_sources", "discovery_run_events"]) {
    await dbRun(`DELETE FROM ${table} WHERE event_id=?`, [eventId]);
  }
  await dbRun("DELETE FROM discovery_events WHERE id=?", [eventId]);
}

async function withConferenceSite<T>(run: (origin: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    const key = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
    const body = CONFERENCE_PAGES[key];
    if (!body) { res.writeHead(404, { "content-type": "text/html" }); res.end("<html><body>Not found</body></html>"); return; }
    res.writeHead(200, { "content-type": key.endsWith(".txt") ? "text/plain" : "text/html" });
    res.end(body.replace(/__ORIGIN__/g, `http://127.0.0.1:${(server.address() as any).port}`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  try {
    return await run(origin);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("enrichment reads the deep sections off the organiser's own subpages, and obeys robots there", async () => {
  await initDiscoverySchema();
  await withConferenceSite(async (origin) => {
    const eventId = `deep-e2e-${Date.now()}`;
    const runId = `deep-run-${Date.now()}`;
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
       start_date,start_year,country,city,format,confidence_score,publish_readiness)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [eventId, "Baltic Photonics Congress 2027", "baltic photonics congress 2027", "html",
        `${origin}/`, "127.0.0.1", `${origin}/`, "validated",
        "2027-09-14", 2027, "Estonia", "Tallinn", "in_person", 0.55, "needs_enrichment"]);
    await dbRun(`INSERT INTO discovery_run_events (run_id,event_id,outcome,validation_status,provider,source_url)
      VALUES (?,?,?,?,?,?)`, [runId, eventId, "accepted", "validated", "test", `${origin}/`]);

    try {
    const before = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [eventId]);
    assert.deepEqual(deepSectionsMissing(before!).sort(), ["committee", "community", "program", "speakers", "sponsors"]);

    const report = await runEnrichment({
      runId, limit: 5, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 5,
      timeBudgetMs: 60_000, urlGuard: localGuard, quiet: true,
    });
    assert.equal(report.status, "completed");

    const after = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [eventId]);
    const speakers = JSON.parse(after!.keynote_speakers || "[]");
    const program = JSON.parse(after!.program_agenda || "null");
    const sponsors = JSON.parse(after!.sponsors_exhibitors || "[]");

    assert.deepEqual(speakers.map((s: any) => s.name).sort(), ["Janusz Wojcik", "Kadri Tamm"]);
    assert.equal(speakers[0].role, "Keynote");
    assert.ok(speakers.every((s: any) => s.org), "affiliations the pages stated are kept");
    assert.equal(program.sessions.length, 2);
    assert.equal(program.sessions[1].session_type, "workshop");
    assert.equal(program.important_dates[0].label, "Abstract deadline");
    assert.deepEqual(sponsors.map((s: any) => s.name).sort(), ["Gulf Coast Lasers", "Northlight Optics"]);
    assert.equal(sponsors.find((s: any) => s.name === "Northlight Optics").tier, "Platinum");

    // robots.txt disallows /committee. The page exists and would have parsed cleanly.
    assert.ok(storedSectionIsEmpty(after!.technical_committee), "a disallowed page is not read, deep pass included");

    // Every section names the page that stated it, and that page is a subpage rather than the root.
    const provenance = await dbAll<{ field: string; source_url: string }>(
      `SELECT field, source_url FROM discovery_event_fields WHERE event_id=?
        AND field IN ('programAgenda','keynoteSpeakers','sponsorsExhibitors')`, [eventId]);
    assert.equal(provenance.length, 3);
    assert.equal(provenance.find((row) => row.field === "keynoteSpeakers")?.source_url, `${origin}/speakers`);
    assert.equal(provenance.find((row) => row.field === "programAgenda")?.source_url, `${origin}/program`);

    assert.ok(report.deepSections.speakers.after > report.deepSections.speakers.before);

    const coverage = await buildDeepCoverageReport({ limit: 5 });
    const record = coverage.records.find((entry) => entry.eventId === eventId);
    assert.ok(record, "the read-only coverage report lists the conference");
    assert.ok(record!.sections.some((entry) => entry.section === "speakers" && entry.sourceUrl === `${origin}/speakers`));
    return true;
    } finally {
      await forgetEvent(eventId);
    }
  });
});

test("a deep section never changes whether a conference may be published", async () => {
  await initDiscoverySchema();
  const eventId = `deep-readiness-${Date.now()}`;
  await dbRun(`INSERT INTO discovery_events
    (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,publish_readiness,readiness_reasons)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [eventId, "Readiness Invariance Congress 2028", "readiness invariance congress 2028", "html",
      "https://invariance.example/", "invariance.example", "https://invariance.example/",
      "validated", "publish_ready", "[]"]);

  const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [eventId]);
  await storeDeepSections({
    eventId, event: event!, officialUrl: "https://invariance.example/",
    extraction: {
      program: null, community: null, committee: [], sponsors: [],
      speakers: [{
        name: "Dana Ruiz", title: null, org: null, role: "Keynote", presentation_title: null,
        email: null, imageUrl: null, source_url: "https://invariance.example/speakers",
      }],
    },
  });

  const after = await dbGet<Record<string, any>>(
    "SELECT publish_readiness, readiness_reasons, keynote_speakers FROM discovery_events WHERE id=?", [eventId]);
  assert.equal(after?.publish_readiness, "publish_ready");
  assert.deepEqual(JSON.parse(after?.readiness_reasons || "[]"), []);
  assert.equal(JSON.parse(after?.keynote_speakers || "[]")[0].name, "Dana Ruiz");
  await forgetEvent(eventId);
});

test("a populated section is never replaced by a thinner read", async () => {
  await initDiscoverySchema();
  const eventId = `deep-nooverwrite-${Date.now()}`;
  await dbRun(`INSERT INTO discovery_events
    (id,title,normalized_title,extraction_method,source_url,source_domain,keynote_speakers)
    VALUES (?,?,?,?,?,?,?)`,
    [eventId, "Overwrite Guard Symposium 2028", "overwrite guard symposium 2028", "html",
      "https://guard.example/", "guard.example",
      JSON.stringify([{ name: "Existing Speaker", source_url: "https://guard.example/speakers" }])]);

  const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [eventId]);
  const stored = await storeDeepSections({
    eventId, event: event!, officialUrl: "https://guard.example/",
    extraction: {
      program: null, community: null, committee: [], sponsors: [],
      speakers: [{
        name: "Replacement Speaker", title: null, org: null, role: null, presentation_title: null,
        email: null, imageUrl: null, source_url: "https://guard.example/other",
      }],
    },
  });
  assert.ok(!stored.filled.includes("speakers"));
  const after = await dbGet<{ keynote_speakers: string }>("SELECT keynote_speakers FROM discovery_events WHERE id=?", [eventId]);
  assert.equal(JSON.parse(after!.keynote_speakers)[0].name, "Existing Speaker");
  await forgetEvent(eventId);
});

test("a missing section page is never quietly replaced by the site root", async () => {
  // The reading cascade normally answers a dead conference URL by trying the site root, which is
  // right when it is hunting a conference and wrong here: everything on the homepage would be
  // stored as though /speakers had said it. This is the regression guard for that.
  const server = http.createServer((req, res) => {
    if ((req.url || "").startsWith("/speakers")) { res.writeHead(404); res.end("<html><body>Gone</body></html>"); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body><h1>Root</h1><h2>Keynote Speakers</h2>
      <div class="speaker"><h3 class="speaker-name">Homepage Person</h3>
      <p class="affiliation">Some University</p></div>
      <p>${"Filler prose to comfortably clear the extractable-text threshold. ".repeat(12)}</p>
      </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  try {
    const substituted = await readPage(`${origin}/speakers`, {
      budget: newReadBudget(0, 10), urlGuard: localGuard, timeoutMs: 5_000,
    });
    assert.equal(substituted.route, "alternate_url", "the default cascade does substitute the root");

    const refused = await readPage(`${origin}/speakers`, {
      budget: newReadBudget(0, 10), urlGuard: localGuard, timeoutMs: 5_000,
      allowAlternateUrls: false, minTextChars: 0,
    });
    assert.notEqual(refused.route, "alternate_url");
    assert.equal(refused.html, "", "a deep read of a dead page returns nothing, not another page");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a terse sponsors page is read rather than judged too thin", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body><h2>Gold Sponsors</h2>
      <a href="https://acme.example"><img src="/a.png" alt="Acme Instruments logo"></a>
      </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  try {
    const shallow = await readPage(`${origin}/sponsors`, {
      budget: newReadBudget(0, 0), urlGuard: localGuard, timeoutMs: 5_000, allowAlternateUrls: false,
    });
    assert.ok(shallow.textLength < 500, "logo grids carry almost no prose");
    // Zero, not a small number: a logo grid's whole content is in `alt` attributes, and any prose
    // floor at all would reject some real sponsors page. This mirrors what the deep pass passes.
    const deep = await readPage(`${origin}/sponsors`, {
      budget: newReadBudget(0, 0), urlGuard: localGuard, timeoutMs: 5_000,
      allowAlternateUrls: false, minTextChars: 0,
    });
    assert.equal(deep.route, "direct");
    const { sponsors } = extractDeepSections(deep.html, `${origin}/sponsors`);
    assert.deepEqual(sponsors.map((sponsor) => sponsor.name), ["Acme Instruments"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------------------------
// Reaching the existing detail tabs
// ---------------------------------------------------------------------------------------------

test("a published record carries the deep sections in the shape the detail tabs already read", () => {
  const record = toExtractedConferenceRecord({
    id: "shape-1", title: "Shape Congress 2027", official_url: "https://shape.example/",
    source_url: "https://shape.example/", topics: "[]",
    keynote_speakers: JSON.stringify([{ name: "Nadia Farouk", org: "Cairo University", role: "Keynote", source_url: "https://shape.example/speakers" }]),
    program_agenda: JSON.stringify({ sessions: [{ title: "Opening", time: "09:00", track: "Main", source_url: "https://shape.example/program" }], tracks: ["Main"], important_dates: [], source_url: "https://shape.example/program" }),
    sponsors_exhibitors: JSON.stringify([{ name: "Delta Optics", tier: "Gold", classification: "sponsor", source_url: "https://shape.example/sponsors" }]),
  });

  // The tab reader takes speakers from `keynote_speakers`, sessions from `program_agenda.sessions`
  // and sponsors from `sponsors_exhibitors`; these are those keys, filled.
  assert.equal(JSON.parse(record.keynote_speakers)[0].name, "Nadia Farouk");
  assert.equal(JSON.parse(record.program_agenda).sessions[0].title, "Opening");
  assert.equal(JSON.parse(record.sponsors_exhibitors)[0].tier, "Gold");
  // Committee was never read, so it stays empty and is still declared missing.
  assert.deepEqual(JSON.parse(record.technical_committee), []);
  const metadata = JSON.parse(record.extraction_metadata);
  assert.deepEqual(metadata.missing_sections, ["technical_committee"]);
  assert.ok(metadata.source_urls.includes("https://shape.example/speakers"));
  assert.equal(metadata.pages_crawled, 3);
});

test("already-published conferences have their empty tabs filled, and other people's records are left alone", async () => {
  const { initDb } = await import("../../db");
  await initDb();
  await initDiscoverySchema();

  const ours = `https://backfill-ours.example/${Date.now()}`;
  const theirs = `https://backfill-theirs.example/${Date.now()}`;
  const eventId = `deep-backfill-${Date.now()}`;
  const speakers = JSON.stringify([{ name: "Owen Blackwood", org: "Dublin City University", role: "Keynote", source_url: `${ours}speakers` }]);

  await dbRun(`INSERT INTO discovery_events
    (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
     publish_readiness,confidence_score,start_date,start_year,country,keynote_speakers)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [eventId, "Backfill Congress 2028", "backfill congress 2028", "html", ours, "backfill-ours.example",
      ours, "validated", "publish_ready", 0.75, "2028-05-02", 2028, "Ireland", speakers]);
  await dbRun(`INSERT INTO discovery_event_sources
    (id,event_id,source_url,source_domain,source_type,source_classification,classification_confidence,extraction_method,is_official)
    VALUES (?,?,?,?,?,?,?,?,1)`,
    [`src-${eventId}`, eventId, ours, "backfill-ours.example", "official_website", "official_event_site", 0.95, "html"]);

  // One row this engine published with empty tabs, and one row it did not own at all.
  await dbRun(`INSERT INTO extracted_conferences (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [ours, JSON.stringify({ conference_name: "Backfill Congress 2028" }), "[]",
      JSON.stringify({ origin: "discovery_engine", status: "success" })]);
  await dbRun(`INSERT INTO extracted_conferences (source_url, overview, keynote_speakers, extraction_metadata, updated_at)
    VALUES (?,?,?,?,datetime('now'))`,
    [theirs, JSON.stringify({ conference_name: "Someone Else's Crawl" }), "[]",
      JSON.stringify({ origin: "site_crawl", status: "success" })]);

  const result = await publishDiscoveredConferences({ requirePassingAudit: false, limit: 50 });
  assert.ok((result.sectionsBackfilled ?? 0) >= 1, "the empty speakers tab is filled in");

  const filled = await dbGet<{ keynote_speakers: string }>("SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [ours]);
  assert.equal(JSON.parse(filled!.keynote_speakers)[0].name, "Owen Blackwood");
  const untouched = await dbGet<{ keynote_speakers: string }>("SELECT keynote_speakers FROM extracted_conferences WHERE source_url=?", [theirs]);
  assert.deepEqual(JSON.parse(untouched!.keynote_speakers), [], "a record this engine did not write is never edited");

  await dbRun("DELETE FROM extracted_conferences WHERE source_url IN (?,?)", [ours, theirs]);
  await forgetEvent(eventId);
});

// ---------------------------------------------------------------------------------------------
// Why a real production sample read nothing
//
// Two defects produce exactly "deepPagesRead: 0, no errors". Both are reproduced here, because a
// green fixture run proved nothing about either of them: the fixture conference verified cleanly
// in the same pass, which is the one case both defects leave working.
// ---------------------------------------------------------------------------------------------

test("a conference verified by an EARLIER run still has its deep pages read", async () => {
  // The production shape: the record was verified before, so `official_source_verified_at` and an
  // authoritative source row are stored — but this run's re-verification does not reproduce it,
  // because the landing page now leads with a different title. The deep pass used to sit inside
  // `if (verified)`, so it never ran, silently, for exactly these records.
  await initDiscoverySchema();
  const pages: Record<string, string> = {
    "/": `<html><head><title>Site under maintenance</title></head><body>
      <h1>Site under maintenance</h1>
      <p>${"We are updating this website and will be back shortly. ".repeat(12)}</p>
      <nav><a href="/speakers">Speakers</a><a href="/sponsors">Sponsors</a></nav></body></html>`,
    "/speakers": `<html><body><h2>Keynote Speakers</h2>
      <div class="speaker"><h3 class="speaker-name">Priya Raghunathan</h3>
      <p class="affiliation">Indian Institute of Science</p></div></body></html>`,
    "/sponsors": `<html><body><h2>Gold Sponsors</h2>
      <a href="https://vidyut.example"><img src="/v.png" alt="Vidyut Semiconductors logo"></a></body></html>`,
  };
  const server = http.createServer((req, res) => {
    const key = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
    if (!pages[key]) { res.writeHead(404); res.end("<html><body>Not found</body></html>"); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pages[key]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  const eventId = `deep-prior-run-${Date.now()}`;
  const runId = `deep-prior-run-batch-${Date.now()}`;
  try {
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
       start_date,start_year,country,format,confidence_score,publish_readiness,official_source_verified_at,title_verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
      [eventId, "Bangalore Semiconductor Summit 2027", "bangalore semiconductor summit 2027", "html",
        `${origin}/`, "127.0.0.1", `${origin}/`, "validated", "2027-11-02", 2027, "India",
        "in_person", 0.6, "publish_ready"]);
    await dbRun(`INSERT INTO discovery_event_sources
      (id,event_id,source_url,source_domain,source_type,source_classification,classification_confidence,extraction_method,is_official)
      VALUES (?,?,?,?,?,?,?,?,1)`,
      [`src-${eventId}`, eventId, `${origin}/`, "127.0.0.1", "official_website", "official_event_site", 0.92, "html"]);
    await dbRun(`INSERT INTO discovery_run_events (run_id,event_id,outcome,validation_status,provider,source_url)
      VALUES (?,?,?,?,?,?)`, [runId, eventId, "accepted", "validated", "test", `${origin}/`]);

    const report = await runEnrichment({
      runId, limit: 5, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 4,
      timeBudgetMs: 60_000, urlGuard: localGuard, quiet: true, trace: true,
    });

    const entry = report.deepTrace?.find((row) => row.eventId === eventId);
    assert.ok(entry, "the trace has an entry for every record examined");
    assert.equal(entry!.officialPageSource, "stored_verification",
      "the page this run could not re-verify is still the one an earlier run established");
    assert.equal(entry!.sameDomainLinks, 2);
    assert.deepEqual(entry!.matchedCandidates.map((candidate) => candidate.outcome), ["read", "read"]);
    assert.equal(entry!.selectedUrls.length, 2);
    assert.deepEqual(entry!.sectionsFilled.sort(), ["speakers", "sponsors"]);
    assert.equal(entry!.provenance.speakers, `${origin}/speakers`);

    const after = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id=?", [eventId]);
    assert.equal(JSON.parse(after!.keynote_speakers)[0].name, "Priya Raghunathan");
    assert.equal(JSON.parse(after!.sponsors_exhibitors)[0].tier, "Gold");
  } finally {
    await forgetEvent(eventId);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a record with no authoritative page reads nothing, and the trace says exactly that", async () => {
  // The other half of the production result, and it is correct behaviour rather than a bug: a
  // never-verified backlog record has no page this engine trusts, so it gets no deep read. What
  // was missing was any way to tell this apart from a wiring failure.
  await initDiscoverySchema();
  const eventId = `deep-unverified-${Date.now()}`;
  const runId = `deep-unverified-batch-${Date.now()}`;
  try {
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,status,publish_readiness,confidence_score)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [eventId, "Unverified Backlog Conference 2027", "unverified backlog conference 2027", "html",
        "https://never-verified.example/listing", "never-verified.example", "validated", "needs_enrichment", 0.4]);
    await dbRun(`INSERT INTO discovery_run_events (run_id,event_id,outcome,validation_status,provider,source_url)
      VALUES (?,?,?,?,?,?)`, [runId, eventId, "accepted", "validated", "test", "https://never-verified.example/listing"]);

    const report = await runEnrichment({
      runId, limit: 5, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 4,
      timeBudgetMs: 30_000, urlGuard: localGuard, quiet: true, trace: true,
    });

    const entry = report.deepTrace?.find((row) => row.eventId === eventId);
    assert.ok(entry);
    assert.equal(entry!.officialPageSource, "none");
    assert.equal(entry!.skipReason, "no_authoritative_official_page");
    assert.deepEqual(entry!.sectionsFilled, [], "no authoritative page means no deep data, by design");
    assert.equal(report.providerUsage.deepPagesRead, 0);
  } finally {
    await forgetEvent(eventId);
  }
});

test("a sample takes the least-verified records first unless a readiness backlog is named", async () => {
  // Why `enrich --limit 5` sampled records that could not verify: the ordering is
  // least-recently-verified first, which is right for working a backlog and wrong for a sample.
  await initDiscoverySchema();
  const stamp = Date.now();
  const ids = [`order-fresh-${stamp}`, `order-never-${stamp}`];
  try {
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,status,publish_readiness,confidence_score,last_verified)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [ids[0], "Ordering Verified Congress 2027", "ordering verified congress 2027", "html",
        "https://ordering.example/a", "ordering.example", "validated", "publish_ready", 0.99]);
    await dbRun(`INSERT INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,status,publish_readiness,confidence_score)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [ids[1], "Ordering Unverified Congress 2027", "ordering unverified congress 2027", "html",
        "https://ordering.example/b", "ordering.example", "validated", "needs_enrichment", 0.01]);

    const order = await dbAll<{ id: string }>(
      `SELECT id FROM discovery_events WHERE id IN (?,?)
        ORDER BY last_verified IS NOT NULL, last_verified ASC, confidence_score DESC`, ids);
    assert.equal(order[0].id, ids[1], "a never-verified record outranks a freshly verified one");

    const filtered = await dbAll<{ id: string }>(
      `SELECT id FROM discovery_events WHERE id IN (?,?) AND publish_readiness IN ('publish_ready')
        ORDER BY last_verified IS NOT NULL, last_verified ASC, confidence_score DESC`, ids);
    assert.deepEqual(filtered.map((row) => row.id), [ids[0]], "--readiness reaches the verified records");
  } finally {
    for (const id of ids) await forgetEvent(id);
  }
});

// ---------------------------------------------------------------------------------------------
// Precision: every case below is a real false positive from a production sample
//
// The rule these enforce is that an empty section beats a wrong one. Each test names the record it
// came from, because a regression here is not an abstract quality slip — it is a conference page
// asserting something its organiser never published.
// ---------------------------------------------------------------------------------------------

test("ACGME: \"Premium Profile\" is a badge, not a speaker", () => {
  const { speakers } = extractDeepSections(`<html><body>
    <h2>Speakers</h2>
    <div class="speaker-card">
      <h3 class="speaker-name">Rosa Villanueva</h3>
      <p class="affiliation">Johns Hopkins University</p>
      <a class="btn btn-premium" href="/upgrade">Premium Profile</a>
    </div>
    <div class="speaker-card"><a href="/pricing">Premium Profile</a></div>
    <ul><li><a href="/opportunities">Speaker Opportunities</a></li>
        <li><a href="/login">Login</a></li>
        <li><a href="/register">Register</a></li></ul>
    </body></html>`, "https://www.acgme.org/meetings/annual-conference/speakers");

  assert.deepEqual(speakers.map((speaker) => speaker.name), ["Rosa Villanueva"]);
});

test("ACGME: \"Live Webinars\" is a navigation item, not a committee member", () => {
  const { committee } = extractDeepSections(`<html><body>
    <h2>Planning Committee</h2>
    <ul>
      <li>Ayesha Rahman, Emory University School of Medicine</li>
      <li><a href="/webinars">Live Webinars</a></li>
      <li><a href="/membership">Membership Options</a></li>
      <li><a href="/newsletter">Newsletter Signup</a></li>
    </ul></body></html>`, "https://www.acgme.org/meetings/annual-conference/committee");

  assert.deepEqual(committee.map((member) => member.name), ["Ayesha Rahman"]);
  assert.equal(committee[0].org, "Emory University School of Medicine");
});

test("Global AI: \"Contact Us Today\" is a call to action, not a sponsor", () => {
  const { sponsors } = extractDeepSections(`<html><body>
    <h2>Our Sponsors</h2>
    <div><a href="https://tensorworks.example"><img src="/l/tw.png" alt="TensorWorks logo"></a></div>
    <p><a href="/contact">Contact Us Today</a></p>
    <p><a href="/sponsorship">Become a Sponsor</a></p>
    <p><a href="/brochure.html">Download the sponsorship brochure</a></p>
    </body></html>`, "https://globalaisummit.example/sponsors");

  assert.deepEqual(sponsors.map((sponsor) => sponsor.name), ["TensorWorks"]);
});

test("INTED: \"INTED Coffee Break\" is a programme item, not a sponsor", () => {
  const { sponsors } = extractDeepSections(`<html><body>
    <h2>Sponsors and Exhibitors</h2>
    <ul>
      <li>Iberia Robotics S.L.</li>
      <li>INTED Coffee Break</li>
      <li>Welcome Reception</li>
      <li>Networking Lunch</li>
    </ul></body></html>`, "https://inted2027.example/sponsors");

  assert.deepEqual(sponsors.map((sponsor) => sponsor.name), ["Iberia Robotics S.L."]);
});

test("a sponsor needs to look like an organisation, not merely sit in the right block", () => {
  // A same-site link with no logo, no outbound target and no organisation marker is navigation.
  const { sponsors } = extractDeepSections(`<html><body>
    <h2>Partners</h2>
    <a href="/about">About the organisers</a>
    <a href="https://meridian.example">Meridian Diagnostics Ltd</a>
    </body></html>`, "https://conf.example/partners");
  assert.deepEqual(sponsors.map((sponsor) => sponsor.name), ["Meridian Diagnostics Ltd"]);
});

// ---------------------------------------------------------------------------------------------
// Event identity
// ---------------------------------------------------------------------------------------------

test("SNMMI 2027 never takes a programme from a 2026 workshop on the same platform", () => {
  const identity = eventIdentityFrom({
    title: "SNMMI 2027 Annual Meeting", acronym: "SNMMI", start_year: 2027,
    official_url: "https://www.emedevents.com/c/medical-conferences-2027/snmmi-annual-meeting-2027",
  })!;
  assert.ok(identity.sharedHost, "an event living under a path does not own the host");

  // The other event's URL is rejected before a fetch is even spent.
  const other = candidateUrlBelongsToEvent(identity,
    "https://www.emedevents.com/c/medical-conferences-2026/advanced-cme-workshop-2026/program");
  assert.equal(other.ok, false);

  // And if a URL somehow looked plausible, the page's own year settles it.
  const page = pageBelongsToEvent(identity, "https://www.emedevents.com/c/x/program",
    `<html><head><title>Advanced CME Workshop 2026 — Program</title></head>
     <body><h1>Advanced CME Workshop 2026</h1></body></html>`);
  assert.equal(page.ok, false);
  assert.match(page.reason, /2026.*not.*2027/);

  // The event's own subpage passes on both counts.
  const own = candidateUrlBelongsToEvent(identity,
    "https://www.emedevents.com/c/medical-conferences-2027/snmmi-annual-meeting-2027/speakers");
  assert.equal(own.ok, true);
  assert.equal(pageBelongsToEvent(identity,
    "https://www.emedevents.com/c/medical-conferences-2027/snmmi-annual-meeting-2027/speakers",
    `<html><head><title>SNMMI 2027 Annual Meeting — Speakers</title></head><body><h1>Speakers</h1></body></html>`
  ).ok, true);
});

test("site-wide platform pages never populate an event's deep fields", () => {
  const identity = eventIdentityFrom({
    title: "SNMMI 2027 Annual Meeting", acronym: "SNMMI", start_year: 2027,
    official_url: "https://www.emedevents.com/c/medical-conferences-2027/snmmi-annual-meeting-2027",
  })!;
  for (const url of [
    "https://www.emedevents.com/medical-organizers",
    "https://www.emedevents.com/medical-conference-speaker-opportunities",
    "https://www.emedevents.com/newsletter",
    "https://www.emedevents.com/webinars",
  ]) {
    const verdict = candidateUrlBelongsToEvent(identity, url);
    assert.equal(verdict.ok, false, `${url} must not be read for this conference`);
  }
});

test("a conference that owns its domain keeps its own organisers page", () => {
  // The platform rule must not cost real data: /organisers on emedevents.com is a directory of
  // everybody's organisers, and on inted2027.example it is this conference's committee.
  const own = eventIdentityFrom({
    title: "INTED 2027", acronym: "INTED", start_year: 2027, official_url: "https://inted2027.example/",
  })!;
  assert.equal(candidateUrlBelongsToEvent(own, "https://inted2027.example/organisers").ok, true);
  const platform = eventIdentityFrom({
    title: "SNMMI 2027 Annual Meeting", acronym: "SNMMI", start_year: 2027,
    official_url: "https://www.emedevents.com/c/conferences-2027/snmmi-2027",
  })!;
  assert.equal(candidateUrlBelongsToEvent(platform, "https://www.emedevents.com/organizers").ok, false);
  // And a sign-up page is nobody's conference data, on either kind of host.
  assert.equal(candidateUrlBelongsToEvent(own, "https://inted2027.example/newsletter").ok, false);
});

test("a conference that owns its domain keeps subpages that name nothing", () => {
  // The other half of the guard: demanding an acronym on every page would throw away most real
  // speakers pages, which say only "Speakers".
  const identity = eventIdentityFrom({
    title: "INTED 2027", acronym: "INTED", start_year: 2027, official_url: "https://inted2027.example/",
  })!;
  assert.equal(identity.sharedHost, false);
  assert.equal(candidateUrlBelongsToEvent(identity, "https://inted2027.example/speakers").ok, true);
  assert.equal(pageBelongsToEvent(identity, "https://inted2027.example/speakers",
    "<html><head><title>Speakers</title></head><body><h1>Speakers</h1></body></html>").ok, true);
  // Even on its own domain, a page announcing another year is refused.
  assert.equal(pageBelongsToEvent(identity, "https://inted2027.example/archive/2024/speakers",
    "<html><head><title>INTED 2024 Speakers</title></head><body><h1>INTED 2024</h1></body></html>").ok, false);
});

test("on a shared host a page must name the event to contribute", () => {
  const identity = eventIdentityFrom({
    title: "Annual Educational Conference", acronym: "ACGME", start_year: 2027,
    official_url: "https://www.acgme.org/meetings/annual-educational-conference",
  })!;
  assert.ok(identity.sharedHost);
  assert.equal(pageBelongsToEvent(identity, "https://www.acgme.org/webinars",
    "<html><head><title>Live Webinars</title></head><body><h1>Live Webinars</h1></body></html>").ok, false);
  assert.equal(pageBelongsToEvent(identity,
    "https://www.acgme.org/meetings/annual-educational-conference/speakers",
    "<html><head><title>Speakers</title></head><body><h1>Speakers</h1></body></html>").ok, true);
});

test("on a platform host, only the event's own pages are read — end to end", async () => {
  // The SNMMI case as the pipeline actually meets it: one host, several events, and site-wide
  // pages that belong to none of them. The official page links to all three.
  const pages: Record<string, string> = {
    "/c/2027/photonics-congress-2027": `<html><head><title>Photonics Congress 2027</title></head><body>
      <h1>Photonics Congress 2027</h1>
      <a href="/c/2027/photonics-congress-2027/speakers">Speakers</a>
      <a href="/c/2026/advanced-cme-workshop-2026/program">Program</a>
      <a href="/medical-organizers">Organizers</a>
      <a href="/medical-conference-speaker-opportunities">Speaker Opportunities</a></body></html>`,
    "/c/2027/photonics-congress-2027/speakers": `<html><head><title>Speakers</title></head><body>
      <h2>Keynote Speakers</h2>
      <div class="speaker"><h3 class="speaker-name">Helena Vasquez</h3>
      <p class="affiliation">Universidad Politecnica de Madrid</p></div></body></html>`,
    "/c/2026/advanced-cme-workshop-2026/program": `<html><head><title>Advanced CME Workshop 2026</title></head>
      <body><h1>Advanced CME Workshop 2026</h1>
      <table><tr><th>Time</th><th>Session</th></tr>
      <tr><td>09:00 - 10:00</td><td>Contrast agent safety</td></tr></table></body></html>`,
    "/medical-organizers": `<html><head><title>Medical Organizers</title></head><body>
      <h2>Organizers</h2><ul><li>Global CME Partners</li></ul></body></html>`,
    "/medical-conference-speaker-opportunities": `<html><head><title>Speaker Opportunities</title></head>
      <body><h2>Speakers</h2><ul><li>Premium Profile</li></ul></body></html>`,
  };
  const server = http.createServer((req, res) => {
    const key = (req.url || "/").split("?")[0].replace(/\/$/, "");
    if (!pages[key]) { res.writeHead(404); res.end("<html><body>Not found</body></html>"); return; }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pages[key]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const officialUrl = `${origin}/c/2027/photonics-congress-2027`;
    const identity = eventIdentityFrom({
      title: "Photonics Congress 2027", acronym: null, start_year: 2027, official_url: officialUrl,
    })!;
    const landing = await readPage(officialUrl, {
      budget: newReadBudget(0, 0), urlGuard: localGuard, timeoutMs: 5_000,
      allowAlternateUrls: false, minTextChars: 0,
    });

    const collected = await collectDeepSections({
      officialUrl, officialHtml: landing.html, maxPages: 6, identity,
      read: async (url) => {
        const read = await readPage(url, {
          budget: newReadBudget(0, 0), urlGuard: localGuard, timeoutMs: 5_000,
          allowAlternateUrls: false, minTextChars: 0,
        });
        return read.html ? { html: read.html, url } : { unreadable: "fetch_failed" as const };
      },
    });

    const outcome = (needle: string) =>
      collected.candidates.find((candidate) => candidate.url.includes(needle))?.outcome;
    assert.equal(outcome("photonics-congress-2027/speakers"), "read");
    assert.equal(outcome("advanced-cme-workshop-2026"), "different_event_url",
      "another event's programme page is rejected before it is even fetched");
    assert.equal(outcome("medical-organizers"), "different_event_url");
    assert.equal(outcome("speaker-opportunities"), "different_event_url");

    assert.deepEqual(collected.extraction.speakers.map((speaker) => speaker.name), ["Helena Vasquez"]);
    assert.equal(collected.extraction.program, null, "no programme is better than another event's");
    assert.deepEqual(collected.extraction.sponsors, []);
    assert.equal(collected.extraction.speakers[0].source_url, `${origin}/c/2027/photonics-congress-2027/speakers`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
