import crypto from "crypto";
import { dbAll, dbGet, dbRun } from "../db";
import { auditPublishReady, latestPassingPublicationAudit } from "./controlledPublish";
import { auditDiscoveredConferences } from "./audit";
import { reclassifyAllPublishReadiness, runEnrichment } from "./enrichment";
import { buildInventoryReport, type InventoryReport } from "./inventory";
import {
  isPublishEnabled, publishDiscoveredConferences, retractIneligiblePublications,
  syncPublishedDeepSections, type PublishResult,
} from "./publish";
import { runProductionScale } from "./scale";

const LOCK_NAME = "production_data_pipeline";
const ACCEPTED = "('validated','published','needs_review')";
const CHECKPOINTS = [2_000, 3_000, 5_000] as const;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export interface AutomationOptions {
  targetAccepted?: number;
  targetPublished?: number;
  batchPages?: number;
  enrichmentLimit?: number;
  maxSearchQueries?: number;
  enrichmentSearchQueries?: number;
  maxJinaPages?: number;
  enrichmentJinaPages?: number;
  discoveryTimeBudgetMs?: number;
  enrichmentTimeBudgetMs?: number;
  /** Bound on the second enrichment pass, the one aimed at published conferences' deep sections. */
  publishedDeepLimit?: number;
  publishedDeepTimeBudgetMs?: number;
  leaseMinutes?: number;
  scheduleHours?: number;
  /**
   * Ceiling on the whole cycle, not on any one stage.
   *
   * Every stage was already bounded and the cycle still had to be killed at twelve hours three
   * nights running, because a stage's budget is checked between records and cannot end a wait
   * already in progress. The stages that matter to a reader — readiness, the audit, publication —
   * are last, so an overrun anywhere earlier meant none of them ran at all.
   *
   * This reserves time for those closing stages and spends only what is left on the expensive
   * ones. A cycle that runs out of room does less discovery and less enrichment; it still
   * publishes what is already ready.
   */
  runTimeBudgetMs?: number;
  /**
   * Run no discovery at all this cycle.
   *
   * Finding conferences is not the shortage — the store holds well over a thousand and fewer than
   * two percent of them have a programme anybody can read. Discovery competes for the same window
   * as the stages that turn a stored record into a readable one, and a cycle that spends its time
   * finding more of what it cannot yet process makes the backlog worse rather than better.
   */
  skipDiscovery?: boolean;
  quiet?: boolean;
}

export interface AutomationResult {
  runId: string;
  status: "completed" | "locked" | "failed";
  stage: string;
  inventory: InventoryReport;
  publication: PublishResult | null;
  nextScheduledAt: string;
}

export interface PipelineLease {
  acquired: boolean;
  ownerId: string;
  expiresAt: string | null;
}

export function automationPublicationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONFERENCEGATE_AUTOMATION_PUBLICATION === "1";
}

export function nextScheduledAt(now = new Date(), scheduleHours = 4): string {
  const cadence = Math.max(1, Math.floor(scheduleHours));
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(17);
  if (candidate <= now) candidate.setUTCHours(candidate.getUTCHours() + 1);
  while (candidate.getUTCHours() % cadence !== 0) candidate.setUTCHours(candidate.getUTCHours() + 1);
  return candidate.toISOString();
}

export async function acquirePipelineLease(ownerId: string, leaseMinutes = 90): Promise<PipelineLease> {
  const minutes = Math.max(15, Math.min(leaseMinutes, 180));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  await dbRun(`INSERT INTO discovery_pipeline_locks
      (name,owner_id,stage,acquired_at,heartbeat_at,lease_expires_at)
      VALUES (?,?,?, ?,?,?)
      ON CONFLICT(name) DO UPDATE SET owner_id=excluded.owner_id,stage=excluded.stage,
        acquired_at=excluded.acquired_at,heartbeat_at=excluded.heartbeat_at,
        lease_expires_at=excluded.lease_expires_at
      WHERE discovery_pipeline_locks.lease_expires_at<=? OR discovery_pipeline_locks.owner_id=?`,
    [LOCK_NAME, ownerId, "starting", now.toISOString(), now.toISOString(), expiresAt, now.toISOString(), ownerId]);
  const row = await dbGet<{ owner_id: string; lease_expires_at: string }>(
    "SELECT owner_id,lease_expires_at FROM discovery_pipeline_locks WHERE name=?", [LOCK_NAME]);
  return { acquired: row?.owner_id === ownerId, ownerId, expiresAt: row?.owner_id === ownerId ? row.lease_expires_at : null };
}

