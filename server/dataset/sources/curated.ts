// Conferences supplied as a curated list rather than found by a crawler.
//
// Somebody who knows a field can hand over a better list than any search will assemble — a society
// programme officer's own calendar of what is scheduled, with the venue and the partner
// organisations already right. This reads such a list from CSV and puts it through the same date
// window, deduplication and ranking as everything else, so the catalogue keeps one set of rules.
//
// The discipline is the same too, and it matters more here because a curated file LOOKS
// authoritative in every cell. "Not yet announced" is not a speaker list, "TBD" is not a location,
// and a link to a society's events calendar is not a conference's own website. Each of those
// arrives as a plausible-looking string and each has to become null.

import type { LaunchConferenceRecord, LaunchSourceType } from "../types";
import type { ParseOutcome, ParseOptions } from "../parseEvidence";
import { refuseByDateWindow, seriesName, slugify, splitTitleParts, topicsFromTitle } from "../parseEvidence";
import { classifyCategories, primaryCategory } from "../../discovery/categories";
import { normalizeCountry, regionForCountry } from "../../discovery/countries";
import { isDirectoryHost, isReferenceHost } from "../../directoryHosts";

/**
 * A cell that states the absence of information rather than information.
 *
 * Every row of a curated list is filled in, because a human filled it in — including the cells
 * where the answer is "nobody knows yet". Storing "Not yet announced" as a speaker's name is
 * exactly the failure this catalogue exists to avoid, and it is far easier to make from a tidy
 * spreadsheet than from a scraped page.
 */
const NOT_STATED = /^(?:n\/?a|tbd|tba|none|not\s+(?:yet\s+)?(?:announced|available|published|confirmed)|to\s+be\s+(?:announced|confirmed|determined))\b/i;

export function statedOrNull(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text || NOT_STATED.test(text)) return null;
  return text;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export interface CuratedDates {
  startDate: string | null;
  endDate: string | null;
  startYear: number | null;
  startMonth: number | null;
  precision: "day" | "month" | null;
}

/**
 * Reads the date forms a curated calendar actually uses.
 *
 *   "2-3 September 2026"     both days known
 *   "28-30 September 2026"   both days known, spanning nothing awkward
 *   "May 2027"               the month only — a day is NOT invented for it
 *
 * A month-only entry keeps `precision: "month"` and a null `startDate`, so nothing downstream can
 * quietly present the first of the month as the day the conference begins.
 */
export function parseCuratedDates(raw: string): CuratedDates {
  const text = String(raw || "").trim();
  const empty: CuratedDates = { startDate: null, endDate: null, startYear: null, startMonth: null, precision: null };
  if (!text) return empty;

  const monthYear = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    if (!month) return empty;
    return { startDate: null, endDate: null, startYear: Number(monthYear[2]), startMonth: month, precision: "month" };
  }

  // "2-3 September 2026" and "12-16 September 2026", including en dashes.
  const dayRange = text.match(/^(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dayRange) {
    const month = MONTHS[dayRange[3].toLowerCase()];
    if (!month) return empty;
    const year = Number(dayRange[4]);
    const pad = (value: number) => String(value).padStart(2, "0");
    return {
      startDate: `${year}-${pad(month)}-${pad(Number(dayRange[1]))}`,
      endDate: `${year}-${pad(month)}-${pad(Number(dayRange[2]))}`,
      startYear: year, startMonth: month, precision: "day",
    };
  }

  const singleDay = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (singleDay) {
    const month = MONTHS[singleDay[2].toLowerCase()];
    if (!month) return empty;
    const year = Number(singleDay[3]);
    const day = `${year}-${String(month).padStart(2, "0")}-${String(Number(singleDay[1])).padStart(2, "0")}`;
    return { startDate: day, endDate: day, startYear: year, startMonth: month, precision: "day" };
  }
  return empty;
}

/**
 * Splits "Mexico City (Barceló México Reforma)" and "Stillwater, Oklahoma State University".
 *
 * The parenthesised or comma-trailing part is the venue. It is kept as the venue and never as the
 * city, because "Barceló México Reforma" is a hotel and filing it as a city puts a hotel in the
 * location filter.
 */
export function splitCuratedLocation(raw: string): { city: string | null; venue: string | null } {
  const text = statedOrNull(raw);
  if (!text) return { city: null, venue: null };
  const parenthesised = text.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (parenthesised) return { city: parenthesised[1].trim(), venue: parenthesised[2].trim() };
  const comma = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (comma.length >= 2) return { city: comma[0], venue: comma.slice(1).join(", ") };
  return { city: text, venue: null };
}

export interface CuratedRow {
  name: string;
  eventType: string;
  dates: string;
  location: string;
  country: string;
  region: string;
  partners: string;
  website: string;
  keynoteSpeakers: string;
  committee: string;
}

/** RFC4180-ish: quoted fields, doubled quotes inside them, commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

export function rowsFromCsv(text: string): CuratedRow[] {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  return rest.map((cells) => ({
    name: cells[0] ?? "", eventType: cells[1] ?? "", dates: cells[2] ?? "", location: cells[3] ?? "",
    country: cells[4] ?? "", region: cells[5] ?? "", partners: cells[6] ?? "", website: cells[7] ?? "",
    keynoteSpeakers: cells[8] ?? "", committee: cells[9] ?? "",
  }));
}

/**
 * Whether this URL can stand as the conference's own website.
 *
 * Three rows of the AAPG list point at `aapg.org/events/calendar/` — the society's calendar of all
 * its events, not any one of them. It is a perfectly good place to have found the conference and a
 * false claim about where the conference lives, so it stays the source and never becomes the
 * official URL. The same applies to a directory or an encyclopaedia.
 */
