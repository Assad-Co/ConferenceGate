// A curated batch that carries a conference and its deep sections in one row.
//
// The AAPG lists arrived as two files — conferences in one, their programme and people in another,
// joined by title. This shape puts both in a single row, which is easier to compile and means the
// join cannot go wrong. Everything else is the same discipline: a cell that states an absence is an
// absence, a listing is never promoted to the conference's own website, and a section that
// structures into nothing keeps its sentence so the tab still says what the source said.
//
// What makes this batch different is where it came from. Most of its rows cite an aggregator rather
// than the organiser, and forty-six cite a *filtered search* on one — a URL that returns whatever
// matches a tag today and describes no conference in particular. Those are recorded as the listing
// they are, and `usableAsOfficialUrl` refuses every one of them.

import type {
  LaunchConferenceDetails, LaunchConferenceRecord, LaunchFormat, LaunchSourceType,
} from "../types";
import type { ParseOptions, ParseOutcome } from "../parseEvidence";
import { refuseByDateWindow, seriesName, slugify, splitTitleParts, topicsFromTitle } from "../parseEvidence";
import { classifyCategories, primaryCategory } from "../../discovery/categories";
import { normalizeCountry, regionForCountry } from "../../discovery/countries";
import { isDirectoryHost, isReferenceHost } from "../../directoryHosts";
import { parseCsv, statedOrNull, usableAsOfficialUrl } from "./curated";
import {
  mapCuratedDetailRow, parseCallForPapers, parseProgramSchedule, type CuratedDetailRow,
} from "./curatedDetails";

export interface IndexRow {
  name: string;
  acronym: string;
  category: string;
  subCategory: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  format: string;
  overview: string;
  callForPapers: string;
  cfpDeadline: string;
  fees: string;
  program: string;
  keynoteSpeakers: string;
  committee: string;
  sponsors: string;
  venue: string;
  accommodation: string;
  organizer: string;
  website: string;
  recordStatus: string;
  qualityNotes: string;

  // A later revision of this batch went back and resolved the conference's own site, keeping the
  // listing it was found on in a column of its own. Every one is optional: the first revision had
  // none of them and must keep reading.
  /** The listing the conference was found on, once `website_or_source` became the official site. */
  sourceUrl: string;
  /** The conference's own site, as resolved. Still screened here — a column name is not evidence. */
  officialUrl: string;
  /** The compiler's judgement of what `officialUrl` is: a conference's own domain, an organiser's
   *  page for it, or nothing resolved. Recorded as their finding, cross-checked against ours. */
  domainType: string;
  logoUrl: string;
  logoSourceType: string;
  cfpUrl: string;
  registrationUrl: string;
  programUrl: string;
  committeeUrl: string;
}

const COLUMNS = [
  "conference_name", "acronym", "category", "sub_category", "start_date", "end_date", "city",
  "country", "format", "overview", "call_for_papers", "cfp_deadline", "fees_and_pricing",
  "program_agenda", "keynote_speakers", "technical_committee", "sponsors", "venue",
  "accommodation", "organizer", "website_or_source", "record_status", "data_quality_notes",
  "source_url", "official_url", "domain_type", "logo_url", "logo_source_type", "cfp_url",
  "registration_url", "program_url", "committee_url",
] as const;

/** Whether a header is this shape, so a file in the wrong directory fails loudly rather than
 *  becoming two hundred conferences with no country. */
export function isIndexHeader(header: string[]): boolean {
  const seen = new Set(header.map((cell) => cell.replace(/^﻿/, "").trim().toLowerCase()));
  return ["conference_name", "start_date", "website_or_source", "record_status"].every((column) => seen.has(column));
}

