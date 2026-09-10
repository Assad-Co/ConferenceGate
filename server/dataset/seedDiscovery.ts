// Puts the launch catalogue into the discovery store, so the enrichment that already runs in
// production starts filling in the parts a search result could never supply.
//
// The two halves of this project have been separate until now. The launch dataset knows 359 real
// conferences — title, dates, city, country, website — because it was built from evidence. The
// discovery engine knows how to READ a conference's website: `deepEnrichment.ts` follows the
// official page's own links to /program, /speakers, /committee and /sponsors and extracts each with
// `deepSections.ts`, under robots, an event-identity check and a verification record. It has simply
// never seen these records, because they live in a JSON file and it reads a database.
//
// This is the bridge, and it is deliberately thin: convert each record to the engine's own
// `NormalizedEvent` and hand it to `storeEvent`. Everything after that — enrichment, deep sections,
// readiness, the review queue, publication — is the machinery that already exists, with its
// existing guards. Nothing here reads a page, and nothing here publishes anything.
//
// Records land as `validated`, not `published`. That is what enrichment picks up, and it leaves the
// publication gate exactly where CLAUDE.md puts it: behind DISCOVERY_PUBLISH_TO_CONFERENCES, an
// audit, and a readiness check. Seeding is not publishing.
//
//   npx tsx server/dataset/seedDiscovery.ts --dry-run     what would be written, writing nothing
//   npx tsx server/dataset/seedDiscovery.ts               write them

import { createHash } from "node:crypto";
import { storeEvent } from "../discovery/store";
import {
  EMPTY_DEADLINES,
  type CategoryAssignment,
  type EventFormat,
  type FieldProvenance,
  type NormalizedEvent,
} from "../discovery/types";
import { loadLaunchDataset } from "./staticDataset";
import type { LaunchConferenceRecord } from "./types";

/** The engine's spelling of a format, from the dataset's. */
function formatFor(record: LaunchConferenceRecord): EventFormat {
  if (record.format === "hybrid") return "hybrid";
  if (record.format === "online") return "online";
  return "in_person";
}

/**
 * How far a source is trusted when two of them disagree about a field.
 *
 * Ordered the same way the dataset ranks its own sources: the organiser's own site outranks a
 * structured events API, which outranks a page written about the conference, which outranks a
 * listing. A directory record is seeded at low trust so anything the enrichment later reads from
 * the conference's own site wins without argument.
 */
function trustFor(record: LaunchConferenceRecord): number {
  switch (record.sourceType) {
    case "official_site": return 0.9;
    case "event_api": return 0.65;
    case "third_party": return 0.5;
    case "reference": return 0.4;
    default: return 0.25;
  }
}

/** The dataset's per-field provenance, in the engine's shape.
 *
 *  Both sides record the same idea — which page supplied a value and how firmly — but with
 *  different field names, so this is a translation rather than a re-derivation. The confidence
 *  words become the numbers the engine compares sources with. */
function provenanceFor(record: LaunchConferenceRecord): Record<string, FieldProvenance> {
  const numeric: Record<string, number> = { High: 0.9, Medium: 0.6, Low: 0.35 };
  const values: Record<string, string | null> = {
    title: record.title,
    dates: record.startDate,
    city: record.city,
    country: record.country,
    venue: record.venue,
    organization: record.organization,
  };
  const translated: Record<string, FieldProvenance> = {};
  for (const [field, entry] of Object.entries(record.provenance)) {
    translated[field] = {
      value: values[field] ?? null,
      sourceUrl: entry.sourceUrl,
      sourceDomain: record.sourceHost,
      method: "derived",
      confidence: numeric[entry.confidence] ?? 0.5,
      lastVerified: record.evidence.retrievedAt,
    };
  }
  return translated;
}

/** Identifies this version of the record, so a re-seed after a rebuild is recognised as a change
 *  rather than as the same row arriving twice. */
function contentHashFor(record: LaunchConferenceRecord): string {
  return createHash("sha256")
    .update(
      [record.title, record.startDate, record.endDate, record.city, record.country, record.venue, record.sourceUrl]
        .map((value) => value ?? "")
        .join("|")
    )
    .digest("hex");
}

