// Fetches the API sources and caches their raw responses under data/sources/.
//
// Split from the builder deliberately. Fetching needs network, credentials and quota; building does
// not. Caching the raw payload in between means the dataset can be rebuilt anywhere — on a laptop,
// in CI, in a container with no egress at all — and that a rebuild months later reproduces exactly
// what the API said at the time rather than whatever it says now.
//
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
  type PredictHqEvent,
} from "./sources/predicthq";
import { fetchOpenAlexConferenceSeries, mapOpenAlexSeries, type ConferenceSeries } from "./sources/openalex";
import { isExaConfigured, resolveOfficialUrl } from "./sources/exa";

const DATA_DIR = path.join(process.cwd(), "data");
export const SOURCES_DIR = path.join(DATA_DIR, "sources");
export const PREDICTHQ_CACHE = path.join(SOURCES_DIR, "predicthq-events.json");
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
    case "status": case undefined: runStatus(); break;
    default:
      console.error(`Unknown command "${command}". Use: status | predicthq | openalex | resolve`);
      process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("ingest.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
