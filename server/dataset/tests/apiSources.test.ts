// Fixture-backed tests for the three API sources. No network: every client takes a `fetchImpl`,
// and these pass a stub, so the suite can run anywhere and can never spend a quota.

import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPredictHqConferences,
  mapPredictHqEvent,
  type PredictHqEvent,
} from "../sources/predicthq";
import { fetchOpenAlexConferenceSeries, mapOpenAlexSeries } from "../sources/openalex";
import { candidateNamesConference, distinctiveTokens, resolveOfficialUrl } from "../sources/exa";
import { buildLaunchDataset } from "../build";

const OPTIONS = { retrievedAt: "2026-09-09", horizonStart: "2026-09-09", years: [2026, 2027, 2028] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SAMPLE_EVENT: PredictHqEvent = {
  id: "phq-1",
  title: "88th EAGE Annual Conference & Exhibition",
  description: "The annual meeting of the European Association of Geoscientists and Engineers.",
  category: "conferences",
  labels: ["conference", "geoscience"],
  rank: 72,
  state: "active",
  country: "NL",
  start: "2027-05-31T07:00:00Z",
  end: "2027-06-03T17:00:00Z",
  start_local: "2027-05-31T09:00:00",
  end_local: "2027-06-03T19:00:00",
  entities: [{ entity_id: "v1", name: "RAI Amsterdam", type: "venue", formatted_address: "Europaplein" }],
  geo: { address: { country_code: "NL", locality: "Amsterdam", region: "North Holland" } },
};

/* ---------------------------------------------------------------- PredictHQ */

test("a PredictHQ event maps to a record once a website has been resolved for it", () => {
  const outcome = mapPredictHqEvent(SAMPLE_EVENT, { ...OPTIONS, officialUrl: "https://eageannual.org/" });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const record = outcome.record;
  assert.equal(record.title, "88th EAGE Annual Conference & Exhibition");
  assert.equal(record.startDate, "2027-05-31");
  assert.equal(record.endDate, "2027-06-03");
  assert.equal(record.city, "Amsterdam");
  assert.equal(record.country, "Netherlands");
  assert.equal(record.worldRegion, "Europe");
  assert.equal(record.venue, "RAI Amsterdam");
  assert.equal(record.edition, "88th");
  assert.equal(record.sourceUrl, "https://eageannual.org/");
  assert.equal(record.sourceType, "official_site");
  assert.equal(record.evidence.method, "event_api");
  assert.equal(record.evidence.externalId, "phq-1");
  // The upstream description is kept whole rather than trimmed to the fields that parsed.
  assert.ok(record.description?.includes("European Association of Geoscientists"));
});

test("an event with no resolvable website is refused, not published with a dead link", () => {
  const outcome = mapPredictHqEvent(SAMPLE_EVENT, { ...OPTIONS, officialUrl: null });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.reason, "no_source_url");
});

test("PredictHQ events obey the same date window as text evidence", () => {
  const finished = mapPredictHqEvent(
    { ...SAMPLE_EVENT, start_local: "2026-03-01T09:00:00", end_local: "2026-03-03T17:00:00" },
    { ...OPTIONS, officialUrl: "https://example-conf.org/" }
  );
  assert.equal(finished.ok, false);
  if (!finished.ok) assert.equal(finished.reason, "already_finished");

  const outOfRange = mapPredictHqEvent(
    { ...SAMPLE_EVENT, start_local: "2031-03-01T09:00:00", end_local: "2031-03-03T17:00:00" },
    { ...OPTIONS, officialUrl: "https://example-conf.org/" }
  );
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) assert.equal(outOfRange.reason, "year_out_of_range:2031");
});

test("a cancelled or deleted event is refused by its state", () => {
  const outcome = mapPredictHqEvent(
    { ...SAMPLE_EVENT, state: "deleted" },
    { ...OPTIONS, officialUrl: "https://eageannual.org/" }
  );
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "event_state:deleted");
});

test("a sparse event still maps, with the absent fields null rather than guessed", () => {
  const outcome = mapPredictHqEvent(
    { id: "phq-2", title: "Some Regional Congress 2027", start_local: "2027-04-02T09:00:00", country: "BH" },
    { ...OPTIONS, officialUrl: "https://example-congress.org/" }
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.record.venue, null);
  assert.equal(outcome.record.city, null);
  assert.equal(outcome.record.country, "Bahrain");
  assert.equal(outcome.record.description, null);
  // No end date was stated, so it falls back to the start rather than inventing a duration.
  assert.equal(outcome.record.endDate, "2027-04-02");
});

