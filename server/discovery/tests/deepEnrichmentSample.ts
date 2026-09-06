// A representative sample run of the deep-section enrichment, end to end.
//
// Three conferences, three markup styles — speaker cards, a committee table, a JSON-LD event with
// a sponsor logo grid — each with its programme, speakers, committee and sponsors on separate
// pages, because that is where conferences actually publish them. The run goes through the real
// `runEnrichment`, the real reading cascade, real robots.txt handling and the real storage path,
// and then prints the verification table: conference title, populated field, and the page of the
// organiser's site that stated it.
//
// WHAT THIS IS NOT: the conferences are invented fixtures, not real events, exactly as in
// phase1Rehearsal.ts. It proves the pipeline; it does not prove anything about any real
// conference. Point the same pass at production for that:
//
//   npm run discovery -- enrich --limit 5 --max-deep-pages 4
//   npm run discovery -- deep-coverage --limit 5
//
//   npx tsx server/discovery/tests/deepEnrichmentSample.ts

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

interface SampleSite { slug: string; title: string; pages: Record<string, string> }

const SITES: SampleSite[] = [
  {
    slug: "photonics",
    title: "Baltic Photonics Congress 2027",
    pages: {
      "": `<h1>Baltic Photonics Congress 2027</h1>
        <p>The Baltic Photonics Congress 2027 takes place in Tallinn, Estonia from 14 to 17 September 2027.
          Four days of talks, workshops and laboratory demonstrations on integrated optics, fibre sensing
          and quantum photonics at the Tallinn Creative Hub.</p>
        <p>Registration opens in March 2027. Authors submit abstracts of up to two pages through the
          submission system, and accepted contributions appear in the congress proceedings.</p>
        <nav><a href="__BASE__/registration">Registration</a><a href="__BASE__/program">Programme</a>
          <a href="__BASE__/speakers">Speakers</a><a href="__BASE__/committee">Committee</a>
          <a href="__BASE__/sponsors">Sponsors</a><a href="__BASE__/venue">Venue</a></nav>
        <p><a href="__BASE__/">Official conference website</a></p>
        <footer class="social"><a href="https://twitter.com/balticphotonics">Follow us</a>
          <a href="https://linkedin.com/company/baltic-optical-society">LinkedIn</a>
          <span>#BPC2027</span> <a href="mailto:chair@balticphotonics.example">Contact the chairs</a></footer>`,
      "/speakers": `<h1>Speakers</h1><h2>Keynote Speakers</h2>
        <div class="speaker"><h3 class="speaker-name">Dr. Kadri Tamm</h3>
          <p class="affiliation">Tallinn University of Technology</p>
          <p class="talk">“Photonic sensing across the Baltic Sea”</p></div>
        <div class="speaker"><h3 class="speaker-name">Janusz Wojcik</h3>
          <p class="affiliation">Wroclaw Institute of Photonics</p></div>
        <h2>Invited Speakers</h2>
        <ul><li>Sigrid Halvorsen, Norwegian Institute of Technology</li></ul>`,
      "/program": `<h1>Programme</h1><h2>Track B: Integrated Optics</h2>
        <table><tr><th>Time</th><th>Session</th><th>Room</th><th>Speaker</th></tr>
        <tr><td>09:30 - 10:15</td><td>Opening plenary</td><td>Hall A</td><td>Kadri Tamm</td></tr>
        <tr><td>11:00 - 12:30</td><td>Workshop: Waveguide fabrication</td><td>Lab 3</td><td></td></tr>
        <tr><td>14:00 - 15:30</td><td>Panel: Photonics funding in the Baltics</td><td>Hall A</td><td></td></tr></table>
        <h2>Important Dates</h2>
        <ul><li>Abstract deadline: 12 April 2027</li><li>Notification of acceptance: 30 May 2027</li></ul>`,
      "/committee": `<h1>Committee</h1><h2>Scientific Committee</h2>
        <table><tr><th>Name</th><th>Affiliation</th><th>Role</th></tr>
        <tr><td>Liisa Kask</td><td>University of Tartu</td><td>General Chair</td></tr>
        <tr><td>Marek Nowak</td><td>Warsaw University of Technology</td><td>Programme Chair</td></tr></table>`,
      "/sponsors": `<h1>Sponsors</h1><h2>Organised by</h2>
        <ul><li><a href="__BASE__/society"><img src="__BASE__/logos/society.png" alt="Baltic Optical Society logo"></a></li></ul>
        <h2>Platinum Sponsors</h2>
        <div><a href="https://northlight.example"><img src="__BASE__/logos/nl.png" alt="Northlight Optics logo"></a></div>
        <h2>Exhibitors</h2><ul><li>Gulf Coast Lasers</li></ul>`,
    },
  },
  {
    slug: "hydrology",
    title: "Andean Hydrology Symposium 2027",
    pages: {
      "": `<h1>Andean Hydrology Symposium 2027</h1>
        <p>The Andean Hydrology Symposium 2027 convenes in Santiago, Chile from 3 to 6 August 2027 to
          discuss glacier retreat, catchment modelling and water governance across the Andes.</p>
        <p>Registration and the call for papers are open. Submissions are reviewed by the scientific
          committee and published in the symposium proceedings.</p>
        <nav><a href="__BASE__/registration">Registration</a><a href="__BASE__/agenda">Agenda</a>
          <a href="__BASE__/keynotes">Keynotes</a><a href="__BASE__/organising-committee">Organising Committee</a>
          <a href="__BASE__/partners">Partners</a><a href="__BASE__/venue">Venue</a></nav>
        <p><a href="__BASE__/">Official conference website</a></p>`,
      "/keynotes": `<h1>Keynotes</h1><h2>Plenary Speakers</h2>
        <dl><dt>Valentina Rojas</dt><dd>Universidad de Chile</dd>
        <dt>Tomás Iriarte</dt><dd>Instituto Nacional de Glaciología</dd></dl>`,
      "/agenda": `<h1>Agenda</h1>
        <ul><li>09:00 - 10:00 Special session: Glacier mass balance</li>
        <li>10:30 - 12:00 Tutorial: Catchment models in practice</li></ul>`,
      "/organising-committee": `<h1>Organising Committee</h1><h2>Organising Committee</h2>
        <ul><li>Paula Menéndez, Pontificia Universidad Católica de Chile</li>
        <li>Diego Salazar, Universidad de Buenos Aires</li></ul>`,
      "/partners": `<h1>Partners</h1><h2>Academic Partners</h2>
        <ul><li>Andean Water Research Network</li><li>Cordillera Field Laboratory</li></ul>`,
    },
  },
  {
    slug: "oncology",
    title: "Pan-Asian Oncology Forum 2028",
    pages: {
      "": `<h1>Pan-Asian Oncology Forum 2028</h1>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"ConferenceEvent",
          "name":"Pan-Asian Oncology Forum 2028","url":"__ORIGIN____BASE__/",
          "startDate":"2028-03-09","endDate":"2028-03-12",
          "location":{"@type":"Place","name":"Marina Bay Convention Centre",
            "address":{"@type":"PostalAddress","addressLocality":"Singapore","addressCountry":"Singapore"}},
          "performer":[{"@type":"Person","name":"Hui Ling Ong",
            "affiliation":{"@type":"Organization","name":"National University of Singapore"}}],
          "sponsor":[{"@type":"Organization","name":"Meridian Diagnostics"}],
          "organizer":{"@type":"Organization","name":"Pan-Asian Oncology Society"}}</script>
        <p>The Pan-Asian Oncology Forum 2028 meets in Singapore from 9 to 12 March 2028, covering
          translational oncology, clinical trial design and survivorship care across the region.</p>
        <p>Registration opens in October 2027 and the call for papers closes in December 2027.</p>
        <nav><a href="__BASE__/registration">Registration</a><a href="__BASE__/schedule">Schedule</a>
          <a href="__BASE__/faculty">Speakers</a><a href="__BASE__/scientific-committee">Scientific Committee</a>
          <a href="__BASE__/sponsors">Sponsors</a><a href="__BASE__/venue">Venue</a></nav>`,
      "/faculty": `<h1>Speakers</h1><h2>Invited Speakers</h2>
        <table><tr><th>Name</th><th>Institution</th><th>Talk</th></tr>
        <tr><td>Aarti Deshmukh</td><td>Tata Memorial Centre</td><td>Adaptive trial design in South Asia</td></tr>
        <tr><td>Kenji Watanabe</td><td>Kyoto University Hospital</td><td>Survivorship care pathways</td></tr></table>`,
      "/schedule": `<h1>Schedule</h1>
        <table><tr><th>Date</th><th>Time</th><th>Session</th><th>Track</th></tr>
        <tr><td>9 March 2028</td><td>08:45 - 09:30</td><td>Keynote: Precision oncology at scale</td><td>Plenary</td></tr>
        <tr><td>9 March 2028</td><td>10:00 - 11:30</td><td>Workshop: Biomarker validation</td><td>Translational</td></tr></table>`,
      "/scientific-committee": `<h1>Scientific Committee</h1><h2>Scientific Committee</h2>
        <table><tr><th>Name</th><th>Affiliation</th><th>Role</th></tr>
        <tr><td>Mei Sun</td><td>Peking Union Medical College</td><td>Co-Chair</td></tr></table>`,
      "/sponsors": `<h1>Sponsors</h1><h2>Diamond Sponsors</h2>
        <div><a href="https://meridian.example"><img src="__BASE__/logos/meridian.png" alt="Meridian Diagnostics logo"></a></div>
        <h2>Exhibitors</h2><ul><li>Straits Biosciences</li></ul>`,
    },
  },
];

