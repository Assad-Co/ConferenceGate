// Conferences whose own website was found after the fact.
//
// A batch of records arrives citing a directory and nothing else: iconf.com knows that ICCS 2026
// exists and says nothing about where it lives. The conference's own site is a fact about it, and
// once somebody has established it there is no reason for the catalogue to keep sending readers to
// a listing — a resolved site is where a reader should go, what supplies the logo, and the page a
// crawler can actually read for a programme.
//
// It is applied as a correction to a record that has no official URL, never as an overwrite: a
// record that already names its own site knows better than this file does. And the URL is screened
// exactly like any other, because a row asserting that something is a conference's website is the
// claim being checked, not evidence for it.

import { parseCsv, statedOrNull, usableAsOfficialUrl } from "./curated";
import { isIndexHeader } from "./conferenceIndex";
import { isDirectoryHost, isReferenceHost } from "../../directoryHosts";
import type { LaunchConferenceRecord } from "../types";

export interface ResolvedUrl {
  title: string;
  officialUrl: string;
  resolvedOn: string;
  method: string;
  /** Dates the organiser's own page states, where they contradict the row the record came from. */
  startDate: string | null;
  endDate: string | null;
}

export function isResolvedUrlHeader(header: string[]): boolean {
  const seen = new Set(header.map((cell) => cell.replace(/^﻿/, "").trim().toLowerCase()));
  // A resolution file may carry the dates the official page states, so `start_date` no longer tells
  // the two shapes apart: an intake batch is what an index header describes, and this is the rest.
  return ["conference_name", "official_url"].every((column) => seen.has(column)) && !isIndexHeader(header);
}

export function rowsFromResolvedCsv(rows: string[][]): ResolvedUrl[] {
  const [header, ...rest] = rows;
  if (!header || !isResolvedUrlHeader(header)) return [];
  const at = new Map(header.map((cell, index) => [cell.replace(/^﻿/, "").trim().toLowerCase(), index]));
  const cell = (cells: string[], column: string) => (cells[at.get(column) ?? -1] ?? "").trim();
  return rest
    .map((cells) => ({
      title: cell(cells, "conference_name"),
      officialUrl: cell(cells, "official_url"),
      resolvedOn: cell(cells, "resolved_on"),
      method: cell(cells, "method") || "web_search",
      startDate: statedOrNull(cell(cells, "start_date")),
      endDate: statedOrNull(cell(cells, "end_date")),
    }))
    .filter((row) => row.title && row.officialUrl);
}

/** The same normalisation the detail join uses, so one spelling of a title reaches one record. */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface ResolutionOutcome {
  applied: number;
  /** Rows that reached no conference, reported rather than dropped. */
  unmatched: string[];
  /** Rows refused because the URL is a listing, a directory or an index. */
  refused: Array<{ title: string; url: string; reason: string }>;
  /** Rows skipped because the record already knew its own site. */
  alreadyKnown: number;
  /** Dates the organiser's own page contradicted, reported so a silent rewrite is impossible. */
  redated: Array<{ title: string; was: string; now: string }>;
}

/** A date the organiser stated, or nothing — a half-read cell must never reach a record. */
function statedDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function applyResolvedUrls(
  records: LaunchConferenceRecord[],
  resolutions: ResolvedUrl[]
): ResolutionOutcome {
  const byTitle = new Map<string, LaunchConferenceRecord[]>();
  for (const record of records) {
    const key = titleKey(record.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), record]);
  }

  const outcome: ResolutionOutcome = { applied: 0, unmatched: [], refused: [], alreadyKnown: 0, redated: [] };
  for (const row of resolutions) {
    const matches = byTitle.get(titleKey(row.title));
    if (!matches?.length) { outcome.unmatched.push(row.title); continue; }

    const url = statedOrNull(row.officialUrl);
    if (!url || !usableAsOfficialUrl(url)) {
      outcome.refused.push({ title: row.title, url: row.officialUrl, reason: "not a conference's own page" });
      continue;
    }
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      outcome.refused.push({ title: row.title, url: row.officialUrl, reason: "unparseable" });
      continue;
    }
    if (isDirectoryHost(host) || isReferenceHost(host)) {
      outcome.refused.push({ title: row.title, url: row.officialUrl, reason: `${host} is a directory` });
      continue;
    }

    for (const record of matches) {
      if (record.officialUrl) { outcome.alreadyKnown += 1; continue; }
      // The link a reader follows becomes the conference's own site. Where the facts were read does
      // not change, and `provenance` already points there — so the record still says that a
      // directory supplied its dates while sending a reader to the organiser.
      record.officialUrl = url;
      record.sourceUrl = url;
      record.sourceHost = host;
      record.sourceType = "official_site";
      outcome.applied += 1;

      // Where the organiser's own page states dates the intake row got wrong, the organiser wins:
      // a listing repeating a date nobody checked is exactly the claim this file exists to correct.
      // Only a full ISO date counts, and only a different one — this can sharpen a record, never
      // blur it.
      const start = statedDate(row.startDate);
      if (start && start !== record.startDate) {
        outcome.redated.push({ title: row.title, was: record.startDate ?? "(none)", now: start });
        record.startDate = start;
        record.endDate = statedDate(row.endDate) ?? start;
        record.year = Number(start.slice(0, 4));
        record.startMonth = Number(start.slice(5, 7));
        record.datePrecision = "day";
        record.datesText = null;
      }
    }
  }
  return outcome;
}
