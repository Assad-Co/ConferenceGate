// PredictHQ's conferences feed, mapped into launch records.
//
// This is the one source here whose fields arrive already structured: a start date is a date, not a
// phrase inside a sentence that has to be parsed back out. That makes it the strongest non-official
// evidence the catalogue has, and it is ranked accordingly — above a directory listing, below the
// organiser's own website.
//
// Two things it does NOT give us, and both are handled rather than papered over:
//
//   * No official website. PredictHQ identifies events, not their homepages. A record with no URL
//     cannot be opened by a reader, so it is refused here and handed to the URL resolver instead of
//     being published with a dead link.
//   * No guarantee any given field is present. Every field below is read defensively, because a
//     schema this wide will have gaps and an absent venue must become null, never a guess.

import { classifyCategories, primaryCategory } from "../../discovery/categories";
import { normalizeCountry } from "../../discovery/countries";
import {
  classifySource,
  refuseByDateWindow,
  seriesName,
  slugify,
  splitTitleParts,
  topicsFromTitle,
  type ParseOptions,
  type ParseOutcome,
} from "../parseEvidence";
import type { LaunchFieldProvenance } from "../types";

const API_BASE = "https://api.predicthq.com/v1/events/";

/** Read defensively: every field is optional because a wide schema will have gaps. */
export interface PredictHqEvent {
  id?: string;
  title?: string;
  description?: string | null;
  category?: string;
  labels?: string[];
  phq_labels?: Array<{ label?: string; weight?: number }>;
  rank?: number;
  local_rank?: number | null;
  phq_attendance?: number | null;
  entities?: Array<{ entity_id?: string; name?: string; type?: string; formatted_address?: string }>;
  start?: string;
  end?: string;
  start_local?: string;
  end_local?: string;
  predicted_end_local?: string;
  timezone?: string | null;
  country?: string;
  state?: string;
  geo?: {
    geometry?: { type?: string; coordinates?: number[] };
    address?: {
      country_code?: string;
      locality?: string | null;
      region?: string | null;
      postcode?: string | null;
      formatted_address?: string | null;
    };
  };
  place_hierarchies?: string[][];
}

export interface PredictHqPage {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: PredictHqEvent[];
}

export function isPredictHqConfigured(): boolean {
  return Boolean(process.env.PREDICTHQ_ACCESS_TOKEN?.trim());
}

export interface PredictHqFetchOptions {
  /** Inclusive ISO day the window opens — normally today. */
  activeFrom: string;
  /** Inclusive ISO day the window closes — normally the last day of the dataset's last year. */
  activeTo: string;
  /** Hard ceiling on events pulled, so one run cannot drain a quota. */
  maxEvents?: number;
  /** Page size. PredictHQ caps this; 500 is its documented maximum. */
  pageSize?: number;
  /** Only events at or above this PHQ rank. Rank is significance, not correctness — it is used to
   *  spend the quota on conferences people have heard of first, never to assert quality. */
  minRank?: number;
  /**
   * Only events expected to draw at least this many people.
   *
   * This is the filter that matters. PredictHQ's "conferences" category is far broader than the
   * word suggests: a live run at rank >= 30 returned a women's breakfast, a psychic medium evening,
   * a church service and a department-store styling drop-in. What separates those from a real
   * conference is not vocabulary, it is size — they draw dozens, a conference draws hundreds to
   * tens of thousands.
   */
  minAttendance?: number;
  fetchImpl?: typeof fetch;
  onPage?: (page: PredictHqPage, pageNumber: number) => void;
}

/**
 * Pulls conference events in the window, following PredictHQ's own `next` links.
 *
 * Stops at `maxEvents`, at the last page, or on the first non-OK response — an error is thrown with
 * the status so the caller can tell "bad token" from "quota spent" rather than seeing an empty list.
 */
