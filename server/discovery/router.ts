// Backend administration for the discovery engine.
//
// No admin UI is built here — section 29 is explicit that Phase 1 gets logs, a CLI, an API and
// database metrics, and no frontend changes. These routes are what the CLI and any future,
// separately authorised dashboard would both call.
//
// Access control: every route requires a signed-in account AND a shared admin token, because
// this app has no admin role to check. `DISCOVERY_ADMIN_TOKEN` unset means the mutating routes
// refuse outright rather than defaulting to open — an engine that can crawl the web on request is
// not something to leave reachable by accident.

import { Router, type NextFunction, type Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { requireAuth, type AuthedRequest } from "../auth";
import { dbAll, dbGet, dbRun } from "../db";
import { buildQualityReport, exportEventsCsv } from "./exportCsv";
import { computeMetrics } from "./metrics";
import { runDiscovery } from "./pipeline";
import { runPreflight } from "./preflight";
import { providerStatus } from "./providers";
import { isPublishEnabled, publishDiscoveredConferences } from "./publish";
import { discoverySchemaReady } from "./schema";
import {
  listDomains,
  normalizeDomain,
  setDomainEnabled,
  upsertDomain,
  type DomainInput,
} from "./sourceRegistry";
import { SOURCE_TYPES, type SourceType } from "./types";

export const discoveryRouter = Router();

/** A second factor beyond being signed in, since the app has no admin role of its own. */
function requireAdminToken(req: AuthedRequest, res: Response, next: NextFunction) {
  const expected = process.env.DISCOVERY_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error:
        "Discovery administration is disabled: set DISCOVERY_ADMIN_TOKEN in the environment to enable it.",
    });
  }
  const provided = req.get("x-discovery-admin-token") || "";
  // Length-independent comparison is unnecessary here (the token is not derived from user data),
  // but a constant-time check costs nothing and avoids a timing signal on the prefix.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(403).json({ error: "Invalid discovery admin token." });
  }
  return next();
}

function timingSafeEqual(a: string, b: string): boolean {
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

const adminOnly = [requireAuth, requireAdminToken] as const;

// ---------------------------------------------------------------------------------------------
// Status and metrics — readable by any signed-in account; they expose no secrets.
// ---------------------------------------------------------------------------------------------

discoveryRouter.get(
  "/status",
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const ready = await discoverySchemaReady();
    if (!ready) {
      return res.json({ ready: false, reason: "discovery schema has not been created yet" });
    }
    const [metrics, domains, lastRuns] = await Promise.all([
      computeMetrics(),
      listDomains(),
      dbAll<Record<string, any>>(
        "SELECT id, started_at, finished_at, status, trigger, counters FROM discovery_runs ORDER BY started_at DESC LIMIT 5"
      ),
    ]);
    res.json({
      ready: true,
      metrics,
      providers: providerStatus(),
      publishing: {
        enabled: isPublishEnabled(),
        note: "When disabled, discovered conferences stay in the discovery tables and are never written into extracted_conferences.",
      },
      domains: domains.map((domain) => ({
        domain: domain.domain,
        sourceName: domain.source_name,
        sourceType: domain.source_type,
        region: domain.region,
        enabled: domain.enabled === 1,
        trustScore: domain.trust_score,
        robotsAllowed: domain.robots_allowed === null ? null : domain.robots_allowed === 1,
        lastChecked: domain.last_checked,
        lastSuccessfulCrawl: domain.last_successful_crawl,
        nextCrawlAt: domain.next_crawl_at,
        failureCount: domain.failure_count,
        lastFailureReason: domain.last_failure_reason,
      })),
      recentRuns: lastRuns.map((run) => ({
        ...run,
        counters: safeJson(run.counters),
      })),
    });
  })
);

/** Whether this deployment can reach the open web at all. Read-only and cheap: one robots.txt
 *  request per domain. Worth checking from the server itself, since a laptop's connectivity says
 *  nothing about the container the engine will actually run in. */
