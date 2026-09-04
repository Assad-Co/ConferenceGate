// Phase 1.4: verify accepted records against organizer-owned pages and enrich only from
// independently supported, first-party evidence. This is deliberately a separate pass: it does
// not discover new events, reclassify conference relevance, or publish anything.

import crypto from "crypto";
import { braveSearch, isBraveConfigured, isDirectoryHost, type LiveSearchResult } from "../braveSearch";
import { dbAll, dbGet, dbRun } from "../db";
import { isSerperConfigured, serperSearch } from "../serperSearch";
import { titleSimilarity } from "./dedupe";
import { extractFromHtml } from "./htmlExtract";
import { canonicalizeUrl, normalizeDates, normalizeDeadlines, normalizeFormat, normalizeLocation } from "./normalize";
import { findOfficialCandidates } from "./officialResolution";
import { newReadBudget, readPage, type ReadBudget } from "./readPage";
import { fetchRobots, isPathAllowed, type RobotsPolicy } from "./robots";
import { classifySource, isHighConfidenceOfficial, type SourceClassification } from "./sourceClassification";
import { getDomain, normalizeDomain } from "./sourceRegistry";
import { extractStructuredEvents } from "./structuredData";
import type { PublishReadiness, RawEventExtraction } from "./types";
import type { UrlGuard } from "./httpClient";

const ACCEPTED_STATUSES = ["validated", "published", "needs_review"];
const AUTHORITATIVE_CLASSES = new Set<SourceClassification>([
  "official_event_site", "organizer_site", "society_site", "university_host_site",
]);
const ENRICHABLE_FIELDS = {
  official_url: "officialUrl",
  organizer: "organizer",
  start_date: "startDate",
  end_date: "endDate",
  city: "city",
  country: "country",
  venue: "venue",
  format: "format",
  registration_url: "registrationUrl",
  abstract_deadline: "abstractDeadline",
  paper_submission_deadline: "paperSubmissionDeadline",
  submission_url: "submissionUrl",
} as const;
type EnrichableColumn = keyof typeof ENRICHABLE_FIELDS;

export type EvidenceDecision = "fill" | "confirm" | "supersede" | "keep_existing";
export interface EvidenceDecisionResult { decision: EvidenceDecision; reason: string }

/** Pure, deterministic precedence rule used by the writer and unit tests. */
export function decideEvidence(input: {
  currentValue: string | null;
  incomingValue: string | null;
  currentAuthority: number;
  incomingAuthority: number;
  sameSource: boolean;
}): EvidenceDecisionResult {
  if (!input.incomingValue) return { decision: "keep_existing", reason: "incoming evidence is empty" };
  if (!input.currentValue || input.currentValue === "unknown") {
    return { decision: "fill", reason: "authoritative evidence fills an unknown value" };
  }
  if (comparable(input.currentValue) === comparable(input.incomingValue)) {
    return { decision: "confirm", reason: "authoritative page independently confirms the stored value" };
  }
  if (input.incomingAuthority < 0.8) {
    return { decision: "keep_existing", reason: "lower-trust evidence cannot replace a stored value" };
  }
  if (input.sameSource && input.currentAuthority >= 0.8) {
    return { decision: "supersede", reason: "the same authoritative page now states a newer value" };
  }
  if (input.incomingAuthority > input.currentAuthority) {
    return { decision: "supersede", reason: "higher-authority evidence supersedes the stored value" };
  }
  return { decision: "keep_existing", reason: "conflicting evidence does not outrank the active source" };
}