async function heartbeat(ownerId: string, stage: string, leaseMinutes: number): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  await dbRun(`UPDATE discovery_pipeline_locks SET stage=?,heartbeat_at=?,lease_expires_at=?
    WHERE name=? AND owner_id=?`, [stage, now.toISOString(), expires, LOCK_NAME, ownerId]);
}

export async function releasePipelineLease(ownerId: string): Promise<void> {
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name=? AND owner_id=?", [LOCK_NAME, ownerId]);
}

/**
 * How long a lease may go without a heartbeat before its holder is presumed dead.
 *
 * A running holder heartbeats every 60 seconds, so five minutes is eight missed beats. That is
 * positive evidence the process is gone rather than an assumption that enough time has passed —
 * which matters, because the whole point of the lease is that two enrichment passes must never
 * run at once.
 */
const STALE_HEARTBEAT_SECONDS = 300;

export interface PipelineLockStatus {
  held: boolean;
  ownerId: string | null;
  stage: string | null;
  acquiredAt: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  /** Seconds since the holder last proved it was alive. Null when nothing holds the lock. */
  secondsSinceHeartbeat: number | null;
  /**
   * `live` — heartbeating now; wait for it. `stale` — the process is gone, but the lease it took
   * still blocks everything until it expires. `expired` — the lease has run out and the next
   * caller will take it unaided. `free` — nothing holds it.
   */
  verdict: "free" | "live" | "stale" | "expired";
}

export async function readPipelineLock(now = new Date()): Promise<PipelineLockStatus> {
  const row = await dbGet<Record<string, any>>(
    "SELECT * FROM discovery_pipeline_locks WHERE name=?", [LOCK_NAME]);
  if (!row) {
    return { held: false, ownerId: null, stage: null, acquiredAt: null, heartbeatAt: null,
      leaseExpiresAt: null, secondsSinceHeartbeat: null, verdict: "free" };
  }
  const beat = Date.parse(row.heartbeat_at);
  const expires = Date.parse(row.lease_expires_at);
  const since = Number.isFinite(beat) ? Math.round((now.getTime() - beat) / 1000) : null;
  // An unparseable heartbeat is treated as stale rather than live: a lock nobody can reason about
  // should be recoverable, and the compare-and-swap below still protects a holder that is awake.
  const verdict: PipelineLockStatus["verdict"] =
    Number.isFinite(expires) && expires <= now.getTime() ? "expired"
      : since === null || since > STALE_HEARTBEAT_SECONDS ? "stale"
      : "live";
  return {
    held: true, ownerId: row.owner_id, stage: row.stage, acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at, leaseExpiresAt: row.lease_expires_at,
    secondsSinceHeartbeat: since, verdict,
  };
}

/**
 * Releases a lease whose holder has stopped heartbeating — the state a killed process leaves
 * behind, and which otherwise blocks every heavy command for up to ninety minutes.
 *
 * This is deliberately not a force-unlock. It refuses a lock that is still heartbeating, and the
 * delete matches the exact owner and heartbeat that were read, so a holder that wakes up in
 * between keeps its lease: the statement matches no row instead of taking it away mid-run.
 */
export async function releaseStalePipelineLock(
  options: { now?: Date } = {}
): Promise<{ released: boolean; reason: string; status: PipelineLockStatus }> {
  const now = options.now ?? new Date();
  const status = await readPipelineLock(now);
  if (!status.held) return { released: false, reason: "nothing_held", status };
  if (status.verdict === "live") {
    return { released: false, reason: "holder_is_alive", status };
  }
  await dbRun("DELETE FROM discovery_pipeline_locks WHERE name=? AND owner_id=? AND heartbeat_at=?",
    [LOCK_NAME, status.ownerId, status.heartbeatAt]);
  const after = await readPipelineLock(now);
  if (after.held && after.ownerId === status.ownerId && after.heartbeatAt === status.heartbeatAt) {
    return { released: false, reason: "delete_matched_nothing", status: after };
  }
  // Either the row is gone, or a new owner legitimately took the lock in the meantime. Both mean
  // this stale lease is no longer in anyone's way.
  return { released: true, reason: after.held ? "taken_by_new_owner" : "released", status: after };
}

