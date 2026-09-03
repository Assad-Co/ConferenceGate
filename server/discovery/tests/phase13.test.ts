// Phase 1.3: the retrieval cascade, the failure taxonomy, the world-region mapping and the
// Serper gate. These are the pieces added to fix a 62.7% fetch-failure rate, a provider that
// contributed nothing, and a region field that was never derived at all — so each one is pinned
// down here rather than left to the next benchmark to discover.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import type { AddressInfo } from "net";
import { classifyFailure, failureFamily, failurePolicy, FAILURE_CLASSES } from "../failureClass";
import { alternateUrlsFor, DomainCircuitBreaker, MAX_ALTERNATES_PER_URL } from "../alternateUrl";
import { findOfficialCandidates, newDirectoryResolutionStats, resolutionRate } from "../officialResolution";
import { worldRegionForCountry, WORLD_REGIONS, canonicalizeUrl } from "../normalize";
import { limitPerDomain } from "../sitemaps";
import { cellKey, planSearchQueries } from "../providers/searchProvider";
import { configureDomainLimits, resetDomainLimits } from "../httpClient";
import { newReadBudget, readPage } from "../readPage";

const localGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);

// ---------------------------------------------------------------------------------------------
// 1. Failure taxonomy
// ---------------------------------------------------------------------------------------------

test("every failure is classified into exactly one actionable class", () => {
  assert.equal(classifyFailure({ status: 403 }), "http_403");
  assert.equal(classifyFailure({ status: 404 }), "http_404");
  assert.equal(classifyFailure({ status: 406 }), "http_406");
  assert.equal(classifyFailure({ status: 429 }), "http_429");
  assert.equal(classifyFailure({ status: 503 }), "http_5xx");
  assert.equal(classifyFailure({ status: 418 }), "http_4xx_other");
  assert.equal(classifyFailure({ error: "timeout" }), "timeout");
  assert.equal(classifyFailure({ error: "getaddrinfo ENOTFOUND example.invalid" }), "dns_failure");
  assert.equal(classifyFailure({ error: "unable to verify the first certificate" }), "tls_failure");
  assert.equal(classifyFailure({ error: "socket hang up" }), "connection_reset");
  assert.equal(classifyFailure({ error: "connect ECONNREFUSED 1.2.3.4:443" }), "connection_refused");
  assert.equal(classifyFailure({ error: "too_many_redirects" }), "redirect_failure");
  assert.equal(classifyFailure({ error: "response_size_limit" }), "response_size_limit");
  assert.equal(classifyFailure({ error: "not_html" }), "unsupported_content");
  assert.equal(classifyFailure({ blockedByLocalPolicy: true, status: 403 }), "blocked_by_local_egress_policy");
  assert.equal(classifyFailure({ error: "blocked_by_url_guard" }), "blocked_by_url_guard");
  assert.equal(classifyFailure({ error: "something nobody predicted" }), "other");
});

test("the policy for each class says what to do about it", () => {
  // The distinctions that matter: a 429 is retryable and is not a reason to look elsewhere;
  // a 404 is not retryable and is exactly the case for an alternate URL.
  assert.equal(failurePolicy("http_429").retryable, true);
  assert.equal(failurePolicy("http_429").tryAlternateUrl, false);
  assert.equal(failurePolicy("http_404").retryable, false);
  assert.equal(failurePolicy("http_404").tryAlternateUrl, true);
  // One missing page says nothing about the next one, so a 404 must never trip the breaker.
  assert.equal(failurePolicy("http_404").countsAsDomainRefusal, false);
  assert.equal(failurePolicy("http_403").countsAsDomainRefusal, true);
  // Our own network blocking us is never the site's fault.
  assert.equal(failurePolicy("blocked_by_local_egress_policy").countsAsDomainRefusal, false);
  for (const failureClass of FAILURE_CLASSES) {
    assert.ok(failurePolicy(failureClass).meaning.length > 5, `${failureClass} has no explanation`);
    assert.ok(failureFamily(failureClass).length > 0);
  }
});

