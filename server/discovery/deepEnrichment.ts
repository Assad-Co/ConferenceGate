// Reading a conference's deeper sections from the pages that actually carry them.
//
// `deepSections.ts` turns one page of HTML into programme, speakers, committee, sponsors and
// community. This module decides which pages to ask for, under what budget, and how what comes
// back is stored — which is the part that has to stay careful.
//
// Three properties, in the order they matter:
//
//   * These fields never make a conference less publishable. They are not readiness inputs, they
//     are not audited, and a speakers page that 404s leaves the record exactly as it was. That is
//     deliberate: a deep section is a nice-to-have on top of a conference that already earned its
//     place, and wiring it into the publication gate would let a broken subpage sink a good event.
//   * A section carries the URL of the page that stated it, on the section and on every item in
//     it. "Where did this speaker come from" has an answer without joining anything.
//   * Nothing is overwritten with less than it had. An empty read never blanks a populated
//     section, so a site that reorganises its navigation cannot silently erase what we already
//     read from it.
//
// The subpages are read through the caller's own reader, which is what keeps robots.txt, the
// per-domain rate limit, the Jina budget and the SSRF guard applying here exactly as they do
// everywhere else. This module opens no sockets of its own.

import crypto from "crypto";
import { dbRun } from "../db";
import {
  DEEP_SECTIONS, deepSectionPopulated, emptyDeepExtraction, extractDeepSections, findSectionPages,
  mergeDeepExtractions, sameDomainLinks, type DeepSection, type DeepSectionExtraction,
  type SectionPageCandidate,
} from "./deepSections";
import { candidateUrlBelongsToEvent, pageBelongsToEvent, type EventIdentity } from "./eventIdentity";
import { canonicalizeUrl } from "./normalize";

/** How the five sections map onto storage: a column, and the provenance field name beside it. */
export const DEEP_SECTION_STORAGE: Record<DeepSection, { column: string; field: string }> = {
  program: { column: "program_agenda", field: "programAgenda" },
  speakers: { column: "keynote_speakers", field: "keynoteSpeakers" },
  committee: { column: "technical_committee", field: "technicalCommittee" },
  sponsors: { column: "sponsors_exhibitors", field: "sponsorsExhibitors" },
  community: { column: "community", field: "community" },
};

export interface DeepPageRead {
  html: string;
  /** Where the read actually landed, after redirects. */
  url: string;
}

/** A read that did not happen, and why. "robots said no" and "the page 404s" are different
 *  answers with different responses, and collapsing them into one loses the diagnosis. */
export interface DeepPageUnread {
  unreadable: "robots_disallowed" | "fetch_failed";
}

export type DeepPageReadResult = DeepPageRead | DeepPageUnread | null;

export interface CollectDeepSectionsOptions {
  /** The verified official page: its HTML is already in hand, and its links are the map. */
  officialUrl: string;
  officialHtml: string;
  /** Reads one URL through the caller's robots-, budget- and guard-aware reader. */
  read: (url: string) => Promise<DeepPageReadResult>;
  /** Subpages to read beyond the official page itself. */
  maxPages?: number;
  /** Only chase pages for sections still empty, so a re-run costs almost nothing. */
  sections?: readonly DeepSection[];
  /** Lets the caller's time budget stop this mid-conference. */
  outOfTime?: () => boolean;
  /**
   * Who this conference is, so a page belonging to a different event cannot contribute to it.
   * Omitted only where there is no record to identify — every production path supplies it.
   */
  identity?: EventIdentity | null;
}

/** What happened to one candidate subpage, so "nothing was read" can always be explained. */
export type DeepCandidateOutcome =
  | "read" | "robots_disallowed" | "fetch_failed" | "already_seen" | "page_budget" | "out_of_time"
  | "different_event_url" | "different_event_page";

export interface DeepCandidateTrace {
  url: string;
  section: DeepSection;
  evidence: string;
  outcome: DeepCandidateOutcome;
  /** For a rejection, exactly which rule rejected it. */
  detail?: string;
}

export interface DeepSectionsCollected {
  extraction: DeepSectionExtraction;
  pagesRead: string[];
  pagesAttempted: number;
  populated: DeepSection[];
  /** Every same-domain page the official page links to, for telling "linked nowhere useful" from
   *  "linked nowhere at all" — a JavaScript-rendered shell reports zero. */
  sameDomainLinks: number;
  candidates: DeepCandidateTrace[];
}