export async function fetchPredictHqConferences(options: PredictHqFetchOptions): Promise<PredictHqEvent[]> {
  const token = process.env.PREDICTHQ_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("PREDICTHQ_ACCESS_TOKEN is not set");

  const doFetch = options.fetchImpl || fetch;
  const maxEvents = Math.max(1, options.maxEvents ?? 5000);
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 500), 500);

  const first = new URL(API_BASE);
  first.searchParams.set("category", "conferences");
  first.searchParams.set("active.gte", options.activeFrom);
  first.searchParams.set("active.lte", options.activeTo);
  first.searchParams.set("limit", String(pageSize));
  // Most significant first, so a capped run keeps the conferences most readers have heard of.
  first.searchParams.set("sort", "-rank");
  if (options.minRank !== undefined) first.searchParams.set("rank.gte", String(options.minRank));
  if (options.minAttendance !== undefined) {
    first.searchParams.set("phq_attendance.gte", String(options.minAttendance));
  }

  const collected: PredictHqEvent[] = [];
  let nextUrl: string | null = first.toString();
  let pageNumber = 0;

  while (nextUrl && collected.length < maxEvents) {
    const response: Response = await doFetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`PredictHQ responded ${response.status}: ${body.slice(0, 300)}`);
    }
    const page = (await response.json()) as PredictHqPage;
    pageNumber += 1;
    options.onPage?.(page, pageNumber);
    for (const event of page.results || []) {
      collected.push(event);
      if (collected.length >= maxEvents) break;
    }
    nextUrl = typeof page.next === "string" && page.next ? page.next : null;
  }

  return collected;
}

