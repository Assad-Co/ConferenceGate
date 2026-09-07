#!/usr/bin/env node
import "../env";
import fs from "node:fs";
import path from "node:path";
import { closeDb } from "../db";
import { digest, type Plan, type Reader } from "./deepRevalidation";
import { buildStoredDeepPlan } from "./deepCleanupScan";
import { applyPlan, restoreRun } from "./deepCleanupStore";
import { fetchRobots, isPathAllowed } from "./robots";
import { readPage, newReadBudget } from "./readPage";
import { isSafeExternalUrl } from "../urlSafety";

function printDryRunSummary(plan: Plan, outputPath: string): void {
  const summary = plan.summary;
  const reasons = new Map<string, number>();
  for (const event of plan.events) for (const change of event.changes) {
    for (const decision of [...change.decisions, ...(change.provenanceDecisions || [])]) {
      if (decision.verdict !== "KEEP") reasons.set(decision.reason, (reasons.get(decision.reason) || 0) + 1);
    }
  }
  for (const entry of summary.protected) for (const decision of entry.decisions || []) {
    if (decision.verdict !== "KEEP") reasons.set(decision.reason, (reasons.get(decision.reason) || 0) + 1);
  }
  console.log([
    "Deep-section dry-run complete",
    `Total accepted inventory: ${summary.totalAcceptedInventory}`,
    `Conferences containing deep data: ${summary.conferencesWithDeepData}`,
    `Conferences actually scanned: ${summary.actuallyScanned}`,
    `Items scanned: ${summary.itemsScanned}`,
    `KEEP: ${summary.KEEP}`, `REMOVE: ${summary.REMOVE}`, `REVIEW: ${summary.REVIEW}`,
    "Counts by section:",
    ...Object.entries(summary.sections).map(([section, counts]: [string, any]) =>
      `  ${section}: scanned=${counts.scanned} KEEP=${counts.KEEP} REMOVE=${counts.REMOVE} REVIEW=${counts.REVIEW}`),
    `Affected conferences: ${summary.affectedConferences}`,
    `Timed-out records: ${summary.timedOutRecords}`,
    `Source verification: ${summary.sourceVerification}; source reads: ${summary.sourceReads}`,
    `Protected ownership exceptions: ${summary.protected.length}`,
    "Removal reasons:",
    ...(reasons.size ? [...reasons].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => `  ${reason}: ${count}`) : ["  None"]),
    `Output plan path: ${outputPath}`,
    `SHA-256: ${digest(plan)}`,
    `Proposed run ID: deep_${digest(plan).slice(0, 24)}`,
    "AI calls: 0",
    "PRODUCTION ROWS MODIFIED: 0",
  ].join("\n"));
}