export function rowsFromIndexCsv(rows: string[][]): IndexRow[] {
  const [header, ...rest] = rows;
  if (!header || !isIndexHeader(header)) return [];
  // Read by column name, not position: a batch that adds a column must not silently shift every
  // field one to the left.
  const at = new Map(header.map((cell, index) => [cell.replace(/^﻿/, "").trim().toLowerCase(), index]));
  const cell = (cells: string[], column: string) => (cells[at.get(column) ?? -1] ?? "").trim();
  return rest.map((cells) => {
    const value = (column: (typeof COLUMNS)[number]) => cell(cells, column);
    return {
      name: value("conference_name"), acronym: value("acronym"), category: value("category"),
      subCategory: value("sub_category"), startDate: value("start_date"), endDate: value("end_date"),
      city: value("city"), country: value("country"), format: value("format"),
      overview: value("overview"), callForPapers: value("call_for_papers"),
      cfpDeadline: value("cfp_deadline"), fees: value("fees_and_pricing"),
      program: value("program_agenda"), keynoteSpeakers: value("keynote_speakers"),
      committee: value("technical_committee"), sponsors: value("sponsors"), venue: value("venue"),
      accommodation: value("accommodation"), organizer: value("organizer"),
      website: value("website_or_source"), recordStatus: value("record_status"),
      qualityNotes: value("data_quality_notes"),
      sourceUrl: value("source_url"), officialUrl: value("official_url"),
      domainType: value("domain_type"), logoUrl: value("logo_url"),
      logoSourceType: value("logo_source_type"), cfpUrl: value("cfp_url"),
      registrationUrl: value("registration_url"), programUrl: value("program_url"),
      committeeUrl: value("committee_url"),
    };
  });
}

/**
 * Hosts that hand back an icon for a domain rather than an image the organiser published.
 *
 * Asking one of these for a conference's logo works, and the second revision of this batch uses
 * Google's for all ninety-four of its resolved domains. Two reasons not to keep it. It is not the
 * organiser's statement — the file says as much in `logo_source_type`, which calls every one a
 * fallback — and it puts a request to a third party on the page for every card a reader scrolls
 * past. The same domain yields the same icon from the organiser's own server, which is what this
 * catalogue derives, so nothing is lost by refusing these.
 */
const ICON_SERVICE_HOST = /(?:^|\.)(?:google\.com|gstatic\.com|duckduckgo\.com|clearbit\.com|logo\.dev|icons?\.duckduckgo\.com|besticon[^/]*)$/i;