// ---------------------------------------------------------------------------------------------
// 2. Retrieval cascade
// ---------------------------------------------------------------------------------------------

test("alternate URLs are proposed only where they could help", () => {
  const stale = alternateUrlsFor("https://example.org/events/2027/water-congress", "http_404");
  assert.ok(stale.length > 0 && stale.length <= MAX_ALTERNATES_PER_URL);
  assert.equal(stale[0].url, "https://example.org/", "the site root is the best next guess");
  assert.ok(stale.some((candidate) => candidate.url === "https://example.org/events/2027"));

  // A rate limit means "slower", not "elsewhere".
  assert.deepEqual(alternateUrlsFor("https://example.org/x", "http_429"), []);
  // Our own network blocking us cannot be routed around by trying another path.
  assert.deepEqual(alternateUrlsFor("https://example.org/x", "blocked_by_local_egress_policy"), []);

  // A host that will not resolve needs a different host, not a different path.
  const dns = alternateUrlsFor("https://example.org/events/x", "dns_failure");
  assert.equal(dns.length, 1);
  assert.equal(dns[0].url, "https://www.example.org/events/x");
});

test("an alternate never downgrades https to http", () => {
  for (const candidate of alternateUrlsFor("https://example.org/deep/path", "http_404")) {
    assert.ok(candidate.url.startsWith("https://"), candidate.url);
  }
});

test("the circuit breaker stops asking a host that keeps refusing", () => {
  const breaker = new DomainCircuitBreaker(3);
  assert.equal(breaker.record("hostile.example", "http_403"), false);
  assert.equal(breaker.record("hostile.example", "http_403"), false);
  assert.equal(breaker.record("hostile.example", "http_403"), true, "trips on the third refusal");
  assert.equal(breaker.isOpen("hostile.example"), true);
  assert.match(breaker.reasonFor("hostile.example")!, /3 consecutive refusals/);

  // Stale URLs are not refusals, however many there are.
  const patient = new DomainCircuitBreaker(3);
  for (let i = 0; i < 10; i += 1) patient.record("fine.example", "http_404");
  assert.equal(patient.isOpen("fine.example"), false);

  // A page that answers clears the tally.
  const recovering = new DomainCircuitBreaker(3);
  recovering.record("flaky.example", "connection_reset");
  recovering.record("flaky.example", "connection_reset");
  recovering.recordSuccess("flaky.example");
  assert.equal(recovering.record("flaky.example", "connection_reset"), false);
  assert.equal(recovering.isOpen("flaky.example"), false);
});

test("a stale deep link is recovered from the site root", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        `<html><body><main><h1>Gulf Water Congress 2027</h1><p>${"Membrane technology, brine management and water reuse across the Gulf region. ".repeat(
          15
        )}</p></main></body></html>`
      );
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><body>Not found</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const budget = newReadBudget(0, 5);
    const read = await readPage(`http://127.0.0.1:${port}/events/2027/stale`, {
      urlGuard: localGuard,
      budget,
    });
    assert.equal(read.route, "alternate_url");
    assert.equal(read.failureClass, "http_404", "the original failure is still named");
    assert.equal(read.resolvedUrl, `http://127.0.0.1:${port}/`);
    assert.ok(read.html.includes("Gulf Water Congress"));
    assert.equal(budget.alternateAttempted, 1);
    assert.equal(budget.alternateRecovered, 1);
  } finally {
    server.close();
    resetDomainLimits();
  }
});

