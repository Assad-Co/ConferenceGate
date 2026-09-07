// Directories as seeds, with the access check that decides whether they may be used at all.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { DirectoryDiscoveryProvider, paginationLinks } from "../providers/directoryProvider";
import { isDirectoryHost } from "../../braveSearch";
import { configureDomainLimits } from "../httpClient";

const localGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);

async function withSite<T>(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  run: (host: string) => Promise<T>
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${(server.address() as any).port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  try {
    return await run(host);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const provider = (host: string, extra: Record<string, unknown> = {}) =>
  new DirectoryDiscoveryProvider({
    urlGuard: localGuard, scheme: "http", maxListingsPerSource: 6,
    sources: [{ key: "testdir", host, listingPaths: ["/conferences"] }],
    ...extra,
  });

test("a directory that disallows crawling is skipped before a listing is requested", async () => {
  const requested: string[] = [];
  await withSite((req, res) => {
    requested.push(req.url || "");
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>should never be read</body></html>");
  }, async (host) => {
    const found = await provider(host).discover({ targetYears: [2027] } as any);
    assert.deepEqual(found, []);
    const report = provider(host).stats;
    void report;
    assert.deepEqual(requested, ["/robots.txt"], "nothing beyond robots.txt is ever requested");
  });
});

test("a 403 on the listing stops the source and records the refusal verbatim", async () => {
  await withSite((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    res.writeHead(403);
    res.end("Forbidden");
  }, async (host) => {
    const instance = provider(host);
    const found = await instance.discover({ targetYears: [2027] } as any);
    assert.deepEqual(found, []);
    const report = instance.stats.sources[0];
    assert.equal(report.outcome, "access_controlled");
    assert.match(report.detail, /HTTP 403/);
    assert.match(report.detail, /left to Serper/);
  });
});

test("a robots-disallowed path is not fetched even when the site is otherwise open", async () => {
  const requested: string[] = [];
  await withSite((req, res) => {
    requested.push((req.url || "").split("?")[0]);
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /conferences\nAllow: /\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>listing</body></html>");
  }, async (host) => {
    const instance = provider(host);
    await instance.discover({ targetYears: [2027] } as any);
    assert.ok(!requested.includes("/conferences"), `disallowed path was requested: ${requested.join(", ")}`);
    assert.equal(instance.stats.sources[0].outcome, "robots_path_disallowed");
  });
});

test("an open directory yields candidates, each marked a lead rather than an authority", async () => {
  await withSite((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (path === "/conferences") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><head><script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Event","name":"Global Petroleum Congress 2027",
         "url":"https://petrocongress2027.example/"}</script></head>
        <body><ul>
          <li><a href="https://cyberconf2027.example/">International Cybersecurity Conference 2027</a></li>
          <li><a href="/about">About this directory</a></li>
        </ul>
        <a rel="next" href="/conferences?page=2">Next</a></body></html>`);
      return;
    }
    if (path === "/conferences" || path.startsWith("/conferences")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><a href="https://geoconf2028.example/">Geoscience Summit 2028</a></body></html>`);
      return;
    }
    res.writeHead(404); res.end("not found");
  }, async (host) => {
    const instance = provider(host);
    const found = await instance.discover({ targetYears: [2027, 2028] } as any);
    const urls = found.map((candidate) => candidate.url);

    assert.ok(urls.includes("https://petrocongress2027.example/"), "a structured listing is read first");
    assert.ok(urls.some((url) => url.includes("cyberconf2027")), "listing links become candidates");
    assert.ok(!urls.some((url) => url.includes("/about")), "the directory's own navigation is not a conference");
    assert.ok(found.every((candidate) => candidate.hints?.directoryLeadEligible === true),
      "every candidate is a lead, so the pipeline resolves it to the conference's own site");
    assert.ok(found.every((candidate) => candidate.priority <= 0.5), "a directory outranks nothing");
    assert.equal(instance.stats.sources[0].outcome, "harvested");
  });
});

test("pagination is followed from the listing rather than guessed", () => {
  const links = paginationLinks(`<html><body>
    <a rel="next" href="/conferences?page=2">Next</a>
    <a href="/conferences?page=3">3</a>
    <a href="/about">About</a>
    <a href="https://elsewhere.example/page/2">2</a></body></html>`, "https://dir.example/conferences", 5);
  assert.deepEqual(links, ["https://dir.example/conferences?page=2", "https://dir.example/conferences?page=3"]);
});

test("the seed hosts are classified as directories and can never be treated as official", () => {
  assert.equal(isDirectoryHost("conflists.com"), true);
  assert.equal(isDirectoryHost("iconf.org"), true);
});
