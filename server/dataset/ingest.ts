// Fetches the API sources and caches their raw responses under data/sources/.
//
// Split from the builder deliberately. Fetching needs network, credentials and quota; building does
// not. Caching the raw payload in between means the dataset can be rebuilt anywhere — on a laptop,
// in CI, in a container with no egress at all — and that a rebuild months later reproduces exactly
// what the API said at the time rather than whatever it says now.
//
//   npx tsx server/dataset/ingest.ts oneshot             verify + fetch + resolve, printing a
//                                                        portable block for a host with no disk
//   npx tsx server/dataset/ingest.ts verify              one cheap call per API, exact statuses
//   npx tsx server/dataset/ingest.ts status              what is configured and what is cached
//   npx tsx server/dataset/ingest.ts predicthq           pull the conferences feed
//   npx tsx server/dataset/ingest.ts openalex            pull the conference series seed list
//   npx tsx server/dataset/ingest.ts resolve             find official URLs for cached events (Exa)
//
// Nothing here writes to the dataset. Run the builder afterwards.

import fs from "node:fs";
import path from "node:path";
import {
  fetchPredictHqConferences,
  isPredictHqConfigured,
  looksLikeConference,
  type PredictHqEvent,
} from "./sources/predicthq";
import { fetchOpenAlexConferenceSeries, mapOpenAlexSeries, type ConferenceSeries } from "./sources/openalex";
import { exaSearch, isExaConfigured, resolveOfficialUrl } from "./sources/exa";

const DATA_DIR = path.join(process.cwd(), "data");
export const SOURCES_DIR = path.join(DATA_DIR, "sources");
export const PREDICTHQ_CACHE = path.join(SOURCES_DIR, "predicthq-events.json");
/** Events captured from a host that had network but no disk, pasted back in as JSONL. */
export const PORTABLE_EVENTS = path.join(SOURCES_DIR, "predicthq-portable.jsonl");
export const RESOLVED_URLS_CACHE = path.join(SOURCES_DIR, "resolved-urls.json");
export const SERIES_FILE = path.join(DATA_DIR, "conference-series.json");

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson<T>(file: string): T | null {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
  } catch (error) {
    console.warn(`[ingest] could not read ${file}: ${(error as Error).message}`);
    return null;
  }
}

export interface PredictHqCache {
  fetchedAt: string;
  activeFrom: string;
  activeTo: string;
  count: number;
  events: PredictHqEvent[];
}

/** Official URLs found for events that did not carry one, keyed by the event's PredictHQ id. */
export interface ResolvedUrlCache {
  resolvedAt: string;
  /** Ids looked up and genuinely not found, kept so a re-run does not pay to ask again. */
  unresolved: string[];
  urls: Record<string, { url: string; matchedOn: string; resultTitle: string | null }>;
}

export function readPredictHqCache(): PredictHqCache | null {
  return readJson<PredictHqCache>(PREDICTHQ_CACHE);
}

/**
 * Events carried back from a machine that could reach the APIs but could not keep a file.
 *
 * Render's web service has no persistent disk and no way to commit, so an ingest run there loses
 * everything the moment it ends. This is the way across that gap: `oneshot` prints one compact JSON
 * line per conference, those lines get saved here, and the builder reads them exactly like a cache
 * it fetched itself. The URL each line carries is folded back out into the resolved-URL map, so
 * nothing downstream needs to know the data arrived by hand.
 */
