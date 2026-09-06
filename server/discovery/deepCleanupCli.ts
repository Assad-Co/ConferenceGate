#!/usr/bin/env node
import "../env";
import fs from "node:fs";
import { closeDb } from "../db";
import { buildPlan, digest, type Plan, type Reader } from "./deepRevalidation";
import { applyPlan, restoreRun } from "./deepCleanupStore";
import { fetchRobots, isPathAllowed } from "./robots";
import { readPage, newReadBudget } from "./readPage";
import { isSafeExternalUrl } from "../urlSafety";

// These readers have no database writes, no paid fallback, and no AI route.
export function cleanupReader(): Reader {
  const robots = new Map<string, ReturnType<typeof fetchRobots>>();
  const guard = async (url: string): Promise<boolean> => {
    if (!await isSafeExternalUrl(url)) return false;
    const origin = new URL(url).origin;
    if (!robots.has(origin)) robots.set(origin, fetchRobots(origin));
    const policy = await robots.get(origin)!;
    return !policy.error && isPathAllowed(policy, url);
  };
  return async url => {
    const page = await readPage(url, { budget: newReadBudget(0, 0), allowFallback: false,
      allowAlternateUrls: false, minTextChars: 0, urlGuard: guard, timeoutMs: 15000 });
    if (page.route === "none" || !page.html || page.direct.truncated) return null;
    return { html: page.html, url: page.resolvedUrl || page.direct.finalUrl || url };
  };
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const allowed: Record<string, string[]> = { "dry-run": ["out", "batch-size", "refill-pages"], write: ["plan", "approve", "batch-size", "max-events"], restore: ["run", "max-events"] };
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
    const plan = await buildPlan(cleanupReader(), { batchSize: number("batch-size", 50), maxRefillPages: number("refill-pages", 4, 0),
      progress: (n, total) => { if (n % 10 === 0) console.error(`Scanned ${n}/${total} accepted conferences`); } });
    fs.writeFileSync(flags.out, JSON.stringify(plan, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ ...plan.summary, plan: flags.out, sha256: digest(plan), proposedRunId: `deep_${digest(plan).slice(0, 24)}`, databaseWrites: 0 }, null, 2));
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
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closeDb);
