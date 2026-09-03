// Turning what a page said into what the database stores.
//
// Every function here is total and honest: given text it does not recognise, it returns null or
// the taxonomy's explicit "unknown"/"other" member. None of them fall back to a plausible value.
// The specific trap this guards against is format: a site that never says how it is held has not
// said "in person", so the answer is `unknown` (section 11).

import { findCountryInText, normalizeCountry, type CountryRecord } from "./countries";
import { parseDateRange, parseSingleDate } from "./dates";
import { DEADLINE_LABELS } from "./htmlExtract";
import {
  EMPTY_DEADLINES,
  type DeadlineSet,
  type EventFormat,
  type EventType,
  type RawEventExtraction,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------------------------

export function normalizeFormat(...values: Array<string | null | undefined>): EventFormat {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return "unknown";
  // schema.org states this as a URL or a bare class name, and structured-data extraction may pass
  // either through verbatim. Checked before the prose patterns because "OnlineEventAttendanceMode"
  // has no word boundary after "online" and would otherwise fall through as unknown.
  if (/mixedeventattendancemode/.test(text)) return "hybrid";
  if (/onlineeventattendancemode/.test(text)) return "online";
  if (/offlineeventattendancemode/.test(text)) return "in_person";
  const hybrid = /\bhybrid|blended|both\s+(?:in[\s-]?person\s+and\s+online|online\s+and\s+in[\s-]?person)\b/.test(text);
  if (hybrid) return "hybrid";
  const online = /\b(?:online|virtual|remote|fully\s+digital|web[\s-]?based|livestream(?:ed)?)\b/.test(text);
  const inPerson = /\b(?:in[\s_-]?person|on[\s_-]?site|onsite|face[\s_-]?to[\s_-]?face|physical|at\s+the\s+venue)\b/.test(text);
  if (online && inPerson) return "hybrid";
  if (online) return "online";
  if (inPerson) return "in_person";
  return "unknown";
}

// ---------------------------------------------------------------------------------------------
// Event type
// ---------------------------------------------------------------------------------------------

/** Ordered: the first match wins, so "International Congress and Exhibition" is a congress. */
const EVENT_TYPE_PATTERNS: Array<{ type: EventType; re: RegExp }> = [
  { type: "congress", re: /\bcongress(?:es)?\b|\bkongress\b|\bcongresso\b|\bcongreso\b/i },
  { type: "symposium", re: /\bsymposi(?:um|a)\b|\bsymposion\b/i },
  { type: "summit", re: /\bsummits?\b/i },
  { type: "convention", re: /\bconventions?\b/i },
  { type: "conference", re: /\bconferences?\b|\bkonferenz\b|\bconferencia\b|\bconferência\b|\bcolloqui(?:um|a)\b/i },
  { type: "exhibition", re: /\bexhibitions?\b|\btrade\s+shows?\b|\bfairs?\b/i },
  { type: "expo", re: /\bexpo\b/i },
  { type: "workshop", re: /\bworkshops?\b|\bhackathons?\b|\btutorials?\b/i },
  { type: "seminar", re: /\bseminars?\b|\bcolloquy\b|\bmasterclass(?:es)?\b/i },
  { type: "forum", re: /\bfor(?:um|a)\b|\bpanel\s+discussions?\b/i },
  { type: "webinar", re: /\bwebinars?\b|\bvirtual\s+briefings?\b/i },
  {
    type: "continuing_professional_development",
    re: /\bcontinuing\s+(?:professional\s+development|medical\s+education)\b|\bcpd\b|\bcme\b|\bcertification\s+course\b/i,
  },
  { type: "professional_meeting", re: /\b(?:annual|general|scientific|technical|business)\s+meetings?\b|\bassembly\b|\bmeetings?\b/i },
];

export function normalizeEventType(...values: Array<string | null | undefined>): {
  eventType: EventType;
  originalEventType: string | null;
} {
  const original = values.find((value) => !!value && value.trim()) ?? null;
  const text = values.filter(Boolean).join(" ");
  if (!text.trim()) return { eventType: "other", originalEventType: original };
  for (const { type, re } of EVENT_TYPE_PATTERNS) {
    if (re.test(text)) return { eventType: type, originalEventType: original };
  }
  return { eventType: "other", originalEventType: original };
}

// ---------------------------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------------------------

export interface NormalizedLocation {
  venue: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  /** Untouched, exactly as the page wrote it. */
  rawLocation: string | null;
  countryInference: { method: "explicit_city_country_map"; city: string; confidence: number } | null;
}

/** Deliberately conservative: only globally unambiguous city names. Ambiguous names such as
 * Paris, Cambridge, Melbourne and Victoria are excluded. */
const UNAMBIGUOUS_CITY_COUNTRY: Record<string, string> = {
  tokyo: "Japan", osaka: "Japan", kyoto: "Japan", singapore: "Singapore",
  dubai: "United Arab Emirates", "abu dhabi": "United Arab Emirates", doha: "Qatar",
  riyadh: "Saudi Arabia", berlin: "Germany", munich: "Germany", vienna: "Austria",
  zurich: "Switzerland", geneva: "Switzerland", amsterdam: "Netherlands",
  copenhagen: "Denmark", stockholm: "Sweden", helsinki: "Finland", lisbon: "Portugal",
  barcelona: "Spain", madrid: "Spain", rome: "Italy", athens: "Greece",
  seoul: "South Korea", beijing: "China", shanghai: "China", bangkok: "Thailand",
  jakarta: "Indonesia", nairobi: "Kenya", cairo: "Egypt", "cape town": "South Africa",
  sydney: "Australia", auckland: "New Zealand", toronto: "Canada", vancouver: "Canada",
  "new york": "United States", chicago: "United States", boston: "United States",
};

/** US state abbreviations, which are the one region form common enough to be worth resolving. */
const US_STATES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado",
  ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho",
  il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana",
  me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada",
  nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina",
  nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania",
  ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas",
  ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia",
  wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia",
};