function comparable(value: string): string {
  const url = canonicalizeUrl(value);
  if (/^https?:/i.test(value) && url) return url.toLowerCase();
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface ReadinessInput {
  titleVerified: boolean;
  startDate: string | null;
  startDateVerified: boolean;
  countryVerified: boolean;
  explicitlyOnline: boolean;
  formatVerified: boolean;
  officialSourceVerified: boolean;
  openReview: boolean;
  unresolvedConflict: boolean;
  blockingQualityFlags?: string[];
  now?: Date;
}

export function classifyPublishReadiness(input: ReadinessInput): { readiness: PublishReadiness; reasons: string[] } {
  const reasons: string[] = [];
  const start = input.startDate ? Date.parse(input.startDate) : NaN;
  const futureStart = Number.isFinite(start) && start >= (input.now ?? new Date()).getTime();
  if (!input.titleVerified) reasons.push("title_not_verified");
  if (!input.startDateVerified || !futureStart) reasons.push("future_start_date_not_verified");
  if (!input.countryVerified && !(input.explicitlyOnline && input.formatVerified)) reasons.push("country_or_online_status_not_verified");
  if (!input.officialSourceVerified) reasons.push("official_source_not_verified");
  if (input.openReview) reasons.push("open_review");
  if (input.unresolvedConflict) reasons.push("unresolved_authoritative_conflict");
  if ((input.blockingQualityFlags || []).length) reasons.push(...input.blockingQualityFlags!.map((f) => `quality:${f}`));
  if (input.openReview || input.unresolvedConflict || (input.blockingQualityFlags || []).length) {
    return { readiness: "needs_review", reasons };
  }
  return reasons.length === 0
    ? { readiness: "publish_ready", reasons: [] }
    : { readiness: "needs_enrichment", reasons };
}

export interface EnrichmentOptions {
  limit?: number;
  maxJinaPages?: number;
  maxSearchQueries?: number;
  timeBudgetMs?: number;
  urlGuard?: UrlGuard;
  quiet?: boolean;
  /** Restrict a batch pass to events attributed to one discovery run. */
  runId?: string;
}

export interface EnrichmentReport {
  runId: string;
  status: "completed" | "time_limit" | "failed";
  totalRecordsExamined: number;
  officialUrls: { before: number; after: number };
  verifiedCountries: { before: number; after: number };
  verifiedDates: { before: number; after: number };
  organizers: { before: number; after: number };
  readiness: Record<PublishReadiness, number>;
  sourceDistribution: { official: number; directory: number; other: number };
  conflicts: { detected: number; resolved: number };
  providerUsage: Record<string, number>;
  errors: string[];
  runtimeMs: number;
}

interface EventRow extends Record<string, any> { id: string; title: string; source_url: string }
interface VerifiedPage {
  url: string;
  classification: SourceClassification;
  authority: number;
  extraction: RawEventExtraction;
  route: string;
  identityScore: number;
  provider: string;
  classificationEvidence: string[];
}

function id(prefix: string): string { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }
function host(url: string): string { try { return normalizeDomain(new URL(url).hostname); } catch { return ""; } }
function parseArray(value: unknown): string[] { try { const v = JSON.parse(String(value || "[]")); return Array.isArray(v) ? v : []; } catch { return []; } }

async function snapshot(): Promise<{ official: number; countries: number; dates: number; organizers: number }> {
  const row = await dbGet<Record<string, number>>(
    `SELECT
       SUM(CASE WHEN official_url IS NOT NULL AND official_url <> '' THEN 1 ELSE 0 END) official,
       SUM(CASE WHEN organizer IS NOT NULL AND organizer <> '' THEN 1 ELSE 0 END) organizers,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM discovery_event_fields f JOIN discovery_event_sources s
         ON s.event_id=f.event_id AND s.source_url=f.source_url WHERE f.event_id=e.id AND f.field='country'
         AND s.is_official=1 AND s.classification_confidence>=0.8) THEN 1 ELSE 0 END) countries,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM discovery_event_fields f JOIN discovery_event_sources s
         ON s.event_id=f.event_id AND s.source_url=f.source_url WHERE f.event_id=e.id AND f.field='startDate'
         AND s.is_official=1 AND s.classification_confidence>=0.8) THEN 1 ELSE 0 END) dates
     FROM discovery_events e WHERE e.status IN ('validated','published','needs_review')`
  );
  return { official: Number(row?.official || 0), countries: Number(row?.countries || 0), dates: Number(row?.dates || 0), organizers: Number(row?.organizers || 0) };
}

export async function runEnrichment(options: EnrichmentOptions = {}): Promise<EnrichmentReport> {
  const started = Date.now();
  const runId = id("denr");
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
  const searchCap = Math.max(0, options.maxSearchQueries ?? 500);
  const deadline = started + Math.max(1_000, options.timeBudgetMs ?? 30 * 60_000);
  const budget = newReadBudget(Math.max(0, options.maxJinaPages ?? 200), Math.max(20, limit));
  const metrics: Record<string, number> = {
    braveQueries: 0, braveResults: 0, braveErrors: 0, serperQueries: 0, serperResults: 0,
    serperErrors: 0, directAttempts: 0, directSuccesses: 0, jinaAttempts: 0,
    jinaSuccesses: 0, jinaRecoveries: 0, robotsDisallowed: 0, pagesUnreadable: 0,
    directoryLeads: 0, directoryResolutions: 0,
  };
  const errors: string[] = [];
  let conflictsDetected = 0;
  let conflictsResolved = 0;
  let examined = 0;
  let searchUsed = 0;
  let timedOut = false;
  const robotsCache = new Map<string, RobotsPolicy>();
  const before = await snapshot();

  await dbRun(`INSERT INTO discovery_enrichment_runs (id, official_urls_before, verified_countries_before,
    verified_dates_before, organizers_before) VALUES (?, ?, ?, ?, ?)`,
    [runId, before.official, before.countries, before.dates, before.organizers]);

  try {
    const runJoin = options.runId
      ? " JOIN discovery_run_events re ON re.event_id=e.id AND re.run_id=?"
      : "";
    const rows = await dbAll<EventRow>(`SELECT DISTINCT e.* FROM discovery_events e${runJoin}
      WHERE e.status IN ('validated','published','needs_review')
      ORDER BY e.confidence_score DESC, e.date_discovered ASC LIMIT ?`,
      [...(options.runId ? [options.runId] : []), limit]);
    for (const event of rows) {
      if (Date.now() >= deadline) { timedOut = true; break; }
      examined += 1;
      if (!options.quiet) console.error(`[${examined}/${rows.length}] verifying ${event.title.slice(0, 80)}`);
      let unresolvedConflict = false;
      let verified = await verifyExistingSources(event, budget, robotsCache, metrics, options.urlGuard);
      if (!verified && searchUsed < searchCap) {
        const found = await searchForOfficial(event, searchCap - searchUsed, metrics);
        searchUsed += found.queries;
        for (const candidate of found.results.slice(0, 4)) {
          if (Date.now() >= deadline) break;
          verified = await verifyPage(event, candidate.link, budget, robotsCache, metrics, options.urlGuard, candidate.discoveryProvider || "search");
          if (verified) break;
        }
      }
      if (verified) {
        const applied = await applyVerifiedPage(runId, event, verified);
        conflictsDetected += applied.detected;
        conflictsResolved += applied.resolved;
        unresolvedConflict = applied.unresolved > 0;
      }
      await updateReadiness(event.id, unresolvedConflict);
    }
    const after = await snapshot();
    const readinessRows = await dbAll<{ publish_readiness: PublishReadiness; count: number }>(
      `SELECT publish_readiness, COUNT(*) count FROM discovery_events WHERE status IN ('validated','published','needs_review') GROUP BY publish_readiness`
    );
    const readiness: Record<PublishReadiness, number> = { publish_ready: 0, needs_enrichment: 0, needs_review: 0 };
    for (const row of readinessRows) readiness[row.publish_readiness] = Number(row.count);
    const distribution = await sourceDistribution();
    const status = timedOut ? "time_limit" as const : "completed" as const;
    const report: EnrichmentReport = {
      runId, status, totalRecordsExamined: examined,
      officialUrls: { before: before.official, after: after.official },
      verifiedCountries: { before: before.countries, after: after.countries },
      verifiedDates: { before: before.dates, after: after.dates },
      organizers: { before: before.organizers, after: after.organizers },
      readiness, sourceDistribution: distribution,
      conflicts: { detected: conflictsDetected, resolved: conflictsResolved },
      providerUsage: { ...metrics, jinaAttempts: budget.jinaUsed, jinaRecoveries: budget.jinaRecovered },
      errors, runtimeMs: Date.now() - started,
    };
    await finishRun(report);
    return report;
  } catch (error: any) {
    errors.push(String(error?.message || error));
    const after = await snapshot();
    const report: EnrichmentReport = {
      runId, status: "failed", totalRecordsExamined: examined,
      officialUrls: { before: before.official, after: after.official }, verifiedCountries: { before: before.countries, after: after.countries },
      verifiedDates: { before: before.dates, after: after.dates }, organizers: { before: before.organizers, after: after.organizers },
      readiness: { publish_ready: 0, needs_enrichment: 0, needs_review: 0 },
      sourceDistribution: await sourceDistribution(), conflicts: { detected: conflictsDetected, resolved: conflictsResolved },
      providerUsage: metrics, errors, runtimeMs: Date.now() - started,
    };
    await finishRun(report);
    throw error;
  }
}

async function verifyExistingSources(event: EventRow, budget: ReadBudget, robots: Map<string, RobotsPolicy>, metrics: Record<string, number>, guard?: UrlGuard): Promise<VerifiedPage | null> {
  const sources = await dbAll<Record<string, any>>(
    `SELECT source_url, source_classification, classification_confidence, is_official FROM discovery_event_sources
     WHERE event_id=? ORDER BY is_official DESC, classification_confidence DESC, trust_score DESC`, [event.id]);
  const urls = new Set<string>();
  if (event.official_url) urls.add(event.official_url);
  for (const source of sources) if (source.source_url) urls.add(source.source_url);
  if (event.source_url) urls.add(event.source_url);
  for (const url of urls) {
    if (isDirectoryHost(host(url))) {
      metrics.directoryLeads += 1;
      const directory = await readAllowed(url, budget, robots, metrics, guard);
      if (!directory) continue;
      for (const candidate of findOfficialCandidates(directory.html, url, { title: event.title, acronym: event.acronym }, 3)) {
        metrics.directoryResolutions += 1;
        const resolved = await verifyPage(event, candidate.url, budget, robots, metrics, guard, "directory_resolution");
        if (resolved) return resolved;
      }
      continue;
    }
    const verified = await verifyPage(event, url, budget, robots, metrics, guard, "existing_source");
    if (verified) return verified;
  }
  return null;
}

async function readAllowed(url: string, budget: ReadBudget, robots: Map<string, RobotsPolicy>, metrics: Record<string, number>, guard?: UrlGuard) {
  const domain = host(url);
  if (!domain) return null;
  let policy = robots.get(domain);
  if (!policy) {
    policy = await fetchRobots(new URL(url).origin, { urlGuard: guard, timeoutMs: 10_000 });
    robots.set(domain, policy);
  }
  if (!isPathAllowed(policy, url)) { metrics.robotsDisallowed += 1; return null; }
  const jinaBefore = budget.jinaUsed;
  const read = await readPage(url, { budget, allowFallback: true, urlGuard: guard, timeoutMs: 15_000 });
  metrics.directAttempts += 1;
  if (read.direct.ok) metrics.directSuccesses += 1;
  if (budget.jinaUsed > jinaBefore && read.route === "jina") metrics.jinaSuccesses += 1;
  if (!read.html || read.textLength < 200) { metrics.pagesUnreadable += 1; return null; }
  return read;
}

async function verifyPage(event: EventRow, url: string, budget: ReadBudget, robots: Map<string, RobotsPolicy>, metrics: Record<string, number>, guard?: UrlGuard, provider = "existing_source"): Promise<VerifiedPage | null> {
  if (!url || isDirectoryHost(host(url))) return null;
  const read = await readAllowed(url, budget, robots, metrics, guard);
  if (!read) return null;
  const finalUrl = read.resolvedUrl || read.direct.finalUrl || url;
  const structured = extractStructuredEvents(read.html, finalUrl);
  const structuredMatch = structured.events
    .filter((raw) => !!raw.title)
    .sort((a, b) => titleSimilarity(b.title!, event.title) - titleSimilarity(a.title!, event.title))[0] || null;
  const seed = structuredMatch && titleSimilarity(structuredMatch.title!, event.title) >= 0.55 ? structuredMatch : null;
  const raw = extractFromHtml(read.html, finalUrl, { seed });
  const identityScore = raw.title ? titleSimilarity(raw.title, event.title) : 0;
  if (!raw.title || identityScore < 0.55) return null;
  const storedYear = Number(event.start_year || 0);
  const extractedYear = normalizeDates(raw).startYear;
  const sameKnownOfficial = [event.official_url, event.source_url]
    .filter(Boolean)
    .some((known) => comparable(String(known)) === comparable(finalUrl));
  if (storedYear && extractedYear && storedYear !== extractedYear && !sameKnownOfficial) return null;
  const registry = await getDomain(host(finalUrl));
  const source = classifySource({ pageUrl: finalUrl, officialUrl: finalUrl, organizerUrl: raw.organizerUrl,
    title: raw.title, organizer: raw.organizer, pageText: read.html, registryType: registry?.source_type });
  if (!isHighConfidenceOfficial(source.classification, source.confidence)) return null;
  return { url: finalUrl, classification: source.classification, authority: source.confidence, extraction: raw,
    route: read.route, identityScore, provider, classificationEvidence: source.evidence };
}

async function searchForOfficial(event: EventRow, remaining: number, metrics: Record<string, number>): Promise<{ queries: number; results: LiveSearchResult[] }> {
  const year = event.start_year ? ` ${event.start_year}` : "";
  const braveQuery = `\"${event.title.replace(/\"/g, "")}\"${year} official conference website`;
  const serperQuery = `${event.title.replace(/[^a-zA-Z0-9 ]+/g, " ")}${year} official conference`;
  let queries = 0;
  const results: LiveSearchResult[] = [];
  if (remaining > queries && isBraveConfigured()) {
    queries += 1; metrics.braveQueries += 1;
    try { const found = await braveSearch(braveQuery, 10, "low"); metrics.braveResults += found.length; results.push(...found); }
    catch { metrics.braveErrors += 1; }
  }
  const strongBrave = results.some((r) => !isDirectoryHost(host(r.link)) && titleSimilarity(r.title, event.title) >= 0.55);
  if (!strongBrave && remaining > queries && isSerperConfigured()) {
    queries += 1; metrics.serperQueries += 1;
    try { const found = await serperSearch(serperQuery, 10); metrics.serperResults += found.length; results.push(...found); }
    catch { metrics.serperErrors += 1; }
  }
  const unique = new Map<string, LiveSearchResult>();
  for (const result of results) {
    if (!result.link || isDirectoryHost(host(result.link))) continue;
    if (titleSimilarity(result.title, event.title) < 0.35) continue;
    const key = canonicalizeUrl(result.link) || result.link;
    if (!unique.has(key)) unique.set(key, result);
  }
  return { queries, results: [...unique.values()] };
}

function extractedValues(page: VerifiedPage): Partial<Record<EnrichableColumn, string | null>> {
  const raw = page.extraction;
  const dates = normalizeDates(raw);
  const location = normalizeLocation(raw);
  const deadlines = normalizeDeadlines(raw, dates.startDate);
  const format = normalizeFormat(raw.formatText, raw.locationText);
  return {
    official_url: canonicalizeUrl(page.url) || page.url,
    organizer: raw.organizer,
    start_date: dates.startDate,
    end_date: dates.endDate,
    city: location.city,
    country: location.country,
    venue: location.venue,
    format: format === "unknown" ? null : format,
    registration_url: raw.registrationUrl,
    abstract_deadline: deadlines.abstractDeadline,
    paper_submission_deadline: deadlines.paperSubmissionDeadline,
    submission_url: raw.submissionUrl,
  };
}

async function applyVerifiedPage(runId: string, event: EventRow, page: VerifiedPage): Promise<{ detected: number; resolved: number; unresolved: number }> {
  const sourceDomain = host(page.url);
  await dbRun(`INSERT INTO discovery_event_sources (id,event_id,source_url,source_domain,source_type,source_classification,
    classification_confidence,classification_evidence,provider,trust_score,extraction_method,confidence,is_official,raw_extraction,last_verified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(event_id,source_url) DO UPDATE SET
    source_classification=excluded.source_classification, classification_confidence=excluded.classification_confidence,
    trust_score=MAX(discovery_event_sources.trust_score,excluded.trust_score), extraction_method=excluded.extraction_method,
    confidence=excluded.confidence, is_official=1, raw_extraction=excluded.raw_extraction, last_verified=datetime('now')`,
    [id("dsrc"), event.id, page.url, sourceDomain, "official_website", page.classification, page.authority,
      JSON.stringify(page.classificationEvidence), page.provider,
      page.authority, page.extraction.method, page.extraction.confidence, 1, JSON.stringify(page.extraction)]);
  let detected = 0, resolved = 0, unresolved = 0;
  for (const [column, incoming] of Object.entries(extractedValues(page)) as Array<[EnrichableColumn, string | null | undefined]>) {
    if (!incoming) continue;
    const field = ENRICHABLE_FIELDS[column];
    const active = await dbGet<Record<string, any>>(`SELECT f.*, s.source_classification, s.classification_confidence
      FROM discovery_event_fields f LEFT JOIN discovery_event_sources s ON s.event_id=f.event_id AND s.source_url=f.source_url
      WHERE f.event_id=? AND f.field=?`, [event.id, field]);
    const currentValue = event[column] == null ? null : String(event[column]);
    const currentAuthority = Number(active?.classification_confidence || 0);
    const decision = decideEvidence({ currentValue, incomingValue: incoming, currentAuthority,
      incomingAuthority: page.authority, sameSource: !!active && comparable(active.source_url) === comparable(page.url) });
    const conflict = !!currentValue && comparable(currentValue) !== comparable(incoming);
    if (conflict) detected += 1;
    if (conflict && decision.decision === "supersede") resolved += 1;
    if (conflict && decision.decision === "keep_existing") unresolved += 1;
    await dbRun(`INSERT INTO discovery_event_field_history (id,enrichment_run_id,event_id,field,old_value,old_source_url,
      old_source_classification,new_value,new_source_url,new_source_classification,decision,reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id("dfhist"), runId, event.id, field, currentValue, active?.source_url || null,
      active?.source_classification || null, incoming, page.url, page.classification, decision.decision, decision.reason]);
    if (decision.decision === "keep_existing") continue;
    if (decision.decision !== "confirm") {
      await dbRun(`UPDATE discovery_events SET ${column}=?, last_verified=datetime('now') WHERE id=?`, [incoming, event.id]);
      event[column] = incoming;
      await dbRun(`INSERT INTO discovery_event_changes (id,event_id,change_type,field,old_value,new_value,source_url)
        VALUES (?,?,?,?,?,?,?)`, [id("dchg"), event.id,
        decision.decision === "supersede" && (column === "start_date" || column === "end_date")
          ? "authoritative_stale_value_superseded" : "authoritative_enrichment",
        column, currentValue, incoming, page.url]);
    }
    await dbRun(`INSERT INTO discovery_event_fields (id,event_id,field,value,source_url,source_domain,extraction_method,confidence,last_verified)
      VALUES (?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(event_id,field) DO UPDATE SET value=excluded.value,
      source_url=excluded.source_url,source_domain=excluded.source_domain,extraction_method=excluded.extraction_method,
      confidence=excluded.confidence,last_verified=datetime('now')`,
      [id("dfld"), event.id, field, incoming, page.url, sourceDomain, page.extraction.method, page.extraction.confidence]);
  }
  if (event.start_date) {
    const d = new Date(`${event.start_date}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) await dbRun(`UPDATE discovery_events SET start_year=?,start_month=? WHERE id=?`, [d.getUTCFullYear(), d.getUTCMonth() + 1, event.id]);
  }
  const loc = normalizeLocation(page.extraction);
  if (loc.countryCode && event.country === loc.country) await dbRun(`UPDATE discovery_events SET country_code=? WHERE id=?`, [loc.countryCode, event.id]);
  const clearable = new Set<string>(["missing_official_url"]);
  if (event.organizer) clearable.add("missing_organizer");
  if (event.country || event.format === "online") clearable.add("unverifiable_location");
  if (event.city || event.format === "online") clearable.add("missing_city");
  if (event.format && event.format !== "unknown") clearable.add("format_not_stated");
  if (event.start_date) clearable.add("no_date_stated");
  await dbRun(`UPDATE discovery_events SET official_source_verified_at=datetime('now'),
    title_verified_at=CASE WHEN ? >= 0.75 THEN datetime('now') ELSE title_verified_at END,
    quality_flags=? WHERE id=?`, [page.identityScore,
      JSON.stringify(parseArray(event.quality_flags).filter((flag) => !clearable.has(flag))), event.id]);
  return { detected, resolved, unresolved };
}

async function updateReadiness(eventId: string, unresolvedConflict: boolean): Promise<void> {
  const event = await dbGet<Record<string, any>>(`SELECT * FROM discovery_events WHERE id=?`, [eventId]);
  if (!event) return;
  const verified = await dbAll<{ field: string }>(`SELECT f.field FROM discovery_event_fields f JOIN discovery_event_sources s
    ON s.event_id=f.event_id AND s.source_url=f.source_url WHERE f.event_id=? AND s.is_official=1
    AND s.classification_confidence>=0.8`, [eventId]);
  const fields = new Set(verified.map((r) => r.field));
  const review = await dbGet<{ n: number }>(`SELECT COUNT(*) n FROM discovery_review_queue WHERE status='open' AND (event_id=? OR candidate_event_id=?)`, [eventId, eventId]);
  const blocking = parseArray(event.quality_flags).filter((f) => ["inconsistent_dates", "broken_official_url", "end_before_start"].includes(f));
  const result = classifyPublishReadiness({
    titleVerified: !!event.title_verified_at, startDate: event.start_date, startDateVerified: fields.has("startDate"),
    countryVerified: fields.has("country"), explicitlyOnline: event.format === "online", formatVerified: fields.has("format"),
    officialSourceVerified: !!event.official_source_verified_at && !!event.official_url && !isDirectoryHost(host(event.official_url)),
    openReview: Number(review?.n || 0) > 0, unresolvedConflict, blockingQualityFlags: blocking,
  });
  await dbRun(`UPDATE discovery_events SET publish_readiness=?,readiness_reasons=? WHERE id=?`, [result.readiness, JSON.stringify(result.reasons), eventId]);
}

async function sourceDistribution(): Promise<{ official: number; directory: number; other: number }> {
  const rows = await dbAll<{ bucket: string; count: number }>(`SELECT CASE
    WHEN EXISTS (SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id AND s.is_official=1 AND s.classification_confidence>=0.8) THEN 'official'
    WHEN EXISTS (SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id AND s.source_classification IN ('directory','aggregator')) THEN 'directory'
    ELSE 'other' END bucket, COUNT(*) count FROM discovery_events e
    WHERE e.status IN ('validated','published','needs_review') GROUP BY bucket`);
  const result = { official: 0, directory: 0, other: 0 };
  for (const row of rows) result[row.bucket as keyof typeof result] = Number(row.count);
  return result;
}

async function finishRun(report: EnrichmentReport): Promise<void> {
  await dbRun(`UPDATE discovery_enrichment_runs SET status=?,records_examined=?,official_urls_after=?,verified_countries_after=?,
    verified_dates_after=?,organizers_after=?,publish_ready=?,needs_enrichment=?,needs_review=?,conflicts_detected=?,conflicts_resolved=?,
    provider_usage=?,source_distribution=?,errors=?,finished_at=datetime('now') WHERE id=?`,
    [report.status, report.totalRecordsExamined, report.officialUrls.after, report.verifiedCountries.after, report.verifiedDates.after,
      report.organizers.after, report.readiness.publish_ready, report.readiness.needs_enrichment, report.readiness.needs_review,
      report.conflicts.detected, report.conflicts.resolved, JSON.stringify(report.providerUsage), JSON.stringify(report.sourceDistribution),
      JSON.stringify(report.errors), report.runId]);
}

export function formatEnrichmentReport(report: EnrichmentReport): string {
  return [
    `Phase 1.4 enrichment ${report.status} (${report.runId})`,
    `Records examined: ${report.totalRecordsExamined}`,
    `Official URLs: ${report.officialUrls.before} -> ${report.officialUrls.after}`,
    `Verified countries: ${report.verifiedCountries.before} -> ${report.verifiedCountries.after}`,
    `Verified dates: ${report.verifiedDates.before} -> ${report.verifiedDates.after}`,
    `Organizers: ${report.organizers.before} -> ${report.organizers.after}`,
    `Readiness: publish_ready=${report.readiness.publish_ready}, needs_enrichment=${report.readiness.needs_enrichment}, needs_review=${report.readiness.needs_review}`,
    `Sources: official=${report.sourceDistribution.official}, directory=${report.sourceDistribution.directory}, other=${report.sourceDistribution.other}`,
    `Conflicts: detected=${report.conflicts.detected}, resolved=${report.conflicts.resolved}`,
    `Provider usage: ${JSON.stringify(report.providerUsage)}`,
    `Runtime: ${(report.runtimeMs / 1000).toFixed(1)}s`,
    ...(report.errors.length ? [`Errors: ${report.errors.join(" | ")}`] : []),
  ].join("\n");
}
