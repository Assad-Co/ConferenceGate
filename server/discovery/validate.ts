// Validation and quality flags.
//
// Two separate jobs, kept apart on purpose.
//
// Validation asks whether a record is internally coherent — a start date that precedes its end
// date, a title that exists, a URL that parses. A record that fails is rejected with the reason
// recorded, because storing an incoherent conference is worse than storing nothing.
//
// Quality flagging asks something different and much softer: is there anything about this record
// a person should look at before it is published? The flags are neutral internal indicators
// (section 21). "missing_organizer" is not an accusation about an organiser; it is a note that a
// field is empty. Nothing here concludes that anyone is fraudulent, and low confidence sends a
// record to review rather than to rejection.

import { isFutureMonth, isFutureOrToday } from "./dates";
import type { NormalizedEvent, PublicationStatus } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  qualityFlags: string[];
  status: PublicationStatus;
}

export interface ValidationOptions {
  targetYears: number[];
  now?: Date;
  /** Trust of the domain the record came from, 0–1. Directories carry less weight than an
   *  organiser's own site, which is what decides whether a thin record is publishable. */
  sourceTrust: number;
  /** Phase 1 default: nothing is auto-published, everything coherent is validated and held.
   *  Turning this on lets high-confidence records from trusted official sources publish. */
  allowAutoPublish?: boolean;
}

const MIN_TITLE_LENGTH = 6;
const MAX_TITLE_LENGTH = 300;

export function validateEvent(event: NormalizedEvent, options: ValidationOptions): ValidationResult {
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const flags: string[] = [];

  // ---- Hard coherence checks.
  const title = (event.title || "").trim();
  if (title.length < MIN_TITLE_LENGTH) errors.push("title_missing_or_too_short");
  if (title.length > MAX_TITLE_LENGTH) errors.push("title_implausibly_long");

  if (event.startDate && event.endDate && event.endDate < event.startDate) {
    errors.push("end_date_before_start_date");
  }

  if (event.officialUrl) {
    try {
      const parsed = new URL(event.officialUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") errors.push("official_url_not_http");
    } catch {
      errors.push("official_url_unparseable");
    }
  }

  if (!event.relevance.isRelevantEvent) errors.push("classified_as_not_a_conference");

  // ---- Timing. Discovery is for upcoming events, so a conference that has already finished is
  // out of scope — but only when the page actually stated a date we could read. An event whose
  // date is unknown is unknown, not past.
  const hasDay = !!event.startDate;
  const isUpcoming = hasDay
    ? isFutureOrToday(event.endDate || event.startDate, now)
    : event.startYear
      ? isFutureMonth(event.startYear, event.startMonth, now)
      : null;

  if (isUpcoming === false) errors.push("event_already_finished");
  if (isUpcoming === null) flags.push("no_date_stated");

  if (event.startYear && options.targetYears.length > 0 && !options.targetYears.includes(event.startYear)) {
    // Out of the run's target years is not an error — the record is real and worth keeping — but
    // it is worth knowing about.
    flags.push("outside_target_years");
  }

  // ---- Deadlines. A deadline that has passed is NOT grounds for rejection while the conference
  // itself is still ahead (section 48) — it is simply a closed call for papers.
  for (const [field, value] of Object.entries(event.deadlines)) {
    if (!value) continue;
    if (event.startDate && value > event.startDate) flags.push(`${toSnake(field)}_after_event_start`);
    else if (!isFutureOrToday(value, now)) flags.push(`${toSnake(field)}_passed`);
  }

  // ---- Neutral quality indicators.
  if (!event.organizer) flags.push("missing_organizer");
  if (!event.officialUrl) flags.push("missing_official_url");
  if (!event.country) flags.push("unverifiable_location");
  if (!event.city && event.format !== "online") flags.push("missing_city");
  if (!event.description) flags.push("missing_description");
  if (event.format === "unknown") flags.push("format_not_stated");
  if (event.categories.length === 0) flags.push("uncategorized");
  if (event.confidenceScore < 0.5) flags.push("low_source_confidence");
  if (options.sourceTrust < 0.6) flags.push("low_trust_source");
  if (event.extractionMethod === "ai") flags.push("ai_assisted_extraction");
  if (event.startDate && event.endDate) {
    const span = (Date.parse(event.endDate) - Date.parse(event.startDate)) / 86_400_000;
    // A "conference" running for months is nearly always a programme page or a parsing slip.
    if (span > 30) flags.push("inconsistent_dates");
  }

  const valid = errors.length === 0;

  // ---- Publication status. Nothing low-confidence is ever published automatically.
  let status: PublicationStatus;
  if (!valid) {
    status = errors.includes("event_already_finished") ? "expired" : "rejected";
  } else if (
    options.allowAutoPublish &&
    event.confidenceScore >= 0.75 &&
    options.sourceTrust >= 0.8 &&
    event.relevance.confidenceScore >= 0.7 &&
    !!event.startDate &&
    !!event.country &&
    !!event.officialUrl &&
    flags.filter((flag) => SERIOUS_FLAGS.has(flag)).length === 0
  ) {
    status = "published";
  } else if (event.confidenceScore < 0.45 || flags.filter((flag) => SERIOUS_FLAGS.has(flag)).length >= 2) {
    status = "needs_review";
  } else {
    status = "validated";
  }

  return { valid, errors, qualityFlags: [...new Set(flags)], status };
}

/** Flags weighty enough to hold a record back on their own. */
const SERIOUS_FLAGS = new Set([
  "low_source_confidence",
  "unverifiable_location",
  "inconsistent_dates",
  "missing_official_url",
  "no_date_stated",
  "broken_official_url",
  "duplicate_content",
]);

function toSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Contact email shape check, kept conservative: an address that does not look like one is null
 *  rather than stored and shown to somebody (section 45). */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value.trim());
}

/** Phone shape check, deliberately loose about formatting and strict about being a phone number. */
export function isPlausiblePhone(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^(?:19|20)\d{2}$/.test(digits)) return false;
  return true;
}
