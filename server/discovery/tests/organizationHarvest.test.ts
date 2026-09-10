// Organisation-first harvesting: read the society's own announcements, keep its identity.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  OrganizationDiscoveryProvider, candidateHosts, conferenceLinksFrom, feedEntries, feedUrlsFrom,
  organizationAcronym, scoreSitemapDocument, scoreSitemapEntry,
} from "../providers/organizationProvider";
import { SEED_DOMAINS, seedBreakdown } from "../sources.seed";
import { isDirectoryHost } from "../../directoryHosts";
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

    assert.ok(urls.some((url) => url.includes("annual-meeting-2027")), "the index's conference is found");
    assert.ok(!urls.some((url) => url.includes("/membership")), "navigation is not a candidate");
    assert.ok(candidates.every((candidate) => candidate.hints?.organization === "Society of Example Engineers"),
      "every candidate carries the organisation that announced it");
    // The index answered, so the feed is not probed: feeds are the fallback, not the first stop.
    assert.ok(provider.stats.pagesFetched > 0 && provider.stats.indexesRead >= 1);
    assert.equal(provider.stats.perDomain[0].sourceType, "hub");
    assert.equal(provider.stats.domainsAttempted, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a sitemap is read before any page is fetched, and its event URLs are scored first", () => {
  // The production trace showed societies whose sitemaps hold hundreds of URLs while their home
  // page answers 403. Scoring happens on the URL, before the request.
  assert.ok(scoreSitemapDocument("https://eage.org/sitemap-events.xml")
    > scoreSitemapDocument("https://eage.org/sitemap-posts.xml"));
  assert.equal(scoreSitemapDocument("https://aiaa.org/sitemap-image.xml"), -1, "an image sitemap is not read");

  assert.equal(scoreSitemapEntry("https://sepm.org/about/staff", [2027]), null, "not an event URL");
  assert.equal(scoreSitemapEntry("https://sepm.org/logo.png", [2027]), null);
  const event = scoreSitemapEntry("https://sepm.org/events/annual-conference-2027", [2027]);
  const older = scoreSitemapEntry("https://sepm.org/events/annual-conference-2019", [2027]);
  assert.ok(event !== null && older !== null && event > older, "the target year outranks an old edition");
});

test("event subdomains and www are tried, so a blocked root does not end the organisation", () => {
  assert.deepEqual(candidateHosts("aapg.org"),
    ["aapg.org", "www.aapg.org", "events.aapg.org", "meetings.aapg.org", "conferences.aapg.org"]);
  assert.deepEqual(candidateHosts("www.seg.org").slice(0, 2), ["seg.org", "www.seg.org"]);
});

test("a society whose home page is blocked still yields its conferences", async () => {
  // AAPG, SEG and AGU all reported home_unreadable in production. A 403 on / says nothing about
  // whether /events answers, and the harvest must not conclude otherwise.
  const pages: Record<string, string> = {
    "/robots.txt": "User-agent: *\nAllow: /\n",
    "/events": `<html><body><h2>Upcoming Conferences</h2><ul>
      <li><a href="/events/annual-convention-2027">Annual Convention 2027</a></li>
      <li><a href="/about">About us</a></li></ul></body></html>`,
  };
  const server = http.createServer((req, res) => {
    const key = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
    if (key === "/") { res.writeHead(403); res.end("Forbidden"); return; }
    if (!pages[key]) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": key.endsWith(".txt") ? "text/plain" : "text/html" });
    res.end(pages[key]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  try {
    const provider = new OrganizationDiscoveryProvider({
      urlGuard: localGuard, scheme: "http", maxPagesPerDomain: 10,
      domains: [{ domain: `127.0.0.1:${port}`, source_name: "Blocked Root Society",
        source_type: "professional_society", enabled: 1 } as any],
    });
    const candidates = await provider.discover({ targetYears: [2027] } as any);
    assert.ok(candidates.some((candidate) => candidate.url.includes("annual-convention-2027")),
      "the events index is reached even though the home page refused");
    const row = provider.stats.perDomain[0];
    assert.match(row.note, /^harvested_via_/, `note should record how it was harvested, got ${row.note}`);
    assert.ok(row.sourceUrl?.includes("/events"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the events index is reached before the page budget is spent probing for feeds", async () => {
  // The original order probed /feed, /rss, /rss.xml, /atom.xml first and exhausted a six-page
  // budget before ever asking for /events. That is why most societies returned nothing.
  let requested: string[] = [];
  const server = http.createServer((req, res) => {
    const key = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
    requested.push(key);
    if (key === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end("User-agent: *\nAllow: /\n"); return; }
    if (key === "/events") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><a href="/events/congress-2027">World Congress 2027</a></body></html>`);
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  try {
    const provider = new OrganizationDiscoveryProvider({
      urlGuard: localGuard, scheme: "http", maxPagesPerDomain: 6,
      domains: [{ domain: `127.0.0.1:${port}`, source_name: "Feedless Society",
        source_type: "professional_society", enabled: 1 } as any],
    });
    const candidates = await provider.discover({ targetYears: [2027] } as any);
    assert.ok(candidates.some((candidate) => candidate.url.includes("congress-2027")));
    assert.ok(!requested.some((path) => /^\/(rss|atom|feed)/.test(path)),
      `no budget is spent guessing feed paths, requested: ${requested.join(", ")}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a feed is used when the society publishes no events index", async () => {
  const pages: Record<string, string> = {
    "/robots.txt": "User-agent: *\nAllow: /\n",
    "/": `<html><head><link rel="alternate" type="application/rss+xml" href="/events.rss"></head>
      <body><h1>Feed Only Society</h1></body></html>`,
    "/events.rss": `<rss><channel>
      <item><title>Example Energy Congress 2027</title><link>/events/energy-congress-2027</link></item>
      </channel></rss>`,
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
      urlGuard: localGuard, scheme: "http", maxPagesPerDomain: 12,
      domains: [{ domain: `127.0.0.1:${port}`, source_name: "Feed Only Society",
        source_type: "professional_society", enabled: 1 } as any],
    });
    const candidates = await provider.discover({ targetYears: [2027] } as any);
    assert.ok(candidates.some((candidate) => candidate.url.includes("energy-congress-2027")));
    assert.equal(provider.stats.feedsRead, 1);
    assert.equal(provider.stats.perDomain[0].sourceType, "feed");
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

test("directories are seeded as leads and still refused as authorities", async () => {
  const directories = SEED_DOMAINS.filter((seed) => seed.sourceType === "conference_directory");
  assert.ok(directories.length >= 15, `expected the directory net to be wide, got ${directories.length}`);

  for (const seed of directories) {
    // Seeded to be READ. This is the wide net for the long tail no society announces: a regional
    // workshop, a first-edition conference with no institution behind it.
    assert.ok(seed.domain.length > 0);
    // And still refused as a place a canonical URL may point. Seeding a host as a lead and
    // refusing it as an authority is the same policy stated from both ends — a listing is never
    // promoted to official, however it entered the crawl.
    assert.equal(
      isDirectoryHost(seed.domain), true,
      `${seed.domain} is seeded as a directory but not refused as one — a listing could be stored as a conference's official site`
    );
  }

  // They must not outrank the societies, or a listing's version of a conference would win a
  // disagreement with the organisation's own page.
  const societies = SEED_DOMAINS.filter((seed) => seed.sourceType === "professional_society");
  assert.ok(societies.length > 0);
  assert.ok(directories.every((d) => (d.trustScore ?? 0.5) < 0.9));
});
