// Builds data/conferencegate-worldwide-2026-2028.{json,csv} and the search index from the
// harvested evidence in data/harvest/*.jsonl, then prints the coverage report.
//
// Everything it writes is derived: delete the three outputs and re-run and they come back
// identical, because the evidence — not the output — is the source of truth.

import fs from "node:fs";
import path from "node:path";
import { buildLaunchDataset, toCsv, type StructuredOutcome } from "./build";
import type { HarvestEvidence, ParseOptions } from "./parseEvidence";
import type { LaunchConferenceRecord } from "./types";
import { mapPredictHqEvent } from "./sources/predicthq";
import { mapCuratedRow, rowsFromCsv, statedOrNull } from "./sources/curated";
import { readPortableEvents, readPredictHqCache, readResolvedUrls } from "./ingest";

const DATA_DIR = path.join(process.cwd(), "data");
const HARVEST_DIR = path.join(DATA_DIR, "harvest");
const DATASET_JSON = path.join(DATA_DIR, "conferencegate-worldwide-2026-2028.json");
const DATASET_CSV = path.join(DATA_DIR, "conferencegate-worldwide-2026-2028.csv");
const SEARCH_INDEX = path.join(DATA_DIR, "conferencegate-search-index.json");
const REPORT = path.join(DATA_DIR, "conferencegate-dataset-report.json");

export function readHarvest(dir = HARVEST_DIR): HarvestEvidence[] {
  if (!fs.existsSync(dir)) return [];
  const evidence: HarvestEvidence[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed) as HarvestEvidence;
      evidence.push(parsed);
    }
  }
  return evidence;
}

/**
 * The cached PredictHQ events, mapped to records.
 *
 * An event with no resolvable website is refused rather than published: a reader has to be able to
 * open the conference. Those refusals are counted in the report like any other, so "how many events
 * are waiting on a URL" is a number somebody can read rather than a silent gap.
 */
export function structuredFromPredictHq(options: ParseOptions): StructuredOutcome[] {
  // Two ways the same events arrive: a cache this machine fetched, and lines carried back from a
  // machine that could reach the API but could not keep a file. Both are the same events.
  const cache = readPredictHqCache();
  const portable = readPortableEvents();
  const events = [...(cache?.events || []), ...portable.events];
  if (events.length === 0) return [];
  const resolved = readResolvedUrls();
  const urlFor = (id: string) => resolved.urls[id]?.url ?? portable.urls[id] ?? null;

  return events.map((event) => {
    const eventId = event.id || "";
    const officialUrl = urlFor(eventId);
    const outcome = mapPredictHqEvent(event, { ...options, officialUrl });
    return {
      outcome,
      sourceUrl: officialUrl || `predicthq:${eventId || "unknown"}`,
      statedText: [event.title, event.geo?.address?.locality, event.country, event.start_local || event.start]
        .filter(Boolean)
        .join(", "),
    };
  });
}

/**
 * Curated lists committed under data/sources — a society's own calendar, handed over rather than
 * crawled. Read through the same rules as everything else; absent, the build is simply unchanged.
 */
export function structuredFromCuratedLists(options: ParseOptions): StructuredOutcome[] {
  const dir = path.resolve(process.cwd(), "data/sources");
  if (!fs.existsSync(dir)) return [];
  const outcomes: StructuredOutcome[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".csv")).sort()) {
    const full = path.join(dir, file);
    const rows = rowsFromCsv(fs.readFileSync(full, "utf8"));
    for (const row of rows) {
      const outcome = mapCuratedRow(row, {
        ...options,
        sourceName: file.replace(/\.csv$/, ""),
        sourceUrl: statedOrNull(row.website) || `curated:${file}`,
      });
      outcomes.push({
        outcome,
        sourceUrl: statedOrNull(row.website) || `curated:${file}#${row.name}`,
        statedText: [row.name, row.dates, row.location, row.country].filter(Boolean).join(", "),
      });
    }
  }
  return outcomes;
}

function percentage(count: number, total: number): string {
  return total === 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;
}

function tally<T extends string | number>(values: Array<T | null>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value === null || value === undefined || value === "" ? "(none)" : String(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

export function coverageReport(records: LaunchConferenceRecord[]) {
  const total = records.length;
  const withField = (predicate: (record: LaunchConferenceRecord) => boolean) => records.filter(predicate).length;
  const officialUrls = withField((record) => Boolean(record.officialUrl));
  const venues = withField((record) => Boolean(record.venue));
  const exactDates = withField((record) => record.datePrecision === "day");
  return {
    total,
    byYear: tally(records.map((record) => record.year)),
    countries: new Set(records.map((record) => record.country).filter(Boolean)).size,
    cities: new Set(records.map((record) => record.city).filter(Boolean)).size,
    categories: new Set(records.map((record) => record.category).filter(Boolean)).size,
    worldRegions: tally(records.map((record) => record.worldRegion)),
    formats: tally(records.map((record) => record.format)),
    sourceTypes: tally(records.map((record) => record.sourceType)),
    coverage: {
      title: percentage(total, total),
      exactDates: percentage(exactDates, total),
      monthOnlyDates: percentage(total - exactDates, total),
      city: percentage(withField((record) => Boolean(record.city)), total),
      country: percentage(withField((record) => Boolean(record.country)), total),
      officialUrl: percentage(officialUrls, total),
      venue: percentage(venues, total),
      organization: percentage(withField((record) => Boolean(record.organization)), total),
      category: percentage(withField((record) => Boolean(record.category)), total),
      description: percentage(withField((record) => Boolean(record.description)), total),
      corroborated: percentage(withField((record) => record.corroboratingSourceUrls.length > 0), total),
    },
    // Stated as zero rather than omitted. These are the deep sections, and no page of any
    // conference here has been read -- the harvest reads search results, not sites. A reader is
    // told "not retrieved" on those tabs, never "(0)", and enrichment can fill them later without
    // any record here having claimed otherwise.
    notAttempted: {
      submissionDeadline: "0.0%",
      program: "0.0%",
      speakers: "0.0%",
      committee: "0.0%",
      sponsors: "0.0%",
      registrationFees: "0.0%",
      images: "0.0%",
    },
  };
}

function main(): void {
  const evidence = readHarvest();
  const now = new Date();
  const horizonStart = now.toISOString().slice(0, 10);
  const options = { retrievedAt: horizonStart, horizonStart, years: [2026, 2027, 2028] };
  const structured = [...structuredFromPredictHq(options), ...structuredFromCuratedLists(options)];
  const result = buildLaunchDataset(evidence, options, structured);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATASET_JSON, JSON.stringify(result.dataset, null, 2) + "\n");
  fs.writeFileSync(DATASET_CSV, toCsv(result.dataset.records));
  fs.writeFileSync(SEARCH_INDEX, JSON.stringify(result.index) + "\n");

  const report = {
    generatedAt: result.dataset.generatedAt,
    horizonStart,
    evidenceRows: evidence.length,
    apiEventRows: structured.length,
    accepted: result.dataset.records.length,
    duplicatesMerged: result.duplicatesMerged,
    rejected: result.rejections.length,
    rejectionReasons: tally(result.rejections.map((rejection) => rejection.reason.split(":")[0])),
    ...coverageReport(result.dataset.records),
  };
  fs.writeFileSync(REPORT, JSON.stringify({ ...report, rejections: result.rejections }, null, 2) + "\n");

  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("cli.ts")) main();
