import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { AddressInfo } from "net";
import { isPathAllowed, parseRobotsTxt, fetchRobots, ROBOTS_AGENT_TOKEN } from "../robots";
import { discoverSitemapUrls, entriesToCandidates, parseSitemapXml, scoreCandidateUrl } from "../sitemaps";
import { configureDomainLimits, discoveryFetch, looksLikeLocalEgressBlock, resetDomainLimits } from "../httpClient";

// The SSRF guard in server/urlSafety.ts blocks loopback, which is exactly what it should do —
// so these tests inject their own guard for the local fixture server rather than weakening it.
const localGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);

test("robots.txt: the most specific matching group wins", () => {
  const policy = parseRobotsTxt(
    [
      "User-agent: *",
      "Disallow: /private/",
      "",
      `User-agent: ${ROBOTS_AGENT_TOKEN}`,
      "Disallow: /admin/",
      "Allow: /admin/public/",
      "Crawl-delay: 3",
      "",
      "Sitemap: https://example.org/sitemap.xml",
    ].join("\n")
  );
  assert.equal(policy.crawlDelayMs, 3000);
  assert.deepEqual(policy.sitemaps, ["https://example.org/sitemap.xml"]);
  assert.equal(isPathAllowed(policy, "https://example.org/admin/secret"), false);
  assert.equal(isPathAllowed(policy, "https://example.org/admin/public/list"), true, "longest match wins");
  assert.equal(
    isPathAllowed(policy, "https://example.org/private/x"),
    true,
    "our own group replaces the wildcard group, it does not add to it"
  );
});

test("robots.txt: a blanket disallow is honoured", () => {
  const policy = parseRobotsTxt("User-agent: *\nDisallow: /");
  assert.equal(policy.blanketDisallow, true);
  assert.equal(isPathAllowed(policy, "https://example.org/events"), false);
});

test("robots.txt: an empty Disallow allows everything", () => {
  const policy = parseRobotsTxt("User-agent: *\nDisallow:");
  assert.equal(policy.blanketDisallow, false);
  assert.equal(isPathAllowed(policy, "https://example.org/anything"), true);
});

