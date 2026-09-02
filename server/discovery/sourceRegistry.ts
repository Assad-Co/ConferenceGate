// The domain/source registry.
//
// The engine is deliberately not written against any particular directory. It is written against
// this table: rows in, candidate URLs out. A university, a medical society, a publisher and a
// conference index are the same shape here and differ only in `source_type` and `trust_score`,
// which is what lets an organiser's own word outrank a listing site's (section 20).
//
// Scheduling lives here too. A domain is due when `next_crawl_at` has passed; a domain that keeps
// failing backs off rather than being retried on every run.

import crypto from "crypto";
import { dbAll, dbGet, dbRun } from "../db";
import type { SourceType } from "./types";

export interface DomainRow {
  domain: string;
  source_name: string;
  source_type: SourceType;
  country: string | null;
  region: string | null;
  enabled: number;
  trust_score: number;
  crawl_frequency_hours: number;
  last_checked: string | null;
  last_successful_crawl: string | null;
  next_crawl_at: string | null;
  robots_allowed: number | null;
  robots_checked_at: string | null;
  robots_crawl_delay_ms: number | null;
  sitemap_urls: string;
  failure_count: number;
  last_failure_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface DomainInput {
  domain: string;
  sourceName: string;
  sourceType: SourceType;
  country?: string | null;
  region?: string | null;
  enabled?: boolean;
  trustScore?: number;
  crawlFrequencyHours?: number;
  notes?: string | null;
}

/** Default trust by source type. An official conference site and the society that runs it are
 *  first-hand; a directory is a report of what someone else said. */
export const TRUST_BY_SOURCE_TYPE: Record<SourceType, number> = {
  official_conference_site: 0.95,
  professional_society: 0.9,
  scientific_organization: 0.9,
  medical_society: 0.9,
  engineering_society: 0.9,
  university: 0.88,
  research_institute: 0.85,
  government: 0.85,
  professional_association: 0.82,
  publisher: 0.8,
  conference_organizer: 0.75,
  convention_organization: 0.7,
  conference_directory: 0.5,
  unknown: 0.4,
};

export function normalizeDomain(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.includes("//")) {
    try {
      host = new URL(host).hostname;
    } catch {
      /* fall through to the plain-string path below */
    }
  }
  return host.replace(/^www\./, "").replace(/\/.*$/, "");
}

export function originFor(domain: string): string {
  return `https://${domain.startsWith("www.") ? domain : domain}`;
}

export async function upsertDomain(input: DomainInput): Promise<void> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error("A domain is required");
  const trust = input.trustScore ?? TRUST_BY_SOURCE_TYPE[input.sourceType] ?? 0.5;
  await dbRun(
    `INSERT INTO discovery_domains (
       domain, source_name, source_type, country, region, enabled, trust_score,
       crawl_frequency_hours, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       source_name = excluded.source_name,
       source_type = excluded.source_type,
       country = excluded.country,
       region = excluded.region,
       enabled = excluded.enabled,
       trust_score = excluded.trust_score,
       crawl_frequency_hours = excluded.crawl_frequency_hours,
       notes = excluded.notes`,
    [
      domain,
      input.sourceName,
      input.sourceType,
      input.country ?? null,
      input.region ?? null,
      input.enabled === false ? 0 : 1,
      trust,
      input.crawlFrequencyHours ?? 168,
      input.notes ?? null,
    ]
  );
}

export async function getDomain(domain: string): Promise<DomainRow | undefined> {
  return dbGet<DomainRow>("SELECT * FROM discovery_domains WHERE domain = ?", [normalizeDomain(domain)]);
}

export async function listDomains(options: { enabledOnly?: boolean } = {}): Promise<DomainRow[]> {
  return dbAll<DomainRow>(
    `SELECT * FROM discovery_domains ${options.enabledOnly ? "WHERE enabled = 1" : ""} ORDER BY trust_score DESC, domain ASC`
  );
}

/**
 * Domains due for a visit, most trusted first.
 *
 * Section 25's priorities in order: a domain never crawled at all, then one whose scheduled time
 * has arrived. A domain that is not due is simply not returned — this is what stops the engine
 * re-reading every URL every day.
 */
export async function selectDomainsDueForCrawl(limit: number): Promise<DomainRow[]> {
  return dbAll<DomainRow>(
    `SELECT * FROM discovery_domains
      WHERE enabled = 1
        AND (robots_allowed IS NULL OR robots_allowed = 1)
        AND (next_crawl_at IS NULL OR next_crawl_at <= datetime('now'))
      ORDER BY (last_successful_crawl IS NULL) DESC, trust_score DESC, next_crawl_at ASC
      LIMIT ?`,
    [limit]
  );
}

export async function recordRobotsPolicy(
  domain: string,
  policy: { allowed: boolean; crawlDelayMs: number | null; sitemaps: string[] }
): Promise<void> {
  await dbRun(
    `UPDATE discovery_domains
        SET robots_allowed = ?, robots_checked_at = datetime('now'),
            robots_crawl_delay_ms = ?, sitemap_urls = ?
      WHERE domain = ?`,
    [
      policy.allowed ? 1 : 0,
      policy.crawlDelayMs,
      JSON.stringify(policy.sitemaps.slice(0, 50)),
      normalizeDomain(domain),
    ]
  );
}

/** Marks a successful visit and schedules the next one from the domain's own frequency. */
export async function recordCrawlSuccess(domain: string): Promise<void> {
  await dbRun(
    `UPDATE discovery_domains
        SET last_checked = datetime('now'),
            last_successful_crawl = datetime('now'),
            failure_count = 0,
            last_failure_reason = NULL,
            next_crawl_at = datetime('now', '+' || crawl_frequency_hours || ' hours')
      WHERE domain = ?`,
    [normalizeDomain(domain)]
  );
}

/**
 * Marks a failed visit and backs off.
 *
 * The delay doubles with each consecutive failure up to a week, so a site that is down, blocking
 * us, or simply has no sitemap is not hammered once per run forever. A success resets it.
 */
export async function recordCrawlFailure(domain: string, reason: string): Promise<void> {
  const row = await getDomain(domain);
  const failures = (row?.failure_count ?? 0) + 1;
  const backoffHours = Math.min(168, 2 ** Math.min(failures, 7));
  await dbRun(
    `UPDATE discovery_domains
        SET last_checked = datetime('now'),
            failure_count = ?,
            last_failure_reason = ?,
            next_crawl_at = datetime('now', '+' || ? || ' hours')
      WHERE domain = ?`,
    [failures, reason.slice(0, 300), backoffHours, normalizeDomain(domain)]
  );
}

export async function setDomainEnabled(domain: string, enabled: boolean): Promise<void> {
  await dbRun("UPDATE discovery_domains SET enabled = ? WHERE domain = ?", [
    enabled ? 1 : 0,
    normalizeDomain(domain),
  ]);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
