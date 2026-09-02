// Deduplication.
//
// One conference appears on its own site, its society's site, a university listing, a publisher's
// page and three directories. Conference Gate must hold one record for it, with all six named as
// sources — not six near-identical rows.
//
// The scoring is additive across independent signals, because no single one is reliable alone:
// two different conferences share a city and a week all the time, and the same conference is
// written six different ways. What is decisive is agreement across several signals at once.
//
// The one rule with no exceptions: nothing is ever deleted because two titles looked similar. A
// high score merges (the sources join one record); a middling score goes to the review queue; a
// low score leaves both records standing (section 17).

import { canonicalizeUrl, normalizeTitle } from "./normalize";
import type { NormalizedEvent } from "./types";

export interface DuplicateCandidate {
  id: string;
  title: string;
  normalized_title: string;
  acronym: string | null;
  start_date: string | null;
  end_date: string | null;
  start_year: number | null;
  start_month: number | null;
  city: string | null;
  country: string | null;
  organizer: string | null;
  official_url: string | null;
  canonical_url: string | null;
  description: string | null;
  series_id: string | null;
}

export interface DuplicateVerdict {
  score: number;
  reason: string;
  decision: "merge" | "review" | "separate";
  matchedSignals: string[];
}

export const MERGE_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;

/** Jaccard overlap of the two titles' word sets, after year/edition/stopword removal. */
export function titleSimilarity(left: string, right: string): number {
  const a = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const b = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Overlap of the two descriptions' distinctive words — weak evidence, used only as a tiebreak. */
export function descriptionSimilarity(left: string | null, right: string | null): number {
  if (!left || !right) return 0;
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 5)
        .slice(0, 200)
    );
  const a = words(left);
  const b = words(right);
  if (a.size < 5 || b.size < 5) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function sameDay(left: string | null, right: string | null): boolean {
  return !!left && !!right && left === right;
}

function withinDays(left: string | null, right: string | null, days: number): boolean {
  if (!left || !right) return false;
  return Math.abs(Date.parse(left) - Date.parse(right)) <= days * 86_400_000;
}

function normalizedText(value: string | null): string | null {
  return value ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null : null;
}

/**
 * Scores how likely two records are the same conference.
 *
 * The identity signals — the same canonical URL, or the same acronym on the same dates — are
 * strong enough to decide on their own. Everything else has to accumulate.
 */