// These readers have no database writes, no paid fallback, and no AI route.
export function cleanupReader(networkTimeoutMs = 5000): Reader {
  const robots = new Map<string, ReturnType<typeof fetchRobots>>();
  return async (url, signal) => {
    const guard = async (url: string): Promise<boolean> => {
      if (signal?.aborted) return false;
      if (!await isSafeExternalUrl(url)) return false;
      if (signal?.aborted) return false;
      const origin = new URL(url).origin;
      if (!robots.has(origin)) robots.set(origin, fetchRobots(origin, { timeoutMs: networkTimeoutMs, signal }));
      const policy = await robots.get(origin)!;
      return !signal?.aborted && !policy.error && isPathAllowed(policy, url);
    };
    const page = await readPage(url, { budget: newReadBudget(0, 0), allowFallback: false,
      allowAlternateUrls: false, minTextChars: 0, urlGuard: guard, timeoutMs: networkTimeoutMs, signal });
    if (page.route === "none" || !page.html || page.direct.truncated) return null;
    return { html: page.html, url: page.resolvedUrl || page.direct.finalUrl || url };
  };
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const allowed: Record<string, string[]> = { "dry-run": ["out", "batch-size", "refill-pages", "verify-sources", "record-timeout-ms", "network-timeout-ms", "checkpoint", "resume", "max-records", "review-plan"], write: ["plan", "approve", "batch-size", "max-events"], restore: ["run", "max-events"] };
  if (!mode || !allowed[mode]) throw new Error("Usage: deepCleanupCli.ts dry-run --out plan.json | write --plan plan.json --approve SHA256 | restore --run RUN_ID");
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !allowed[mode].includes(key) || !args[i + 1] || args[i + 1].startsWith("--") || flags[key]) throw new Error(`Invalid flag ${args[i]}`);
    flags[key] = args[i + 1];
  }
  const number = (key: string, fallback: number, min = 1) => {
    const n = flags[key] === undefined ? fallback : Number(flags[key]);
    if (!Number.isInteger(n) || n < min) throw new Error(`Invalid --${key}`);
    return n;
  };
  if (!process.env.TURSO_DATABASE_URL && process.env.NODE_ENV !== "test") throw new Error("TURSO_DATABASE_URL is required; refusing an ephemeral Render database.");
  if (mode === "dry-run") {
    if (!flags.out) throw new Error("--out is required.");
    const outputPath = path.resolve(flags.out);
    const checkpointPath = path.resolve(flags.checkpoint || `${outputPath}.checkpoint.json`);
    if (checkpointPath === outputPath) throw new Error("Checkpoint and plan paths must differ.");
    if (number("refill-pages", 0, 0) !== 0) throw new Error("Dry-run inspects existing data only; refill is disabled.");
    const verify = number("verify-sources", 0, 0);
    const resume = number("resume", 1, 0);
    if (verify > 1 || resume > 1) throw new Error("--verify-sources and --resume must be 0 or 1.");
    const networkTimeoutMs = number("network-timeout-ms", 5000);
    if (flags["review-plan"] && [outputPath, checkpointPath].includes(path.resolve(flags["review-plan"]))) throw new Error("Use separate output/checkpoint paths from the input REVIEW plan.");
    const reviewPlan = flags["review-plan"] ? JSON.parse(fs.readFileSync(flags["review-plan"], "utf8")) as Plan : undefined;
    console.log(`Starting deep-section dry-run (${verify ? "stored source verification" : "stored data only; no web crawling"}). Output: ${outputPath}\nCheckpoint: ${checkpointPath}`);
    const plan = await buildStoredDeepPlan(cleanupReader(networkTimeoutMs), {
      batchSize: number("batch-size", 50), verifySources: verify === 1,
      reviewPlan,
      networkTimeoutMs, recordTimeoutMs: number("record-timeout-ms", 15000),
      checkpointPath, resume: resume === 1, maxRecords: number("max-records", Number.MAX_SAFE_INTEGER),
      progress: summary => {
        const n = summary.actuallyScanned, total = summary.conferencesWithDeepData;
        if (n === 0) console.error(`Inventory: ${summary.totalAcceptedInventory} accepted; ${total} conferences with deep data; ${summary.skippedWithoutDeepData} empty conferences skipped.`);
        if (n <= 1 || n % 10 === 0 || n === total) console.error(`Scanned ${n}/${total} conferences with deep data | KEEP ${summary.KEEP} / REMOVE ${summary.REMOVE} / REVIEW ${summary.REVIEW}`);
      },
    });
    if (fs.existsSync(outputPath)) {
      if (digest(JSON.parse(fs.readFileSync(outputPath, "utf8"))) !== digest(plan)) throw new Error("Output file contains a different plan; use a new output path.");
    } else fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2), { flag: "wx" });
    printDryRunSummary(plan, outputPath);
  } else if (mode === "write") {
    if (!flags.plan || !flags.approve) throw new Error("--plan and --approve are required after dry-run review.");
    const plan = JSON.parse(fs.readFileSync(flags.plan, "utf8")) as Plan;
    console.log(JSON.stringify(await applyPlan(plan, flags.approve, { batchSize: number("batch-size", 50),
      maxEvents: number("max-events", Number.MAX_SAFE_INTEGER), progress: n => { if (n % 10 === 0) console.error(`Checkpointed ${n} conferences`); } }), null, 2));
  } else {
    if (!flags.run) throw new Error("--run is required.");
    console.log(JSON.stringify(await restoreRun(flags.run, { maxEvents: number("max-events", Number.MAX_SAFE_INTEGER) }), null, 2));
  }
}
// A floating main().catch() is insufficient: a pending promise alone does not keep Node alive.
// Keep a referenced handle for the entire command (including file writing), and await its
// completion explicitly. Fail closed until the command and database close have both succeeded.
process.exitCode = 1;
const keepAlive = setInterval(() => console.error("Deep-section command is still running; waiting for completion."), 15000);
let succeeded = false;
try {
  await main();
  succeeded = true;
} catch (error) {
  console.error("Deep-section command failed:", error instanceof Error ? error.stack || error.message : error);
} finally {
  clearInterval(keepAlive);
  try { closeDb(); } catch (error) {
    succeeded = false;
    console.error("Database close failed:", error);
  }
  process.exitCode = succeeded ? 0 : 1;
}
