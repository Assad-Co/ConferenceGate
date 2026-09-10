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
import { auditPublishReady } from "./controlledPublish";
import {
  formatDeepTrace, formatEnrichmentReport, reclassifyAllPublishReadiness, runEnrichment,
} from "./enrichment";
import type { PublishReadiness } from "./types";
import { buildQualityReport, formatQualityReport, writeEventsCsv } from "./exportCsv";
import { computeMetrics } from "./metrics";
import { buildInventoryReport } from "./inventory";
import { runDiscovery } from "./pipeline";
import { providerStatus } from "./providers";
import { isPublishEnabled, publishDiscoveredConferences, syncPublishedDeepSections } from "./publish";
import { formatPreflightReport, runPreflight } from "./preflight";
import { initDiscoverySchema } from "./schema";
import { runProductionScale } from "./scale";
import {
  readPipelineLock, releaseStalePipelineLock, runProductionAutomation, withPipelineLease,
} from "./automation";
import {
  buildDeepCoverageReport, buildFieldCoverageReport, formatDeepCoverageReport, formatFieldCoverageReport,
} from "./deepEnrichment";
import { DEEP_SECTIONS } from "./deepSections";
import { buildOperationalStatus } from "./operations";
import { runUrlRemediation } from "./urlRemediation";
import { SEED_DOMAINS, seedBreakdown } from "./sources.seed";
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

