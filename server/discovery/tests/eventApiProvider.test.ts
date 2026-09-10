// The structured-events provider, against fixtures. No network, no quota: both clients take a
// `fetchImpl` and the provider carries it through, so these tests can exercise the whole sweep —
// the country loop, the conference gate, the URL resolution and every refusal — without a key.

import assert from "node:assert/strict";
import test from "node:test";
import { EventApiProvider, sweepStartIndex } from "../providers/eventApiProvider";
import type { DiscoveryContext } from "../types";

const CONTEXT: DiscoveryContext = { targetYears: [2026, 2027, 2028], maxCandidates: 8 };

/** Restores whatever the environment held, so one test cannot leak configuration into the next. */
function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const ENABLED = {
  DISCOVERY_PREDICTHQ: "1",
  PREDICTHQ_ACCESS_TOKEN: "test-token",
  EXA_API_KEY: "test-key",
};

interface StubEvent {
  title: string;
  start_local?: string;
  country?: string;
  phq_attendance?: number;
}

/** One PredictHQ page and one Exa answer, chosen by which host is being asked. */
function stubFetch(events: StubEvent[], exaResults: Array<{ url: string; title: string }>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(typeof input === "object" && "url" in input ? input.url : input);
    calls.push(url);
    if (url.includes("predicthq.com")) {
      return new Response(JSON.stringify({
        count: events.length,
        next: null,
        results: events.map((event, index) => ({
          id: `evt_${index}`,
          category: "conferences",
          rank: 70,
          phq_attendance: event.phq_attendance ?? 2000,
          ...event,
        })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      results: exaResults.map((result) => ({ ...result, score: 0.9, publishedDate: null })),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("the provider stays off, and says why, until it is asked for and both keys exist", async () => {
  await withEnv({ DISCOVERY_PREDICTHQ: undefined, PREDICTHQ_ACCESS_TOKEN: "t", EXA_API_KEY: "k" }, async () => {
    const provider = new EventApiProvider();
    assert.equal(provider.isEnabled(), false);
    assert.match(provider.unavailableReason() || "", /DISCOVERY_PREDICTHQ=1/);
    // And an unasked-for provider spends nothing at all, rather than returning empty after calling.
    assert.deepEqual(await provider.discover(CONTEXT), []);
  });

  // Asked for, but with no way to turn an event into a page: that is a different sentence, because
  // it is a different fix.
  await withEnv({ DISCOVERY_PREDICTHQ: "1", PREDICTHQ_ACCESS_TOKEN: "t", EXA_API_KEY: undefined }, async () => {
    const provider = new EventApiProvider();
    assert.equal(provider.isEnabled(), false);
    assert.match(provider.unavailableReason() || "", /EXA_API_KEY/);
  });

  await withEnv(ENABLED, async () => {
    assert.equal(new EventApiProvider().isEnabled(), true);
    assert.equal(new EventApiProvider().unavailableReason(), null);
  });
});

test("an event becomes a candidate only once its own website is resolved", async () => {
  await withEnv(ENABLED, async () => {
    const { impl } = stubFetch(
      [{ title: "World Geothermal Congress 2027", start_local: "2027-04-12T09:00:00", country: "KE" }],
      [{ url: "https://worldgeothermalcongress2027.org/", title: "World Geothermal Congress 2027" }]
    );
    const candidates = await new EventApiProvider({ fetchImpl: impl }).discover({ ...CONTEXT, maxCandidates: 1 });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].url, "https://worldgeothermalcongress2027.org/");
    assert.equal(candidates[0].sourceDomain, "worldgeothermalcongress2027.org");
    assert.equal(candidates[0].provider, "predicthq");
    // The title is carried as a hint, never as a stored fact: the page is still read.
    assert.equal(candidates[0].hints?.title, "World Geothermal Congress 2027");
    assert.match(candidates[0].reason, /site resolved on/);
  });
});

test("an event whose site cannot be resolved yields nothing rather than a listing", async () => {
  await withEnv(ENABLED, async () => {
    // Exa answers, but with pages that do not name the conference — a directory and a news item.
    // Offering either would file a listing as an official site, which is the contamination this
    // engine spends most of its rules refusing.
    const { impl } = stubFetch(
      [{ title: "International Symposium on Applied Hydrology 2027", start_local: "2027-06-01T09:00:00", country: "NG" }],
      [
        { url: "https://allconferencealert.com/nigeria/hydrology", title: "Conferences in Nigeria 2027" },
        { url: "https://news.example.com/story/water-summit", title: "Water experts gather" },
      ]
    );
    assert.deepEqual(await new EventApiProvider({ fetchImpl: impl }).discover(CONTEXT), []);
  });
});

test("an event outside the run's years is refused even when its site resolves", async () => {
  await withEnv(ENABLED, async () => {
    const { impl } = stubFetch(
      [{ title: "Pacific Materials Congress 2031", start_local: "2031-03-02T09:00:00", country: "NZ" }],
      [{ url: "https://pacificmaterialscongress2031.org/", title: "Pacific Materials Congress 2031" }]
    );
    assert.deepEqual(await new EventApiProvider({ fetchImpl: impl }).discover(CONTEXT), []);
  });
});

test("the events API's own category is not taken at its word", async () => {
  await withEnv(ENABLED, async () => {
    // Every one of these came back from a live "conferences" query. The category is far broader
    // than the word, so the gate runs on the title and the resolved URL rather than the label.
    const { impl } = stubFetch(
      [
        { title: "Ladies Christmas Breakfast", start_local: "2027-12-04T09:00:00", country: "AU" },
        { title: "An Evening with a Psychic Medium", start_local: "2027-02-14T19:00:00", country: "GB" },
        { title: "Sunday Morning Worship Service", start_local: "2027-05-09T10:00:00", country: "US" },
      ],
      [{ url: "https://example.com/whatever", title: "Anything at all" }]
    );
    assert.deepEqual(await new EventApiProvider({ fetchImpl: impl }).discover(CONTEXT), []);
  });
});

test("one country failing does not end the sweep", async () => {
  await withEnv(ENABLED, async () => {
    let predictHqCalls = 0;
    const impl = (async (input: string | URL | Request) => {
      const url = String(typeof input === "object" && "url" in input ? input.url : input);
      if (url.includes("predicthq.com")) {
        predictHqCalls += 1;
        // The first country is rate-limited; the ones after it must still be asked for.
        if (predictHqCalls === 1) return new Response("Too Many Requests", { status: 429 });
        return new Response(JSON.stringify({
          count: 1, next: null,
          results: [{
            id: "evt_1", category: "conferences", rank: 70, phq_attendance: 3000,
            title: "African Energy Indaba 2027", start_local: "2027-03-03T09:00:00", country: "ZA",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        results: [{ url: "https://africanenergyindaba2027.com/", title: "African Energy Indaba 2027", score: 0.9 }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const candidates = await new EventApiProvider({ fetchImpl: impl }).discover({ ...CONTEXT, maxCandidates: 16 });
    assert.ok(predictHqCalls > 1, "the sweep continued past the country that failed");
    assert.ok(candidates.length >= 1, "later countries still produced candidates");
  });
});

test("the sweep rotates, so no country sits permanently at the back of the list", async () => {
  // A fixed order means the countries at the front are asked three times a day and the ones at the
  // back never. Different days must start in different places.
  const first = sweepStartIndex(new Date("2026-09-10T00:00:00Z"));
  const next = sweepStartIndex(new Date("2026-09-11T00:00:00Z"));
  assert.notEqual(first, next);
  assert.ok(Number.isInteger(first) && first >= 0);
});