/**
 * Reads the official page plus the subpages it links for the sections still wanted.
 *
 * Same-domain only, HTML only, capped, and in evidence order: a link whose path says `/speakers`
 * outranks one that merely says so in its nav label.
 */
export async function collectDeepSections(options: CollectDeepSectionsOptions): Promise<DeepSectionsCollected> {
  const wanted = options.sections?.length ? [...options.sections] : [...DEEP_SECTIONS];
  const maxPages = Math.max(0, options.maxPages ?? 4);
  const parts: DeepSectionExtraction[] = [];
  const pagesRead: string[] = [];
  let pagesAttempted = 0;

  // The landing page first: a small conference often states everything on it, and reading it costs
  // nothing because enrichment has already fetched it.
  parts.push(extractDeepSections(options.officialHtml, options.officialUrl));
  pagesRead.push(options.officialUrl);

  const seen = new Set([canonicalizeUrl(options.officialUrl) || options.officialUrl]);
  const candidates = findSectionPages(options.officialHtml, options.officialUrl, {
    perSection: 2, sections: wanted,
  });

  const traced: DeepCandidateTrace[] = [];
  const note = (candidate: SectionPageCandidate, outcome: DeepCandidateOutcome, detail?: string) =>
    traced.push({ url: candidate.url, section: candidate.section, evidence: candidate.evidence, outcome, detail });
  const identity = options.identity ?? null;

  for (const candidate of candidates) {
    if (pagesRead.length > maxPages) { note(candidate, "page_budget"); continue; }
    if (options.outOfTime?.()) { note(candidate, "out_of_time"); continue; }
    const key = canonicalizeUrl(candidate.url) || candidate.url;
    if (seen.has(key)) { note(candidate, "already_seen"); continue; }
    seen.add(key);

    // Cheapest check first: a URL that cannot belong to this event costs no fetch to reject.
    if (identity) {
      const verdict = candidateUrlBelongsToEvent(identity, candidate.url);
      if (!verdict.ok) { note(candidate, "different_event_url", verdict.reason); continue; }
    }

    pagesAttempted += 1;
    const read = await options.read(candidate.url);
    if (!read || "unreadable" in read || !read.html) {
      note(candidate, read && "unreadable" in read ? read.unreadable : "fetch_failed");
      continue;
    }
    const landedUrl = read.url || candidate.url;

    // What the page actually says about which event it belongs to. A URL can look right and the
    // page still be another edition's — which is exactly how a 2026 workshop's programme reached
    // a 2027 conference — so the page gets its own say before a word of it is kept.
    if (identity) {
      const verdict = pageBelongsToEvent(identity, landedUrl, read.html);
      if (!verdict.ok) { note(candidate, "different_event_page", verdict.reason); continue; }
    }

    note(candidate, "read");
    parts.push(extractDeepSections(read.html, landedUrl));
    pagesRead.push(landedUrl);
  }

  const extraction = mergeDeepExtractions(parts);
  return {
    extraction, pagesRead, pagesAttempted, candidates: traced,
    sameDomainLinks: sameDomainLinks(options.officialHtml, options.officialUrl).length,
    populated: DEEP_SECTIONS.filter((section) => deepSectionPopulated(extraction, section)),
  };
}

/** The JSON one section is stored as — the exact shape `extracted_conferences` already holds. */
export function serializeDeepSection(section: DeepSection, extraction: DeepSectionExtraction): string | null {
  switch (section) {
    case "program":
      return extraction.program ? JSON.stringify(extraction.program) : null;
    case "speakers":
      return extraction.speakers.length ? JSON.stringify(extraction.speakers) : null;
    case "committee":
      return extraction.committee.length ? JSON.stringify(extraction.committee) : null;
    case "sponsors":
      return extraction.sponsors.length ? JSON.stringify(extraction.sponsors) : null;
    case "community":
      return extraction.community ? JSON.stringify(extraction.community) : null;
  }
}

/** Which page stated a section, for the provenance row that goes beside it. */
export function deepSectionSourceUrl(
  section: DeepSection, extraction: DeepSectionExtraction, fallback: string
): string {
  switch (section) {
    case "program": return extraction.program?.source_url || fallback;
    case "speakers": return extraction.speakers[0]?.source_url || fallback;
    case "committee": return extraction.committee[0]?.source_url || fallback;
    case "sponsors": return extraction.sponsors[0]?.source_url || fallback;
    case "community": return extraction.community?.source_url || fallback;
  }
}

