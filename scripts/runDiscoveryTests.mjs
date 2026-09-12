// Runs discovery tests in a process that cannot inherit production database access.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conferencegate-tests-"));
const testDatabase = path.join(testRoot, "discovery-tests.db");
// Both suites run under the same isolation: no production credentials, no network, an isolated
// database path. The launch dataset's tests live beside its code rather than under discovery/,
// so the runner collects from every directory that holds tests instead of one hard-coded path.
const testDirectories = ["server/discovery/tests", "server/dataset/tests", "server/tests"];
const testFiles = testDirectories.flatMap((directory) => {
  const url = new URL(`../${directory}/`, import.meta.url);
  if (!fs.existsSync(url)) return [];
  return fs
    .readdirSync(url)
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `${directory}/${name}`);
});

// Tests are fixture-backed, and that includes the launch dataset: pointing the reader at an empty
// directory keeps the catalogue that ships in data/ out of assertions about stored database rows.
// A test that wants static records writes its own fixture and overrides this.
const emptyDatasetDir = path.join(testRoot, "no-launch-dataset");
fs.mkdirSync(emptyDatasetDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: "test",
  TEST_DATABASE_PATH: testDatabase,
  LAUNCH_DATASET_DIR: emptyDatasetDir,
};
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;

const child = spawn(
  process.execPath,
  [
    // tsx identifies its temporary directory with geteuid() on Unix and os.userInfo() on
    // Windows. Some locked-down Windows runners cannot service os.userInfo(); supply a stable,
    // process-local test identity before tsx loads so isolation tests can still run.
    "--import", "data:text/javascript,if(!process.geteuid)process.geteuid=()=>0",
    "--import", "tsx", "--test", "--test-concurrency=1", ...testFiles,
  ],
  { stdio: "inherit", env }
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
});

fs.rmSync(testRoot, { recursive: true, force: true });
process.exitCode = exitCode;

