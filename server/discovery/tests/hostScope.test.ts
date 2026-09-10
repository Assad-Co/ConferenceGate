// Naming the hosts to work on, so a conference somebody is waiting for is not behind a backlog.

import assert from "node:assert/strict";
import test from "node:test";
import { dbAll, dbRun } from "../../db";
import { initDiscoverySchema } from "../schema";
import { runEnrichment } from "../enrichment";

/** Nothing in this file may leave the machine; the guard also proves what was attempted. */
const attempted: string[] = [];
const refuseEverything = async (url: string) => {
  attempted.push(url);
  return false;
};

const EVENTS = [
  ["scope-ice", "AAPG ICE 2026", "https://iceevent.org/2026/", "https://www.aapg.org/events/calendar/"],
  ["scope-seals", "Hydrocarbon Seals GTW", "https://www.aapg.org/event-details/seals/", "https://www.aapg.org/event-details/seals/"],
  ["scope-urtec", "URTeC 2027", "https://urtec.org/2027/", "https://urtec.org/2027/"],
  ["scope-other", "Some Other Congress 2027", "https://example.org/congress/", "https://example.org/congress/"],
  ["scope-elsewhere", "Yet Another Meeting 2027", "https://elsewhere.example/meet/", "https://elsewhere.example/meet/"],
] as const;

test("a host scope works only the conferences it names", async () => {
  await initDiscoverySchema();
  for (const [id, title, officialUrl, sourceUrl] of EVENTS) {
    await dbRun(
      `INSERT OR REPLACE INTO discovery_events
        (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
         start_date,start_year,country,city,format,confidence_score,publish_readiness)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, title, title.toLowerCase(), "html", sourceUrl, new URL(sourceUrl).hostname, officialUrl,
        "validated", "2027-05-03", 2027, "United States", "Houston", "in_person", 0.6, "publish_ready"]
    );
  }

  attempted.length = 0;
  const scoped = await runEnrichment({
    onlyHosts: ["aapg.org", "urtec.org"],
    limit: 50, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 0,
    timeBudgetMs: 20_000, urlGuard: refuseEverything, quiet: true,
  });
  assert.equal(scoped.status, "completed");

  const reached = new Set(attempted.map((url) => new URL(url).hostname.replace(/^www\./, "")));
  // iceevent.org is in because its record was found on the AAPG calendar — a society's conference
  // usually lives on its own domain while the record still points home, so source_url counts too.
  assert.ok(reached.has("iceevent.org"), `iceevent.org was not reached: ${[...reached].join(", ")}`);
  assert.ok(reached.has("aapg.org"));
  assert.ok(reached.has("urtec.org"));
  // And the rest of the catalogue is left entirely alone, which is the whole point.
  assert.equal(reached.has("example.org"), false, "an unscoped conference was worked anyway");
  assert.equal(reached.has("elsewhere.example"), false);
});

test("no scope means the whole queue, exactly as before", async () => {
  await initDiscoverySchema();
  attempted.length = 0;
  await runEnrichment({
    limit: 50, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 0,
    timeBudgetMs: 20_000, urlGuard: refuseEverything, quiet: true,
  });
  const reached = new Set(attempted.map((url) => new URL(url).hostname.replace(/^www\./, "")));
  assert.ok(reached.has("example.org"), "an unscoped run stopped visiting the rest of the queue");
});

test("a scope that matches nothing works nothing, rather than everything", async () => {
  // The failure that would matter: an empty match silently falling back to the full queue would
  // turn a typo into eight hours of the backlog nobody asked for.
  await initDiscoverySchema();
  attempted.length = 0;
  const report = await runEnrichment({
    onlyHosts: ["no-such-society.invalid"],
    limit: 50, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 0,
    timeBudgetMs: 20_000, urlGuard: refuseEverything, quiet: true,
  });
  assert.equal(report.status, "completed");
  assert.deepEqual(attempted, []);
});

test("a host never matches another host that merely ends with its name", async () => {
  await initDiscoverySchema();
  await dbRun(
    `INSERT OR REPLACE INTO discovery_events
      (id,title,normalized_title,extraction_method,source_url,source_domain,official_url,status,
       start_date,start_year,country,city,format,confidence_score,publish_readiness)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ["scope-lookalike", "Not AAPG At All 2027", "not aapg at all 2027", "html",
      "https://notaapg.org/x/", "notaapg.org", "https://notaapg.org/x/", "validated",
      "2027-05-03", 2027, "United States", "Houston", "in_person", 0.6, "publish_ready"]
  );

  attempted.length = 0;
  await runEnrichment({
    onlyHosts: ["aapg.org"],
    limit: 50, maxSearchQueries: 0, maxJinaPages: 0, maxDeepPagesPerEvent: 0,
    timeBudgetMs: 20_000, urlGuard: refuseEverything, quiet: true,
  });
  const reached = new Set(attempted.map((url) => new URL(url).hostname.replace(/^www\./, "")));
  assert.equal(reached.has("notaapg.org"), false, "a lookalike domain was pulled into the scope");

  await dbAll("DELETE FROM discovery_events WHERE id LIKE 'scope-%'");
});
