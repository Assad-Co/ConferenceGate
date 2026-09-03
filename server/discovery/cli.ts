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

  preflight [--domains a,b] [--registry]
                            Can this machine reach the open web? Asks each domain for its
                            robots.txt and says whether the network, the site, or nothing at
                            all is in the way. Run this before a first crawl in a new
                            environment. Exits non-zero when outbound HTTPS is blocked.
  seed                      Load the Phase 1 seed domains into the registry (idempotent).
  domains                   List the registry with its scheduling and health state.
  enable   --domain d       Enable a domain.
  disable  --domain d       Disable a domain.
  add      --domain d --name "…" --type university [--country … --region … --trust 0.9]
  run      [--domains a,b] [--years 2026,2027,2028] [--max-pages 100] [--max-candidates 1000]
           [--time-budget-ms 300000] [--max-ai-calls 0] [--allow-auto-publish] [--quiet]
  metrics                   Print database metrics as JSON.
  report                    Print the quality report.
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