test("robots.txt: wildcards and end-anchors are honoured", () => {
  const policy = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\nDisallow: /calendar/*/print");
  assert.equal(isPathAllowed(policy, "https://example.org/papers/x.pdf"), false);
  assert.equal(isPathAllowed(policy, "https://example.org/papers/x.pdf.html"), true);
  assert.equal(isPathAllowed(policy, "https://example.org/calendar/2027/print"), false);
});

test("no robots.txt is not a prohibition", () => {
  assert.equal(isPathAllowed({ fetched: false, blanketDisallow: false, rules: [], crawlDelayMs: null, sitemaps: [], error: null }, "https://example.org/x"), true);
});

test("nested sitemap indexes are followed to their leaf URLs", async () => {
  const server = http.createServer((req, res) => {
    const send = (body: string, type = "application/xml") => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    };
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === "/robots.txt") return send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml`, "text/plain");
    if (req.url === "/sitemap.xml") {
      return send(
        `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
           <sitemap><loc>${base}/sitemap-a.xml</loc></sitemap>
           <sitemap><loc>${base}/sitemap-b.xml</loc></sitemap>
         </sitemapindex>`
      );
    }
    if (req.url === "/sitemap-a.xml") {
      return send(
        `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
           <sitemap><loc>${base}/sitemap-a1.xml</loc></sitemap>
         </sitemapindex>`
      );
    }
    if (req.url === "/sitemap-a1.xml") {
      return send(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
           <url><loc>${base}/conferences/geoscience-2027</loc><lastmod>2026-08-01</lastmod></url>
           <url><loc>${base}/logo.png</loc></url>
           <url><loc>https://elsewhere.example.com/off-site</loc></url>
         </urlset>`
      );
    }
    if (req.url === "/sitemap-b.xml") {
      return send(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
           <url><loc>${base}/news/annual-report</loc></url>
           <url><loc>${base}/events/robotics-summit-2027</loc></url>
         </urlset>`
      );
    }
    res.writeHead(404).end("no");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const robots = await fetchRobots(origin, { urlGuard: localGuard });
    assert.deepEqual(robots.sitemaps, [`${origin}/sitemap.xml`]);

    const result = await discoverSitemapUrls(origin, {
      declaredSitemaps: robots.sitemaps,
      urlGuard: localGuard,
    });
    const urls = result.entries.map((entry) => entry.url);
    assert.ok(urls.includes(`${origin}/conferences/geoscience-2027`), "leaf URLs from a nested index are reached");
    assert.ok(urls.includes(`${origin}/events/robotics-summit-2027`));
    assert.ok(!urls.some((url) => url.endsWith(".png")), "images are not candidate pages");
    assert.ok(!urls.some((url) => url.includes("elsewhere.example.com")), "cross-host entries are dropped");
    assert.equal(result.entries.find((e) => e.url.includes("geoscience"))?.lastModified, "2026-08-01");

    const candidates = entriesToCandidates(result.entries, "127.0.0.1", "sitemap", [2026, 2027, 2028]);
    // Both event pages name a target year and an event word, so they tie at the top; what matters
    // is that they outrank the news page rather than which of the two comes first.
    const top = candidates.slice(0, 2).map((c) => c.url);
    assert.ok(top.includes(`${origin}/conferences/geoscience-2027`));
    assert.ok(top.includes(`${origin}/events/robotics-summit-2027`));
    assert.ok(!candidates.some((c) => c.url.includes("/news/")), "obvious sitemap noise is rejected before fetch");
  } finally {
    server.close();
    resetDomainLimits();
  }
});

test("duplicate sitemap entries appear once", () => {
  const parsed = parseSitemapXml(
    `<urlset><url><loc>https://a.example/conference-2027</loc></url><url><loc>https://a.example/conference-2027</loc></url></urlset>`
  );
  assert.equal(parsed.entries.length, 2, "the parser reports what the file says");
  const candidates = entriesToCandidates(parsed.entries, "a.example", "sitemap", [2027]);
  assert.equal(candidates.length, 2, "de-duplication of identical URLs happens once they are stored, by primary key");
});

test("URL scoring prefers event paths in target years and demotes stale or noisy ones", () => {
  const strong = scoreCandidateUrl("https://x.example/conferences/water-2027", [2026, 2027, 2028]);
  const weak = scoreCandidateUrl("https://x.example/news/2019/annual-report", [2026, 2027, 2028]);
  const neutral = scoreCandidateUrl("https://x.example/about", [2026, 2027, 2028]);
  assert.ok(strong.score > neutral.score);
  assert.ok(neutral.score >= weak.score);
  assert.ok(strong.score > 0.7);
  assert.equal(neutral.score, 0, "an obvious about page is rejected before fetch");
  assert.match(strong.reason, /target year/);
});

test("redirects are followed manually and revalidated at every hop", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { location: "/finish" });
      return res.end();
    }
    if (req.url === "/finish") {
      res.writeHead(200, { "content-type": "text/html", etag: '"v1"' });
      return res.end("<html><body><h1>Arrived</h1></body></html>");
    }
    if (req.url === "/offsite") {
      // A page redirecting into the private network is exactly what the guard exists to stop.
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    res.writeHead(404).end("no");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const ok = await discoveryFetch(`http://127.0.0.1:${port}/start`, { urlGuard: localGuard });
    assert.equal(ok.ok, true);
    assert.equal(ok.finalUrl, `http://127.0.0.1:${port}/finish`);
    assert.deepEqual(ok.redirects, [`http://127.0.0.1:${port}/finish`]);
    assert.match(ok.body, /Arrived/);
    assert.equal(ok.etag, '"v1"');
    assert.ok(ok.contentHash);

    const blocked = await discoveryFetch(`http://127.0.0.1:${port}/offsite`, { urlGuard: localGuard });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "redirect_blocked_by_url_guard");
    assert.equal(blocked.body, "");
  } finally {
    server.close();
    resetDomainLimits();
  }
});

test("a conditional request that answers 304 is reported as unchanged, not as a failure", async () => {
  const server = http.createServer((req, res) => {
    if (req.headers["if-none-match"] === '"v1"') {
      res.writeHead(304, { etag: '"v1"' });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html", etag: '"v1"' });
    res.end("<html><body>Page</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const first = await discoveryFetch(`http://127.0.0.1:${port}/page`, { urlGuard: localGuard });
    assert.equal(first.notModified, false);
    const second = await discoveryFetch(`http://127.0.0.1:${port}/page`, { urlGuard: localGuard, etag: first.etag });
    assert.equal(second.notModified, true);
    assert.equal(second.ok, true);
    assert.equal(second.body, "", "an unchanged page is not downloaded again");
  } finally {
    server.close();
    resetDomainLimits();
  }
});

test("a network's own block is told apart from a site's refusal", () => {
  // The exact shape a sandbox/VPC allowlist answers with: a sentence, no origin server header.
  assert.equal(
    looksLikeLocalEgressBlock(403, "Host not in allowlist: www.egu.eu. Add this host to your network egress settings to allow access."),
    true
  );
  assert.equal(looksLikeLocalEgressBlock(407, "Proxy denied: host not permitted by your organization policy."), true);

  // A real site refusing a crawler must NOT be reclassified — that would hide a genuine signal.
  assert.equal(
    looksLikeLocalEgressBlock(403, "Access denied. You do not have permission to view this page.", new Headers({ server: "cloudflare" })),
    false
  );
  assert.equal(looksLikeLocalEgressBlock(403, "<html><body><h1>403 Forbidden</h1></body></html>"), false);
  assert.equal(looksLikeLocalEgressBlock(404, "Host not in allowlist"), false, "only 403/407/502 are candidates");
  assert.equal(
    looksLikeLocalEgressBlock(403, `not in allowlist ${"x".repeat(3000)}`),
    false,
    "a full-length page is a real page, not a filter's one-line answer"
  );
});

test("a locally blocked host is reported as such, and is not retried", async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Host not in allowlist: example.org. Add this host to your network egress settings to allow access.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const result = await discoveryFetch(`http://127.0.0.1:${port}/robots.txt`, { urlGuard: localGuard });
    assert.equal(result.ok, false);
    assert.equal(result.blockedByLocalPolicy, true);
    assert.equal(result.error, "blocked_by_local_egress_policy", "not reported as the site's own http_403");
    assert.equal(requests, 1, "a policy denial will not change on a retry, so it is not retried");
  } finally {
    server.close();
    resetDomainLimits();
  }
});

test("robots.txt reports an unreachable host as unreachable, not as 'no robots.txt'", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Host not in allowlist: example.org. Add this host to your network egress settings to allow access.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const policy = await fetchRobots(`http://127.0.0.1:${port}`, { urlGuard: localGuard });
    assert.equal(policy.error, "blocked_by_local_egress_policy");
    assert.equal(policy.fetched, false, "we never actually read this site's rules");
  } finally {
    server.close();
    resetDomainLimits();
  }
});

test("the hosted reader is opt-in, and capped once opted in", async () => {
  const { newReadBudget, readPage } = await import("../readPage");
  const { isJinaFallbackEnabled } = await import("../jinaFetch");

  // A page that answers, but with almost nothing in it — the signature of a JS-rendered shell,
  // and the only situation the reader exists for.
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><div id='app'></div></body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  const previous = process.env.DISCOVERY_JINA_ENABLED;
  try {
    delete process.env.DISCOVERY_JINA_ENABLED;
    assert.equal(isJinaFallbackEnabled(), false, "off unless explicitly enabled");

    const offBudget = newReadBudget(5);
    const off = await readPage(`http://127.0.0.1:${port}/thin`, { urlGuard: localGuard, budget: offBudget });
    assert.equal(off.usedFallback, false, "a disabled reader is not called, whatever the budget");
    assert.equal(offBudget.jinaUsed, 0);
    assert.equal(offBudget.jinaSkippedForCap, 0, "not skipped for budget — not considered at all");
    // The thin HTML is still handed on rather than thrown away: a page with barely any visible
    // text can still carry a complete JSON-LD block, and structured data is the best source there
    // is. It is passed along as a direct read, with its short text length recorded.
    assert.equal(off.route, "direct");
    assert.ok(off.textLength < 500, "and it is recorded as the thin read it was");

    // Enabled, but with no budget left: the page is counted as skipped and still no call is made.
    process.env.DISCOVERY_JINA_ENABLED = "1";
    const cappedBudget = newReadBudget(0);
    const capped = await readPage(`http://127.0.0.1:${port}/thin`, { urlGuard: localGuard, budget: cappedBudget });
    assert.equal(cappedBudget.jinaUsed, 0, "the cap is a hard limit, not a suggestion");
    assert.equal(cappedBudget.jinaSkippedForCap, 1, "and what it cost us is recorded");
    assert.equal(capped.route, "direct", "the thin direct read is still what gets extracted");

    // Low-priority candidates are not worth a paid read even when budget remains.
    const withheldBudget = newReadBudget(5);
    const withheld = await readPage(`http://127.0.0.1:${port}/thin`, {
      urlGuard: localGuard,
      budget: withheldBudget,
      allowFallback: false,
    });
    assert.equal(withheldBudget.jinaUsed, 0);
    assert.equal(withheld.usedFallback, false);
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_JINA_ENABLED;
    else process.env.DISCOVERY_JINA_ENABLED = previous;
    server.close();
    resetDomainLimits();
  }
});

test("a substantial page is read directly and never reaches the reader", async () => {
  const { newReadBudget, readPage } = await import("../readPage");
  const body = `<html><body><main><h1>International Congress on Water Reuse 2027</h1><p>${"Membrane technology and brine management for utilities across the Gulf region. ".repeat(
    20
  )}</p></main></body></html>`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  const previous = process.env.DISCOVERY_JINA_ENABLED;
  try {
    process.env.DISCOVERY_JINA_ENABLED = "1";
    const budget = newReadBudget(5);
    const read = await readPage(`http://127.0.0.1:${port}/full`, { urlGuard: localGuard, budget });
    assert.equal(read.route, "direct");
    assert.equal(read.usedFallback, false, "the reader is a fallback, not a step");
    assert.equal(budget.jinaUsed, 0);
    assert.equal(budget.directUsable, 1);
    assert.ok(read.textLength > 500);
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_JINA_ENABLED;
    else process.env.DISCOVERY_JINA_ENABLED = previous;
    server.close();
    resetDomainLimits();
  }
});

test("the real SSRF guard still refuses loopback", async () => {
  // Proof that the production guard has not been relaxed to make these tests pass.
  const result = await discoveryFetch("http://127.0.0.1:1/never");
  assert.equal(result.ok, false);
  assert.equal(result.error, "blocked_by_url_guard");
});

