import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const port = Number(process.env.SMOKE_PORT || 3107);
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    JWT_SECRET: 'public-home-smoke-only-secret',
    TEST_DATABASE_PATH: process.env.TEST_DATABASE_PATH || '/tmp/conferencegate-smoke.db',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        'Server exited before becoming healthy.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.status === 'ok' && body?.database === 'ready') return body;
    } catch {
      // Server is still starting.
    }
    await sleep(500);
  }
  throw new Error(
    'Timed out waiting for /api/health.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr
  );
}

try {
  const health = await waitForHealth();
  const base = 'http://127.0.0.1:' + port;
  for (const url of ['/', '/?utm_source=review&gclid=test', '/?ref=review']) {
    const response = await fetch(base + url);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Where conferences connect to opportunity/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('vary'), /Cookie/i);
    for (const page of ['pricing', 'terms', 'privacy', 'refunds']) {
      assert.ok(html.includes('href="/' + page + '.html"'), 'Missing ' + page + ' link');
    }
    assert.ok(html.includes("location.hash.startsWith('#password-reset=')"), 'Legacy reset links need an app redirect');
  }
  const invalid = await fetch(base, { headers: { cookie: 'cg_session=invalid' } });
  assert.match(await invalid.text(), /Where conferences connect to opportunity/);
  const session = jwt.sign({ sub: 'public-home-smoke-user', sv: 0 }, 'public-home-smoke-only-secret');
  for (const [url, headers] of [
    ['/?auth=choose', {}], ['/?discover=1', {}], ['/?authError=test', {}],
    ['/?linkedinNeedsRole=1', {}], ['/', { cookie: 'cg_session=' + session }],
  ]) {
    const response = await fetch(base + url, { headers });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root">/);
  }
  for (const page of ['pricing', 'terms', 'privacy', 'refunds']) {
    const response = await fetch(base + '/' + page + '.html');
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /<div id="root">/);
  }
  console.log(JSON.stringify({ smoke: 'passed', publicHomepage: 'passed', health }));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  const testDb = process.env.TEST_DATABASE_PATH || '/tmp/conferencegate-smoke.db';
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDb + suffix, { force: true }); } catch {}
  }
}
