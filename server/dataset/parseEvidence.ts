// Turns one harvested search result into a launch dataset record.
//
// This is deliberately code rather than transcription. The harvest captures what a search result
// said, verbatim; every structured field below is then derived from that text by rules that can be
// read, tested and re-run. A hand-typed record drifts silently from its evidence — a parsed one
// cannot, because rebuilding the dataset re-derives it.
//
// The refusals matter as much as the extraction:
//   * No date the parser is sure of means no record. A deadline or an academic-year label is never
//     promoted to an event date.
//   * A country it cannot resolve stays null; the nearest-looking guess is never substituted.
//   * A listing host never becomes an official URL, however authoritative the listing sounds.

import { parseDateRange } from "../discovery/dates";
import { findCountryInText, normalizeCountry } from "../discovery/countries";
import { classifyCategories, primaryCategory } from "../discovery/categories";
import { isDirectoryHost, isReferenceHost } from "../directoryHosts";
import type {
  LaunchConferenceRecord,
  LaunchFieldProvenance,
  LaunchFormat,
  LaunchSourceType,
} from "./types";

export interface HarvestEvidence {
  query: string;
  /** The search result's title, verbatim. */
  title: string;
  /** The page that stated these facts. */
  url: string;
  /** The statement of the conference's facts, verbatim. */
  stated: string;
  /** The society or publisher named as running it, when the result named one. */
  org: string | null;
}

export type ParseOutcome =
  | { ok: true; record: LaunchConferenceRecord }
  | { ok: false; reason: string };

/** First-level administrative divisions that sit between a city and its country in an address.
 *  Only the three countries whose events are routinely written "City, State, Country" are listed;
 *  an unrecognised segment is treated as a city, not silently dropped. */
const SUBDIVISIONS = new Set(
  [
    // United States
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
    "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
    "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
    "new york state", "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah",
    "vermont", "virginia", "washington state", "west virginia", "wisconsin", "wyoming",
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks",
    "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny",
    "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
    "wi", "wy",
    // Canada
    "alberta", "british columbia", "manitoba", "new brunswick", "newfoundland and labrador",
    "nova scotia", "ontario", "prince edward island", "quebec", "québec", "saskatchewan",
    // Australia
    "new south wales", "queensland", "south australia", "tasmania", "victoria",
    "western australia", "nsw", "qld", "vic", "wa state",
    // India, and the handful of other divisions that turn up written this way.
    "andhra pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana",
    "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra",
    "odisha", "punjab", "rajasthan", "tamil nadu", "telangana", "uttar pradesh", "uttarakhand",
    "west bengal", "bavaria", "catalonia", "lombardy", "gauteng", "ontario province",
    "dc", "d.c.", "district of columbia",
  ].map((value) => value.toLowerCase())
);

/** Words that mark a segment as a place an event is held rather than part of its name. */
const VENUE_TERMS =
  /\b(hotel|hilton|marriott|hyatt|sheraton|westin|radisson|intercontinental|waldorf|gaylord|resort|casino|convention|conference cent(?:er|re)|exhibition cent(?:er|re)|congress cent(?:er|re)|congr[eè]s|centre|center|university|universidad|universit[àé]|college|campus|institute|auditorium|hall|forum|palais|arena|stadium|expo cent(?:er|re)|world trade|fairground|pavilion|plaza|towers?)\b/i;

/** Ordinal edition prefix: "88th EAGE Annual Conference", "3rd World Congress on …". */
const EDITION_RE = /^(\d{1,3})(?:st|nd|rd|th)\b/i;

/** An acronym token, optionally carrying its year: "ICMMPME", "AGU26", "Robotics-2027". */
const ACRONYM_RE = /^([A-Z][A-Z0-9]{1,11}(?:[-/][A-Z0-9]{1,11})?)[-\s]?(?:20\d\d)?$/;

/** A trailing parenthetical acronym: "… and Nutrition 2027 (CAFN 2027)". */
const PAREN_ACRONYM_RE = /\(([A-Z][A-Z0-9]{1,11}(?:[-\s]?20\d\d)?)\)/;

const YEAR_RE = /\b(20\d\d)\b/;

