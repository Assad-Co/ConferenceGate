// Runs discovery tests in a process that cannot inherit production database access.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conferencegate-tests-"));
const testDatabase = path.join(testRoot, "discovery-tests.db");
const testFiles = fs
  .readdirSync(new URL("../server/discovery/tests/", import.meta.url))
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `server/discovery/tests/${name}`);

const env = {
  ...process.env,
  NODE_ENV: "test",
  TEST_DATABASE_PATH: testDatabase,
};
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...testFiles],
  { stdio: "inherit", env }
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
});

fs.rmSync(testRoot, { recursive: true, force: true });
process.exitCode = exitCode;
