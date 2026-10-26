import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const user = process.env.ETHEREAL_TEST_USER;
const pass = process.env.ETHEREAL_TEST_PASSWORD;
if (!user || !pass) throw new Error('Missing process-scoped test inbox credentials');
const directory = await mkdtemp(path.join(os.tmpdir(), 'cg-captured-recovery-'));
const email = `qa-recovery-${crypto.randomUUID()}@example.invalid`;
const base = 'http://127.0.0.1:3144';
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_PATH: path.join(directory, 'isolated.db'), PORT: '3144',
    TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', PUBLIC_BASE_URL: 'https://conferencegate.example.invalid',
    RESEND_API_KEY: 'sandbox-only-not-a-real-provider-key', PASSWORD_RESET_FROM_EMAIL: 'no-reply@example.invalid',
    ETHEREAL_TEST_RECIPIENTS: email, PRIVATE_WORKSPACES_ONLY: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
// Keep server output private; never dump provider responses or reset content on failure.
child.stdout.resume(); child.stderr.resume();
let socket;
async function request(route, body, cookie) {
  const response = await fetch(base + route, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  });
  return { response, data: await response.json() };
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const result = await request('/api/health'); if (result.data.database === 'ready') { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Isolated test server failed to become ready');
  const signup = await request('/api/auth/signup', { name: 'Synthetic Recovery QA', email, password: 'InitialSynthetic123!', role: 'professional' });
  assert.equal(signup.response.status, 201);
  const cookie = signup.response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie);
  assert.equal((await request('/api/auth/password-reset/request', { email })).response.status, 202);
  socket = tls.connect({ host: 'imap.ethereal.email', port: 993, servername: 'imap.ethereal.email', rejectUnauthorized: true });
  socket.setEncoding('utf8');
  socket.setTimeout(15000, () => socket.destroy(new Error('Mailbox timeout')));
  let buffer = '', failure, wake;
  socket.on('data', chunk => { buffer += chunk; wake?.(); });
  socket.on('error', error => { failure = error; wake?.(); });
  async function until(predicate) {
    while (!predicate(buffer)) { if (failure) throw failure; await new Promise(resolve => { wake = resolve; }); }
    wake = undefined; const value = buffer; buffer = ''; return value;
  }
  await until(value => value.includes('\r\n'));
  let index = 0;
  async function command(value) {
    const tag = `qa${++index}`; socket.write(`${tag} ${value}\r\n`);
    const result = await until(text => new RegExp(`(?:^|\\r\\n)${tag} (?:OK|NO|BAD)[^\\r]*\\r\\n`).test(text));
    assert(new RegExp(`${tag} OK`).test(result), 'Mailbox command failed'); return result;
  }
  await command(`LOGIN ${JSON.stringify(user)} ${JSON.stringify(pass)}`);
  await command('SELECT INBOX');
  const found = await command(`UID SEARCH HEADER TO ${JSON.stringify(email)}`);
  const id = found.match(/\* SEARCH (\d+)/)?.[1]; assert(id, 'No captured recovery message');
  const raw = await command(`UID FETCH ${id} BODY.PEEK[]`);
  const decoded = raw.replace(/=\r\n/g, '').replace(/=([A-F0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const token = decoded.match(/#password-reset=([A-Za-z0-9_-]{32,})/)?.[1]; assert(token, 'No recovery link in captured message');
  assert(decoded.includes('30 minutes'));
  console.log('PASS: Isolated signup, reset request, SMTP capture and authenticated mailbox retrieval.');
  assert.equal((await request('/api/auth/password-reset/confirm', { token, newPassword: 'short' })).response.status, 400);
  assert.equal((await request('/api/auth/password-reset/confirm', { token, newPassword: 'ResetSynthetic123!' })).response.status, 200);
  assert.equal((await request('/api/auth/me', undefined, cookie)).response.status, 401);
  assert.equal((await request('/api/auth/login', { email, password: 'InitialSynthetic123!' })).response.status, 401);
  assert.equal((await request('/api/auth/login', { email, password: 'ResetSynthetic123!' })).response.status, 200);
  assert.equal((await request('/api/auth/password-reset/confirm', { token, newPassword: 'AnotherSynthetic123!' })).response.status, 400);
  console.log('PASS: Short-password rejection, reset completion, session revocation, old-password rejection, new login and token-reuse rejection.');
} catch {
  console.error('FAIL: Isolated recovery acceptance failed; credentials, tokens, message body and server output suppressed.');
  process.exitCode = 1;
} finally {
  socket?.destroy();
  child.kill();
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert(path.basename(directory).startsWith('cg-captured-recovery-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