/** One cycle's settings, read once and reused by every cycle in a repeated stretch. */
function automationOptions(flags: Record<string, string | boolean>) {
  return {
    targetAccepted: numberFlag(flags.target, 5_000),
    targetPublished: numberFlag(flags["published-target"], 1_000),
    batchPages: numberFlag(flags["batch-pages"], 500),
    enrichmentLimit: numberFlag(flags["enrichment-limit"], 250),
    maxSearchQueries: numberFlag(flags["max-search-queries"], 14),
    enrichmentSearchQueries: numberFlag(flags["enrichment-search-queries"], 6),
    maxJinaPages: numberFlag(flags["max-jina-pages"], 100),
    enrichmentJinaPages: numberFlag(flags["enrichment-jina-pages"], 50),
    discoveryTimeBudgetMs: numberFlag(flags["discovery-time-budget-ms"], 25 * 60_000),
    enrichmentTimeBudgetMs: numberFlag(flags["enrichment-time-budget-ms"], 20 * 60_000),
    // Ceiling on ONE cycle. Render kills a cron job that overruns, and a killed cycle never
    // reaches publication, so the cycle has to stop itself first.
    runTimeBudgetMs: numberFlag(flags["run-time-budget-ms"], 55 * 60_000),
    scheduleHours: numberFlag(flags["schedule-hours"], 8),
    // Finding conferences is not the shortage. The store holds well over a thousand and fewer than
    // two percent have a programme anybody can read; a cycle that spends its window finding more
    // of what it cannot yet process makes the backlog worse.
    skipDiscovery: flags["skip-discovery"] === true,
    // --only-hosts aapg.org,iceevent.org,urtec.org — fill these conferences and nothing else.
    // Also settable as DISCOVERY_ONLY_HOSTS so a hosted worker can be pointed at a society
    // without redeploying a new start command.
    onlyHosts: String(flags["only-hosts"] ?? process.env.DISCOVERY_ONLY_HOSTS ?? "")
      .split(",").map((host) => host.trim()).filter(Boolean),
    quiet: flags.quiet === true,
  };
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
           [--max-deep-pages 4] [--readiness publish_ready] [--missing-deep-only] [--trace]
           [--time-budget-ms 1800000] [--allow-local-db] [--quiet]
                            Verify accepted records against first-party pages, preserve field
                            provenance/history, enrich supported fields and classify publication
                            readiness. Does not discover new events and never publishes.
                            --readiness picks which backlog to work; without it records come
                            least-recently-verified first, which for a small sample means the
                            records least likely to have an authoritative page yet. --trace prints,
                            per conference, why deep pages were or were not read.
                            --with-official-url visits only records that already hold a website,
                            which is the only kind the deep pass can read anything from; pair it
                            with --missing-deep-only to work the deep-section backlog.
  diagnose [--run <id>]     Break a run's fetch failures down by class and by domain, and say
                            what each class implies. Defaults to the most recent run.
  metrics                   Print database metrics as JSON.
  inventory                 Print the production inventory/checkpoint metrics as JSON.
  publish-audit [--sample 10]
                            Re-read a random publish_ready sample from verified official pages
                            and persist a pass/fail gate. A passing sample of at least 10 is
                            required before real publication.
  reclassify-readiness      Recompute readiness for every accepted record from stored verified
                            evidence, conflicts and open reviews. Performs no fetching or publishing.
  remediate-urls [--limit 500]
                            Reconstruct absolute official URLs from preserved authoritative
                            provenance and reassess readiness. Never discovers or publishes.
  report                    Print the quality report.
  audit [--sample 20] [--out audit.txt]
                            Re-fetch a random sample of stored records from their source pages
                            and check every audited field against what the page says. Reports
                            field-level accuracy and flags records worth a closer look.
  export   [--out discovery_test.csv] [--years 2027]
  publish  [--dry-run] [--limit 200]
                            Write qualifying records into extracted_conferences. Requires
                            DISCOVERY_PUBLISH_TO_CONFERENCES=1 for a real (non-dry) run.
  scale    [--target 1000] [--batch-pages 500] [--max-batches 50]
           [--batch-time-budget-ms 1800000] [--max-search-queries 48]
                            Resume bounded production batches through discovery, run-scoped
                            enrichment, with AI and publication disabled.
  automate [--target 5000] [--batch-pages 500] [--enrichment-limit 250]
           [--schedule-hours 8] [--run-time-budget-ms 3300000] [--repeat-for-ms 0]
           [--skip-discovery] [--only-hosts aapg.org,iceevent.org] [--quiet]
                            Run one resumable unattended production cycle under the durable
                            database lease. --only-hosts (or DISCOVERY_ONLY_HOSTS) narrows the
                            cycle to conferences on those hosts and skips discovery entirely,
                            so a society's events can be filled without waiting out the backlog. Discovery and enrichment are bounded; publication is
                            separately fail-closed by CONFERENCEGATE_AUTOMATION_PUBLICATION=1.
                            CONFERENCEGATE_AUTOMATION_DISABLED=1 stops it doing anything at all.
  harvest [--orgs aapg.org,spe.org] [--max-org-domains 10] [--max-pages 120]
          [--org-pages 10] [--years 2026,2027,2028] [--allow-local-db] [--quiet]
                            Organisation-first harvest, and ONLY that: the sitemap and search
                            providers are switched off so the run visits exactly the organisations
                            asked for and spends nothing on search. Reads each society's robots.txt,
                            its event sitemaps, a hub it found last time, its events index across
                            www/event subdomains, then its feed. --orgs names the organisations to
                            test; without it the registry's due domains are used, capped by
                            --max-org-domains. Publishing stays off.
  ingest [--sources conflists,iconf] [--listings 25] [--max-pages 600]
         [--years 2026,2027,2028] [--search-queries 0] [--allow-local-db] [--quiet]
                            Seed from conference directories, and optionally Serper. Each source is
                            gated on its own robots.txt BEFORE any listing is requested: a blanket
                            disallow or an HTTP 401/403 skips that source and records why, leaving
                            the gap to Serper. Every candidate is marked a directory lead, so the
                            existing resolution finds the conference's own site and the listing host
                            is never treated as authoritative. --search-queries turns Serper on.
  organizations             Print the registry's size and its regional/type breakdown.
  field-coverage [--sample 20] [--published]
                            Percentage of accepted (or published) conferences holding each of the
                            nine detail fields, plus a per-conference sample of what is present and
                            what is missing. Stored rows only: no fetching, no writes.
  sync-deep-tabs [--dry-run] [--limit 500]
                            Reconcile what customers see with the verification ledger: deliver the
                            sections a hardened read confirmed, and withdraw the ones it has not.
                            Withdrawn items stay in discovery storage untouched; only their
                            visibility changes. Publishes nothing, changes no readiness, and edits
                            no record this engine did not write. --dry-run reports both counts
                            without writing.
  deep-coverage [--limit 20] [--section speakers]
                            Which accepted conferences hold programme, speaker, committee, sponsor
                            and community data, and which page of the organiser's site stated each.
                            Reads stored records only: no fetching, no provider calls, no writes.
  pipeline-lock [--release-stale]
                            Show who holds the pipeline lease and whether it is still
                            heartbeating. --release-stale clears a lease whose holder has stopped
                            heartbeating for five minutes (what a killed or redeployed process
                            leaves behind); it refuses a lease that is still alive.
  operations                Print the private operational status/checkpoint document as JSON.
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
      const summary = await withPipelineLease("manual_discovery", () => runDiscovery({
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
      }));
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
      const report = await withPipelineLease("manual_enrichment", () => runEnrichment({
        limit: numberFlag(flags.limit, 500),
        maxSearchQueries: numberFlag(flags["max-search-queries"], 500),
        maxJinaPages: numberFlag(flags["max-jina-pages"], 200),
        maxDeepPagesPerEvent: Number(flags["max-deep-pages"] ?? 4),
        missingDeepSectionsOnly: flags["missing-deep-only"] === true,
        requireOfficialUrl: flags["with-official-url"] === true,
        // Records are otherwise taken least-recently-verified first, which is the right order for
        // working a backlog and the wrong one for a sample: those records are precisely the ones
        // with no authoritative page yet, so a five-record sample can legitimately read nothing.
        readiness: list(flags.readiness).filter((value): value is PublishReadiness =>
          value === "publish_ready" || value === "needs_enrichment" || value === "needs_review"),
        trace: flags.trace === true,
        timeBudgetMs: numberFlag(flags["time-budget-ms"], 30 * 60 * 1000),
        quiet: flags.quiet === true,
      }));
      console.log("\n--- Enrichment report ---");
      console.log(formatEnrichmentReport(report));
      if (report.deepTrace) {
        console.log("\n--- Deep-section trace ---");
        console.log(formatDeepTrace(report.deepTrace));
      }
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

    case "inventory": {
      console.log(JSON.stringify(await buildInventoryReport(
        typeof flags["scale-run-id"] === "string" ? flags["scale-run-id"] : undefined
      ), null, 2));
      break;
    }

    case "publish-audit": {
      const result = await withPipelineLease("manual_publication_audit", () => auditPublishReady({
        sample: numberFlag(flags.sample, 10),
        onProgress: (done, total, title) => console.error(`  [${done}/${total}] auditing ${title.slice(0, 70)}`),
      }));
      console.log(JSON.stringify(result, null, 2));
      if (!result.passed) process.exitCode = 2;
      break;
    }

    case "reclassify-readiness": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        throw new Error("Refusing production reclassification without durable TURSO_DATABASE_URL.");
      }
      if (process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1") {
        throw new Error("Refusing reclassification while DISCOVERY_PUBLISH_TO_CONFERENCES=1. Set it to 0 first.");
      }
      console.log(JSON.stringify(await withPipelineLease("manual_readiness", () => reclassifyAllPublishReadiness()), null, 2));
      break;
    }

    case "remediate-urls": {
      if (!process.env.TURSO_DATABASE_URL) throw new Error("Refusing production remediation without durable TURSO_DATABASE_URL.");
      if (process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === "1") {
        throw new Error("Refusing remediation while DISCOVERY_PUBLISH_TO_CONFERENCES=1. Set it to 0 first.");
      }
      console.log(JSON.stringify(await runUrlRemediation({ limit: numberFlag(flags.limit, 500) }), null, 2));
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
      const result = await withPipelineLease("manual_publication", () => publishDiscoveredConferences({
        dryRun,
        limit: numberFlag(flags.limit, 200),
      }));
      console.log(JSON.stringify({ dryRun, ...result }, null, 2));
      break;
    }

    case "scale": {
      if (!process.env.TURSO_DATABASE_URL) throw new Error("Refusing scale run without durable TURSO_DATABASE_URL.");
      if (isPublishEnabled()) throw new Error(
        "Refusing scale orchestration while publishing is enabled. " +
        "Set DISCOVERY_PUBLISH_TO_CONFERENCES=0 for inventory growth."
      );
      const result = await withPipelineLease("manual_scale", () => runProductionScale({
        targetAccepted: numberFlag(flags.target, 1_000),
        batchPages: numberFlag(flags["batch-pages"], 500),
        batchCandidates: numberFlag(flags["batch-candidates"], 6_000),
        maxBatches: numberFlag(flags["max-batches"], 50),
        batchTimeBudgetMs: numberFlag(flags["batch-time-budget-ms"], 30 * 60_000),
        maxSearchQueries: numberFlag(flags["max-search-queries"], 48),
        maxJinaPages: numberFlag(flags["max-jina-pages"], 150),
        quiet: flags.quiet === true,
      }));
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "automate": {
      // The off switch.
      //
      // Stopping the unattended worker had no lever short of editing the schedule in a dashboard,
      // which is not something this repository can do and not something anyone should have to
      // remember. A stopped worker is also not a failed one: this returns cleanly so a paused
      // stretch does not fill the run history with red.
      if (process.env.CONFERENCEGATE_AUTOMATION_DISABLED === "1") {
        console.error(
          "[automate] stopped: CONFERENCEGATE_AUTOMATION_DISABLED=1. No pages are read, nothing is "
          + "enriched and nothing is published. Unset it to resume."
        );
        return;
      }

      // How long this invocation keeps starting cycles for.
      //
      // A cycle is bounded so it cannot be killed mid-pipeline, which means one invocation does
      // one pass and then the machine sits idle until the schedule comes round again. That is a
      // strange thing for a backlog: there is work outstanding the whole time nothing is running.
      // Repeating turns one firing into a working stretch — each cycle takes and releases its own
      // lease, and publication runs at the end of every one, so records reach readers throughout
      // rather than once every eight hours.
      // The launch catalogue belongs in the store before any cycle works the backlog.
      //
      // Seeding was a command a person ran once, which meant a record added to the catalogue
      // afterwards — or one an earlier, more cautious seeding held back — simply never entered the
      // store, and no amount of enrichment could reach it. storeEvent is an upsert keyed on
      // content, so running this at the start of a stretch re-adds what is missing and leaves
      // what is not. It reads no pages and publishes nothing.
      try {
        const { seedLaunchRecords } = await import("../dataset/seedDiscovery");
        const seeded = await seedLaunchRecords({});
        console.error(`[automate] catalogue seeded: ${seeded.seeded} record(s), ${seeded.failures.length} failed`);
      } catch (error: any) {
        // A catalogue that cannot be seeded must not stop the cycle that works what is already there.
        console.error(`[automate] catalogue seeding skipped: ${String(error?.message || error).slice(0, 200)}`);
      }

      const repeatFor = numberFlag(flags["repeat-for-ms"], 0);
      const repeatDeadline = Date.now() + repeatFor;
      let cycle = 0;
      let result = await runProductionAutomation(automationOptions(flags));
      console.log(JSON.stringify(result, null, 2));

      while (repeatFor > 0 && Date.now() < repeatDeadline) {
        // Another worker holding the lease means the work is being done by someone else, not that
        // it is worth spinning. Stop rather than burn the rest of the stretch bouncing.
        if (result.status === "locked") {
          console.error("[automate] another worker holds the lease; ending this stretch.");
          break;
        }
        // A cycle with nothing to do returns in seconds; without this a five-hour stretch would
        // be thousands of empty passes over the same records.
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        if (Date.now() >= repeatDeadline) break;
        cycle += 1;
        console.error(`[automate] ${new Date().toISOString()} starting cycle ${cycle + 1}`);
        result = await runProductionAutomation(automationOptions(flags));
        console.log(JSON.stringify(result, null, 2));
      }
      break;
    }

    case "ingest": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error("TURSO_DATABASE_URL is not set. Pass --allow-local-db only for a throwaway local run.");
        process.exitCode = 3;
        break;
      }
      const summary = await withPipelineLease("directory_ingest", () => runDiscovery({
        targetYears: list(flags.years).map(Number).filter(Number.isInteger),
        enableDirectoryIngest: true,
        directorySources: list(flags.sources),
        maxDirectoryListings: numberFlag(flags.listings, 25),
        maxPages: numberFlag(flags["max-pages"], 600),
        maxCandidates: numberFlag(flags["max-candidates"], 5000),
        maxSearchQueries: Number(flags["search-queries"] ?? 0),
        maxAiCalls: 0,
        allowAutoPublish: false,
        trigger: "directory_ingest",
        quiet: flags.quiet === true,
      }));
      console.log("\n--- Source access ---");
      for (const source of summary.directoryIngest?.sources ?? []) {
        console.log(`  ${source.source.padEnd(12)} ${source.outcome.padEnd(24)} ${source.candidates} candidates` +
          ` from ${source.listingsFetched} listings`);
        console.log(`      ${source.detail}`);
        for (const error of source.errors.slice(0, 3)) console.log(`      error: ${error}`);
      }
      const { events, ...rest } = summary;
      console.log("\n--- Ingest summary ---");
      console.log(JSON.stringify({ ...rest, eventsAccepted: events.length }, null, 2));
      break;
    }

    case "organizations": {
      const breakdown = seedBreakdown();
      console.log(`Registry seeds: ${breakdown.total}`);
      console.log("\nBy region:");
      for (const [region, count] of Object.entries(breakdown.byRegion).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${region.padEnd(16)} ${count}`);
      }
      console.log("\nBy type:");
      for (const [type, count] of Object.entries(breakdown.byType).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type.padEnd(26)} ${count}`);
      }
      break;
    }

    case "harvest": {
      if (!process.env.TURSO_DATABASE_URL && flags["allow-local-db"] !== true) {
        console.error("TURSO_DATABASE_URL is not set. Pass --allow-local-db only for a throwaway local run.");
        process.exitCode = 3;
        break;
      }
      for (const domain of SEED_DOMAINS) await upsertDomain(domain);
      const orgs = list(flags.orgs);
      const summary = await withPipelineLease("organization_harvest", () => runDiscovery({
        targetYears: list(flags.years).map(Number).filter(Number.isInteger),
        organizationsOnly: true,
        organizationDomains: orgs.length ? orgs : undefined,
        maxOrganizationDomains: orgs.length ? orgs.length : numberFlag(flags["max-org-domains"], 10),
        maxOrganizationPagesPerDomain: numberFlag(flags["org-pages"], 10),
        maxPages: numberFlag(flags["max-pages"], 120),
        maxSearchQueries: 0,
        maxAiCalls: 0,
        allowAutoPublish: false,
        trigger: "organization_harvest",
        quiet: flags.quiet === true,
      }));
      const { events, ...rest } = summary;
      console.log("\n--- Per organisation ---");
      for (const row of summary.organizationHarvest?.perDomain ?? []) {
        console.log(`  ${row.organization.slice(0, 44).padEnd(46)} ${String(row.candidates).padStart(4)} candidates` +
          `  ${String(row.pages).padStart(2)} pages  via ${row.sourceType ?? "-"}  (${row.note})`);
        if (row.sourceUrl) console.log(`      source: ${row.sourceUrl}`);
        for (const error of row.errors) console.log(`      error:  ${error}`);
      }
      console.log("\n--- Sample candidates ---");
      for (const event of events.slice(0, 15)) {
        console.log(`  ${String(event.title).slice(0, 80)}`);
        console.log(`      ${event.officialUrl || event.sourceUrl}`);
      }
      console.log("\n--- Harvest summary ---");
      console.log(JSON.stringify({ ...rest, eventsAccepted: events.length }, null, 2));
      break;
    }

    case "field-coverage": {
      console.log(formatFieldCoverageReport(await buildFieldCoverageReport({
        sample: numberFlag(flags.sample, 20),
        scope: flags.published === true ? "published" : "accepted",
      })));
      break;
    }

    case "sync-deep-tabs": {
      const result = await syncPublishedDeepSections({
        limit: numberFlag(flags.limit, 500), dryRun: flags["dry-run"] === true,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "deep-coverage": {
      const section = typeof flags.section === "string" ? flags.section : undefined;
      const report = await buildDeepCoverageReport({
        limit: numberFlag(flags.limit, 20),
        section: DEEP_SECTIONS.find((name) => name === section),
      });
      console.log(formatDeepCoverageReport(report));
      break;
    }

    case "pipeline-lock": {
      // Exists because a lease outlives the process that took it. A redeploy kills the holder
      // mid-run and every heavy command then refuses for up to ninety minutes, with nothing to
      // look at that says whether a worker is really running.
      if (flags["release-stale"] === true) {
        const outcome = await releaseStalePipelineLock();
        console.log(JSON.stringify(outcome, null, 2));
        if (!outcome.released && outcome.reason === "holder_is_alive") {
          console.error(
            "\nRefusing: the lease is still heartbeating, so a worker really is running. " +
            "Wait for it rather than starting a second pass over the same records."
          );
          process.exitCode = 1;
        }
        break;
      }
      console.log(JSON.stringify(await readPipelineLock(), null, 2));
      break;
    }

    case "operations": {
      console.log(JSON.stringify(await buildOperationalStatus(), null, 2));
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

