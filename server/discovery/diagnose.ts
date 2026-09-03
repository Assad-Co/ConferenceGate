// Turning "203 terminal failures" into a plan.
//
// That was the single least actionable number in the Phase 1.2 benchmark. It could have been one
// blocked network, or two hostile hosts, or two hundred stale URLs, and each of those calls for
// something completely different. This reads a run's recorded failures back and says which.

import { dbAll, dbGet } from "../db";
import { failureFamily, failurePolicy, type FailureClass } from "./failureClass";

export interface FailureDiagnosis {
  runId: string | null;
  startedAt: string | null;
  attempts: number;
  fetched: number;
  failures: number;
  failureRate: number;
  byClass: Array<{
    failureClass: string;
    family: string;
    count: number;
    share: number;
    retryable: boolean;
    tryAlternateUrl: boolean;
    meaning: string;
  }>;
  byDomain: Array<{ domain: string; failures: number; classes: Record<string, number> }>;
  /** Domains whose failures are entirely one class — the ones worth a decision rather than a fix. */
  singleCauseDomains: Array<{ domain: string; failureClass: string; count: number }>;
  /** What the taxonomy implies is worth doing next, in order of how many URLs it would recover. */
  recommendations: string[];
}

export async function diagnoseRun(runId?: string): Promise<FailureDiagnosis> {
  const run = runId
    ? await dbGet<Record<string, any>>("SELECT * FROM discovery_runs WHERE id = ?", [runId])
    : await dbGet<Record<string, any>>("SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1");

  const counters = (() => {
    try {
      return JSON.parse(run?.counters || "{}");
    } catch {
      return {};
    }
  })();

  const rows = run
    ? await dbAll<{ domain: string; failure_class: string; count: number }>(
        "SELECT domain, failure_class, count FROM discovery_run_failures WHERE run_id = ?",
        [run.id]
      )
    : [];

  const byClassMap = new Map<string, number>();
  const byDomainMap = new Map<string, { failures: number; classes: Record<string, number> }>();
  for (const row of rows) {
    byClassMap.set(row.failure_class, (byClassMap.get(row.failure_class) || 0) + Number(row.count));
    const domain = byDomainMap.get(row.domain) ?? { failures: 0, classes: {} };
    domain.failures += Number(row.count);
    domain.classes[row.failure_class] = (domain.classes[row.failure_class] || 0) + Number(row.count);
    byDomainMap.set(row.domain, domain);
  }

  const failures = [...byClassMap.values()].reduce((sum, count) => sum + count, 0);
  const attempts = Number(counters.pagesAttempted ?? 0);
  const fetched = Number(counters.pagesFetched ?? 0);

  const byClass = [...byClassMap.entries()]
    .map(([failureClass, count]) => {
      const policy = failurePolicy(failureClass as FailureClass);
      return {
        failureClass,
        family: failureFamily(failureClass as FailureClass),
        count,
        share: failures > 0 ? Number((count / failures).toFixed(3)) : 0,
        retryable: policy.retryable,
        tryAlternateUrl: policy.tryAlternateUrl,
        meaning: policy.meaning,
      };
    })
    .sort((left, right) => right.count - left.count);

  const byDomain = [...byDomainMap.entries()]
    .map(([domain, state]) => ({ domain, ...state }))
    .sort((left, right) => right.failures - left.failures)
    .slice(0, 50);

  const singleCauseDomains = byDomain
    .filter((entry) => Object.keys(entry.classes).length === 1 && entry.failures >= 3)
    .map((entry) => ({
      domain: entry.domain,
      failureClass: Object.keys(entry.classes)[0],
      count: entry.failures,
    }));

  // Recommendations are derived from the taxonomy rather than written by hand, so they cannot
  // drift away from what the numbers actually say.
  const recommendations: string[] = [];
  const countOf = (name: string) => byClassMap.get(name) || 0;
  const staleUrls = countOf("http_404") + countOf("http_410");
  const refusals = countOf("http_403") + countOf("http_401") + countOf("http_406");
  const rateLimited = countOf("http_429");
  const transport = countOf("timeout") + countOf("connection_reset") + countOf("connection_refused");
  const localBlocks = countOf("blocked_by_local_egress_policy");

  if (localBlocks > 0) {
    recommendations.push(
      `${localBlocks} failure(s) were this machine's own network refusing to connect — nothing to do with the sites. Fix the egress rules before drawing any conclusion about the rest.`
    );
  }
  if (staleUrls > 0) {
    recommendations.push(
      `${staleUrls} URL(s) were stale (404/410) on sites that are otherwise fine. The alternate-URL stage retries the site root and parent path for exactly these; check how many it recovered before adding more discovery.`
    );
  }
  if (refusals > 0) {
    recommendations.push(
      `${refusals} request(s) were refused by the site itself (401/403/406). These will not come back on a retry: prefer other hosts, and let the circuit breaker stop spending budget on them.`
    );
  }
  if (rateLimited > 0) {
    recommendations.push(
      `${rateLimited} request(s) were rate limited. This is the one failure that means "slower", not "elsewhere" — raise the per-domain interval for those hosts rather than dropping them.`
    );
  }
  if (transport > 0) {
    recommendations.push(
      `${transport} transport failure(s) (timeout/reset/refused). Worth one retry; if a single domain dominates, it is that host rather than the network.`
    );
  }
  if (singleCauseDomains.length > 0) {
    recommendations.push(
      `${singleCauseDomains.length} domain(s) failed for exactly one reason every time — a decision about the domain, not a bug: ${singleCauseDomains
        .slice(0, 5)
        .map((entry) => `${entry.domain} (${entry.failureClass} ×${entry.count})`)
        .join(", ")}`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("No recorded fetch failures for this run.");
  }

  return {
    runId: run?.id ?? null,
    startedAt: run?.started_at ?? null,
    attempts,
    fetched,
    failures,
    failureRate: attempts > 0 ? Number((failures / attempts).toFixed(3)) : 0,
    byClass,
    byDomain,
    singleCauseDomains,
    recommendations,
  };
}

export function formatDiagnosis(diagnosis: FailureDiagnosis): string {
  const lines: string[] = [];
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

  lines.push("CONFERENCE GATE — FETCH FAILURE DIAGNOSIS");
  lines.push(diagnosis.runId ? `Run ${diagnosis.runId} (started ${diagnosis.startedAt})` : "No run found");
  lines.push("");
  lines.push(`Attempts ............. ${diagnosis.attempts}`);
  lines.push(`Fetched .............. ${diagnosis.fetched}`);
  lines.push(`Failures ............. ${diagnosis.failures}  (${pct(diagnosis.failureRate)} of attempts)`);
  lines.push("");

  if (diagnosis.byClass.length > 0) {
    lines.push("By failure class");
    lines.push("  class                            count   share  retry  alt-url  meaning");
    for (const row of diagnosis.byClass) {
      lines.push(
        `  ${row.failureClass.padEnd(32)}${String(row.count).padStart(5)}${pct(row.share).padStart(8)}${(row.retryable ? "yes" : "no").padStart(7)}${(row.tryAlternateUrl ? "yes" : "no").padStart(9)}  ${row.meaning}`
      );
    }
    lines.push("");
  }

  if (diagnosis.byDomain.length > 0) {
    lines.push("By source domain (worst first)");
    for (const row of diagnosis.byDomain.slice(0, 25)) {
      const classes = Object.entries(row.classes)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => `${name}×${count}`)
        .join(", ");
      lines.push(`  ${row.domain.padEnd(38)}${String(row.failures).padStart(5)}  ${classes}`);
    }
    lines.push("");
  }

  lines.push("What the numbers imply");
  for (const recommendation of diagnosis.recommendations) lines.push(`  • ${recommendation}`);
  return lines.join("\n");
}
