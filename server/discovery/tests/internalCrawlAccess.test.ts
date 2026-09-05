// The legacy live-crawl endpoints must stay closed to customer traffic.
//
// These tests hold two separate lines. The first is the predicate: who is authorized, and — more
// importantly — who is not when the configuration is missing or half-present. The second is the
// wiring, because a correct guard that nobody applied protects nothing, and the three routes it
// belongs on are easy to add to without noticing.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  INTERNAL_CRAWL_HEADER,
  LEGACY_CRAWL_UNAVAILABLE,
  hasInternalCrawlAuthorization,
  requireInternalCrawlAuthorization,
} from "../../internalCrawlAccess";

test("no configured token authorizes nobody, however the caller asks", () => {
  for (const header of [undefined, "", "anything", "undefined"]) {
    assert.equal(hasInternalCrawlAuthorization(header, {} as NodeJS.ProcessEnv), false);
    assert.equal(hasInternalCrawlAuthorization(header, { DISCOVERY_ADMIN_TOKEN: "" } as NodeJS.ProcessEnv), false);
  }
});

test("only the exact operator token authorizes a crawl", () => {
  const env = { DISCOVERY_ADMIN_TOKEN: "s3cret-operator-token" } as NodeJS.ProcessEnv;
  assert.equal(hasInternalCrawlAuthorization("s3cret-operator-token", env), true);
  for (const wrong of [undefined, "", "s3cret-operator-toke", "s3cret-operator-tokenn", "S3CRET-OPERATOR-TOKEN"]) {
    assert.equal(hasInternalCrawlAuthorization(wrong, env), false);
  }
});

test("an unauthorized request is refused before the handler runs", () => {
  const previous = process.env.DISCOVERY_ADMIN_TOKEN;
  delete process.env.DISCOVERY_ADMIN_TOKEN;
  try {
    let status = 0;
    let body: unknown = null;
    let handlerReached = false;
    const res = { status(code: number) { status = code; return this; }, json(payload: unknown) { body = payload; return this; } };
    requireInternalCrawlAuthorization(
      { get: () => undefined } as any,
      res as any,
      () => { handlerReached = true; }
    );
    assert.equal(handlerReached, false, "the crawl handler must not run for an anonymous caller");
    assert.equal(status, 404);
    assert.deepEqual(body, LEGACY_CRAWL_UNAVAILABLE);
    assert.match(String((body as any).error), /stored Conference Gate records/);
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_ADMIN_TOKEN;
    else process.env.DISCOVERY_ADMIN_TOKEN = previous;
  }
});

test("an authorized request reaches the handler", () => {
  const previous = process.env.DISCOVERY_ADMIN_TOKEN;
  process.env.DISCOVERY_ADMIN_TOKEN = "operator-token";
  try {
    let handlerReached = false;
    requireInternalCrawlAuthorization(
      { get: (name: string) => (name === INTERNAL_CRAWL_HEADER ? "operator-token" : undefined) } as any,
      { status() { throw new Error("must not refuse an authorized caller"); } } as any,
      () => { handlerReached = true; }
    );
    assert.equal(handlerReached, true);
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_ADMIN_TOKEN;
    else process.env.DISCOVERY_ADMIN_TOKEN = previous;
  }
});

test("every route that can start a crawl carries the guard, and the stored-read routes do not", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
  for (const route of [
    'app.post("/api/ai/extract-conference"',
    'app.post("/api/ai/extract-conference/prefetch"',
    'app.post("/api/ai/extract-conference/focus"',
  ]) {
    const index = source.indexOf(route);
    assert.notEqual(index, -1, `${route} moved; update this test with it`);
    assert.match(
      source.slice(index, index + route.length + 120),
      /requireInternalCrawlAuthorization/,
      `${route} can start a crawl and must be guarded`
    );
  }
  // Reading what is already stored costs nothing and must stay available to the detail page.
  for (const route of [
    'app.get("/api/ai/extract-conference/cached"',
    'app.get("/api/ai/extract-conference/status"',
  ]) {
    const index = source.indexOf(route);
    assert.notEqual(index, -1, `${route} moved; update this test with it`);
    assert.doesNotMatch(source.slice(index, index + route.length + 120), /requireInternalCrawlAuthorization/);
  }
});