test("a virtual event is recorded as online", () => {
  const outcome = mapPredictHqEvent(
    { ...SAMPLE_EVENT, labels: ["conference", "virtual"] },
    { ...OPTIONS, officialUrl: "https://eageannual.org/" }
  );
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.record.format, "online");
});

test("the PredictHQ client pages through next links, sends the token, and stops at the cap", async () => {
  process.env.PREDICTHQ_ACCESS_TOKEN = "test-token";
  const seen: string[] = [];
  const authHeaders: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(url));
    authHeaders.push(String((init?.headers as Record<string, string>)?.Authorization));
    if (seen.length === 1) {
      return jsonResponse({ count: 3, next: "https://api.predicthq.com/v1/events/?page=2", results: [SAMPLE_EVENT, SAMPLE_EVENT] });
    }
    return jsonResponse({ count: 3, next: null, results: [SAMPLE_EVENT] });
  }) as unknown as typeof fetch;

  const all = await fetchPredictHqConferences({ activeFrom: "2026-09-09", activeTo: "2028-12-31", fetchImpl });
  assert.equal(all.length, 3);
  assert.equal(seen.length, 2);
  assert.ok(seen[0].includes("category=conferences"));
  assert.ok(seen[0].includes("active.gte=2026-09-09"));
  assert.deepEqual([...new Set(authHeaders)], ["Bearer test-token"]);

  const capped = await fetchPredictHqConferences({ activeFrom: "2026-09-09", activeTo: "2028-12-31", maxEvents: 1, fetchImpl });
  assert.equal(capped.length, 1);
});

test("a PredictHQ error surfaces its status instead of looking like an empty feed", async () => {
  process.env.PREDICTHQ_ACCESS_TOKEN = "bad-token";
  const fetchImpl = (async () => new Response("Invalid token", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchPredictHqConferences({ activeFrom: "2026-09-09", activeTo: "2028-12-31", fetchImpl }),
    /PredictHQ responded 401/
  );
});

/* ------------------------------------------------------------------ OpenAlex */

test("an OpenAlex conference source becomes a series, with nothing invented", () => {
  const series = mapOpenAlexSeries({
    id: "https://openalex.org/S123",
    display_name: "IEEE International Conference on Robotics and Automation (ICRA)",
    abbreviated_title: "ICRA",
    alternate_titles: ["Int. Conf. on Robotics and Automation"],
    type: "conference",
    homepage_url: "https://www.ieee-ras.org/",
    country_code: "US",
    works_count: 41000,
    cited_by_count: 900000,
    topics: [{ display_name: "Robotics" }],
  });
  assert.ok(series);
  assert.equal(series!.acronym, "ICRA");
  assert.equal(series!.homepageUrl, "https://www.ieee-ras.org/");
  assert.equal(series!.worksCount, 41000);
  assert.deepEqual(series!.topics, ["Robotics"]);

  const noHomepage = mapOpenAlexSeries({ id: "https://openalex.org/S9", display_name: "Some Conference", type: "conference" });
  assert.equal(noHomepage!.homepageUrl, null);
  assert.equal(noHomepage!.acronym, null);
});

test("a source OpenAlex does not type as a conference is refused", () => {
  assert.equal(mapOpenAlexSeries({ id: "https://openalex.org/S1", display_name: "Nature", type: "journal" }), null);
  assert.equal(mapOpenAlexSeries({ id: "https://openalex.org/S2", type: "conference" }), null);
});

test("the OpenAlex client follows its cursor and asks for the polite pool", async () => {
  process.env.OPENALEX_CONTACT_EMAIL = "someone@example.com";
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    seen.push(String(url));
    if (seen.length === 1) {
      return jsonResponse({ results: [{ id: "S1", display_name: "A", type: "conference" }], meta: { next_cursor: "abc" } });
    }
    return jsonResponse({ results: [{ id: "S2", display_name: "B", type: "conference" }], meta: { next_cursor: null } });
  }) as unknown as typeof fetch;

  const sources = await fetchOpenAlexConferenceSeries({ fetchImpl });
  assert.equal(sources.length, 2);
  assert.ok(seen[0].includes("type%3Aconference"));
  assert.ok(seen[0].includes("mailto=someone%40example.com"));
  assert.ok(seen[1].includes("cursor=abc"));
});

