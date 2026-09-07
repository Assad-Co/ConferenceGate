import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(process.cwd(), ".deep-cleanup-cli-test-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const shim = "data:text/javascript,if(!process.geteuid)process.geteuid=()=>0";
const shimPath = path.join(root, "identity.cjs");
fs.writeFileSync(shimPath, "if(!process.geteuid)process.geteuid=()=>0;");

async function fixture(name: string) {
  const database = path.join(root, `${name}.db`);
  // Create the fixture in its own process so native SQLite handles are fully released
  // before the CLI process opens it and before Windows removes the temporary files.
  const setup = spawnSync(process.execPath, ["--input-type=module", "-e", `
  import { createClient } from '@libsql/client';
  const client = createClient({ url: ${JSON.stringify(`file:${database}`)} });
  await client.executeMultiple(\`CREATE TABLE discovery_events (
    id TEXT PRIMARY KEY, title TEXT, status TEXT, official_url TEXT, start_year INTEGER,
    program_agenda TEXT, keynote_speakers TEXT, technical_committee TEXT, sponsors_exhibitors TEXT, community TEXT
  ); CREATE TABLE discovery_event_fields (event_id TEXT, field TEXT, value TEXT, source_url TEXT);\`);
  for (let n = 0; n < 8; n++) await client.execute({
    sql: "INSERT INTO discovery_events(id,title,status,start_year,keynote_speakers) VALUES (?,?,?,?,?)",
    args: ['fixture-' + n, "Fixture Conference 2027", n === 7 ? "rejected" : "validated", 2027,
      n === 0 ? '[{"name":"Legacy Person"}]' : null],
  });
  client.close();`], { encoding: "utf8", timeout: 10000 });
  assert.equal(setup.status, 0, setup.stderr);
  return database;
}
function run(database: string, out: string, preload?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", TEST_DATABASE_PATH: database,
    NODE_OPTIONS: `--require ${JSON.stringify(shimPath)}` };
  delete env.TURSO_DATABASE_URL; delete env.TURSO_AUTH_TOKEN;
  return spawnSync(process.execPath, ["--import", shim, "node_modules/tsx/dist/cli.mjs",
    "--import", shim, ...(preload ? ["--import", pathToFileURL(preload).href] : []),
    "server/discovery/deepCleanupCli.ts", "dry-run", "--out", out, "--batch-size", "50"],
  { env, encoding: "utf8", timeout: 20000 });
}

test("direct tsx dry-run cannot exit 0 with no plan while a database promise is pending", async () => {
  const database = await fixture("pending");
  const before = fs.readFileSync(database);
  const preload = path.join(root, "pending-read.mjs");
  // Reproduce the event-loop gap: the first real database read resolves on an unreferenced
  // timer. A floating main().catch() permits Node to exit 0 before this promise completes.
  // Only the fixture transport is delayed. The actual CLI, scanner and file writer run.
  fs.writeFileSync(preload, `
    const { db } = await import(${JSON.stringify(pathToFileURL(path.resolve("server/db.ts")).href)});
    const execute = db.execute.bind(db);
    let first = true;
    db.execute = async statement => {
      const sql = typeof statement === 'string' ? statement : statement.sql;
      if (!/^SELECT\\b/i.test(sql.trim())) throw new Error('Dry-run attempted a database write');
      if (first) { first = false; await new Promise(resolve => { setTimeout(resolve, 150).unref(); }); }
      return execute(statement);
    };
  `);
  const out = path.join(root, "pending-plan.json");
  const result = run(database, out, preload);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(out), `Silent success without plan:\n${result.stdout}\n${result.stderr}`);
  const plan = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(plan.summary.totalAcceptedInventory, 7);
  assert.equal(plan.summary.actuallyScanned, 1);
  assert.equal(plan.summary.conferencesWithDeepData, 1);
  assert.equal(plan.summary.itemsScanned, 1);
  assert.equal(plan.summary.REVIEW, 1);
  assert.equal(plan.summary.aiCalls, 0);
  assert.deepEqual(fs.readFileSync(database), before, "source database must remain byte-for-byte unchanged");
  for (const label of ["Total accepted inventory: 7", "Conferences actually scanned: 1", "Conferences containing deep data: 1",
    "Items scanned: 1", "KEEP: 0", "REMOVE: 0", "REVIEW: 1", "Counts by section:",
    "Affected conferences: 1", "Removal reasons:", "PRODUCTION ROWS MODIFIED: 0", out]) {
    assert.ok(result.stdout.includes(label), `Missing terminal summary: ${label}\n${result.stdout}`);
  }
  const originalPlan = fs.readFileSync(out, "utf8");
  const resumed = run(database, out, preload);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(fs.readFileSync(out, "utf8"), originalPlan, "completed CLI rerun must keep the same reviewed plan");
});

test("direct tsx dry-run reports plan-generation failure and exits nonzero", async () => {
  const result = run(path.join(root, "missing-schema.db"), path.join(root, "failed-plan.json"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no such table|SQLITE_ERROR/);
  assert.equal(fs.existsSync(path.join(root, "failed-plan.json")), false);
});

test("direct tsx dry-run reports output failure and exits nonzero without a success summary", async () => {
  const database = await fixture("write-error");
  const out = path.join(root, "nonexistent-directory", "plan.json");
  const result = run(database, out);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT|no such file/);
  assert.equal(fs.existsSync(out), false);
  assert.ok(!result.stdout.includes("PRODUCTION ROWS MODIFIED: 0"));
});