/** The date part of a PredictHQ timestamp, which may be a full ISO datetime or already a day. */
function isoDay(value: string | undefined | null): string | null {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function venueOf(event: PredictHqEvent): string | null {
  const venue = (event.entities || []).find((entity) => entity?.type === "venue" && entity.name);
  return venue?.name?.trim() || null;
}

/** PredictHQ marks a remote event through its labels rather than a dedicated field. */
function formatOf(event: PredictHqEvent): "in-person" | "hybrid" | "online" {
  const labels = [
    ...(event.labels || []),
    ...(event.phq_labels || []).map((entry) => entry?.label || ""),
  ]
    .join(" ")
    .toLowerCase();
  if (/\bhybrid\b/.test(labels)) return "hybrid";
  if (/\b(virtual|online|remote)\b/.test(labels)) return "online";
  return "in-person";
}

/** The words that make a title a conference rather than an evening out. */
const CONFERENCE_VOCABULARY =
  /\b(conferences?|congress(?:es)?|symposi(?:um|a)|conventions?|expo(?:sition)?s?|summits?|colloqui(?:um|a)|trade\s+(?:fair|show)|(?:annual|general|international)\s+meeting|world\s+congress)\b/i;

/**
 * True when an event is a conference rather than something else in the same category.
 *
 * Two ways to qualify, because either alone is wrong. The vocabulary test alone would refuse
 * ADIPEC, GITEX and LEAP, whose names say nothing about what they are. The size test alone would
 * accept any large gathering. So: a title that names itself a conference, OR an event big enough
 * that nothing else it could be would draw that crowd.
 */
export function looksLikeConference(
  event: PredictHqEvent,
  highAttendanceBypass = 2000
): boolean {
  if (CONFERENCE_VOCABULARY.test(event.title || "")) return true;
  return (Number(event.phq_attendance) || 0) >= highAttendanceBypass;
}

export interface PredictHqMapOptions extends ParseOptions {
  /**
   * The conference's own website, resolved elsewhere.
   *
   * PredictHQ does not supply one, and a record a reader cannot open is not launch inventory — so
   * without this the event is refused rather than published with no link.
   */
  officialUrl?: string | null;
  /** Attendance above which an event counts as a conference whatever its title says. */
  highAttendanceBypass?: number;
}

/**
 * Turns one PredictHQ event into a launch record, or says why it cannot be one.
 *
 * The date window, the year range and the already-finished rule are the SAME checks the text parser
 * runs, imported rather than restated, so a conference cannot be accepted by one path and refused
 * by the other.
 */
export function mapPredictHqEvent(event: PredictHqEvent, options: PredictHqMapOptions): ParseOutcome {
  const title = (event.title || "").replace(/\s+/g, " ").trim();
  if (!title || title.length < 4) return { ok: false, reason: "no_title" };
  if (event.state && event.state !== "active") return { ok: false, reason: `event_state:${event.state}` };
  if (!looksLikeConference(event, options.highAttendanceBypass)) return { ok: false, reason: "not_a_conference" };

  const startDate = isoDay(event.start_local) || isoDay(event.start);
  const endDate = isoDay(event.end_local) || isoDay(event.end) || isoDay(event.predicted_end_local) || startDate;
  const startYear = startDate ? Number(startDate.slice(0, 4)) : null;
  const startMonth = startDate ? Number(startDate.slice(5, 7)) : null;

  const dateRefusal = refuseByDateWindow(
    { startDate, endDate, startYear, startMonth, precision: startDate ? "day" : null },
    options
  );
  if (dateRefusal) return { ok: false, reason: dateRefusal };

  const countryRecord = normalizeCountry(event.country || event.geo?.address?.country_code);
  const city = event.geo?.address?.locality?.trim() || null;
  const region = event.geo?.address?.region?.trim() || null;
  const venue = venueOf(event);
  const format = formatOf(event);
  if (!city && !countryRecord && format !== "online") return { ok: false, reason: "no_location" };

  // No website means no page for a reader to open. Refused here and picked up by the resolver.
  const officialUrl = options.officialUrl?.trim() || null;
  if (!officialUrl || !/^https?:\/\//i.test(officialUrl)) return { ok: false, reason: "no_source_url" };
  let host: string;
  try {
    host = new URL(officialUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { ok: false, reason: "unparseable_source_url" };
  }

  const { acronym, edition } = splitTitleParts(title);
  const description = (event.description || "").replace(/\s+/g, " ").trim() || null;
  const phqLabels = [
    ...(event.labels || []),
    ...(event.phq_labels || []).map((entry) => entry?.label || ""),
  ].filter(Boolean);

  const categoryResults = classifyCategories({
    title,
    description,
    topics: [...phqLabels, ...topicsFromTitle(title)],
    organizer: null,
  });
  const category = primaryCategory(categoryResults);
  const topics = [...new Set([...phqLabels, ...categoryResults.flatMap((r) => r.evidence), ...topicsFromTitle(title)])].slice(0, 16);
  const keywords = [...new Set(
    [
      acronym,
      city,
      region,
      countryRecord?.name,
      countryRecord?.iso2,
      countryRecord?.iso3,
      ...(countryRecord?.aliases || []),
      countryRecord?.region,
      startYear ? String(startYear) : null,
      category,
    ].filter((value): value is string => Boolean(value && value.trim()))
  )];

  const sourceType = classifySource(officialUrl);
  const provenanceEntry = (confidence: LaunchFieldProvenance["confidence"]): LaunchFieldProvenance => ({
    sourceUrl: officialUrl,
    sourcePageTitle: title,
    confidence,
  });
  const provenance: Record<string, LaunchFieldProvenance> = {
    title: provenanceEntry("High"),
    dates: provenanceEntry("High"),
  };
  if (city) provenance.city = provenanceEntry("High");
  if (countryRecord) provenance.country = provenanceEntry("High");
  if (venue) provenance.venue = provenanceEntry("High");

  const series = seriesName(title, acronym);
  const id = slugify([acronym || series || title, startYear, city || countryRecord?.name || format].filter(Boolean).join("-"));
  if (!id) return { ok: false, reason: "no_identity" };

  return {
    ok: true,
    record: {
      id,
      title,
      acronym,
      series,
      edition,
      year: startYear!,
      startDate,
      endDate,
      datePrecision: "day",
      datesText: null,
      city,
      region,
      country: countryRecord?.name ?? null,
      countryCode: countryRecord?.iso2 ?? null,
      worldRegion: countryRecord?.region ?? null,
      venue,
      format,
      organization: null,
      category,
      categories: categoryResults.map((result) => result.category),
      topics,
      keywords,
      description,
      sourceUrl: officialUrl,
      sourceHost: host,
      // The record is only as strong as the page its link points at; PredictHQ supplied the facts,
      // and that is recorded in the evidence rather than by upgrading the source type.
      sourceType: sourceType === "official_site" ? "official_site" : "event_api",
      officialUrl: sourceType === "official_site" ? officialUrl : null,
      evidence: {
        query: "predicthq:category=conferences",
        resultTitle: title,
        statedText: [
          title,
          venue,
          city,
          region,
          countryRecord?.name,
          startDate && endDate && startDate !== endDate ? `${startDate} to ${endDate}` : startDate,
        ]
          .filter(Boolean)
          .join(", "),
        retrievedAt: options.retrievedAt,
        method: "event_api",
        externalId: event.id ?? null,
      },
      provenance,
      corroboratingSourceUrls: [],
      origin: "launch_dataset",
    },
  };
}
