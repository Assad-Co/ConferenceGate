import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.EPHEMERAL_SQLITE_SMOKE_PORT || 3122);
const localDb = path.resolve('data/app.db');

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(localDb + suffix, { force: true }); } catch {}
}

const env = { ...process.env, PORT: String(port), NODE_ENV: 'production' };
delete env.DATABASE_PATH;
delete env.TURSO_DATABASE_URL;
delete env.TURSO_AUTH_TOKEN;

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const deadline = Date.now() + 25000;
  let health = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {}
    await sleep(300);
  }

  if (!health) throw new Error(`Timed out waiting for temporary SQLite health.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  if (health.database !== 'ready') throw new Error('Database was not ready: ' + JSON.stringify(health));
  if (health.databaseBackend !== 'sqlite') throw new Error('Wrong database backend: ' + JSON.stringify(health));
  if (health.databasePersistentPathConfigured !== false) {
    throw new Error('Temporary startup must report persistence=false: ' + JSON.stringify(health));
  }

  console.log(JSON.stringify({
    ephemeralSqliteSmoke: 'passed',
    productionStartsWithoutDatabasePath: true,
    tursoRequired: false,
    health,
  }));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(localDb + suffix, { force: true }); } catch {}
  }
}
