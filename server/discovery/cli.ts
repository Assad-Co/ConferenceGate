#!/usr/bin/env node
// Command-line control for the discovery engine.
//
// Phase 1's interface, per section 29: no dashboard, no frontend, just commands you can run and
// read. Everything the admin API can do is here, plus the two things a terminal is better at —
// writing discovery_test.csv and printing the quality report.
//
//   npm run discovery -- seed
//   npm run discovery -- domains
//   npm run discovery -- run --domains acm.org,egu.eu --max-pages 60 --years 2026,2027,2028
//   npm run discovery -- report
//   npm run discovery -- export --out discovery_test.csv
//   npm run discovery -- publish --dry-run

import "../env";
import fs from "fs";
import path from "path";
import { auditDiscoveredConferences, formatAuditReport } from "./audit";
import { diagnoseRun, formatDiagnosis } from "./diagnose";
import { formatEnrichmentReport, runEnrichment } from "./enrichment";
import { buildQualityReport, formatQualityReport, writeEventsCsv } from "./exportCsv";
import { computeMetrics } from "./metrics";
import { runDiscovery } from "./pipeline";
import { providerStatus } from "./providers";
import { isPublishEnabled, publishDiscoveredConferences } from "./publish";
import { formatPreflightReport, runPreflight } from "./preflight";
import { initDiscoverySchema } from "./schema";
import { SEED_DOMAINS } from "./sources.seed";
import { listDomains, setDomainEnabled, upsertDomain } from "./sourceRegistry";