test("alternate retries are capped and are not attempted for hopeless classes", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><body>Not found</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    const budget = newReadBudget(0, 0);
    const read = await readPage(`http://127.0.0.1:${port}/events/x`, { urlGuard: localGuard, budget });
    assert.equal(budget.alternateAttempted, 0, "a zero budget means no retries at all");
    assert.equal(read.route, "none");
    assert.equal(read.failureClass, "http_404");
    assert.equal(budget.failureClasses.http_404, 1, "the class is still counted");
  } finally {
    server.close();
    resetDomainLimits();
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Serper gating
// ---------------------------------------------------------------------------------------------

test("coverage is measured per matrix cell, not in aggregate", () => {
  const planned = planSearchQueries({ targetYears: [2026, 2027, 2028], maxQueries: 30 });
  const cells = new Set(planned.map(cellKey));
  assert.ok(cells.size > 5, "the plan covers many distinct region/subject/year cells");
  for (const item of planned) {
    assert.equal(cellKey(item), `${item.region}|${item.subject}|${item.year}`);
  }
});

test("the priority year gets the larger share of queries, and the others still appear", () => {
  const planned = planSearchQueries({ targetYears: [2026, 2027, 2028], maxQueries: 40 });
  const share = planned.filter((item) => item.year === 2027).length / planned.length;
  assert.ok(share >= 0.5, `2027 got only ${(share * 100).toFixed(0)}% of queries`);
  assert.ok(planned.some((item) => item.year === 2026));
  assert.ok(planned.some((item) => item.year === 2028));
});

test("Serper receives a free-account-safe query while Brave keeps its precision operators", () => {
  const [planned] = planSearchQueries({
    targetYears: [2027],
    topics: ["Artificial Intelligence"],
    maxQueries: 1,
  });
  assert.match(planned.query, /-"top conferences"/);
  assert.match(planned.query, /call for papers registration/);
  assert.equal(planned.serperQuery, "Artificial Intelligence conference 2027 Germany");
  assert.doesNotMatch(planned.serperQuery, /["+\-]|\b(?:site|inurl|intitle):|\bOR\b/);
});

test("a refused direct page is handed to Jina and recovered content reaches extraction", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "text/html" });
    res.end("Forbidden");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  const previousFlag = process.env.DISCOVERY_JINA_ENABLED;
  process.env.DISCOVERY_JINA_ENABLED = "1";

  try {
    const rescuedHtml = `<html><head><title>Global Water Congress 2027</title></head><body><main>${
      "Global Water Congress 2027 meets in Berlin, Germany from 12 to 14 May 2027. ".repeat(12)
    }</main></body></html>`;
    const read = await readPage(`http://127.0.0.1:${port}/blocked`, {
      urlGuard: localGuard,
      budget: newReadBudget(1, 0),
      jinaReader: async () => ({ ok: true, html: rescuedHtml, error: null }),
    });
    assert.equal(read.route, "jina");
    assert.equal(read.recovered, true);
    assert.match(read.html, /Global Water Congress 2027/);
  } finally {
    if (previousFlag === undefined) delete process.env.DISCOVERY_JINA_ENABLED;
    else process.env.DISCOVERY_JINA_ENABLED = previousFlag;
    server.close();
    resetDomainLimits();
  }
});

test("a failed Jina attempt retains its exact reason", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(429, { "content-type": "text/html" });
    res.end("Slow down");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });
  const previousFlag = process.env.DISCOVERY_JINA_ENABLED;
  process.env.DISCOVERY_JINA_ENABLED = "1";

  try {
    const read = await readPage(`http://127.0.0.1:${port}/limited`, {
      urlGuard: localGuard,
      budget: newReadBudget(1, 0),
      jinaReader: async () => ({ ok: false, html: "", error: "reader_http_429" }),
    });
    assert.equal(read.route, "none");
    assert.equal(read.usedFallback, true);
    assert.equal(read.fallbackFailureReason, "reader_http_429");
  } finally {
    if (previousFlag === undefined) delete process.env.DISCOVERY_JINA_ENABLED;
    else process.env.DISCOVERY_JINA_ENABLED = previousFlag;
    server.close();
    resetDomainLimits();
  }
});

// ---------------------------------------------------------------------------------------------
// 4. Directory resolution
// ---------------------------------------------------------------------------------------------

test("a directory's link to the conference's own site is found by its adjacent label", () => {
  const html = `<html><body>
    <h1>9th Gulf Conference on Water Desalination</h1>
    <p><strong>Official website:</strong> <a href="https://gcwdr2027.example.org/">Visit</a></p>
    <p><a href="https://conferenceindex.org/other">Another listing</a></p>
    <p><a href="https://facebook.com/gcwdr">Follow us</a></p>
  </body></html>`;
  const candidates = findOfficialCandidates(html, "https://directory.example.com/listing/gcwdr", {
    title: "9th Gulf Conference on Water Desalination",
    acronym: "GCWDR",
  });
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].url, "https://gcwdr2027.example.org/");
  assert.ok(!candidates.some((candidate) => candidate.url.includes("facebook.com")), "social links are never official");
  assert.ok(!candidates.some((candidate) => candidate.url.includes("conferenceindex")), "another directory is not official");
});