export function readPortableEvents(): { events: PredictHqEvent[]; urls: Record<string, string> } {
  const events: PredictHqEvent[] = [];
  const urls: Record<string, string> = {};
  if (!fs.existsSync(PORTABLE_EVENTS)) return { events, urls };

  for (const raw of fs.readFileSync(PORTABLE_EVENTS, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let parsed: PredictHqEvent & { _resolvedUrl?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const { _resolvedUrl, ...event } = parsed;
    if (!event.id) continue;
    events.push(event);
    if (_resolvedUrl) urls[event.id] = _resolvedUrl;
  }
  return { events, urls };
}

export function readResolvedUrls(): ResolvedUrlCache {
  return readJson<ResolvedUrlCache>(RESOLVED_URLS_CACHE) || { resolvedAt: "", unresolved: [], urls: {} };
}

async function runPredictHq(argv: string[]): Promise<void> {
  if (!isPredictHqConfigured()) {
    console.error("PREDICTHQ_ACCESS_TOKEN is not set. Put it in .env (which is gitignored).");
    process.exitCode = 1;
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const activeFrom = argFor(argv, "--from") || today;
  const activeTo = argFor(argv, "--to") || "2028-12-31";
  const maxEvents = Number(argFor(argv, "--max") || 5000);
  const minRank = argFor(argv, "--min-rank") ? Number(argFor(argv, "--min-rank")) : undefined;

  console.log(`[predicthq] conferences ${activeFrom} .. ${activeTo} (max ${maxEvents})`);
  const events = await fetchPredictHqConferences({
    activeFrom,
    activeTo,
    maxEvents,
    minRank,
    onPage: (page, number) => console.log(`  page ${number}: ${page.results?.length ?? 0} events (total reported ${page.count ?? "?"})`),
  });

  writeJson(PREDICTHQ_CACHE, {
    fetchedAt: new Date().toISOString(),
    activeFrom,
    activeTo,
    count: events.length,
    events,
  } satisfies PredictHqCache);
  console.log(`[predicthq] cached ${events.length} events -> ${PREDICTHQ_CACHE}`);
}

async function runOpenAlex(argv: string[]): Promise<void> {
  const maxSeries = Number(argFor(argv, "--max") || 20000);
  const minWorks = Number(argFor(argv, "--min-works") || 25);
  console.log(`[openalex] conference series (max ${maxSeries}, min works ${minWorks})`);

  const sources = await fetchOpenAlexConferenceSeries({
    maxSeries,
    minWorks,
    onPage: (page, number) => console.log(`  page ${number}: ${page.results?.length ?? 0} sources`),
  });
  const series = sources
    .map(mapOpenAlexSeries)
    .filter((entry): entry is ConferenceSeries => entry !== null)
    .sort((left, right) => right.worksCount - left.worksCount);

  writeJson(SERIES_FILE, { generatedAt: new Date().toISOString(), count: series.length, series });
  console.log(`[openalex] ${series.length} series (${series.filter((s) => s.homepageUrl).length} with a homepage) -> ${SERIES_FILE}`);
}

async function runResolve(argv: string[]): Promise<void> {
  if (!isExaConfigured()) {
    console.error("EXA_API_KEY is not set — nothing to resolve with. Events stay unresolved.");
    process.exitCode = 1;
    return;
  }
  const cache = readPredictHqCache();
  if (!cache) {
    console.error(`No PredictHQ cache at ${PREDICTHQ_CACHE}. Run the predicthq command first.`);
    process.exitCode = 1;
    return;
  }
  const limit = Number(argFor(argv, "--max") || 200);
  const resolved = readResolvedUrls();
  const alreadySeen = new Set([...Object.keys(resolved.urls), ...resolved.unresolved]);

  let looked = 0;
  let found = 0;
  for (const event of cache.events) {
    if (looked >= limit) break;
    const id = event.id;
    if (!id || alreadySeen.has(id)) continue;
    const startDate = (event.start_local || event.start || "").slice(0, 10);
    const year = Number(startDate.slice(0, 4));
    if (!year) continue;

    looked += 1;
    try {
      const hit = await resolveOfficialUrl({
        title: event.title || "",
        year,
        city: event.geo?.address?.locality ?? null,
        country: event.country ?? null,
      });
      if (hit) {
        resolved.urls[id] = { url: hit.url, matchedOn: hit.matchedOn, resultTitle: hit.resultTitle };
        found += 1;
        console.log(`  ✓ ${event.title?.slice(0, 58)} -> ${hit.url} (${hit.matchedOn})`);
      } else {
        // Recorded so a later run does not pay to ask the same question again.
        resolved.unresolved.push(id);
      }
    } catch (error) {
      console.warn(`  ! ${event.title?.slice(0, 48)}: ${(error as Error).message}`);
      break;
    }
  }

  resolved.resolvedAt = new Date().toISOString();
  writeJson(RESOLVED_URLS_CACHE, resolved);
  console.log(`[resolve] looked up ${looked}, found ${found}, cached -> ${RESOLVED_URLS_CACHE}`);
}

/**
 * One real call per configured API, through the clients that ship.
 *
 * Worth its own command because the request shapes here were written from documentation rather than
 * from a successful call — the container this was built in cannot reach any of these hosts. This
 * turns "hopefully the auth header is right" into a five-second answer, and prints the exact status
 * and body when it is not, so a wrong header reads as `401` rather than as an empty feed.
 */
async function runVerify(): Promise<void> {
  const checks: Array<{ name: string; run: () => Promise<string> }> = [];

  if (isPredictHqConfigured()) {
    checks.push({
      name: "PredictHQ",
      run: async () => {
        const events = await fetchPredictHqConferences({
          activeFrom: new Date().toISOString().slice(0, 10),
          activeTo: "2028-12-31",
          maxEvents: 1,
          pageSize: 1,
        });
        const first = events[0];
        return first ? `ok — e.g. "${(first.title || "").slice(0, 60)}" (${first.country ?? "?"})` : "ok — reachable, no events in window";
      },
    });
  } else {
    console.log("PredictHQ  skipped (PREDICTHQ_ACCESS_TOKEN not set)");
  }

  checks.push({
    name: "OpenAlex ",
    run: async () => {
      const sources = await fetchOpenAlexConferenceSeries({ maxSeries: 1, pageSize: 1 });
      const first = sources[0];
      return first ? `ok — e.g. "${(first.display_name || "").slice(0, 60)}"` : "ok — reachable, no sources returned";
    },
  });

  if (isExaConfigured()) {
    checks.push({
      name: "Exa      ",
      run: async () => {
        const results = await exaSearch({ query: "EAGE Annual Conference official website", numResults: 1 });
        const first = results[0];
        return first ? `ok — e.g. ${first.url}` : "ok — reachable, no results returned";
      },
    });
  } else {
    console.log("Exa        skipped (EXA_API_KEY not set)");
  }

  let failures = 0;
  for (const check of checks) {
    try {
      console.log(`${check.name}  ${await check.run()}`);
    } catch (error) {
      failures += 1;
      console.log(`${check.name}  FAILED — ${(error as Error).message}`);
    }
  }
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. The message above is the API's own, verbatim: a 401 or 403 means the`);
    console.log("credential or the auth header is wrong, a 400 means the request shape is. Report it back and it gets fixed.");
    process.exitCode = 1;
  }
}

/** The fields the mapper actually reads, and nothing else — these lines get pasted by a human. */
function toPortableLine(event: PredictHqEvent, resolvedUrl: string | null): string {
  const venue = (event.entities || []).find((entity) => entity?.type === "venue" && entity.name);
  const compact: Record<string, unknown> = {
    id: event.id,
    title: event.title,
    state: event.state,
    country: event.country,
    start_local: event.start_local || event.start,
    end_local: event.end_local || event.end,
    phq_attendance: event.phq_attendance ?? null,
    rank: event.rank ?? null,
  };
  // Kept short on purpose: a description that runs to a thousand characters makes the block
  // unpasteable, and the first couple of sentences are what a reader sees anyway.
  if (event.description) compact.description = String(event.description).replace(/\s+/g, " ").slice(0, 220);
  if (event.labels?.length) compact.labels = event.labels.slice(0, 6);
  if (venue?.name) compact.entities = [{ name: venue.name, type: "venue" }];
  const locality = event.geo?.address?.locality;
  const region = event.geo?.address?.region;
  if (locality || region) compact.geo = { address: { locality: locality ?? null, region: region ?? null } };
  if (resolvedUrl) compact._resolvedUrl = resolvedUrl;
  return JSON.stringify(compact);
}

/**
 * Everything in one run, for a host that has network but nothing to write to.
 *
 * Verify, fetch, resolve, then print the result as JSONL. The point is the printed block: it is the
 * only way data gets off a machine with no disk and no credentials to commit with, so it is kept
 * compact enough to copy out of a terminal.
 */
async function runOneshot(argv: string[]): Promise<void> {
  const maxEvents = Number(argFor(argv, "--max") || 250);
  const maxResolve = Number(argFor(argv, "--resolve") || 150);
  const minRank = argFor(argv, "--min-rank") ? Number(argFor(argv, "--min-rank")) : 50;
  const minAttendance = Number(argFor(argv, "--min-attendance") || 500);

  if (!isPredictHqConfigured()) {
    console.error("PREDICTHQ_ACCESS_TOKEN is not set — nothing to fetch.");
    process.exitCode = 1;
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`[1/3] fetching up to ${maxEvents} conferences, ${today} .. 2028-12-31, rank >= ${minRank}, attendance >= ${minAttendance}`);
  let events: PredictHqEvent[];
  try {
    events = await fetchPredictHqConferences({
      activeFrom: today,
      activeTo: "2028-12-31",
      maxEvents,
      minRank,
      minAttendance,
    });
  } catch (error) {
    console.error(`PredictHQ FAILED — ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`      got ${events.length} events`);

  // Filtered here rather than after resolution: paying Exa to find a website for a church service
  // is the expensive way to discover it is not a conference.
  const conferences = events.filter((event) => looksLikeConference(event));
  console.log(`      ${conferences.length} of them read as conferences (the rest are other events in the same category)`);

  const urls: Record<string, string> = {};
  if (isExaConfigured()) {
    console.log(`[2/3] resolving official websites for up to ${maxResolve} of them`);
    let looked = 0;
    for (const event of conferences) {
      if (looked >= maxResolve) break;
      if (!event.id || !event.title) continue;
      const year = Number((event.start_local || event.start || "").slice(0, 4));
      if (!year) continue;
      looked += 1;
      try {
        const hit = await resolveOfficialUrl({
          title: event.title,
          year,
          city: event.geo?.address?.locality ?? null,
          country: event.country ?? null,
          countryCode: event.country ?? null,
        });
        if (hit) urls[event.id] = hit.url;
        // Printed as it goes: a silent five-minute loop tells nobody whether it is working.
        console.log(`      ${looked}/${Math.min(maxResolve, conferences.length)} ${hit ? "OK  " : "--  "} ${(event.title || "").slice(0, 52)}${hit ? ` -> ${hit.host}` : ""}`);
      } catch (error) {
        console.error(`      Exa FAILED — ${(error as Error).message}`);
        break;
      }
    }
    console.log(`      looked up ${looked}, found ${Object.keys(urls).length} websites`);
  } else {
    console.log("[2/3] EXA_API_KEY not set — skipping website resolution (those events cannot be published)");
  }

  const withUrl = conferences.filter((event) => event.id && urls[event.id]);
  console.log(`[3/3] ${withUrl.length} events have a website and are ready to publish\n`);
  console.log("=== COPY EVERYTHING BELOW THIS LINE ===");
  for (const event of withUrl) console.log(toPortableLine(event, urls[event.id!]));
  console.log("=== COPY EVERYTHING ABOVE THIS LINE ===");
}

function runStatus(): void {
  const cache = readPredictHqCache();
  const resolved = readResolvedUrls();
  const series = readJson<{ count?: number }>(SERIES_FILE);
  console.log("credentials");
  console.log(`  PredictHQ  ${isPredictHqConfigured() ? "configured" : "NOT configured (PREDICTHQ_ACCESS_TOKEN)"}`);
  console.log(`  OpenAlex   no key required${process.env.OPENALEX_CONTACT_EMAIL ? " (mailto set)" : " (set OPENALEX_CONTACT_EMAIL to join the polite pool)"}`);
  console.log(`  Exa        ${isExaConfigured() ? "configured" : "NOT configured (EXA_API_KEY) — URL resolution is off"}`);
  console.log("caches");
  console.log(`  predicthq-events.json  ${cache ? `${cache.count} events, fetched ${cache.fetchedAt}` : "absent"}`);
  console.log(`  resolved-urls.json     ${Object.keys(resolved.urls).length} resolved, ${resolved.unresolved.length} looked up and not found`);
  console.log(`  conference-series.json ${series?.count ?? "absent"}`);
}

function argFor(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  switch (command) {
    case "predicthq": await runPredictHq(argv); break;
    case "openalex": await runOpenAlex(argv); break;
    case "resolve": await runResolve(argv); break;
    case "verify": await runVerify(); break;
    case "oneshot": await runOneshot(argv); break;
    case "status": case undefined: runStatus(); break;
    default:
      console.error(`Unknown command "${command}". Use: status | verify | oneshot | predicthq | openalex | resolve`);
      process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("ingest.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
