import test from "node:test";
import assert from "node:assert/strict";
import { firecrawlScrape, firecrawlScrapeUnavailableReason } from "../firecrawl";

test("credit exhaustion stops subsequent paid scrapes without throwing", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FIRECRAWL_API_KEY;
  let requests = 0;
  process.env.FIRECRAWL_API_KEY = "test-key";
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ error: "Insufficient credits to perform this request" }), { status: 402 });
  };
  try {
    assert.equal(await firecrawlScrape("https://example.org/speakers", { maxAttempts: 1 }), null);
    assert.equal(await firecrawlScrape("https://example.org/committee", { maxAttempts: 1 }), null);
    assert.equal(requests, 1);
    assert.equal(firecrawlScrapeUnavailableReason(), "Firecrawl credits exhausted");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousKey;
  }
});