function renderPage(site: SampleSite, page: string, origin: string): string {
  const base = `/${site.slug}`;
  const body = site.pages[page].replace(/__BASE__/g, base).replace(/__ORIGIN__/g, origin);
  return `<html><head><title>${site.title}</title>` +
    `<link rel="canonical" href="${origin}${base}/"></head><body>${body}</body></html>`;
}

async function main(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "deep-sample-"));
  process.chdir(workDir);

  const { initDb, dbGet, dbRun } = await import("../../db");
  const { initDiscoverySchema } = await import("../schema");
  const { runEnrichment } = await import("../enrichment");
  const { configureDomainLimits } = await import("../httpClient");
  const { buildDeepCoverageReport, formatDeepCoverageReport } = await import("../deepEnrichment");

  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const url = (req.url || "/").split("?")[0];
    if (url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /hydrology/partners\n");
      return;
    }
    const site = SITES.find((candidate) => url === `/${candidate.slug}` || url.startsWith(`/${candidate.slug}/`));
    const page = site ? url.slice(`/${site.slug}`.length).replace(/\/$/, "") : null;
    if (!site || page === null || site.pages[page] === undefined) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>Not found</body></html>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(renderPage(site, page, origin));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  // The production SSRF guard blocks loopback and stays untouched; this run supplies its own,
  // scoped to its own server, which also guarantees nothing here reaches a real host.
  const urlGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 6 });

  try {
    await initDb();
    await initDiscoverySchema();
    const runId = `deep-sample-${Date.now()}`;
    for (const site of SITES) {
      const url = `${origin}/${site.slug}/`;
      const id = `deep-sample-${site.slug}`;
      await dbRun(`INSERT INTO discovery_events
        (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
         start_date,start_year,country,format,confidence_score,publish_readiness)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, site.title, site.title.toLowerCase(), "html", url, "127.0.0.1", url, "validated",
          site.slug === "oncology" ? "2028-03-09" : "2027-08-03",
          site.slug === "oncology" ? 2028 : 2027, "Estonia", "in_person", 0.8, "needs_enrichment"]);
      await dbRun(`INSERT INTO discovery_run_events (run_id,event_id,outcome,validation_status,provider,source_url)
        VALUES (?,?,?,?,?,?)`, [runId, id, "accepted", "validated", "sample", url]);
    }

    const before = await buildDeepCoverageReport({ limit: 10 });
    console.log("BEFORE");
    console.log(Object.entries(before.totals).map(([section, count]) => `  ${section.padEnd(10)} ${count}`).join("\n"));

    const report = await runEnrichment({
      runId, limit: SITES.length, maxSearchQueries: 0, maxJinaPages: 0,
      maxDeepPagesPerEvent: 6, timeBudgetMs: 120_000, urlGuard, quiet: true,
    });

    console.log(`\nEnrichment ${report.status}: ${report.totalRecordsExamined} records examined, ` +
      `${report.providerUsage.deepPagesRead} subpages read, ` +
      `${report.providerUsage.robotsDisallowed} skipped for robots.txt, ` +
      `AI calls 0 (the pass has no model dependency).\n`);

    console.log(formatDeepCoverageReport(await buildDeepCoverageReport({ limit: 10 })));

    for (const site of SITES) {
      const row = await dbGet<Record<string, any>>(
        "SELECT keynote_speakers, technical_committee, sponsors_exhibitors FROM discovery_events WHERE id=?",
        [`deep-sample-${site.slug}`]);
      const speakers = JSON.parse(row?.keynote_speakers || "[]");
      const committee = JSON.parse(row?.technical_committee || "[]");
      const sponsors = JSON.parse(row?.sponsors_exhibitors || "[]");
      console.log(`\n${site.title}`);
      for (const person of speakers) {
        console.log(`  speaker    ${person.role || "-"} | ${person.name} | ${person.org || "(no affiliation stated)"}`);
        console.log(`             source: ${person.source_url}`);
      }
      for (const member of committee) {
        console.log(`  committee  ${member.role || "-"} | ${member.name} | ${member.org || "(no affiliation stated)"}`);
        console.log(`             source: ${member.source_url}`);
      }
      for (const sponsor of sponsors) {
        console.log(`  ${sponsor.classification.padEnd(10)} ${sponsor.tier || "(no tier stated)"} | ${sponsor.name}`);
        console.log(`             source: ${sponsor.source_url}`);
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