export function scoreDuplicate(incoming: NormalizedEvent, existing: DuplicateCandidate): DuplicateVerdict {
  const signals: string[] = [];
  let score = 0;

  // ---- URL identity. The same page, or the same official site, is the same conference.
  const incomingCanonical = canonicalizeUrl(incoming.officialUrl || incoming.sourceUrl);
  const existingCanonical = existing.canonical_url || canonicalizeUrl(existing.official_url);
  if (incomingCanonical && existingCanonical && incomingCanonical === existingCanonical) {
    signals.push("same canonical URL");
    score += 0.85;
  }

  // ---- Title.
  const similarity = titleSimilarity(incoming.title, existing.title);
  if (similarity >= 0.9) {
    signals.push(`titles match (${similarity.toFixed(2)})`);
    score += 0.45;
  } else if (similarity >= 0.65) {
    signals.push(`titles similar (${similarity.toFixed(2)})`);
    score += 0.3;
  } else if (similarity >= 0.4) {
    signals.push(`titles partly similar (${similarity.toFixed(2)})`);
    score += 0.12;
  }

  // ---- Acronym. A shared acronym is strong, but only alongside a matching year: IMOG 2027 and
  // IMOG 2028 are two different conferences, not one duplicated.
  const incomingAcronym = incoming.acronym?.toUpperCase() || null;
  const existingAcronym = existing.acronym?.toUpperCase() || null;
  if (incomingAcronym && existingAcronym && incomingAcronym === existingAcronym) {
    const sameYear = !!incoming.startYear && incoming.startYear === existing.start_year;
    signals.push(sameYear ? "same acronym and year" : "same acronym");
    score += sameYear ? 0.4 : 0.1;
  }

  // ---- Dates.
  if (sameDay(incoming.startDate, existing.start_date)) {
    signals.push("same start date");
    score += 0.3;
  } else if (withinDays(incoming.startDate, existing.start_date, 3)) {
    signals.push("start dates within three days");
    score += 0.15;
  } else if (
    incoming.startYear &&
    incoming.startYear === existing.start_year &&
    incoming.startMonth &&
    incoming.startMonth === existing.start_month
  ) {
    signals.push("same month and year");
    score += 0.12;
  } else if (incoming.startDate && existing.start_date) {
    // Two conferences with the same name in different months of the same year are different
    // editions or different events; that is evidence against, not merely absence of evidence.
    signals.push("different dates");
    score -= 0.25;
  }

  // ---- Place.
  const incomingCity = normalizedText(incoming.city);
  const existingCity = normalizedText(existing.city);
  if (incomingCity && existingCity) {
    if (incomingCity === existingCity) {
      signals.push("same city");
      score += 0.15;
    } else {
      signals.push("different cities");
      score -= 0.2;
    }
  }
  if (incoming.country && existing.country) {
    if (incoming.country === existing.country) {
      signals.push("same country");
      score += 0.08;
    } else {
      signals.push("different countries");
      score -= 0.25;
    }
  }

  // ---- Organiser.
  const incomingOrganizer = normalizedText(incoming.organizer);
  const existingOrganizer = normalizedText(existing.organizer);
  if (incomingOrganizer && existingOrganizer && incomingOrganizer === existingOrganizer) {
    signals.push("same organiser");
    score += 0.12;
  }

  // ---- Series.
  const incomingSeries = seriesKeyFor(incoming);
  if (incomingSeries && existing.series_id && incomingSeries === existing.series_id) {
    signals.push("same conference series");
    score += 0.1;
  }

  // ---- Description overlap: the tiebreak, never the deciding vote.
  const descriptionOverlap = descriptionSimilarity(incoming.description, existing.description);
  if (descriptionOverlap >= 0.6) {
    signals.push(`descriptions overlap (${descriptionOverlap.toFixed(2)})`);
    score += 0.1;
  }

  const finalScore = Math.max(0, Math.min(1, score));
  const decision: DuplicateVerdict["decision"] =
    finalScore >= MERGE_THRESHOLD ? "merge" : finalScore >= REVIEW_THRESHOLD ? "review" : "separate";

  return {
    score: Number(finalScore.toFixed(3)),
    reason: signals.length > 0 ? signals.join("; ") : "no shared identifying signals",
    decision,
    matchedSignals: signals,
  };
}

/** Picks the best match among candidates. Returns null when nothing scores above "separate". */
export function bestDuplicate(
  incoming: NormalizedEvent,
  candidates: DuplicateCandidate[]
): { candidate: DuplicateCandidate; verdict: DuplicateVerdict } | null {
  let best: { candidate: DuplicateCandidate; verdict: DuplicateVerdict } | null = null;
  for (const candidate of candidates) {
    const verdict = scoreDuplicate(incoming, candidate);
    if (verdict.decision === "separate") continue;
    if (!best || verdict.score > best.verdict.score) best = { candidate, verdict };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Conference series
// ---------------------------------------------------------------------------------------------

/**
 * A stable key for "the same conference, any year".
 *
 * Built from the acronym when the conference states one, otherwise from its year-stripped title.
 * This is what will later let the engine notice that a 2028 edition of a series it already knows
 * has appeared — without ever guessing that one exists (section 19).
 */
export function seriesKeyFor(event: {
  title: string;
  acronym: string | null;
  organizer: string | null;
}): string | null {
  if (event.acronym && event.acronym.length >= 2) {
    return `acr:${event.acronym.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  }
  const normalized = normalizeTitle(event.title);
  if (normalized.split(" ").filter(Boolean).length < 2) return null;
  return `ttl:${normalized.replace(/\s+/g, "-")}`;
}

/** A display name for a series: the title with its year taken off, not a name we made up. */
export function seriesNameFor(title: string): string {
  return title
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,:–-]+$/, "")
    .trim();
}
