import test from "node:test";
import assert from "node:assert/strict";
import { eventIdentityFrom } from "../eventIdentity";
import { conventionalSectionUrls, crawlSweepPages, sitemapSectionUrls, sweepUrlVerdict, specificPageVerdict } from "../sweepPages";

const identity = eventIdentityFrom({ title: "Example Science Congress", official_url: "https://society.example/events/science/2026", start_year: 2026 })!;
const base = identity.officialUrl;
test("filters binary and old underscored paths before fetching", () => {
  for (const suffix of ["programme.png", "programme.jpg?download=1", "programme.pdf", "CSRS_2018_Final_Program", "CSRS2017Programme"]) {
    assert.equal(sweepUrlVerdict(identity, base + "/" + suffix).ok, false, suffix);
  }
});

test("shared root URL cannot donate parent conference rosters to workshops", async () => {
  const workshop = eventIdentityFrom({ title: "Distilling Reasoning: From Chain-of-Thought to Agentic Capabilities in Smaller Models — NeurIPS 2026", official_url: "https://neurips.cc/", start_year: 2026 })!;
  const parent = { finalUrl: "https://neurips.cc/", html: "<title>NeurIPS 2026</title><h1>NeurIPS 2026 Committee</h1>" };
  assert.equal(specificPageVerdict(workshop, parent, true).ok, false);
  assert.equal(specificPageVerdict(workshop, { ...parent, html: "<h1>Distilling Reasoning: From Chain-of-Thought to Agentic Capabilities in Smaller Models 2026</h1>" }, true).ok, true);
  const result = await crawlSweepPages({ identity: workshop, home: parent, requireSpecificIdentity: true, readXml: async () => { throw Error("unexpected read"); }, readPage: async () => { throw Error("unexpected read"); }});
  assert.deepEqual(result.pages, []);
});
const home = { finalUrl: base, html: '<h1>Example Science Congress 2026</h1><a href="/events/science/2026/programme">Programme</a>' };

test("guesses stay within the event path, excluding society root and sibling events", () => {
  assert.ok(conventionalSectionUrls(identity).every(url => url.startsWith(base + "/")));
  assert.equal(sweepUrlVerdict(identity, "https://society.example/speakers").ok, false);
  assert.equal(sweepUrlVerdict(identity, base + "-other/speakers").ok, false);
  assert.equal(sweepUrlVerdict(identity, "https://evil.example/events/science/2026/speakers").ok, false);
  assert.equal(sweepUrlVerdict(identity, base + "/%bad").ok, false);
});

test("sitemap indexes discover unlinked pages and reject other hosts, editions and event paths", async () => {
  const requested: string[] = [];
  const result = await sitemapSectionUrls(identity, async url => {
    requested.push(url);
    if (url === "https://society.example/sitemap.xml") return '<sitemapindex><sitemap><loc>https://society.example/map.xml</loc></sitemap></sitemapindex>';
    if (url.endsWith("/map.xml")) return `<urlset>
      <url><loc>${base}/speakers?a=1&amp;b=2</loc></url>
      <url><loc>https://society.example/events/other/2026/speakers</loc></url>
      <url><loc>https://evil.example/speakers</loc></url>
      <url><loc>https://society.example/events/science/2025/speakers</loc></url>
    </urlset>`;
    throw Error("404");
  });
  assert.deepEqual(result, [base + "/speakers?a=1&b=2"]);
  assert.ok(requested.length <= 6);
});

test("follows programme to speaker page at depth two, deduplicates and stops before depth three", async () => {
  const requests: string[] = [];
  const result = await crawlSweepPages({ identity, home, readXml: async () => "", readPage: async url => {
    requests.push(url);
    if (url === base + "/programme") return { finalUrl: url, html: `<h1>Programme</h1><a href="${base}/programme/speakers">Speakers</a><a href="${base}/programme/speakers#top">Keynote speakers</a>` };
    if (url === base + "/programme/speakers") return { finalUrl: url, html: `<h1>Speakers</h1><a href="${base}/third/committee">Committee</a>` };
    throw Error("404");
  }});
  assert.ok(result.pages.some(page => page.finalUrl.endsWith("programme/speakers")));
  assert.equal(requests.filter(url => url.includes("programme/speakers")).length, 1);
  assert.ok(!requests.some(url => url.includes("third")));
  assert.equal(requests[1], base + "/programme/speakers");
});

test("rejects redirected unrelated pages and prior-year content, including fees", async () => {
  const result = await crawlSweepPages({ identity, home, readXml: async () => "", readPage: async url => {
    if (url.endsWith("/registration")) return { finalUrl: "https://elsewhere.example/registration", html: "<h1>Registration</h1>" };
    return { finalUrl: url, html: "<h1>Programme 2025</h1>" };
  }});
  assert.equal(result.pages.length, 1);
  assert.ok(result.rejected.some(row => row.reason === "different_host_or_invalid_url"));
  assert.ok(result.rejected.some(row => row.reason.includes("page_states_year_2025")));
});

test("rejects wrong-year home before extracting or crawling", async () => {
  const result = await crawlSweepPages({ identity, home: { ...home, html: "<h1>Science Congress 2025</h1>" }, readXml: async () => { throw Error("must not read"); }, readPage: async () => { throw Error("must not read"); }});
  assert.equal(result.pages.length, 0);
  assert.equal(result.rejected[0].stage, "home");
});

test("bounded page attempts and guesses are marked for free-only fetching", async () => {
  const requests: boolean[] = [];
  await crawlSweepPages({ identity, home: { ...home, html: "<h1>Science 2026</h1>" }, maxPages: 3, readXml: async () => "", readPage: async (_url, guessed) => { requests.push(guessed); throw Error("404"); }});
  assert.deepEqual(requests, [true, true, true]);
});

test("sitemap loops have a fixed request budget", async () => {
  let count = 0;
  await sitemapSectionUrls(identity, async () => `<sitemapindex><sitemap><loc>https://society.example/map-${++count}.xml</loc></sitemap></sitemapindex>`);
  assert.equal(count, 6);
});