/**
 * Takes the lease, clearing one first if its holder is provably gone.
 *
 * A lease outlives the process that took it. A redeploy or a kill leaves one held for up to ninety
 * minutes, and until it lapses every cycle returns `another_worker_active` in eight seconds —
 * including a run somebody triggered by hand precisely because they wanted work done now.
 * Recovering that used to need a person at a terminal, which is the wrong thing to require of an
 * unattended worker.
 *
 * Only a lease whose holder has stopped heartbeating for five minutes is cleared. A live holder
 * beats every sixty seconds, so silence that long is evidence the process is gone rather than an
 * assumption that enough time has passed — and a holder still beating keeps its lease, so this
 * cycle stands down exactly as before. Two enrichment passes over the same records must never run
 * at once, and that rule is not the one that was broken.
 */
export async function acquireOrRecoverPipelineLease(
  ownerId: string,
  leaseMinutes: number
): Promise<PipelineLease> {
  const first = await acquirePipelineLease(ownerId, leaseMinutes);
  if (first.acquired) return first;

  const recovered = await releaseStalePipelineLock();
  if (!recovered.released) return first;

  console.error(`[automation] cleared a lease abandoned by ${recovered.status.ownerId || "a killed run"}`);
  return acquirePipelineLease(ownerId, leaseMinutes);
}

/** Applies the same database lease to manual/API heavy work, closing the race with automation. */
export async function withPipelineLease<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const ownerId = id("manual");
  const lease = await acquirePipelineLease(ownerId, 90);
  if (!lease.acquired) throw new Error("Another discovery, enrichment, or publication worker is already active.");
  const timer = setInterval(() => void heartbeat(ownerId, stage, 90).catch(() => undefined), 60_000);
  timer.unref();
  try {
    await heartbeat(ownerId, stage, 90);
    return await work();
  } finally {
    clearInterval(timer);
    await releasePipelineLease(ownerId);
  }
}

async function setStage(runId: string, ownerId: string, stage: string, leaseMinutes: number): Promise<void> {
  // Printed even under --quiet. Quiet suppresses per-record chatter; a stage boundary is not
  // chatter, it is the only thing that says where an unattended cycle got to. Three consecutive
  // twelve-hour kills left logs that named no stage at all, which is why this is unconditional.
  console.error(`[automation] ${new Date().toISOString()} stage=${stage}`);
  await heartbeat(ownerId, stage, leaseMinutes);
  await dbRun("UPDATE discovery_automation_runs SET stage=? WHERE id=?", [stage, runId]);
  await dbRun(`UPDATE discovery_automation_state SET status='running',current_stage=?,current_run_id=?,
    updated_at=datetime('now') WHERE id=1`, [stage, runId]);
}

/** Prints the readiness reasons standing between accepted records and publication, most common
 *  first. Reads only; changes nothing. */
async function reportReadinessBlockers(label: string): Promise<void> {
  const rows = await dbAll<{ readiness_reasons: string; count: number }>(
    `SELECT readiness_reasons, COUNT(*) count FROM discovery_events
      WHERE status IN ('validated','published','needs_review') AND publish_readiness <> 'publish_ready'
      GROUP BY readiness_reasons ORDER BY count DESC LIMIT 12`
  );
  const tally = new Map<string, number>();
  for (const row of rows) {
    let reasons: unknown[] = [];
    try { const parsed = JSON.parse(String(row.readiness_reasons || "[]")); if (Array.isArray(parsed)) reasons = parsed; } catch { reasons = []; }
    for (const reason of reasons) {
      tally.set(String(reason), (tally.get(String(reason)) || 0) + Number(row.count));
    }
  }
  const ranked = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!ranked.length) {
    console.error(`[automation] ${label} readiness: nothing is blocked`);
    return;
  }
  console.error(`[automation] ${label} readiness blockers: ` +
    ranked.map(([reason, count]) => `${reason}=${count}`).join("  "));
}

async function countPublishCandidates(): Promise<number> {
  return Number((await dbGet<{ count: number }>(`SELECT COUNT(*) count FROM discovery_events e
    WHERE e.status='validated' AND e.publish_readiness='publish_ready'
      AND NOT EXISTS (SELECT 1 FROM discovery_review_queue q WHERE q.status='open'
        AND (q.event_id=e.id OR q.candidate_event_id=e.id))`))?.count || 0);
}

