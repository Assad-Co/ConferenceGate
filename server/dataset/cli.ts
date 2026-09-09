// Builds data/conferencegate-worldwide-2026-2028.{json,csv} and the search index from the
// harvested evidence in data/harvest/*.jsonl, then prints the coverage report.
//
// Everything it writes is derived: delete the three outputs and re-run and they come back
// identical, because the evidence — not the output — is the source of truth.

import fs from "node:fs";
import path from "node:path";
import { buildLaunchDataset, toCsv } from "./build";
import type { HarvestEvidence } from "./parseEvidence";
import type { LaunchConferenceRecord } from "./types";

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
      city: percentage(withField((record) => Boolean(record.city)), total),
      country: percentage(withField((record) => Boolean(record.country)), total),
      officialUrl: percentage(officialUrls, total),
      venue: percentage(venues, total),
      organization: percentage(withField((record) => Boolean(record.organization)), total),
      category: percentage(withField((record) => Boolean(record.category)), total),
      corroborated: percentage(withField((record) => record.corroboratingSourceUrls.length > 0), total),
    },
  };
}

function main(): void {
  const evidence = readHarvest();
  const now = new Date();
  const horizonStart = now.toISOString().slice(0, 10);
  const result = buildLaunchDataset(evidence, {
    retrievedAt: horizonStart,
    horizonStart,
    years: [2026, 2027, 2028],
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATASET_JSON, JSON.stringify(result.dataset, null, 2) + "\n");
  fs.writeFileSync(DATASET_CSV, toCsv(result.dataset.records));
  fs.writeFileSync(SEARCH_INDEX, JSON.stringify(result.index) + "\n");

  const report = {
    generatedAt: result.dataset.generatedAt,
    horizonStart,
    evidenceRows: evidence.length,
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