export function toNormalizedEvent(record: LaunchConferenceRecord): NormalizedEvent {
  const categories: CategoryAssignment[] = record.categories.map((category, index) => ({
    category,
    // The dataset stores categories most-confident-first but not their scores; this keeps the
    // order meaningful without inventing a precision the record never had.
    confidence: Math.max(0.3, 0.8 - index * 0.15),
    evidence: record.topics.slice(0, 4),
  }));

  return {
    title: record.title,
    acronym: record.acronym,
    description: record.description,

    startDate: record.startDate,
    endDate: record.endDate,
    startYear: record.year,
    startMonth: record.startDate ? Number(record.startDate.slice(5, 7)) : null,
    datePrecision: record.datePrecision,
    datesText: record.datesText,

    // A launch record carries no deadlines: nothing it was built from stated one, and enrichment
    // is what will find them on the conference's own call-for-papers page.
    deadlines: { ...EMPTY_DEADLINES },

    venue: record.venue,
    venueAddress: null,
    city: record.city,
    region: record.region,
    country: record.country,
    countryCode: record.countryCode,
    worldRegion: record.worldRegion,
    rawLocation: [record.venue, record.city, record.region, record.country].filter(Boolean).join(", ") || null,
    latitude: null,
    longitude: null,

    format: formatFor(record),
    eventType: "conference",
    originalEventType: null,

    organizer: record.organization,
    organizerUrl: null,
    officialUrl: record.officialUrl,
    registrationUrl: null,
    submissionUrl: null,
    imageUrl: null,

    price: null,
    currency: null,
    language: null,

    contactName: null,
    contactEmail: null,
    contactPhone: null,

    topics: record.topics,
    categories,

    series: {
      name: record.series,
      acronym: record.acronym,
      edition: record.edition,
      year: record.year,
    },

    sourceUrl: record.sourceUrl,
    sourceDomain: record.sourceHost,
    // Derived, not read: every field here came from evidence about the conference rather than from
    // its own page. Saying "html" would claim a page read that never happened, and would let this
    // outrank what enrichment actually reads later.
    extractionMethod: "derived",
    confidenceScore: trustFor(record),
    relevance: {
      isRelevantEvent: true,
      classification: "conference",
      confidenceScore: trustFor(record),
      classificationReason: `Launch dataset record built from ${record.evidence.method} evidence and validated against the date, location and source-URL rules.`,
    },
    provenance: provenanceFor(record),
    // Nothing is flagged: a record only reaches the dataset by passing its rules, and inventing a
    // flag here would put a mark on the row that no check actually raised.
    qualityFlags: [],
    contentHash: contentHashFor(record),
  };
}

export interface SeedResult {
  considered: number;
  seeded: number;
  skippedWithoutUrl: number;
  failures: Array<{ id: string; message: string }>;
}

export async function seedLaunchRecords(
  options: { dryRun?: boolean; limit?: number; onProgress?: (done: number, total: number, title: string) => void } = {}
): Promise<SeedResult> {
  const { records } = loadLaunchDataset();
  const limit = options.limit ?? records.length;
  const result: SeedResult = { considered: 0, seeded: 0, skippedWithoutUrl: 0, failures: [] };

  for (const record of records.slice(0, limit)) {
    result.considered += 1;
    // Enrichment works by following a conference's own website. A record without one has nothing
    // for it to read, so seeding it would only add a row nothing can improve.
    if (!record.officialUrl) {
      result.skippedWithoutUrl += 1;
      continue;
    }
    if (options.dryRun) {
      result.seeded += 1;
      continue;
    }
    try {
      options.onProgress?.(result.considered, limit, record.title);
      await storeEvent(toNormalizedEvent(record), {
        // `validated` is what enrichment selects. Publication stays behind its own flag and audit.
        status: "validated",
        sourceTrust: trustFor(record),
        sourceType: record.sourceType,
        provider: "launch_dataset",
        isOfficial: record.sourceType === "official_site",
      });
      result.seeded += 1;
    } catch (error) {
      result.failures.push({ id: record.id, message: (error as Error).message });
    }
  }
  return result;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;

  if (!process.env.TURSO_DATABASE_URL && !dryRun) {
    console.error("TURSO_DATABASE_URL is not set. Seeding a container-local SQLite file would write");
    console.error("rows nothing can read; run this where the production database is configured.");
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  // Each record is several round trips to a remote database, so a silent run looks identical to a
  // hung one for minutes at a time. Printing every twentieth is enough to see it moving without
  // turning the log into three hundred lines.
  const result = await seedLaunchRecords({
    dryRun,
    limit,
    onProgress: (done, total, title) => {
      if (done === 1 || done % 20 === 0) {
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.log(`  ${done}/${total}  ${elapsed}s  ${title.slice(0, 52)}`);
      }
    },
  });
  console.log(`${dryRun ? "[dry run] " : ""}considered ${result.considered}`);
  console.log(`  seeded as validated       ${result.seeded}`);
  console.log(`  skipped, no website       ${result.skippedWithoutUrl}`);
  console.log(`  failed                    ${result.failures.length}`);
  for (const failure of result.failures.slice(0, 10)) console.log(`    ${failure.id}: ${failure.message}`);

  if (result.failures.length > 0) {
    // Reporting success while writing nothing is worse than failing: it sends somebody away
    // believing the catalogue is being enriched when not one row was stored.
    console.error(`\n${result.failures.length} records could not be stored. Nothing downstream will see them.`);
    process.exitCode = 1;
    return;
  }
  if (!dryRun && result.seeded > 0) {
    // Deliberately does not promise filled tabs. Enrichment reads the sites and writes what it
    // finds into `discovery_events`; the detail page reads `extracted_conferences`. Publication
    // is what joins the two, and it is opt-in. Saying "the tabs will fill" would be the same
    // overstatement this pipeline refuses everywhere else.
    console.log("\nThese are now visible to enrichment: `npm run discovery -- enrich --missing-deep-only`");
    console.log("(or the next automation run) reads each conference's own site and stores what it");
    console.log("finds on the discovery record. Reaching the detail page's tabs is a further step:");
    console.log("publication, behind DISCOVERY_PUBLISH_TO_CONFERENCES. `publish --dry-run` shows it.");
  }
}

if (process.argv[1] && process.argv[1].endsWith("seedDiscovery.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
