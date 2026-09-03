// The Phase 1 rehearsal: the whole engine, end to end, against the local fixture web.
//
// This is the run that proves DISCOVER → VERIFY → EXTRACT → NORMALIZE → CLASSIFY → DEDUPLICATE →
// STORE actually works as a chain rather than as eleven separately-tested parts. It seeds a
// registry of eleven independent fixture domains, crawls them exactly as the engine would crawl
// real ones — robots.txt first, sitemaps, conditional requests, per-domain politeness — and then
// writes the CSV and quality report that section 32 and section 34 ask for.
//
// WHAT THIS IS NOT: the conferences it finds are invented fixtures, not real events. The CSV it
// writes therefore goes to a scratch directory and never into the repository — synthetic
// conference rows sitting in a project that promises never to present unstated facts would be
// exactly the wrong artefact to leave behind. Point the same engine at real domains
// (`npm run discovery -- seed && npm run discovery -- run`) to produce a real one.
//
//   npx tsx server/discovery/tests/phase1Rehearsal.ts --out /tmp/discovery-rehearsal

import fs from "fs";
import os from "os";
import path from "path";

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const outDir = outIndex !== -1 ? process.argv[outIndex + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "discovery-"));
  fs.mkdirSync(outDir, { recursive: true });

  // The database lives beside the output, so a rehearsal never touches the app's own data/app.db.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-db-"));
  process.chdir(workDir);

  // Imported after the chdir: server/db.ts resolves its SQLite file from the working directory.
  const { startFixtureWeb } = await import("./fixtureWeb");
  const { initDb } = await import("../../db");
  const { initDiscoverySchema } = await import("../schema");
  const { upsertDomain } = await import("../sourceRegistry");
  const { runDiscovery } = await import("../pipeline");
  const { configureDomainLimits, resetDomainLimits } = await import("../httpClient");
  const { auditDiscoveredConferences, formatAuditReport } = await import("../audit");
  const { diagnoseRun, formatDiagnosis } = await import("../diagnose");
  const { buildQualityReport, formatQualityReport, writeEventsCsv } = await import("../exportCsv");
  const { publishDiscoveredConferences } = await import("../publish");

  const web = await startFixtureWeb();
  // The production SSRF guard blocks loopback, which is correct and stays untouched; the
  // rehearsal supplies its own guard scoped to its own servers.
  const urlGuard = async (url: string) => /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
  // Every fixture site shares the 127.0.0.1 host, so the per-domain politeness delay would
  // serialise all eleven behind one queue. Real domains keep the real delay.
  configureDomainLimits("127.0.0.1", { minIntervalMs: 0, maxConcurrent: 8 });

  try {
    // The app's own schema too, so the publish dry run below sees the real extracted_conferences
    // table it would be writing into.
    await initDb();
    await initDiscoverySchema();
    for (const site of web.sites) {
      await upsertDomain({
        domain: site.domain,
        sourceName: site.name,
        sourceType: site.sourceType,
        country: site.country,
        region: site.region,
      });
    }

    console.log(`Fixture web: ${web.sites.length} sites, ${web.totalConferencePages} conference pages published.\n`);

    const started = Date.now();
    const summary = await runDiscovery({
      targetYears: [2026, 2027, 2028],
      domains: web.sites.map((site) => site.domain),
      maxPages: 400,
      maxCandidates: 4000,
      timeBudgetMs: 5 * 60 * 1000,
      maxAiCalls: 0, // the whole rehearsal runs without a single model call
      maxJinaPages: 0, // and without a single call to any third-party service
      scheme: "http",
      urlGuard,
      trigger: "rehearsal",
      quiet: true,
    });

    // A second pass over the same web: every page is unchanged, so this proves the conditional
    // requests and content hashes actually stop the work being done twice.
    const rerun = await runDiscovery({
      targetYears: [2026, 2027, 2028],
      domains: web.sites.map((site) => site.domain),
      maxPages: 400,
      maxCandidates: 4000,
      timeBudgetMs: 5 * 60 * 1000,
      maxAiCalls: 0,
      maxJinaPages: 0,
      scheme: "http",
      urlGuard,
      trigger: "rehearsal-rerun",
      quiet: true,
    });

    const report = await buildQualityReport();
    const csvPath = path.join(outDir, "discovery_test.csv");
    const csv = await writeEventsCsv(csvPath);
    const publishPreview = await publishDiscoveredConferences({ dryRun: true, limit: 500 });

    // The same audit the Render run will produce, exercised against the fixture web so the
    // command and its report format are proven before they matter.
    // The same failure diagnosis the Render run will produce, exercised here so the report and
    // its query path are proven before they are needed.
    const diagnosis = await diagnoseRun(summary.runId);
    fs.writeFileSync(path.join(outDir, "fetch_diagnosis.txt"), `${formatDiagnosis(diagnosis)}\n`, "utf8");

    const audit = await auditDiscoveredConferences({ sample: 20, urlGuard, maxJinaPages: 0 });
    const auditText = formatAuditReport(audit);
    fs.writeFileSync(path.join(outDir, "field_audit.txt"), `${auditText}\n`, "utf8");

    const text = formatQualityReport(report);
    fs.writeFileSync(path.join(outDir, "quality_report.txt"), `${text}\n`, "utf8");
    fs.writeFileSync(
      path.join(outDir, "run_summary.json"),
      JSON.stringify(
        {
          firstRun: { ...summary, events: undefined, eventsAccepted: summary.events.length },
          rerun: { ...rerun, events: undefined, eventsAccepted: rerun.events.length },
          publishPreview: { ...publishPreview, urls: publishPreview.urls.slice(0, 10) },
          elapsedMs: Date.now() - started,
        },
        null,
        2
      ),
      "utf8"
    );

    console.log(text);
    console.log("");
    console.log("--- First run ---");
    console.log(
      JSON.stringify(
        {
          candidatesDiscovered: summary.candidatesDiscovered,
          pagesFetched: summary.pagesFetched,
          pagesFailed: summary.pagesFailed,
          eventsDetected: summary.eventsDetected,
          eventsRejected: summary.eventsRejected,
          created: summary.created,
          updated: summary.updated,
          merged: summary.merged,
          reviewQueued: summary.reviewQueued,
          aiCalls: summary.aiCalls,
          extractionMethods: summary.extractionMethods,
          rejectionReasons: summary.rejectionReasons,
          skippedDomains: summary.skippedDomains,
        },
        null,
        2
      )
    );
    console.log("");
    console.log("--- Second run over the same, unchanged web ---");
    console.log(
      JSON.stringify(
        {
          pagesFetched: rerun.pagesFetched,
          pagesUnchanged: rerun.pagesUnchanged,
          created: rerun.created,
          eventsDetected: rerun.eventsDetected,
        },
        null,
        2
      )
    );
    console.log("");
    console.log(`CSV:    ${csv.path} (${csv.rows} rows)`);
    console.log(`Report: ${path.join(outDir, "quality_report.txt")}`);
    console.log(`Would publish into extracted_conferences (dry run): ${publishPreview.written}`);
    console.log("");
    console.log(auditText);
  } finally {
    await web.stop();
    resetDomainLimits();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