/* ----------------------------------------------------------------------- Exa */

test("a candidate only counts when it actually names the conference", () => {
  assert.ok(candidateNamesConference({ url: "https://icra2027.org/", title: "ICRA 2027" }, { title: "International Conference on Robotics and Automation", acronym: "ICRA" }));
  assert.ok(candidateNamesConference({ url: "https://eageannual.org/", title: "EAGE Annual Conference & Exhibition 2027" }, { title: "EAGE Annual Conference & Exhibition" }));
  // A listing host is never the conference's own website, whatever it ranks.
  assert.equal(candidateNamesConference({ url: "https://10times.com/icra-2027", title: "ICRA 2027" }, { title: "Robotics", acronym: "ICRA" }), null);
  assert.equal(candidateNamesConference({ url: "https://en.wikipedia.org/wiki/ICRA", title: "ICRA" }, { title: "Robotics", acronym: "ICRA" }), null);
  // An unrelated page that merely appeared in the results is refused.
  assert.equal(candidateNamesConference({ url: "https://example.com/blog", title: "Ten travel tips" }, { title: "International Conference on Water" }), null);
});

test("distinctive tokens drop the words every conference shares", () => {
  assert.deepEqual(distinctiveTokens("13th International Conference on Applied Geochemistry 2027"), ["applied", "geochemistry"]);
});

test("resolution excludes listing hosts at the API rather than filtering them afterwards", async () => {
  process.env.EXA_API_KEY = "test-key";
  let sentBody: any = null;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return jsonResponse({ results: [] });
  }) as unknown as typeof fetch;

  await resolveOfficialUrl({ title: "International Conference on Water", year: 2027, fetchImpl });
  assert.equal(sentBody.type, "auto");
  assert.ok(Array.isArray(sentBody.excludeDomains));
  assert.ok(sentBody.excludeDomains.includes("10times.com"));
  assert.ok(sentBody.excludeDomains.includes("conferenceindex.org"));
});

test("URL resolution returns null rather than the best guess", async () => {
  process.env.EXA_API_KEY = "test-key";
  const fetchImpl = (async () =>
    jsonResponse({
      results: [
        { url: "https://10times.com/some-event", title: "Applied Geochemistry 2027" },
        { url: "https://unrelated.example/news", title: "Weekly roundup" },
      ],
    })) as unknown as typeof fetch;

  const miss = await resolveOfficialUrl({ title: "International Conference on Applied Geochemistry", year: 2027, fetchImpl });
  assert.equal(miss, null);

  const hitFetch = (async () =>
    jsonResponse({ results: [{ url: "https://appliedgeochemistry2027.org/", title: "Applied Geochemistry 2027" }] })) as unknown as typeof fetch;
  const hit = await resolveOfficialUrl({ title: "International Conference on Applied Geochemistry", year: 2027, fetchImpl: hitFetch });
  assert.ok(hit);
  assert.equal(hit!.host, "appliedgeochemistry2027.org");
});

/* --------------------------------------------------------------- integration */

test("API records and text evidence merge into one catalogue under one set of rules", () => {
  const result = buildLaunchDataset(
    [{ query: "q", title: "t", url: "https://10times.com/eage-annual", stated: "EAGE Annual 2027, Amsterdam, Netherlands, 31 May - 3 June 2027", org: null }],
    OPTIONS,
    [
      {
        outcome: mapPredictHqEvent(SAMPLE_EVENT, { ...OPTIONS, officialUrl: "https://eageannual.org/" }),
        sourceUrl: "https://eageannual.org/",
        statedText: "EAGE",
      },
      {
        outcome: mapPredictHqEvent(SAMPLE_EVENT, { ...OPTIONS, officialUrl: null }),
        sourceUrl: "predicthq:phq-1",
        statedText: "unresolved",
      },
    ]
  );

  // The directory row and the API row are the same conference; the stronger source wins the slot.
  assert.equal(result.dataset.records.length, 1);
  assert.equal(result.duplicatesMerged, 1);
  assert.equal(result.dataset.records[0].sourceUrl, "https://eageannual.org/");
  // The unresolved event is reported as a refusal rather than vanishing.
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].reason, "no_source_url");
});