export function usableAsOfficialUrl(url: string | null): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    return false;
  }
  if (isDirectoryHost(host) || isReferenceHost(host)) return false;
  // An index of events on any host, however trustworthy the host.
  return !/\/(?:events?|meetings?|conferences?)\/(?:calendar|list|index)?\/?$/.test(path)
    && !/\/calendar\/?$/.test(path);
}

export interface CuratedOptions extends ParseOptions {
  /** Where the list came from, for provenance. */
  sourceName: string;
  sourceUrl: string;
}

export function mapCuratedRow(row: CuratedRow, options: CuratedOptions): ParseOutcome {
  const title = String(row.name || "").replace(/\s+/g, " ").trim();
  if (!title || title.length < 4) return { ok: false, reason: "no_title" };

  const dates = parseCuratedDates(row.dates);
  const refusal = refuseByDateWindow(dates, options);
  if (refusal) return { ok: false, reason: refusal };

  const website = statedOrNull(row.website);
  const officialUrl = usableAsOfficialUrl(website) ? website : null;
  // The row is still worth keeping when its link is a calendar: the conference is real, the dates
  // and place are stated, and the link remains where a reader can go looking.
  const sourceUrl = website || options.sourceUrl;
  let sourceHost: string;
  try {
    sourceHost = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { ok: false, reason: "unparseable_source_url" };
  }

  const { city, venue } = splitCuratedLocation(row.location);
  const countryRecord = normalizeCountry(statedOrNull(row.country));
  if (!city && !countryRecord) return { ok: false, reason: "no_location" };

  const { title: cleanTitle, acronym, edition } = splitTitleParts(title);
  const organization = statedOrNull(row.partners);
  const categoryResults = classifyCategories({
    title: cleanTitle,
    description: [row.eventType, row.partners].filter(Boolean).join(" "),
    topics: topicsFromTitle(cleanTitle),
    organizer: organization,
  });
  const category = primaryCategory(categoryResults);
  const topics = [...new Set([
    ...categoryResults.flatMap((result) => result.evidence), ...topicsFromTitle(cleanTitle),
  ])].slice(0, 16);
  const year = dates.startYear!;

  const sourceType: LaunchSourceType = officialUrl ? "official_site" : "reference";
  const record: LaunchConferenceRecord = {
    id: slugify([seriesName(cleanTitle, acronym) || cleanTitle, year, city].filter(Boolean).join(" ")),
    title: cleanTitle,
    acronym,
    series: seriesName(cleanTitle, acronym),
    edition,
    year,
    startDate: dates.startDate,
    endDate: dates.endDate,
    datePrecision: dates.precision,
    datesText: String(row.dates || "").trim() || null,
    city,
    region: null,
    country: countryRecord?.name ?? null,
    countryCode: countryRecord?.iso2 ?? null,
    // Derived from the validated country by table lookup, never taken from the sheet's own
    // "Region" column — that column says "Latin America" and "Asia Pacific", which are the
    // society's own groupings rather than this catalogue's world regions.
    worldRegion: regionForCountry(countryRecord?.name ?? null),
    venue,
    format: "in-person",
    organization,
    category,
    categories: [...new Set(categoryResults.map((result) => result.category))],
    topics,
    keywords: [
      city, countryRecord?.name, countryRecord?.iso2,
      regionForCountry(countryRecord?.name ?? null), String(year), category,
    ].filter((value): value is string => Boolean(value)),
    // Exactly what the list stated, and nothing more. The event type is a real fact about the
    // conference; "Not yet announced" is not a fact about its speakers.
    description: [title, row.eventType.trim(), row.location.trim(), row.dates.trim()]
      .filter(Boolean).join(", "),
    sourceUrl,
    sourceHost,
    sourceType,
    officialUrl,
    corroboratingSourceUrls: [],
    evidence: {
      query: `curated:${options.sourceName}`,
      resultTitle: title,
      statedText: [row.name, row.dates, row.location, row.country].filter(Boolean).join(", "),
      retrievedAt: new Date().toISOString().slice(0, 10),
      method: "web_search",
      externalId: null,
    },
    origin: "launch_dataset",
    provenance: {
      title: { sourceUrl, sourcePageTitle: options.sourceName, confidence: "High" },
      dates: { sourceUrl, sourcePageTitle: options.sourceName, confidence: dates.precision === "day" ? "High" : "Medium" },
      city: { sourceUrl, sourcePageTitle: options.sourceName, confidence: city ? "High" : "Low" },
      country: { sourceUrl, sourcePageTitle: options.sourceName, confidence: countryRecord ? "High" : "Low" },
      venue: { sourceUrl, sourcePageTitle: options.sourceName, confidence: venue ? "High" : "Low" },
      organization: { sourceUrl, sourcePageTitle: options.sourceName, confidence: organization ? "High" : "Low" },
    },
  };
  return { ok: true, record };
}