interface Args {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function list(value: string | boolean | undefined): string[] {
  return typeof value === "string" ? value.split(",").map((part) => part.trim()).filter(Boolean) : [];
}

function numberFlag(value: string | boolean | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HELP = `Conference Gate — discovery engine

  preflight [--domains a,b] [--registry] [--skip-providers]
                            Can this machine reach the open web? Asks each domain for its
                            robots.txt and says whether the network, the site, or nothing at
                            all is in the way, then checks Brave, Serper, Jina, Turso and
                            Gemini (one request each). Run this before a first crawl in a new
                            environment. Exits non-zero when outbound HTTPS is blocked.
  phase1 [--out ./phase1] [--max-pages 400] [--years 2026,2027,2028] [--sample 20]
         [--max-search-queries 24] [--max-jina-pages 40] [--allow-local-db]
                            The whole benchmark in one command: preflight, seed, run, report,
                            CSV export and a random field audit, written into one directory.
                            Stops before crawling if outbound HTTPS is blocked. Publishing stays
                            off regardless.
  seed                      Load the Phase 1 seed domains into the registry (idempotent).
  domains                   List the registry with its scheduling and health state.
  enable   --domain d       Enable a domain.
  disable  --domain d       Disable a domain.
  add      --domain d --name "…" --type university [--country … --region … --trust 0.9]
  run      [--domains a,b] [--years 2026,2027,2028] [--max-pages 100] [--max-candidates 1000]
           [--time-budget-ms 300000] [--max-ai-calls 0] [--allow-auto-publish] [--quiet]
  enrich   [--limit 500] [--max-search-queries 500] [--max-jina-pages 200]
           [--time-budget-ms 1800000] [--allow-local-db] [--quiet]
                            Verify accepted records against first-party pages, preserve field
                            provenance/history, enrich supported fields and classify publication
                            readiness. Does not discover new events and never publishes.
  diagnose [--run <id>]     Break a run's fetch failures down by class and by domain, and say
                            what each class implies. Defaults to the most recent run.
  metrics                   Print database metrics as JSON.
  report                    Print the quality report.
  audit [--sample 20] [--out audit.txt]
                            Re-fetch a random sample of stored records from their source pages
                            and check every audited field against what the page says. Reports
                            field-level accuracy and flags records worth a closer look.
  export   [--out discovery_test.csv] [--years 2027]
  publish  [--dry-run] [--limit 200]
                            Write qualifying records into extracted_conferences. Requires
                            DISCOVERY_PUBLISH_TO_CONFERENCES=1 for a real (non-dry) run.
  providers                 Show which discovery providers are available and why.
`;

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  await initDiscoverySchema();

  switch (command) {
    case "preflight": {
      const report = await runPreflight({
        domains: list(flags.domains),
        fromRegistry: flags.registry === true,
        skipProviders: flags["skip-providers"] === true,
      });
      console.log(formatPreflightReport(report));
      // Non-zero on a blocked network, so a deploy check or CI step fails loudly rather than
      // going on to run a crawl that cannot possibly work.
      if (report.outboundHttps === "blocked") process.exitCode = 2;
      break;
    }

    case "seed": {
      for (const domain of SEED_DOMAINS) await upsertDomain(domain);
      console.log(`Seeded ${SEED_DOMAINS.length} domains.`);
      for (const domain of SEED_DOMAINS) {
        console.log(`  ${domain.domain.padEnd(24)} ${domain.sourceType.padEnd(24)} ${domain.region ?? ""}`);
      }
      break;
    }

    case "domains": {
      const domains = await listDomains();
      if (domains.length === 0) {
        console.log("No domains registered. Run: npm run discovery -- seed");
        break;
      }
      console.log(
        ["domain", "type", "trust", "on", "robots", "last ok", "next", "fails"].map((h) => h.padEnd(14)).join("")
      );
      for (const domain of domains) {
        console.log(
          [
            domain.domain,
            domain.source_type,
            String(domain.trust_score),
            domain.enabled ? "yes" : "no",
            domain.robots_allowed === null ? "?" : domain.robots_allowed ? "allowed" : "blocked",
            domain.last_successful_crawl ?? "never",
            domain.next_crawl_at ?? "now",
            String(domain.failure_count),
          ]
            .map((cell) => String(cell).slice(0, 13).padEnd(14))
            .join("")
        );
      }
      break;
    }

    case "enable":
    case "disable": {
      const domain = String(flags.domain || "");
      if (!domain) throw new Error("--domain is required");
      await setDomainEnabled(domain, command === "enable");
      console.log(`${domain} ${command}d.`);
      break;
    }

    case "add": {
      const domain = String(flags.domain || "");
      if (!domain) throw new Error("--domain is required");
      await upsertDomain({
        domain,
        sourceName: String(flags.name || domain),
        sourceType: (String(flags.type || "unknown") as any),
        country: flags.country ? String(flags.country) : null,
        region: flags.region ? String(flags.region) : null,
        trustScore: flags.trust ? Number(flags.trust) : undefined,
        crawlFrequencyHours: flags.frequency ? Number(flags.frequency) : undefined,
      });
      console.log(`Added ${domain}.`);
      break;
    }

    case "run": {
      const summary = await runDiscovery({
        domains: list(flags.domains),
        topics: list(flags.topics),
        targetYears: list(flags.years).map(Number).filter(Number.isInteger),
        maxPages: numberFlag(flags["max-pages"], 100),
        maxCandidates: numberFlag(flags["max-candidates"], 1000),
        timeBudgetMs: numberFlag(flags["time-budget-ms"], 5 * 60 * 1000),
        maxAiCalls: Number(flags["max-ai-calls"]) || 0,
        allowAutoPublish: flags["allow-auto-publish"] === true,
        quiet: flags.quiet === true,
        trigger: "cli",
      });
      const { events, ...rest } = summary;
      console.log("\n--- Run summary ---");
      console.log(JSON.stringify({ ...rest, eventsAccepted: events.length }, null, 2));
      break;
    }

    case "enrich": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error(
          "TURSO_DATABASE_URL is not set. Enrichment must use the same durable database as the web service. " +
          "Pass --allow-local-db only for an intentional throwaway local verification."
        );
        process.exitCode = 3;
        break;
      }
      // This command has no AI dependency and no publishing call. Keep both safeguards visible in
      // the report rather than depending on whichever environment happens to invoke it.
      if (process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1") {
        throw new Error("Refusing enrichment while DISCOVERY_PUBLISH_TO_CONFERENCES=1. Set it to 0 first.");
      }
      const report = await runEnrichment({
        limit: numberFlag(flags.limit, 500),
        maxSearchQueries: numberFlag(flags["max-search-queries"], 500),
        maxJinaPages: numberFlag(flags["max-jina-pages"], 200),
        timeBudgetMs: numberFlag(flags["time-budget-ms"], 30 * 60 * 1000),
        quiet: flags.quiet === true,
      });
      console.log("\n--- Enrichment report ---");
      console.log(formatEnrichmentReport(report));
      console.log("\n--- Enrichment JSON ---");
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "failed") process.exitCode = 2;
      break;
    }

    case "audit": {
      const report = await auditDiscoveredConferences({
        sample: numberFlag(flags.sample, 20),
        onProgress: (done, total, title) =>
          console.error(`  [${done}/${total}] re-reading ${title.slice(0, 70)}`),
      });
      const text = formatAuditReport(report);
      console.log(text);
      if (typeof flags.out === "string") {
        fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
        fs.writeFileSync(path.resolve(flags.out), `${text}\n`, "utf8");
        fs.writeFileSync(path.resolve(flags.out).replace(/\.txt$/, "") + ".json", JSON.stringify(report, null, 2), "utf8");
        console.log(`\nWritten to ${path.resolve(flags.out)}`);
      }
      break;
    }

    case "phase1": {
      const outDir = path.resolve(String(flags.out || "phase1-results"));
      fs.mkdirSync(outDir, { recursive: true });
      const write = (name: string, body: string) => {
        fs.writeFileSync(path.join(outDir, name), body.endsWith("\n") ? body : `${body}\n`, "utf8");
        console.log(`  wrote ${path.join(outDir, name)}`);
      };

      // On Render, a worker with no Turso credentials writes to a container-local SQLite file that
      // the web service cannot see and that vanishes on the next deploy. The run would look like a
      // success and leave nothing behind, which is worse than refusing.
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error(
          "TURSO_DATABASE_URL is not set.\n\n" +
            "This would write discovered conferences to a local SQLite file. On a Render worker that\n" +
            "file is not shared with the web service and does not survive a deploy, so the results of\n" +
            "this run would be invisible and then lost.\n\n" +
            "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to the SAME database the web service uses,\n" +
            "or pass --allow-local-db if a throwaway local run is genuinely what you want."
        );
        process.exitCode = 3;
        break;
      }

      console.log("STEP 1 — preflight\n");
      const preflight = await runPreflight({ fromRegistry: false });
      const preflightText = formatPreflightReport(preflight);
      console.log(preflightText);
      write("01-preflight.txt", preflightText);
      write("01-preflight.json", JSON.stringify(preflight, null, 2));

      if (preflight.outboundHttps === "blocked") {
        // Refusing to continue is the point: a crawl from here would produce a page of failures
        // that look like the sites' fault, and the run would be worse than no run at all.
        console.error(
          "\nSTOPPING: outbound HTTPS is blocked from this machine, so no real crawl is possible.\n" +
            "Nothing was crawled and nothing was written to the database.\n" +
            preflight.recommendation
        );
        process.exitCode = 2;
        break;
      }

      console.log("\nSTEP 2 — seeding the registry\n");
      for (const domain of SEED_DOMAINS) await upsertDomain(domain);
      console.log(`  seeded ${SEED_DOMAINS.length} domains`);

      console.log("\nSTEP 3 — discovery run\n");
      const summary = await runDiscovery({
        targetYears: list(flags.years).map(Number).filter(Number.isInteger),
        maxPages: numberFlag(flags["max-pages"], 400),
        maxCandidates: numberFlag(flags["max-candidates"], 2000),
        maxSearchQueries: numberFlag(flags["max-search-queries"], 24),
        maxJinaPages: Number(flags["max-jina-pages"] ?? 40),
        maxAlternateUrls: Number(flags["max-alternate-urls"] ?? 80),
        domainConcurrency: numberFlag(flags["domain-concurrency"], 4),
        maxCandidatesPerDomain: numberFlag(flags["max-per-domain"], 25),
        acceptedTarget: Number(flags["accepted-target"] ?? 0),
        maxAiCalls: Number(flags["max-ai-calls"]) || 0,
        timeBudgetMs: numberFlag(flags["time-budget-ms"], 25 * 60 * 1000),
        // Never on, whatever the flags say: this command exists to produce evidence for a human
        // decision, and publishing is that decision.
        allowAutoPublish: false,
        trigger: "phase1",
      });
      const { events, ...runRest } = summary;
      write("02-run-summary.json", JSON.stringify({ ...runRest, eventsAccepted: events.length }, null, 2));

      console.log("\nSTEP 4 — quality report\n");
      const quality = await buildQualityReport();
      const qualityText = formatQualityReport(quality);
      console.log(qualityText);
      write("03-quality-report.txt", qualityText);
      write("03-quality-report.json", JSON.stringify(quality, null, 2));

      console.log("\nSTEP 4b — fetch failure diagnosis\n");
      const diagnosis = await diagnoseRun(summary.runId);
      const diagnosisText = formatDiagnosis(diagnosis);
      console.log(diagnosisText);
      write("03b-fetch-diagnosis.txt", diagnosisText);
      write("03b-fetch-diagnosis.json", JSON.stringify(diagnosis, null, 2));

      console.log("\nSTEP 5 — CSV export\n");
      const csv = await writeEventsCsv(path.join(outDir, "discovery_test.csv"));
      console.log(`  ${csv.rows} rows → ${csv.path}`);

      console.log("\nSTEP 6 — field audit\n");
      const audit = await auditDiscoveredConferences({
        sample: numberFlag(flags.sample, 20),
        onProgress: (done, total, title) => console.error(`  [${done}/${total}] re-reading ${title.slice(0, 70)}`),
      });
      const auditText = formatAuditReport(audit);
      console.log(auditText);
      write("04-field-audit.txt", auditText);
      write("04-field-audit.json", JSON.stringify(audit, null, 2));

      console.log(`\nDone. Everything is in ${outDir}`);
      console.log(
        `Publishing was NOT enabled: ${summary.created} discovered conference(s) are in the discovery_* tables only.`
      );
      break;
    }

    case "diagnose": {
      const diagnosis = await diagnoseRun(typeof flags.run === "string" ? flags.run : undefined);
      console.log(formatDiagnosis(diagnosis));
      if (typeof flags.out === "string") {
        fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
        fs.writeFileSync(path.resolve(flags.out), JSON.stringify(diagnosis, null, 2), "utf8");
        console.log(`\nWritten to ${path.resolve(flags.out)}`);
      }
      break;
    }

    case "metrics": {
      console.log(JSON.stringify(await computeMetrics(), null, 2));
      break;
    }

    case "report": {
      console.log(formatQualityReport(await buildQualityReport()));
      break;
    }

    case "export": {
      const out = String(flags.out || "discovery_test.csv");
      const years = list(flags.years).map(Number).filter(Number.isInteger);
      const runId = typeof flags["run-id"] === "string" ? flags["run-id"] : undefined;
      const result = await writeEventsCsv(out, { years: years.length > 0 ? years : undefined, runId });
      console.log(`Wrote ${result.rows} rows to ${result.path}`);
      break;
    }

    case "publish": {
      const dryRun = flags["dry-run"] === true || flags.dryRun === true;
      if (!dryRun && !isPublishEnabled()) {
        console.error(
          "Refusing to publish: set DISCOVERY_PUBLISH_TO_CONFERENCES=1 to allow writing into extracted_conferences.\n" +
            "Re-run with --dry-run to see what would be written."
        );
        process.exitCode = 1;
        break;
      }
      const result = await publishDiscoveredConferences({
        dryRun,
        limit: numberFlag(flags.limit, 200),
      });
      console.log(JSON.stringify({ dryRun, ...result }, null, 2));
      break;
    }

    case "providers": {
      for (const provider of providerStatus()) {
        console.log(
          `${provider.name.padEnd(16)} ${provider.kind.padEnd(10)} ${provider.enabled ? "enabled" : "unavailable"}${
            provider.reason ? ` — ${provider.reason}` : ""
          }`
        );
      }
      break;
    }

    default:
      console.log(HELP);
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
  });