function splitSegments(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isSubdivision(segment: string): boolean {
  return SUBDIVISIONS.has(segment.toLowerCase().replace(/\.$/, ""));
}

/** True when a segment between the conference's name and its city describes a place.
 *
 *  A venue keyword settles it. Otherwise a short capitalised phrase ("RAI Amsterdam") is taken as a
 *  venue, while anything containing a joining word or a conference noun is left in the title —
 *  because "Geophysics and Geochemistry" is the second half of a conference's name, not a building.
 */
function looksLikeVenue(segment: string, city: string | null): boolean {
  // A segment that opens with an edition ordinal, or closes with the word for a kind of event, is
  // the conference's own name: "4th Honolulu Education Conference" is not a building. Checked
  // before the venue vocabulary, because such a name can still mention a hall or a university.
  if (/^\d{1,3}(st|nd|rd|th)\b/i.test(segment)) return false;
  if (/\b(conference|congress|symposium|summit|meeting|workshop|expo|exhibition|convention|forum|school|session)$/i.test(segment)) {
    return false;
  }
  if (VENUE_TERMS.test(segment)) return true;
  // "Helsinki Congress Paasitorni, Helsinki, Finland": a segment that repeats the city right after
  // it is naming a building in that city, whatever words it uses.
  if (city && city.length > 3 && new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(segment)) return true;
  if (/\b(and|&|on|of|for|in)\b/i.test(segment)) return false;
  const words = segment.split(/\s+/);
  if (words.length > 5) return false;
  return /^[A-Z0-9]/.test(segment);
}

function detectFormat(text: string): LaunchFormat {
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(online[- ]only|fully virtual|virtual[- ]only|online event|virtual event)\b/i.test(text)) return "online";
  return "in-person";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether a URL's path is an index of events rather than a page about one.
 *
 * The host alone cannot tell: rogtecmagazine.com is a trade magazine, elsevier.com a publisher,
 * siggraph.org a society, and none is a directory — yet "/events-calendar/",
 * "/events/conferences/all" and "/siggraph-events/conferences/" are each a list. Gastech 2026
 * reached a reader's screen linked to the first of those and labelled the organiser's own page.
 */
export function isEventIndexPath(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  if (/^(?:all|calendar|list(?:ing)?s?|index|upcoming|archives?|past|directory)$/.test(last)) return true;
  if (/^(?:events?|meetings?|conferences?)[-_](?:calendars?|list(?:ing)?s?|index|directory)$/.test(last)) return true;
  return /\/(?:events?|meetings?|conferences?)\/(?:calendar|list|index)?\/?$/.test(path)
    || /\/calendar\/?$/.test(path);
}

export function classifySource(url: string): LaunchSourceType {
  const host = hostOf(url);
  if (!host) return "third_party";
  if (isDirectoryHost(host)) return "directory_listing";
  if (isReferenceHost(host)) return "reference";
  // A trustworthy host's list of everything it runs is still a list. Classified as official it
  // became the conference's own website, which is the one thing a listing must never become.
  if (isEventIndexPath(url)) return "third_party";
  return "official_site";
}

/** Reads the edition ordinal and acronym out of a conference name.
 *
 *  The name itself is returned unchanged. Stripping a leading acronym looked tidier and was worse:
 *  "PDAC 2027 International Convention" became "International Convention", "NCCN 2027 Annual
 *  Conference" became "Annual Conference", and both stopped naming the conference at all. The
 *  acronym is also exactly what a reader types into search, so it stays in the title and is
 *  recorded separately as well. */
export function splitTitleParts(rawTitle: string): {
  title: string;
  acronym: string | null;
  edition: string | null;
} {
  const title = rawTitle.replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—,\s]+$/g, "").trim();
  let acronym: string | null = null;

  const paren = title.match(PAREN_ACRONYM_RE);
  if (paren) {
    acronym = paren[1].replace(/[-\s]?20\d\d$/, "").trim();
  } else {
    const commaParts = title.split(",").map((part) => part.trim()).filter(Boolean);
    const leadingToken = commaParts[0] || "";
    if (commaParts.length > 1 && ACRONYM_RE.test(leadingToken)) {
      acronym = leadingToken.match(ACRONYM_RE)![1];
    } else {
      const leading = title.match(/^([A-Z][A-Z0-9]{1,11}(?:[-/][A-Z0-9]{1,11})?)(?:[-\s]20\d\d)?\s+(?=(?:the\s+)?(?:\d{1,3}(?:st|nd|rd|th)\s+)?(?:international|national|annual|world|european|asian|global|conference|congress|symposium|summit|meeting|workshop|convention|general))/i);
      if (leading && /[A-Z]{2,}/.test(leading[1])) acronym = leading[1];
    }
  }
  if (acronym) acronym = acronym.replace(/[-\s]?20\d\d$/, "").trim() || null;

  let edition: string | null = null;
  const editionMatch = title.replace(/^[A-Z][A-Z0-9]{1,11}[-\s]?(?:20\d\d)?[,\s]+/, "").match(EDITION_RE);
  if (editionMatch) edition = `${editionMatch[1]}${ordinalSuffix(Number(editionMatch[1]))}`;

  return { title, acronym, edition };
}

