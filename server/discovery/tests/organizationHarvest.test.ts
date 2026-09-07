// Organisation-first harvesting: read the society's own announcements, keep its identity.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  OrganizationDiscoveryProvider, conferenceLinksFrom, feedEntries, feedUrlsFrom, organizationAcronym,
} from "../providers/organizationProvider";
import { SEED_DOMAINS, seedBreakdown } from "../sources.seed";
import { configureDomainLimits } from "../httpClient";

const localGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);

test("the registry covers every region and the named priority organisations", () => {
  const breakdown = seedBreakdown();
  assert.ok(breakdown.total >= 200, `expected ~200 organisations, got ${breakdown.total}`);
  for (const region of ["North America", "Europe", "Middle East", "Asia", "Africa", "Latin America", "Oceania"]) {
    assert.ok((breakdown.byRegion[region] || 0) >= 5, `${region} is under-represented`);
  }
  const domains = new Set(SEED_DOMAINS.map((seed) => seed.domain));
  for (const required of ["aapg.org", "spe.org", "eage.org", "seg.org", "agu.org", "ieee.org",
    "acm.org", "acs.org", "aiche.org", "asme.org", "sae.org"]) {
    assert.ok(domains.has(required), `${required} must be in the registry`);
  }
  assert.equal(domains.size, SEED_DOMAINS.length, "no duplicate domains");
});

test("an acronym is read from the name, never invented from initials", () => {
  assert.equal(organizationAcronym("American Association of Petroleum Geologists (AAPG)"), "AAPG");
  assert.equal(organizationAcronym("IEEE"), "IEEE");
  assert.equal(organizationAcronym("Society of Petroleum Engineers"), null);
});

test("an events index yields the conferences it links, not its navigation", () => {
  const links = conferenceLinksFrom(`<html><body>
    <nav><a href="/about">About</a><a href="/membership">Membership</a></nav>
    <ul>
      <li><a href="/events/annual-convention-2027">AAPG Annual Convention and Exhibition 2027</a></li>
      <li><a href="https://ace2027.example/">ACE 2027 Conference</a></li>
      <li><a href="/events/archive-2019">Annual Convention 2019</a></li>
      <li><a href="/login">Log in</a></li>
    </ul></body></html>`, "https://aapg.org/events", 10);
  const urls = links.map((link) => link.url);
  assert.ok(urls.includes("https://aapg.org/events/annual-convention-2027"));
  assert.ok(urls.includes("https://ace2027.example/"), "a society's conference often owns its own domain");
  assert.ok(!urls.some((url) => /\/about|\/membership|\/login/.test(url)), "navigation is not a conference");
});

test("feeds are found where advertised and read as RSS or Atom", () => {
  assert.deepEqual(
    feedUrlsFrom(`<html><head><link rel="alternate" type="application/rss+xml" href="/events.rss">
      <link rel="stylesheet" href="/x.css"></head><body></body></html>`, "https://spe.org/"),
    ["https://spe.org/events.rss"]);

  const entries = feedEntries(`<rss><channel>
    <item><title>SPE Annual Technical Conference 2027</title><link>https://spe.org/atce-2027</link></item>
    <entry><title><![CDATA[Offshore Technology Conference 2028]]></title>
      <link href="https://spe.org/otc-2028"/></entry>
    </channel></rss>`, "https://spe.org/events.rss", 10);
  assert.deepEqual(entries.map((entry) => entry.url), ["https://spe.org/atce-2027", "https://spe.org/otc-2028"]);
  assert.equal(entries[1].title, "Offshore Technology Conference 2028");
});

test("harvesting a society reads its own pages and keeps its identity on every candidate", async () => {
  const pages: Record<string, string> = {
    "/robots.txt": "User-agent: *\nAllow: /\n",
    "/": `<html><head><link rel="alternate" type="application/rss+xml" href="/events.rss"></head>
      <body><h1>Society of Example Engineers</h1><a href="/events">Events</a></body></html>`,
    "/events.rss": `<rss><channel>
      <item><title>Example Energy Congress 2027</title><link>/events/energy-congress-2027</link></item>
      </channel></rss>`,
    "/events": `<html><body><h1>Events</h1><ul>
      <li><a href="/events/annual-meeting-2027">Annual Meeting 2027</a></li>
      <li><a href="/membership">Membership</a></li></ul></body></html>`,
  };
  const server = http.createServer((req, res) => {
    const key = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
    if (!pages[key]) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": key.endsWith(".rss") ? "application/rss+xml" : "text/html" });
    res.end(pages[key]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const provider = new OrganizationDiscoveryProvider({
      urlGuard: localGuard, scheme: "http", maxPagesPerDomain: 8,
      domains: [{
        domain: `127.0.0.1:${port}`, source_name: "Society of Example Engineers",
        source_type: "engineering_society", enabled: 1, trust_score: 0.9,
      } as any],
    });
    const candidates = await provider.discover({ targetYears: [2027] } as any);
    const urls = candidates.map((candidate) => candidate.url);

    assert.ok(urls.some((url) => url.includes("energy-congress-2027")), "the feed's conference is found");
    assert.ok(urls.some((url) => url.includes("annual-meeting-2027")), "the index's conference is found");
    assert.ok(!urls.some((url) => url.includes("/membership")), "navigation is not a candidate");
    assert.ok(candidates.every((candidate) => candidate.hints?.organization === "Society of Example Engineers"),
      "every candidate carries the organisation that announced it");
    assert.ok(provider.stats.pagesFetched > 0 && provider.stats.feedsRead >= 1 && provider.stats.indexesRead >= 1);
    assert.equal(provider.stats.domainsAttempted, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a society that disallows crawling is skipped and recorded", async () => {
  const server = http.createServer((req, res) => {
    if ((req.url || "") === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>should never be read</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  try {
    const provider = new OrganizationDiscoveryProvider({
      urlGuard: localGuard, scheme: "http",
      domains: [{ domain: `127.0.0.1:${port}`, source_name: "Closed Society", source_type: "professional_society", enabled: 1 } as any],
    });
    const candidates = await provider.discover({ targetYears: [2027] } as any);
    assert.deepEqual(candidates, []);
    assert.equal(provider.stats.domainsRobotsBlocked, 1);
    assert.equal(provider.stats.pagesFetched, 0, "not one page is requested from a site that said no");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