/** A stored section counts as empty when it holds no items — `[]`, `{}` and null all qualify. */
export function storedSectionIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  let parsed: any = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return true; }
  }
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (parsed && typeof parsed === "object") {
    return Object.values(parsed).every((nested) => {
      if (nested === null || nested === undefined || nested === "") return true;
      if (Array.isArray(nested)) return nested.length === 0;
      return false;
    });
  }
  return true;
}

/** Sections an event still has nothing stored for. */
export function deepSectionsMissing(event: Record<string, any>): DeepSection[] {
  return DEEP_SECTIONS.filter((section) => storedSectionIsEmpty(event[DEEP_SECTION_STORAGE[section].column]));
}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export interface StoredDeepSections {
  filled: DeepSection[];
  /** section → the page that stated it, for the verification table a sample run prints. */
  provenance: Partial<Record<DeepSection, string>>;
}

/**
 * Writes the sections an event did not already have.
 *
 * Existing content wins: a populated section is left alone rather than replaced, so a re-read that
 * happens to land on a thinner page cannot cost us what a richer one already gave.
 */
export async function storeDeepSections(input: {
  eventId: string;
  event: Record<string, any>;
  extraction: DeepSectionExtraction;
  officialUrl: string;
  runId?: string | null;
}): Promise<StoredDeepSections> {
  const filled: DeepSection[] = [];
  const provenance: Partial<Record<DeepSection, string>> = {};

  for (const section of DEEP_SECTIONS) {
    const { column, field } = DEEP_SECTION_STORAGE[section];
    const payload = serializeDeepSection(section, input.extraction);
    if (!payload) continue;
    if (!storedSectionIsEmpty(input.event[column])) continue;
    const sourceUrl = deepSectionSourceUrl(section, input.extraction, input.officialUrl);
    let sourceDomain = "";
    try { sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }

    await dbRun(`UPDATE discovery_events SET ${column}=?, deep_sections_verified_at=datetime('now') WHERE id=?`,
      [payload, input.eventId]);
    // Provenance lives here and inside the payload itself. The subpage is deliberately NOT written
    // into discovery_event_sources: that table decides which page speaks for the conference, and a
    // sponsors page is evidence about sponsors, not a second claim to authority.
    await dbRun(`INSERT INTO discovery_event_fields (id,event_id,field,value,source_url,source_domain,extraction_method,confidence,last_verified)
      VALUES (?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(event_id,field) DO UPDATE SET value=excluded.value,
      source_url=excluded.source_url,source_domain=excluded.source_domain,extraction_method=excluded.extraction_method,
      confidence=excluded.confidence,last_verified=datetime('now')`,
      [id("dfld"), input.eventId, field, payload, sourceUrl, sourceDomain, "html", 0.8]);
    await dbRun(`INSERT INTO discovery_event_changes (id,event_id,change_type,field,old_value,new_value,source_url)
      VALUES (?,?,?,?,?,?,?)`,
      [id("dchg"), input.eventId, "deep_section_enrichment", field, null, payload.slice(0, 4000), sourceUrl]);

    input.event[column] = payload;
    filled.push(section);
    provenance[section] = sourceUrl;
  }
  return { filled, provenance };
}