function ordinalSuffix(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (value % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/** The recurring identity of a conference: its name with the specific edition stripped out. */
export function seriesName(title: string, acronym: string | null): string | null {
  const stripped = title
    .replace(YEAR_RE, "")
    .replace(EDITION_RE, "")
    .replace(/\b(annual|edition)\b/gi, (match) => match)
    .replace(/\s{2,}/g, " ")
    .replace(/^[-–—\s]+|[-–—,\s]+$/g, "")
    .trim();
  return stripped || acronym || null;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

const TOPIC_STOP_WORDS = new Set([
  "the", "and", "of", "on", "for", "in", "at", "to", "a", "an", "with", "its", "international",
  "national", "annual", "world", "global", "conference", "conferences", "congress", "symposium",
  "summit", "meeting", "workshop", "expo", "exhibition", "convention", "forum", "edition",
  "th", "st", "nd", "rd",
]);

/** Subject words the title itself used. Nothing is inferred — a topic must appear in the text. */
export function topicsFromTitle(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s&-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !TOPIC_STOP_WORDS.has(word) && !/^\d+$/.test(word));
  return [...new Set(words)].slice(0, 12);
}

/**
 * The date window every record has to satisfy, whoever supplied it.
 *
 * Exported so an API source runs exactly these checks rather than a second set that drifts: a year
 * outside the dataset, a date nobody stated to better than a year, and a conference that has
 * already finished are refused identically whether the dates came from a sentence or from JSON.
 *
 * Returns the refusal reason, or null when the dates are acceptable.
 */
export function refuseByDateWindow(
  dates: { startDate: string | null; endDate: string | null; startYear: number | null; startMonth: number | null; precision: string | null },
  options: ParseOptions
): string | null {
  if (!dates.startYear) return "no_date";
  if (!options.years.includes(dates.startYear)) return `year_out_of_range:${dates.startYear}`;
  if (dates.precision !== "day" && dates.precision !== "month") return "date_precision_too_coarse";

  const lastDay = dates.endDate || dates.startDate;
  if (lastDay && lastDay < options.horizonStart) return "already_finished";
  if (!lastDay && dates.startYear && dates.startMonth) {
    const monthEnd = `${dates.startYear}-${String(dates.startMonth).padStart(2, "0")}-28`;
    if (monthEnd < options.horizonStart) return "already_finished";
  }
  return null;
}

export interface ParseOptions {
  retrievedAt: string;
  /** Records ending before this day are refused: a launch catalogue of finished events is worse
   *  than a smaller one. */
  horizonStart: string;
  /** Years the dataset covers. */
  years: number[];
}

export function parseHarvestEvidence(evidence: HarvestEvidence, options: ParseOptions): ParseOutcome {
  const stated = (evidence.stated || "").replace(/\s+/g, " ").trim();
  if (!stated) return { ok: false, reason: "empty_statement" };
  if (!/^https?:\/\//i.test(evidence.url)) return { ok: false, reason: "no_source_url" };
  const host = hostOf(evidence.url);
  if (!host) return { ok: false, reason: "unparseable_source_url" };

  const dates = parseDateRange(stated);
  // A finished conference is not launch inventory, and a date nobody stated to better than a year
  // is not a date. Both refusals live in refuseByDateWindow so an API source applies the same ones.
  const dateRefusal = refuseByDateWindow(dates, options);
  if (dateRefusal) return { ok: false, reason: dateRefusal };

  const segments = splitSegments(stated);
  if (segments.length === 0) return { ok: false, reason: "empty_statement" };

  // Work backwards from the country: everything after it is the date, everything before it is the
  // venue and the name. Scanning from the end takes the location's country rather than one that
  // happens to appear in the conference's name ("Asia Pacific", "Gartner … Brazil").
  let countryIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (normalizeCountry(segments[index])) { countryIndex = index; break; }
  }

  let country: string | null = null;
  let countryCode: string | null = null;
  let worldRegion: string | null = null;
  let city: string | null = null;
  let region: string | null = null;
  let venue: string | null = null;
  // The other names for the same country. A reader searching "USA" or "UK" is naming the country
  // this record already resolved, so those spellings belong in the record's keywords rather than
  // being a miss.
  let countryAliases: string[] = [];
  let titleEnd = segments.length;

  if (countryIndex >= 0) {
    const match = normalizeCountry(segments[countryIndex])!;
    country = match.name;
    countryCode = match.iso2;
    worldRegion = match.region;
    countryAliases = [match.iso2, match.iso3, ...match.aliases];

    let cursor = countryIndex - 1;
    if (cursor >= 0 && isSubdivision(segments[cursor])) {
      region = segments[cursor];
      cursor -= 1;
    }
    // Segment 0 is always the conference's name, never its city: "ICLR 2027 International
    // Conference on Learning Representations, California, United States" states a state and a
    // country and no city at all, and filling the city with the title would be worse than leaving
    // it empty.
    const venueParts: string[] = [];
    if (cursor >= 1) {
      // The segment before the country is usually the city, but sometimes the organiser named only
      // the building ("European University Cyprus, Cyprus"). Where that is all there is, it is
      // recorded as the venue and the city stays unknown.
      if (looksLikeVenue(segments[cursor], null) && VENUE_TERMS.test(segments[cursor])) {
        venueParts.unshift(segments[cursor]);
        cursor -= 1;
        if (cursor >= 1) {
          city = segments[cursor];
          cursor -= 1;
        }
      } else {
        city = segments[cursor];
        cursor -= 1;
      }
    }
    while (cursor >= 1 && looksLikeVenue(segments[cursor], city)) {
      venueParts.unshift(segments[cursor]);
      cursor -= 1;
    }
    if (venueParts.length) venue = venueParts.join(", ");
    titleEnd = cursor + 1;
  } else {
    // No country named. Fall back to whatever the sentence says elsewhere rather than inventing
    // one, and keep the whole prefix as the name.
    const inText = findCountryInText(stated);
    if (inText) {
      country = inText.name;
      countryCode = inText.iso2;
      worldRegion = inText.region;
      countryAliases = [inText.iso2, inText.iso3, ...inText.aliases];
    }
    const dateIndex = segments.findIndex((segment) => YEAR_RE.test(segment) && parseDateRange(segment).startYear);
    titleEnd = dateIndex > 0 ? dateIndex : Math.min(1, segments.length);
  }

  if (titleEnd <= 0) titleEnd = 1;
  const rawTitle = segments.slice(0, titleEnd).join(", ");
  if (!rawTitle || rawTitle.length < 4) return { ok: false, reason: "no_title" };

  const { title, acronym, edition } = splitTitleParts(rawTitle);
  if (!title || title.length < 4) return { ok: false, reason: "no_title" };

  const format = detectFormat(stated);
  if (!city && !country && format !== "online") return { ok: false, reason: "no_location" };

  const categoryResults = classifyCategories({
    title,
    description: stated,
    topics: topicsFromTitle(title),
    organizer: evidence.org,
  });
  const category = primaryCategory(categoryResults);

  const topics = [...new Set([...categoryResults.flatMap((result) => result.evidence), ...topicsFromTitle(title)])].slice(0, 16);
  const keywords = [...new Set(
    [acronym, evidence.org, city, region, country, ...countryAliases, worldRegion, String(dates.startYear), category]
      .filter((value): value is string => Boolean(value && value.trim()))
  )];

  const sourceType = classifySource(evidence.url);
  const provenanceEntry = (confidence: LaunchFieldProvenance["confidence"]): LaunchFieldProvenance => ({
    sourceUrl: evidence.url,
    sourcePageTitle: evidence.title || null,
    confidence,
  });
  // An official site speaking about its own event is the strongest evidence available here; a
  // directory repeating it is the weakest that still gets published.
  const baseConfidence: LaunchFieldProvenance["confidence"] =
    sourceType === "official_site" ? "High" : sourceType === "directory_listing" ? "Low" : "Medium";

  const provenance: Record<string, LaunchFieldProvenance> = {
    title: provenanceEntry(baseConfidence),
    dates: provenanceEntry(dates.precision === "day" ? baseConfidence : "Low"),
  };
  if (city) provenance.city = provenanceEntry(baseConfidence);
  if (country) provenance.country = provenanceEntry(baseConfidence);
  if (venue) provenance.venue = provenanceEntry(baseConfidence);
  if (evidence.org) provenance.organization = provenanceEntry(baseConfidence);

  const series = seriesName(title, acronym);
  const id = slugify([acronym || series || title, dates.startYear, city || country || format].filter(Boolean).join("-"));
  if (!id) return { ok: false, reason: "no_identity" };

  return {
    ok: true,
    record: {
      id,
      title,
      acronym,
      series,
      edition,
      year: dates.startYear,
      startDate: dates.startDate,
      endDate: dates.endDate,
      datePrecision: dates.precision === "day" ? "day" : "month",
      startMonth: dates.startMonth,
      datesText: dates.rawText === stated ? null : dates.rawText,
      city,
      region,
      country,
      countryCode,
      worldRegion,
      venue,
      format,
      organization: evidence.org,
      category,
      categories: categoryResults.map((result) => result.category),
      topics,
      keywords,
      description: stated,
      sourceUrl: evidence.url,
      sourceHost: host,
      sourceType,
      // A listing is never promoted to official, however authoritative it sounds.
      officialUrl: sourceType === "official_site" ? evidence.url : null,
      evidence: {
        query: evidence.query,
        resultTitle: evidence.title,
        statedText: stated,
        retrievedAt: options.retrievedAt,
        method: "web_search",
      },
      provenance,
      corroboratingSourceUrls: [],
      origin: "launch_dataset",
    },
  };
}