/** A logo only where the source supplied an image of its own, never a service's rendering of one. */
export function suppliedLogoUrl(logoUrl: string, logoSourceType: string): string | null {
  const value = statedOrNull(logoUrl);
  if (!value || !/^https:\/\//i.test(value)) return null;
  if (/fallback/i.test(logoSourceType)) return null;
  try {
    if (ICON_SERVICE_HOST.test(new URL(value).hostname)) return null;
  } catch {
    return null;
  }
  return value;
}

/** ISO, or a year/month the source stopped short at. Nothing else is guessed into a date. */
function readIsoDate(raw: string): { date: string | null; year: number | null; month: number | null } {
  const value = statedOrNull(raw) ?? "";
  const full = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return { date: value, year: Number(full[1]), month: Number(full[2]) };
  const month = value.match(/^(\d{4})-(\d{2})$/);
  if (month) return { date: null, year: Number(month[1]), month: Number(month[2]) };
  const year = value.match(/^(\d{4})$/);
  if (year) return { date: null, year: Number(year[1]), month: null };
  return { date: null, year: null, month: null };
}

function formatFor(raw: string): LaunchFormat {
  const value = raw.toLowerCase();
  if (value.includes("hybrid")) return "hybrid";
  if (value.includes("online") || value.includes("virtual")) return "online";
  return "in-person";
}

/**
 * How strong the cited page is as evidence.
 *
 * Decided by the host and the URL, not by the row's own `record_status`. Twenty-two rows call
 * themselves OFFICIAL VERIFIED and a hundred and thirteen cite an aggregator, and those two claims
 * cannot both be about the same page — so the one that can be checked wins. The status column is
 * still kept, on the record's evidence, as what the compiler believed.
 */
function sourceTypeFor(host: string, officialUrl: string | null): LaunchSourceType {
  if (isDirectoryHost(host)) return "directory_listing";
  if (isReferenceHost(host)) return "reference";
  return officialUrl ? "official_site" : "third_party";
}

export interface IndexMapOptions extends ParseOptions {
  sourceName: string;
}

export type IndexOutcome =
  | { ok: true; record: LaunchConferenceRecord; details: LaunchConferenceDetails }
  | { ok: false; reason: string };

export function mapIndexRow(row: IndexRow, options: IndexMapOptions): IndexOutcome {
  const title = String(row.name || "").replace(/\s+/g, " ").trim();
  if (!title || title.length < 4) return { ok: false, reason: "no_title" };

  const start = readIsoDate(row.startDate);
  const end = readIsoDate(row.endDate);
  // Twenty of these rows name a real conference whose dates nobody has announced. A catalogue is
  // ordered and filtered by date, so a record with none cannot take its place in one — it is
  // refused and reported, rather than parked at an invented date.
  if (!start.year) return { ok: false, reason: "no_start_date" };
  const refusal = refuseByDateWindow(
    {
      startDate: start.date, endDate: end.date, startYear: start.year, startMonth: start.month,
      precision: start.date ? "day" : start.month ? "month" : null,
    },
    options
  );
  if (refusal) return { ok: false, reason: refusal };

  // Where this conference lives, from a file that may state it in one column or three.
  //
  // The first revision of this batch put a directory link in `website_or_source` and stopped. The
  // second went back and resolved the organiser's own site, leaving the directory behind in
  // `source_url`. So the best page is whichever of the two is stated, and the listing is kept as
  // where the facts were actually read — dropping it would leave the record claiming a page that
  // never carried these dates.
  const resolved = statedOrNull(row.officialUrl);
  const website = resolved || statedOrNull(row.website) || statedOrNull(row.sourceUrl);
  if (!website || !/^https?:\/\//i.test(website)) return { ok: false, reason: "no_source_url" };
  let host: string;
  try {
    host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { ok: false, reason: "unparseable_source_url" };
  }
  // The compiler's `domain_type` is their finding, not a permit. A column asserting that a URL is
  // the conference's own is exactly the claim this file screens rather than believes, so the URL
  // still has to pass on its own shape — which is what refuses the thirty-six rows whose "official"
  // page is an entry in a publisher's event index.
  const officialUrl = usableAsOfficialUrl(website) ? website : null;
  // The page the facts were read off, which is the listing wherever one is named.
  const statedOn = statedOrNull(row.sourceUrl) || website;

  const city = statedOrNull(row.city);
  const countryRecord = normalizeCountry(statedOrNull(row.country));
  if (!city && !countryRecord) return { ok: false, reason: "no_location" };

  const { title: cleanTitle, acronym, edition } = splitTitleParts(title);
  const statedAcronym = statedOrNull(row.acronym);
  const organization = statedOrNull(row.organizer);
  const description = statedOrNull(row.overview);
  const statedCategories = [statedOrNull(row.category), statedOrNull(row.subCategory)].filter(Boolean) as string[];

  const categoryResults = classifyCategories({
    title: cleanTitle,
    description: [description, ...statedCategories].filter(Boolean).join(" "),
    topics: topicsFromTitle(cleanTitle),
    organizer: organization,
  });
  const topics = [...new Set([
    ...statedCategories, ...categoryResults.flatMap((result) => result.evidence), ...topicsFromTitle(cleanTitle),
  ])].slice(0, 16);

  // The deep sections go through exactly the parsers the AAPG lists use, on the columns that mean
  // the same thing. Anything that structures into nothing keeps its sentence.
  const detailRow: CuratedDetailRow = {
    name: title, dates: row.startDate, venue: row.venue, program: row.program,
    keynoteSpeakers: row.keynoteSpeakers, committee: row.committee, pricing: row.fees,
    sponsors: row.sponsors, website, safetyNote: "",
  };
  const parsed = mapCuratedDetailRow(detailRow, city, start.year, countryRecord?.name ?? null);

  // This shape states the call for papers in two columns of its own, which beats reading it out of
  // the programme paragraph — but the programme is still read, so a deadline stated only there is
  // not lost.
  const statedCfp = statedOrNull(row.callForPapers);
  const statedDeadline = readIsoDate(row.cfpDeadline).date;
  const fromProgram = parseCallForPapers(row.program);
  const callForPapers = statedCfp || statedDeadline || fromProgram
    ? {
        status: statedCfp ? (/closed/i.test(statedCfp) ? "Closed" : /published|open/i.test(statedCfp) ? "Open" : null) : fromProgram?.status ?? null,
        abstractDeadline: statedDeadline ?? fromProgram?.abstractDeadline ?? null,
        submissionEmail: fromProgram?.submissionEmail ?? null,
        lengthLimit: fromProgram?.lengthLimit ?? null,
        text: statedCfp ?? fromProgram?.text ?? null,
        url: statedOrNull(row.cfpUrl),
      }
    : null;

  const record: LaunchConferenceRecord = {
    id: slugify([seriesName(cleanTitle, statedAcronym || acronym) || cleanTitle, start.year, city].filter(Boolean).join(" ")),
    title: cleanTitle,
    acronym: statedAcronym || acronym,
    series: seriesName(cleanTitle, statedAcronym || acronym),
    edition,
    year: start.year,
    startDate: start.date,
    endDate: end.date,
    datePrecision: start.date ? "day" : start.month ? "month" : null,
    startMonth: start.month,
    // This shape states dates as two ISO fields, not as a phrase, so there is no "dates text" to
    // keep. Leaving it null lets the page compose the range; setting it to the bare start date made
    // every one of these conferences display a single day when the source had given an end date.
    datesText: null,
    city,
    region: null,
    country: countryRecord?.name ?? null,
    countryCode: countryRecord?.iso2 ?? null,
    worldRegion: regionForCountry(countryRecord?.name ?? null),
    venue: parsed.venueName,
    format: formatFor(row.format),
    organization,
    category: primaryCategory(categoryResults) ?? statedCategories[0] ?? null,
    categories: [...new Set([...categoryResults.map((result) => result.category), ...statedCategories])],
    topics,
    keywords: topics.slice(0, 8),
    description,
    sourceUrl: website,
    sourceHost: host,
    sourceType: sourceTypeFor(host, officialUrl),
    officialUrl,
    logoUrl: suppliedLogoUrl(row.logoUrl, row.logoSourceType),
    evidence: {
      query: options.sourceName,
      resultTitle: title,
      // The compiler's own note about this row, kept verbatim: it is the only account of how firmly
      // each field was established, and it says out loud which ones were not.
      statedText: [description, statedOrNull(row.qualityNotes)].filter(Boolean).join(" — "),
      retrievedAt: options.retrievedAt,
      method: "web_search",
      externalId: statedOrNull(row.recordStatus),
    },
    provenance: {
      title: { sourceUrl: statedOn, sourcePageTitle: null, confidence: /official/i.test(row.recordStatus) ? "High" : "Medium" },
      dates: { sourceUrl: statedOn, sourcePageTitle: null, confidence: start.date ? "High" : "Low" },
      city: { sourceUrl: statedOn, sourcePageTitle: null, confidence: city ? "Medium" : "Low" },
      country: { sourceUrl: statedOn, sourcePageTitle: null, confidence: countryRecord ? "Medium" : "Low" },
    },
    // Not the listing: the builder owns this field and blanks it on intake, because what belongs
    // here is what deduplication finds — another page that independently stated the same
    // conference. Where these facts were read is `provenance`, which is set above and survives.
    corroboratingSourceUrls: [],
    origin: "launch_dataset",
    supply: "curated_list",
    details: {
      source: options.sourceName,
      venueName: parsed.venueName,
      venueAddress: parsed.venueAddress ?? statedOrNull(row.accommodation),
      program: parsed.program,
      callForPapers,
      schedule: parseProgramSchedule(row.program, start.year),
      keynotes: parsed.keynotes,
      committee: parsed.committee,
      fees: parsed.fees,
      sponsors: parsed.sponsors,
      safetyNote: null,
      registrationUrl: statedOrNull(row.registrationUrl),
    },
  };

  return { ok: true, record, details: record.details! };
}

/** Reads one file, reporting each refusal with the conference it refused. */
export function readIndexCsv(
  text: string,
  options: IndexMapOptions
): { records: LaunchConferenceRecord[]; refused: Array<{ title: string; reason: string }> } {
  const records: LaunchConferenceRecord[] = [];
  const refused: Array<{ title: string; reason: string }> = [];
  for (const row of rowsFromIndexCsv(parseCsv(text))) {
    const outcome = mapIndexRow(row, options);
    if (outcome.ok === true) {
      records.push(outcome.record);
      continue;
    }
    refused.push({ title: row.name || "(untitled)", reason: outcome.reason });
  }
  return { records, refused };
}

export type { ParseOutcome };