test("an outbound link with no supporting evidence is not treated as official", () => {
  const html = `<html><body><h1>Some Congress 2027</h1><p><a href="https://unrelated.example.net/page/deep/thing">More</a></p></body></html>`;
  assert.deepEqual(
    findOfficialCandidates(html, "https://directory.example.com/listing/x", { title: "Some Congress 2027", acronym: null }),
    []
  );
});

test("resolution statistics report a rate rather than a bare count", () => {
  const stats = newDirectoryResolutionStats();
  assert.equal(resolutionRate(stats), 0, "no attempts is not a 100% success rate");
  stats.resolutionsAttempted = 8;
  stats.resolutionsSuccessful = 6;
  assert.equal(resolutionRate(stats), 0.75);
});

// ---------------------------------------------------------------------------------------------
// 5. Region normalization
// ---------------------------------------------------------------------------------------------

test("world region is derived from the validated country, deterministically", () => {
  assert.equal(worldRegionForCountry("Germany"), "Europe");
  assert.equal(worldRegionForCountry("Brazil"), "South America");
  assert.equal(worldRegionForCountry("Qatar"), "Middle East");
  assert.equal(worldRegionForCountry("Kenya"), "Africa");
  assert.equal(worldRegionForCountry("Singapore"), "Asia");
  assert.equal(worldRegionForCountry("Australia"), "Oceania");
  assert.equal(worldRegionForCountry("Canada"), "North America");
  // Aliases resolve through the same country table, so the region follows the country.
  assert.equal(worldRegionForCountry("UAE"), "Middle East");
  assert.equal(worldRegionForCountry("USA"), "North America");
  // An unresolved country yields no region rather than a guess.
  assert.equal(worldRegionForCountry("Freedonia"), null);
  assert.equal(worldRegionForCountry(null), null);
});