export function emptyDeepResult(): DeepSectionsCollected {
  return {
    extraction: emptyDeepExtraction(), pagesRead: [], pagesAttempted: 0, populated: [],
    sameDomainLinks: 0, candidates: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Read-only coverage report
//
// The verification table: which conferences hold which deep sections, and which page of the
// organiser's site stated each one. Reads stored rows, fetches nothing, writes nothing.
// ---------------------------------------------------------------------------------------------

export interface DeepCoverageRecord {
  eventId: string;
  title: string;
  officialUrl: string | null;
  sections: Array<{ section: DeepSection; items: number; sourceUrl: string | null; sample: string | null }>;
}

export interface DeepCoverageReport {
  acceptedRecords: number;
  totals: Record<DeepSection, number>;
  records: DeepCoverageRecord[];
}

function countItems(section: DeepSection, raw: unknown): { items: number; sample: string | null } {
  let parsed: any = raw;
  if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { return { items: 0, sample: null }; } }
  if (Array.isArray(parsed)) {
    return { items: parsed.length, sample: parsed[0]?.name ? String(parsed[0].name) : null };
  }
  if (section === "program" && parsed?.sessions) {
    return {
      items: parsed.sessions.length + (parsed.important_dates?.length || 0),
      sample: parsed.sessions[0]?.title || parsed.important_dates?.[0]?.label || null,
    };
  }
  if (section === "community" && parsed) {
    const social = parsed.social_media?.length || 0;
    return { items: social + (parsed.hashtag ? 1 : 0) + (parsed.contact_email ? 1 : 0), sample: parsed.social_media?.[0]?.platform || parsed.hashtag || null };
  }
  return { items: 0, sample: null };
}

export async function buildDeepCoverageReport(
  options: { limit?: number; section?: DeepSection } = {}
): Promise<DeepCoverageReport> {
  const { dbAll, dbGet } = await import("../db");
  const limit = Math.max(1, Math.min(options.limit ?? 20, 500));
  const accepted = Number((await dbGet<{ count: number }>(
    `SELECT COUNT(*) count FROM discovery_events WHERE status IN ('validated','published','needs_review')`
  ))?.count || 0);

  const totalsRow = await dbGet<Record<string, number>>(`SELECT
      SUM(program_agenda IS NOT NULL AND program_agenda NOT IN ('','[]','{}')) program,
      SUM(keynote_speakers IS NOT NULL AND keynote_speakers NOT IN ('','[]','{}')) speakers,
      SUM(technical_committee IS NOT NULL AND technical_committee NOT IN ('','[]','{}')) committee,
      SUM(sponsors_exhibitors IS NOT NULL AND sponsors_exhibitors NOT IN ('','[]','{}')) sponsors,
      SUM(community IS NOT NULL AND community NOT IN ('','[]','{}')) community
    FROM discovery_events WHERE status IN ('validated','published','needs_review')`);

  const wanted = options.section ? [options.section] : [...DEEP_SECTIONS];
  const populatedClause = wanted
    .map((section) => `(${DEEP_SECTION_STORAGE[section].column} IS NOT NULL AND ${DEEP_SECTION_STORAGE[section].column} NOT IN ('','[]','{}'))`)
    .join(" OR ");

  const rows = await dbAll<Record<string, any>>(
    `SELECT id, title, official_url, program_agenda, keynote_speakers, technical_committee,
            sponsors_exhibitors, community
       FROM discovery_events
      WHERE status IN ('validated','published','needs_review') AND (${populatedClause})
      ORDER BY deep_sections_verified_at DESC LIMIT ?`,
    [limit]
  );

  const fieldRows = rows.length
    ? await dbAll<{ event_id: string; field: string; source_url: string }>(
      `SELECT event_id, field, source_url FROM discovery_event_fields
        WHERE event_id IN (${rows.map(() => "?").join(",")})
          AND field IN ('programAgenda','keynoteSpeakers','technicalCommittee','sponsorsExhibitors','community')`,
      rows.map((row) => row.id)
    )
    : [];
  const sourceByKey = new Map(fieldRows.map((row) => [`${row.event_id}:${row.field}`, row.source_url]));

  return {
    acceptedRecords: accepted,
    totals: {
      program: Number(totalsRow?.program || 0), speakers: Number(totalsRow?.speakers || 0),
      committee: Number(totalsRow?.committee || 0), sponsors: Number(totalsRow?.sponsors || 0),
      community: Number(totalsRow?.community || 0),
    },
    records: rows.map((row) => ({
      eventId: String(row.id),
      title: String(row.title),
      officialUrl: row.official_url ? String(row.official_url) : null,
      sections: wanted
        .map((section) => {
          const { column, field } = DEEP_SECTION_STORAGE[section];
          const { items, sample } = countItems(section, row[column]);
          return { section, items, sample, sourceUrl: sourceByKey.get(`${row.id}:${field}`) || null };
        })
        .filter((entry) => entry.items > 0),
    })),
  };
}

export function formatDeepCoverageReport(report: DeepCoverageReport): string {
  const lines = [
    `Deep section coverage across ${report.acceptedRecords} accepted conferences`,
    ...DEEP_SECTIONS.map((section) => `  ${section.padEnd(10)} ${report.totals[section]}`),
    "",
  ];
  if (report.records.length === 0) {
    lines.push("No accepted conference holds a deep section yet.");
    return lines.join("\n");
  }
  for (const record of report.records) {
    lines.push(record.title.slice(0, 90));
    for (const entry of record.sections) {
      lines.push(
        `  ${entry.section.padEnd(10)} ${String(entry.items).padStart(4)} item(s)` +
        `${entry.sample ? `  e.g. ${entry.sample.slice(0, 48)}` : ""}` +
        `\n    source: ${entry.sourceUrl || "(not recorded)"}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