discoveryRouter.get(
  "/preflight",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const domains =
      typeof req.query.domains === "string"
        ? req.query.domains.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 25)
        : undefined;
    const report = await runPreflight({
      domains,
      fromRegistry: req.query.registry === "true",
      // Default to skipping the provider checks on the HTTP route: each spends a unit of quota,
      // and this endpoint is the one somebody might refresh.
      skipProviders: req.query.providers !== "true",
    });
    res.json({ preflight: report });
  })
);

discoveryRouter.get(
  "/metrics",
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    res.json({ metrics: await computeMetrics() });
  })
);

discoveryRouter.get(
  "/report",
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    res.json({ report: await buildQualityReport() });
  })
);

discoveryRouter.get(
  "/export.csv",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const years = parseYears(req.query.years);
    const csv = await exportEventsCsv({
      years: years.length > 0 ? years : undefined,
      limit: Math.min(Number(req.query.limit) || 5000, 20000),
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="discovery_test.csv"');
    res.send(csv);
  })
);

/**
 * Discovered conferences, filtered the way section 28 describes.
 *
 * Read-only, on the discovery tables only. The app's own conference endpoints are untouched.
 */
discoveryRouter.get(
  "/events",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const where: string[] = [];
    const args: any[] = [];

    const year = Number(req.query.year);
    if (Number.isInteger(year)) {
      where.push("start_year = ?");
      args.push(year);
    }
    if (typeof req.query.country === "string" && req.query.country.trim()) {
      where.push("country = ?");
      args.push(req.query.country.trim());
    }
    if (typeof req.query.format === "string" && req.query.format.trim()) {
      where.push("format = ?");
      args.push(req.query.format.trim());
    }
    if (typeof req.query.type === "string" && req.query.type.trim()) {
      where.push("event_type = ?");
      args.push(req.query.type.trim());
    }
    if (typeof req.query.status === "string" && req.query.status.trim()) {
      where.push("status = ?");
      args.push(req.query.status.trim());
    }
    if (typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) {
      where.push("start_date >= ?");
      args.push(req.query.from);
    }
    if (typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
      where.push("start_date <= ?");
      args.push(req.query.to);
    }
    if (typeof req.query.category === "string" && req.query.category.trim()) {
      where.push("id IN (SELECT event_id FROM discovery_event_categories WHERE category = ?)");
      args.push(req.query.category.trim().replace(/-/g, " "));
    }
    if (req.query.newest === "true") {
      where.push("date_discovered >= datetime('now', '-7 days')");
    }

    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const events = await dbAll<Record<string, any>>(
      `SELECT * FROM discovery_events ${clause}
        ORDER BY start_date IS NULL, start_date ASC, confidence_score DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const total = await dbGet<{ count: number }>(`SELECT COUNT(*) AS count FROM discovery_events ${clause}`, args);

    res.json({ total: Number(total?.count ?? 0), limit, offset, events: events.map(presentEvent) });
  })
);

discoveryRouter.get(
  "/events/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const event = await dbGet<Record<string, any>>("SELECT * FROM discovery_events WHERE id = ?", [req.params.id]);
    if (!event) return res.status(404).json({ error: "Not found" });

    const [sources, fields, categories, changes] = await Promise.all([
      dbAll("SELECT * FROM discovery_event_sources WHERE event_id = ? ORDER BY trust_score DESC", [req.params.id]),
      dbAll("SELECT * FROM discovery_event_fields WHERE event_id = ?", [req.params.id]),
      dbAll("SELECT * FROM discovery_event_categories WHERE event_id = ? ORDER BY confidence DESC", [req.params.id]),
      dbAll("SELECT * FROM discovery_event_changes WHERE event_id = ? ORDER BY detected_at DESC LIMIT 50", [req.params.id]),
    ]);

    res.json({ event: presentEvent(event), sources, fieldProvenance: fields, categories, changes });
  })
);

discoveryRouter.get(
  "/review-queue",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "open";
    const rows = await dbAll(
      "SELECT * FROM discovery_review_queue WHERE status = ? ORDER BY created_at DESC LIMIT 200",
      [status]
    );
    res.json({ items: rows });
  })
);

// ---------------------------------------------------------------------------------------------
// Mutating routes — signed in AND holding the admin token.
// ---------------------------------------------------------------------------------------------

discoveryRouter.post(
  "/run",
  ...adminOnly,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const summary = await runDiscovery({
      targetYears: parseYears(body.years),
      domains: Array.isArray(body.domains) ? body.domains.map(String).slice(0, 50) : undefined,
      topics: Array.isArray(body.topics) ? body.topics.map(String).slice(0, 20) : undefined,
      maxPages: Math.min(Number(body.maxPages) || 100, 2000),
      maxCandidates: Math.min(Number(body.maxCandidates) || 1000, 20000),
      timeBudgetMs: Math.min(Number(body.timeBudgetMs) || 5 * 60 * 1000, 30 * 60 * 1000),
      maxAiCalls: Math.min(Number(body.maxAiCalls) || 0, 200),
      allowAutoPublish: body.allowAutoPublish === true,
      trigger: "api",
      quiet: false,
    });
    // The in-memory event list is dropped from the response: it duplicates what /events already
    // serves and would make a run reply megabytes long.
    const { events, ...rest } = summary;
    res.json({ summary: { ...rest, eventsAccepted: events.length } });
  })
);

discoveryRouter.post(
  "/domain",
  ...adminOnly,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    const domain = normalizeDomain(String(body.domain || ""));
    if (!domain) return res.status(400).json({ error: "A domain is required." });
    const sourceType = String(body.sourceType || "unknown") as SourceType;
    if (!SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({ error: `sourceType must be one of: ${SOURCE_TYPES.join(", ")}` });
    }

    const input: DomainInput = {
      domain,
      sourceName: String(body.sourceName || domain).slice(0, 200),
      sourceType,
      country: body.country ? String(body.country).slice(0, 100) : null,
      region: body.region ? String(body.region).slice(0, 100) : null,
      enabled: body.enabled !== false,
      trustScore: body.trustScore === undefined ? undefined : Math.max(0, Math.min(1, Number(body.trustScore))),
      crawlFrequencyHours: body.crawlFrequencyHours ? Math.max(1, Number(body.crawlFrequencyHours)) : undefined,
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
    };
    await upsertDomain(input);
    res.status(201).json({ domain: input.domain });
  })
);

discoveryRouter.patch(
  "/domain/:domain",
  ...adminOnly,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "Provide { enabled: boolean }." });
    }
    await setDomainEnabled(req.params.domain, req.body.enabled);
    res.json({ domain: normalizeDomain(req.params.domain), enabled: req.body.enabled });
  })
);

discoveryRouter.post(
  "/review-queue/:id/resolve",
  ...adminOnly,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const resolution = String(req.body?.resolution || "").slice(0, 200);
    if (!resolution) return res.status(400).json({ error: "A resolution is required." });
    await dbRun(
      "UPDATE discovery_review_queue SET status = 'resolved', resolved_at = datetime('now'), resolution = ? WHERE id = ?",
      [resolution, req.params.id]
    );
    res.json({ id: req.params.id, status: "resolved" });
  })
);

/** Writes qualifying discovered conferences into the app's existing extracted_conferences table.
 *  Refuses unless publication has been explicitly enabled in the environment. */
discoveryRouter.post(
  "/publish",
  ...adminOnly,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dryRun = req.body?.dryRun !== false;
    if (!dryRun && !isPublishEnabled()) {
      return res.status(403).json({
        error:
          "Publishing into extracted_conferences is disabled. Set DISCOVERY_PUBLISH_TO_CONFERENCES=1 to enable it.",
      });
    }
    const result = await publishDiscoveredConferences({
      dryRun,
      limit: Math.min(Number(req.body?.limit) || 200, 2000),
      minConfidence: req.body?.minConfidence === undefined ? undefined : Number(req.body.minConfidence),
    });
    res.json({ dryRun, result });
  })
);

function presentEvent(row: Record<string, any>): Record<string, any> {
  return {
    ...row,
    topics: safeJson(row.topics) ?? [],
    quality_flags: safeJson(row.quality_flags) ?? [],
  };
}

function safeJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseYears(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100);
  }
  return [];
}