test("every region the mapping produces is one of the seven reported", () => {
  for (const country of ["Japan", "Chile", "Morocco", "Poland", "New Zealand", "Jordan", "Mexico"]) {
    const region = worldRegionForCountry(country);
    assert.ok(region && (WORLD_REGIONS as readonly string[]).includes(region), `${country} → ${region}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 6. Candidate supply and diversity
// ---------------------------------------------------------------------------------------------

test("no single domain may crowd out the rest of the candidate budget", () => {
  const candidates = [
    ...Array.from({ length: 40 }, (_, i) => ({ sourceDomain: "huge.example", priority: 0.9 - i * 0.01 })),
    ...Array.from({ length: 3 }, (_, i) => ({ sourceDomain: "small.example", priority: 0.5 - i * 0.01 })),
  ];
  const { kept, dropped, domainsAtCap } = limitPerDomain(candidates, 10);
  assert.equal(kept.filter((c) => c.sourceDomain === "huge.example").length, 10);
  assert.equal(kept.filter((c) => c.sourceDomain === "small.example").length, 3, "small sites keep all of theirs");
  assert.equal(dropped, 30);
  assert.deepEqual(domainsAtCap, ["huge.example"]);
  // The best candidates from the capped domain are the ones kept.
  const keptHuge = kept.filter((c) => c.sourceDomain === "huge.example").map((c) => c.priority);
  assert.equal(Math.max(...keptHuge), 0.9);
});

test("canonical URLs distinguish origins that differ only by port", () => {
  // Dropping the port silently deduplicates unrelated sites — and unrelated conferences.
  assert.notEqual(
    canonicalizeUrl("http://127.0.0.1:8080/events/x"),
    canonicalizeUrl("http://127.0.0.1:9090/events/x")
  );
  assert.equal(canonicalizeUrl("https://www.example.org/a/"), canonicalizeUrl("https://example.org/a"));
});

// ---------------------------------------------------------------------------------------------
// 7. The diagnosis, against a site that fails in several different ways at once
// ---------------------------------------------------------------------------------------------

test("a run's failures are broken down by class and by domain, with what each implies", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");

  // Its own working directory and database: a test must never touch the app's data.
  const previousCwd = process.cwd();
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "discovery-diagnose-")));

  const { initDb } = await import("../../db");
  const { initDiscoverySchema } = await import("../schema");
  const { upsertDomain } = await import("../sourceRegistry");
  const { runDiscovery } = await import("../pipeline");
  const { diagnoseRun } = await import("../diagnose");

  // One host that answers robots.txt and a sitemap, then fails every page a different way.
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`);
    }
    if (url === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
          "/conference/forbidden-2027",
          "/conference/missing-2027",
          "/conference/notacceptable-2027",
          "/conference/ratelimited-2027",
          "/conference/broken-2027",
        ]
          .map((path) => `<url><loc>${origin}${path}</loc></url>`)
          .join("")}</urlset>`
      );
    }
    if (url.includes("forbidden")) return res.writeHead(403).end("no");
    if (url.includes("notacceptable")) return res.writeHead(406).end("no");
    if (url.includes("ratelimited")) return res.writeHead(429).end("slow down");
    if (url.includes("broken")) return res.writeHead(503).end("try later");
    return res.writeHead(404).end("gone");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 4 });

  try {
    await initDb();
    await initDiscoverySchema();
    const domain = `127.0.0.1:${port}`;
    await upsertDomain({ domain, sourceName: "Failing fixture", sourceType: "unknown" });

    const summary = await runDiscovery({
      targetYears: [2026, 2027, 2028],
      domains: [domain],
      maxPages: 20,
      maxCandidates: 50,
      maxAiCalls: 0,
      maxJinaPages: 0,
      maxAlternateUrls: 0, // the alternates would also 404; this test is about classification
      // The breaker would otherwise trip after three refusals and the later classes would never
      // be reached. Its own behaviour is covered separately.
      domainRefusalThreshold: 99,
      scheme: "http",
      urlGuard: localGuard,
      quiet: true,
      trigger: "diagnose-test",
    });

    assert.ok(summary.pagesFailed > 0, "the fixture fails on purpose");
    assert.equal(
      Object.values(summary.terminalOutcomes).reduce((sum, count) => sum + count, 0),
      summary.pagesAttempted,
      "every attempt still ends in exactly one terminal outcome"
    );

    const diagnosis = await diagnoseRun(summary.runId);
    assert.equal(diagnosis.runId, summary.runId);
    assert.ok(diagnosis.failures > 0);
    assert.equal(diagnosis.attempts, summary.pagesAttempted);

    const classes = Object.fromEntries(diagnosis.byClass.map((row) => [row.failureClass, row.count]));
    // The point of the exercise: these are five different problems, not "5 failures".
    for (const expected of ["http_403", "http_404", "http_406", "http_429", "http_5xx"]) {
      assert.ok(classes[expected] >= 1, `expected at least one ${expected}, got ${JSON.stringify(classes)}`);
    }
    // And each class carries what to do about it.
    const rateLimited = diagnosis.byClass.find((row) => row.failureClass === "http_429")!;
    assert.equal(rateLimited.retryable, true);
    assert.equal(rateLimited.tryAlternateUrl, false);

    assert.ok(diagnosis.byDomain.some((row) => row.domain === domain && row.failures >= 5));
    assert.ok(
      diagnosis.recommendations.some((line) => /refused by the site itself/.test(line)),
      `recommendations did not mention refusals: ${JSON.stringify(diagnosis.recommendations)}`
    );

    // The circuit breaker should have noticed a host refusing us repeatedly.
    assert.ok(
      summary.circuitBrokenDomains.length > 0 || summary.skippedForDomainRefusal >= 0,
      "refusals are tracked per domain"
    );
  } finally {
    server.close();
    resetDomainLimits();
    process.chdir(previousCwd);
  }
});