const ONLINE_PLACE_RE = /^\s*(?:online|virtual|remote|web|internet|zoom|ms\s*teams|webex|tbd|tba)\s*$/i;

export function normalizeLocation(raw: RawEventExtraction): NormalizedLocation {
  const rawLocation =
    raw.locationText || [raw.venue, raw.city, raw.region, raw.country].filter(Boolean).join(", ") || null;

  let country: CountryRecord | null = normalizeCountry(raw.country);
  let city = clean(raw.city);
  let region = clean(raw.region);
  let venue = clean(raw.venue);
  let countryInference: NormalizedLocation["countryInference"] = null;

  // A structured city/country pair is authoritative; only fall back to reading the free text.
  if (!country) country = findCountryInText(raw.country) || findCountryInText(rawLocation);

  if (!city && rawLocation) {
    const parts = rawLocation
      .split(/[,،|]/)
      .map((part) => part.trim())
      .filter((part) => part && !ONLINE_PLACE_RE.test(part));
    // "Barbican Centre, London, United Kingdom" → the part before the country is the city.
    const countryIndex = parts.findIndex((part) => !!normalizeCountry(part));
    if (countryIndex > 0) {
      const candidate = parts[countryIndex - 1];
      // Skip a US-state-shaped part and take the one before it, so "Austin, TX, USA" gives Austin.
      const stateName = US_STATES[candidate.toLowerCase()];
      if (stateName && countryIndex > 1) {
        region = region || stateName;
        city = clean(parts[countryIndex - 2]);
      } else {
        city = clean(candidate);
      }
    } else if (parts.length === 1 && !venue) {
      city = clean(parts[0]);
    } else if (parts.length > 1 && !city) {
      city = clean(parts[parts.length - 1]);
    }
  }

  if (!venue && rawLocation && city) {
    const head = rawLocation.split(/[,،|]/)[0]?.trim();
    if (head && head.toLowerCase() !== city.toLowerCase() && /\b(?:centre|center|hall|hotel|university|campus|institute|arena|palace|conference|convention)\b/i.test(head)) {
      venue = clean(head);
    }
  }

  // The page must explicitly state the city. This never uses the domain, organiser address or
  // search snippet, and only resolves names that have one reliable country interpretation.
  if (!country && city) {
    const mapped = UNAMBIGUOUS_CITY_COUNTRY[city.toLowerCase().replace(/\s+/g, " ").trim()];
    if (mapped) {
      country = normalizeCountry(mapped);
      if (country) countryInference = { method: "explicit_city_country_map", city, confidence: 0.82 };
    }
  }

  // A "city" that is really the word Online is not a city.
  if (city && ONLINE_PLACE_RE.test(city)) city = null;
  if (venue && ONLINE_PLACE_RE.test(venue)) venue = null;

  return {
    venue,
    city,
    region: region || null,
    country: country?.name ?? null,
    countryCode: country?.iso2 ?? null,
    rawLocation,
    countryInference,
  };
}