async function quarantineAuditFailures(failures: Array<{ eventId: string; reasons: string[] }>): Promise<void> {
  for (const failure of failures) {
    if (!failure.eventId || failure.eventId === "sample") continue;
    const reviewId = id("dreview");
    await dbRun(`INSERT INTO discovery_review_queue (id,event_id,reason,payload,status)
      SELECT ?,?,?,?,'open' WHERE NOT EXISTS (SELECT 1 FROM discovery_review_queue
        WHERE event_id=? AND status='open' AND reason='automated_publication_audit_failed')`,
      [reviewId, failure.eventId, "automated_publication_audit_failed",
        JSON.stringify({ reasons: failure.reasons }), failure.eventId]);
    await dbRun(`UPDATE discovery_events SET publish_readiness='needs_review' WHERE id=?`, [failure.eventId]);
  }
}

export async function buildEnrichmentCoverage(): Promise<Record<string, number>> {
  const row = await dbGet<Record<string, number>>(`SELECT COUNT(*) total,
    SUM(description IS NOT NULL AND description<>'') description,
    SUM(organizer IS NOT NULL AND organizer<>'') organizer,
    SUM(acronym IS NOT NULL AND acronym<>'') acronym,
    SUM(topics IS NOT NULL AND topics<>'[]') topics,
    SUM(abstract_deadline IS NOT NULL OR paper_submission_deadline IS NOT NULL OR submission_url IS NOT NULL) cfp,
    SUM(registration_url IS NOT NULL OR early_bird_deadline IS NOT NULL) fees,
    SUM(venue IS NOT NULL OR venue_address IS NOT NULL) venue_accommodation
    FROM discovery_events WHERE status IN ${ACCEPTED}`);
  const publishedSections = await dbGet<Record<string, number>>(`SELECT
    SUM(program_agenda IS NOT NULL AND program_agenda<>'{}' AND program_agenda<>'{"sessions":[]}') program,
    SUM(keynote_speakers IS NOT NULL AND keynote_speakers<>'[]') keynote_speakers,
    SUM(technical_committee IS NOT NULL AND technical_committee<>'[]') technical_committee,
    SUM(sponsors_exhibitors IS NOT NULL AND sponsors_exhibitors<>'[]') sponsors_exhibitors,
    SUM(community IS NOT NULL AND community<>'{}' AND community<>'{"social_media":[]}') community
    FROM extracted_conferences ec WHERE json_extract(ec.extraction_metadata,'$.origin')='discovery_engine'`);
  return {
    total: Number(row?.total || 0), description: Number(row?.description || 0), organizer: Number(row?.organizer || 0),
    acronym: Number(row?.acronym || 0), topics: Number(row?.topics || 0), cfp: Number(row?.cfp || 0),
    fees: Number(row?.fees || 0), venueAccommodation: Number(row?.venue_accommodation || 0),
    program: Number(publishedSections?.program || 0), keynoteSpeakers: Number(publishedSections?.keynote_speakers || 0),
    technicalCommittee: Number(publishedSections?.technical_committee || 0),
    sponsorsExhibitors: Number(publishedSections?.sponsors_exhibitors || 0), community: Number(publishedSections?.community || 0),
  };
}

async function captureCheckpoints(report: InventoryReport): Promise<void> {
  for (const target of CHECKPOINTS) {
    if (report.totalAccepted < target) continue;
    const existing = await dbGet("SELECT target_accepted FROM discovery_quality_checkpoints WHERE target_accepted=?", [target]);
    if (existing) continue;
    const audit = target === 5_000
      ? await auditDiscoveredConferences({ sample: 20, statuses: ["validated", "published", "needs_review"] })
      : null;
    await dbRun(`INSERT INTO discovery_quality_checkpoints
      (target_accepted,accepted_at_capture,report,enrichment_coverage) VALUES (?,?,?,?)`,
      [target, report.totalAccepted, JSON.stringify(report), JSON.stringify(await buildEnrichmentCoverage())]);
    if (audit) await dbRun("UPDATE discovery_quality_checkpoints SET audit_report=? WHERE target_accepted=?", [JSON.stringify(audit), target]);
  }
  await dbRun(`INSERT OR IGNORE INTO discovery_daily_reports
    (report_date,report,enrichment_coverage) VALUES (date('now'),?,?)`,
    [JSON.stringify(report), JSON.stringify(await buildEnrichmentCoverage())]);
}