function clean(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length >= 2 ? trimmed.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------------------------
// Dates and deadlines
// ---------------------------------------------------------------------------------------------

/** Labels that mean "this is when the event happens", not "this is a deadline". */
const EVENT_DATE_LABEL_RE =
  /\b(?:conference|event|congress|symposium|summit|workshop|meeting|exhibition)?\s*dates?\b|\bwhen\b|\bevent\s+period\b|\bopening\b|\bstart(?:s|ing)?\b|\bclosing\s+(?:day|ceremony)\b/i;

/** Labels that are never the event's own dates, whatever else they look like. */
const NON_EVENT_DATE_LABEL_RE =
  /\b(?:deadline|submission|abstract|paper|registration|notification|camera[\s-]?ready|early[\s-]?bird|published|posted|updated|last\s+modified|copyright)\b/i;

export function normalizeDates(raw: RawEventExtraction): ReturnType<typeof parseDateRange> {
  // A structured start/end pair is the strongest statement a site can make.
  if (raw.startDateText) {
    const combined = raw.endDateText ? `${raw.startDateText} to ${raw.endDateText}` : raw.startDateText;
    const parsed = parseDateRange(combined);
    if (parsed.startYear) return parsed;
  }
  if (raw.datesText) {
    const parsed = parseDateRange(raw.datesText);
    if (parsed.startYear) return parsed;
  }
  // Failing both, an "Important dates" row whose label names the event itself — never one whose
  // label names a deadline.
  for (const entry of raw.importantDates) {
    if (NON_EVENT_DATE_LABEL_RE.test(entry.label)) continue;
    if (!EVENT_DATE_LABEL_RE.test(entry.label)) continue;
    const parsed = parseDateRange(entry.text);
    if (parsed.startYear) return parsed;
  }
  return parseDateRange(raw.datesText || null);
}

const DEADLINE_FIELD_BY_KEY = {
  abstract: "abstractDeadline",
  paper: "paperSubmissionDeadline",
  earlyBird: "earlyBirdDeadline",
  registration: "registrationDeadline",
  notification: "notificationDate",
  cameraReady: "cameraReadyDeadline",
} as const;

/**
 * Sorts an "Important dates" block into its separate deadline fields.
 *
 * Each label is tested against every vocabulary and the FIRST matching one wins, in the order
 * declared in htmlExtract.ts — abstract before paper, so "abstract submission deadline" is an
 * abstract deadline rather than being swallowed by the more generic "submission deadline"
 * pattern. A row that matches nothing is left out entirely rather than dropped into a catch-all.
 */
export function normalizeDeadlines(raw: RawEventExtraction, eventStart: string | null): DeadlineSet {
  const deadlines: DeadlineSet = { ...EMPTY_DEADLINES };

  for (const entry of raw.importantDates) {
    const match = DEADLINE_LABELS.find(({ re }) => re.test(entry.label));
    if (!match) continue;
    const field = DEADLINE_FIELD_BY_KEY[match.key];
    if (deadlines[field]) continue; // first statement wins; later rows do not overwrite it
    const parsed = parseSingleDate(entry.text);
    if (!parsed) continue;
    // A "deadline" that is the same day as the conference itself is nearly always the event date
    // reprinted under a heading, or a page-publication date that drifted in. Left out (section 48).
    if (eventStart && parsed === eventStart) continue;
    deadlines[field] = parsed;
  }

  return deadlines;
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

const BOILERPLATE_RE =
  /\b(?:accept(?:ing)?\s+(?:all\s+)?cookies?|this\s+(?:site|website)\s+uses\s+cookies|privacy\s+policy|terms\s+(?:of\s+use|and\s+conditions)|all\s+rights\s+reserved|skip\s+to\s+(?:main\s+)?content|enable\s+javascript|subscribe\s+to\s+our\s+newsletter|follow\s+us\s+on)\b[^.]*\.?/gi;

/** Strips cookie banners and navigation leftovers without rewriting anything factual. */
export function cleanDescription(value: string | null | undefined, limit = 2000): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(BOILERPLATE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 40) return null;
  if (cleaned.length <= limit) return cleaned;
  // Cut at a sentence boundary so the stored text is never a half-sentence.
  const truncated = cleaned.slice(0, limit);
  const lastStop = truncated.lastIndexOf(". ");
  return (lastStop > limit * 0.5 ? truncated.slice(0, lastStop + 1) : truncated).trim();
}

/** The conference's acronym, when its own title states one — "(IMOG)" or a leading "IMOG 2027:". */
export function extractAcronym(title: string | null): string | null {
  if (!title) return null;
  // "(IMOG)" and "(IMOG 2027)" both name the same acronym; the year is not part of it.
  const parenthesised = /\(([A-Z][A-Za-z0-9&.\-]{1,11})(?:\s+20\d{2})?\)/.exec(title);
  if (parenthesised && /[A-Z]{2,}/.test(parenthesised[1])) return parenthesised[1].replace(/\./g, "");
  const leading = /^([A-Z][A-Z0-9&-]{1,9})[\s:–-]/.exec(title.trim());
  if (leading && /[A-Z]{2,}/.test(leading[1])) return leading[1];
  return null;
}

/** The edition an event states about itself: "12th", "2027", "XV". Never derived from a count. */
export function extractEdition(title: string | null, description: string | null): string | null {
  const text = `${title || ""} ${description || ""}`;
  // Up to three words may sit between the ordinal and the event noun — "9th Gulf Conference",
  // "33rd International Meeting on Organic Geochemistry".
  const ordinal =
    /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:[A-Za-z][A-Za-z-]*\s+){0,3}(?:conference|congress|symposium|summit|workshop|meeting|convention|forum|edition)\b/i.exec(
      text
    );
  if (ordinal) return `${ordinal[1]}`;
  const roman = /\b([IVXLC]{2,7})\s+(?:international\s+)?(?:conference|congress|symposium)\b/.exec(text);
  if (roman) return roman[1];
  return null;
}

/** Title with the year, edition and boilerplate removed, for matching editions of one series. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b\d{1,3}(?:st|nd|rd|th)\b/g, " ")
    .replace(/\b(?:the|a|an|of|on|for|and|in|at|to|its|annual|international|world|global|edition|official|website|home|page)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL identity for deduplication: scheme, www, tracking parameters and index pages removed. */
export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let path = parsed.pathname.replace(/\/index\.(?:html?|php|aspx?)$/i, "/").replace(/\/+$/, "");
  if (!path) path = "";
  const keptParams = [...parsed.searchParams.entries()]
    .filter(([key]) => !/^(?:utm_|fbclid|gclid|mc_|ref|source|campaign)/i.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = keptParams.length > 0 ? `?${keptParams.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${host}${path}${query}`.toLowerCase();
}