export async function runProductionAutomation(options: AutomationOptions = {}): Promise<AutomationResult> {
  if (!process.env.TURSO_DATABASE_URL && process.env.NODE_ENV !== "test") {
    throw new Error("Refusing unattended production automation without durable TURSO_DATABASE_URL.");
  }
  if (isPublishEnabled()) {
    throw new Error("Refusing automation while unrestricted DISCOVERY_PUBLISH_TO_CONFERENCES is enabled.");
  }
  const ownerId = id("worker");
  const runId = id("dauto");
  const leaseMinutes = Math.max(15, Math.min(options.leaseMinutes ?? 90, 180));
  const scheduleHours = Math.max(1, options.scheduleHours ?? 8);
  const next = nextScheduledAt(new Date(), scheduleHours);
  // Time set aside for the closing stages — readiness, the audit, publication, the checkpoint.
  // They are cheap, but they are last, so they are exactly what an overrun destroys.
  const CLOSING_RESERVE_MS = 10 * 60_000;
  const runDeadline = Date.now() + Math.max(5 * 60_000, options.runTimeBudgetMs ?? 55 * 60_000);
  /** Time left for the expensive stages, once the closing stages have been kept back. */
  const expensiveWindow = (): number => Math.max(0, runDeadline - CLOSING_RESERVE_MS - Date.now());
  /** What an expensive stage may spend: its own budget, capped by what the cycle has left over. */
  const stageBudget = (requested: number): number => Math.min(requested, expensiveWindow());

  const lease = await acquireOrRecoverPipelineLease(ownerId, leaseMinutes);
  const initial = await buildInventoryReport();
  if (!lease.acquired) return { runId, status: "locked", stage: "another_worker_active", inventory: initial, publication: null, nextScheduledAt: next };

  await dbRun(`INSERT INTO discovery_automation_runs
    (id,owner_id,accepted_before,published_before) VALUES (?,?,?,?)`,
    [runId, ownerId, initial.totalAccepted, initial.totalPublished]);
  let publication: PublishResult | null = null;
  let scaleRunId: string | null = null;
  let enrichmentRunId: string | null = null;
  let auditId: string | null = null;
  /**
   * Readiness, the audit gate, publication, and the deep-tab sync — the stages that actually put
   * a conference in front of a reader.
   *
   * Extracted so a cycle can run it at both ends. It used to run only last, which meant a
   * conference whose page verified in the first two minutes still waited out discovery, enrichment
   * and the deep pass — three quarters of an hour — before anyone could see it. Nothing about the
   * work required that; it was a stage boundary.
   *
   * `stale` reuses a passing audit from the last thirty days rather than re-reading ten live pages
   * every time. That is not a relaxation: it is the same gate publishDiscoveredConferences enforces
   * for itself, and the late pass still takes a fresh sample.
   */
  const deliverReadyRecords = async (
    label: "early" | "late"
  ): Promise<{ publication: PublishResult | null; auditId: string | null }> => {
    await setStage(runId, ownerId, `readiness_${label}`, leaseMinutes);
    await reclassifyAllPublishReadiness();
    // Which fields are actually holding records back, in words, every cycle.
    //
    // "publication wrote 0" says something is wrong and nothing about what. The reasons are
    // already computed and stored per record; not printing them meant the one question that
    // mattered — what is blocking these conferences — could only be answered by someone opening
    // the database by hand.
    await reportReadinessBlockers(label);
    // Readiness has just been recomputed, so a record that no longer qualifies says so now. Take
    // its published row back before publishing anything else: a rule that stops the next bad
    // record while leaving the last one on screen has only half worked.
    // People filed as sponsors go back to the speakers list, and page furniture is dropped. Repairs
    // stored rows in place; moves nothing it cannot evidence.
    const { repairPublishedSponsors } = await import("./repairSponsors");
    const repaired = await repairPublishedSponsors({ limit: 500 });
    if (repaired.repaired > 0) {
      console.error(`[automation] ${label} repaired ${repaired.repaired} sponsor list(s): ` +
        `${repaired.movedToSpeakers} moved to speakers, ${repaired.droppedFurniture} dropped`);
    }

    const retracted = await retractIneligiblePublications({ limit: 500 });
    if (retracted.retracted > 0) {
      console.error(`[automation] ${label} withdrew ${retracted.retracted} published record(s) that no longer qualify`);
    }
    // Empty tabs filled in on conferences this engine already published. Runs before the decision
    // below, and unconditionally: it publishes nothing and changes no readiness, so a cycle with
    // nothing new to publish must still deliver sections the deep pass has since read.
    await syncPublishedDeepSections({ limit: 1_000 });
    const candidates = await countPublishCandidates();
    if (candidates === 0 || !automationPublicationEnabled()) return { publication: null, auditId: null };

    let passed = true;
    let id: string | null = null;
    const reuseable = label === "early" ? await latestPassingPublicationAudit() : undefined;
    if (!reuseable) {
      await setStage(runId, ownerId, `publication_audit_${label}`, leaseMinutes);
      const audit = await auditPublishReady({ sample: 10 });
      id = audit.id;
      passed = audit.passed;
      if (!passed) await quarantineAuditFailures(audit.failures);
    }

    if (!passed) {
      return {
        publication: { considered: candidates, written: 0, skippedExisting: 0, skippedIneligible: candidates, urls: [] },
        auditId: id,
      };
    }
    await setStage(runId, ownerId, `controlled_publication_${label}`, leaseMinutes);
    const written = await publishDiscoveredConferences({ limit: 500, requirePassingAudit: true });
    await dbRun("UPDATE discovery_automation_state SET last_publication_at=datetime('now') WHERE id=1");
    console.error(`[automation] ${label} publication wrote ${written.written} record(s)`);
    return { publication: written, auditId: id };
  };

  try {
    // Whatever is already ready goes out before this cycle starts crawling, not after it finishes.
    // On the first cycle of a stretch that is every record earlier work left ready, delivered in
    // about a minute instead of three quarters of an hour.
    const early = await deliverReadyRecords("early");
    if (early.publication) publication = early.publication;
    if (early.auditId) auditId = early.auditId;

    // Discovery grows inventory; enrichment, the deep pass and publication are what put a
    // conference in front of a reader. Taken first-come-first-served, discovery's twenty-five
    // minutes swallowed the window and left enrichment nothing — the stages a reader can actually
    // see would have been starved by the one they cannot. It gets a third, and no more.
    const discoveryBudget = Math.min(
      options.discoveryTimeBudgetMs ?? 25 * 60_000,
      Math.floor(expensiveWindow() / 6)
    );
    if (!options.skipDiscovery && initial.totalAccepted < (options.targetAccepted ?? 5_000) && discoveryBudget > 0) {
      await setStage(runId, ownerId, "discovery", leaseMinutes);
      const scale = await runProductionScale({
        targetAccepted: options.targetAccepted ?? 5_000,
        batchPages: options.batchPages ?? 500,
        maxBatches: 1,
        batchTimeBudgetMs: discoveryBudget,
        // A budget checked between batches cannot end a batch already running. Discovery took 32
        // minutes of a 7-minute allowance in production and left enrichment 9 of its 20, because
        // one batch — with an events API and a URL resolver inside it — is far longer than the
        // page loop this budget was written for. The deadline goes in as well, so the loop can
        // stop itself rather than discovering afterwards that it should have.
        deadline: Date.now() + discoveryBudget,
        maxSearchQueries: options.maxSearchQueries ?? 14,
        maxJinaPages: options.maxJinaPages ?? 100,
        quiet: options.quiet,
      });
      scaleRunId = scale.scaleRunId;
      await dbRun("UPDATE discovery_automation_state SET last_discovery_at=datetime('now') WHERE id=1");
    }

    // Twenty minutes was enrichment's share when discovery took a third of the window. Discovery is
    // off, so that time is simply unspent; the deep pass still gets whatever is left after this.
    const enrichmentBudget = stageBudget(options.enrichmentTimeBudgetMs ?? 32 * 60_000);
    if (enrichmentBudget > 0) {
      await setStage(runId, ownerId, "enrichment", leaseMinutes);
      const enrichment = await runEnrichment({
        readiness: ["needs_enrichment"], limit: options.enrichmentLimit ?? 250,
        // 526 of the 1,192 blocked records have no absolute official URL, so there is no page to
        // fetch and no verification they can ever pass. They were still taking slots in a pass
        // capped at 250 records: nearly half the budget spent on records whose blocker this stage
        // cannot lift. The pass now asks only for records it can actually finish.
        requireOfficialUrl: true,
        maxSearchQueries: options.enrichmentSearchQueries ?? 6,
        maxJinaPages: options.enrichmentJinaPages ?? 50,
        timeBudgetMs: enrichmentBudget, quiet: options.quiet,
      });
      enrichmentRunId = enrichment.runId;
    }

    // A second, smaller pass over the conferences customers can actually open.
    //
    // The pass above works the needs_enrichment backlog, which is right for growing inventory and
    // wrong for the detail page: a record becomes publish_ready the moment its title, date, country
    // and official source verify, and from that moment the backlog pass excluded it forever. The
    // programme, speakers, committee and sponsors of every published conference were therefore the
    // one thing the schedule could never reach. This visits only publish_ready records that still
    // have an empty deep section, so it costs nothing once they are full.
    // The pass that actually fills a reader's tabs, and now the largest in the cycle.
    //
    // It used to get eight minutes of fifty-five and sixty records, and only records already
    // publish_ready — of which there were eighty-five against a thousand needing enrichment. At
    // that rate the catalogue's programmes and speakers were decades away, which is the honest
    // reason tabs stayed empty however often the worker ran.
    //
    // The readiness filter is gone because it was never protecting anything: CLAUDE.md is explicit
    // that a deep field is not a readiness input and is not audited, so reading one early cannot
    // make a conference more publishable than its own evidence warrants. A record enriched now and
    // published later simply arrives with its sections already filled.
    const deepBudget = stageBudget(options.publishedDeepTimeBudgetMs ?? 25 * 60_000);
    if (deepBudget > 0) await runEnrichment({
      missingDeepSectionsOnly: true,
      // The deep pass reads a conference's own site. A record without one cannot yield a section,
      // so asking for it spends a slot to learn nothing — which is what a forty-record production
      // pass did, forty times over, before this narrowed what it asks for.
      requireOfficialUrl: true,
      limit: options.publishedDeepLimit ?? 400,
      maxSearchQueries: 0,
      maxJinaPages: options.enrichmentJinaPages ?? 50,
      // Programme, speakers, committee and sponsors is already four; four was therefore the exact
      // budget for a site that keeps each on its own page and nothing to spare for one that splits
      // a programme across two.
      maxDeepPagesPerEvent: 6,
      timeBudgetMs: deepBudget,
      quiet: options.quiet,
    });

    await dbRun("UPDATE discovery_automation_state SET last_enrichment_at=datetime('now') WHERE id=1");

    const late = await deliverReadyRecords("late");
    if (late.publication) publication = late.publication;
    if (late.auditId) auditId = late.auditId;

    await setStage(runId, ownerId, "checkpoint", leaseMinutes);
    const inventory = await buildInventoryReport();
    await captureCheckpoints(inventory);
    const providerUsage = await dbGet<{ counters: string }>("SELECT counters FROM discovery_runs ORDER BY started_at DESC LIMIT 1");
    await dbRun(`UPDATE discovery_automation_runs SET status='completed',stage='idle',accepted_after=?,published_after=?,
      discovery_scale_run_id=?,enrichment_run_id=?,publication_audit_id=?,publication_result=?,provider_usage=?,finished_at=datetime('now') WHERE id=?`,
      [inventory.totalAccepted, inventory.totalPublished, scaleRunId, enrichmentRunId, auditId,
        JSON.stringify(publication), providerUsage?.counters || "{}", runId]);
    await dbRun(`UPDATE discovery_automation_state SET status='idle',current_stage='idle',current_run_id=NULL,
      last_success_at=datetime('now'),next_scheduled_at=?,last_failure=NULL,updated_at=datetime('now') WHERE id=1`, [next]);
    return { runId, status: "completed", stage: "idle", inventory, publication, nextScheduledAt: next };
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 1000);
    await dbRun(`UPDATE discovery_automation_runs SET status='failed',error=?,finished_at=datetime('now') WHERE id=?`, [message, runId]);
    await dbRun(`UPDATE discovery_automation_state SET status='failed',last_failure=?,next_scheduled_at=?,
      updated_at=datetime('now') WHERE id=1`, [message, next]);
    throw error;
  } finally {
    await releasePipelineLease(ownerId);
  }
}
