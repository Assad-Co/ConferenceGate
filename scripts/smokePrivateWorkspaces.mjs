import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';
const port = 3147;
const dbPath = '/tmp/cg-private-workspaces-' + process.pid + '.db';
const ownerEmail = 'private-owner@example.invalid';
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), TEST_DATABASE_PATH: dbPath, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', PRIVATE_WORKSPACES_ONLY: 'true', FREE_LAUNCH_ORGANIZER_ACCESS: 'true', FREE_LAUNCH_SPONSOR_ACCESS: 'true', OWNER_PREVIEW_EMAIL_SHA256: crypto.createHash('sha256').update(ownerEmail).digest('hex') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', c => output += c);
child.stderr.on('data', c => output += c);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function req(path, { method = 'GET', cookie, body, expected = 200 } = {}) {
  const response = await fetch('http://127.0.0.1:' + port + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (response.status !== expected) throw Error(path + ': ' + response.status + ' ' + JSON.stringify(data));
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function check(value, message) { if (!value) throw Error(message); }
async function signup(email) {
  return req('/api/auth/signup', { method: 'POST', body: { role: 'professional', email, password: 'PrivateAcceptance123!', name: 'Private access acceptance' }, expected: 201 });
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(output);
    try { const h = await req('/api/health'); if (h.data.database === 'ready') { ready = true; break; } } catch {}
    await sleep(250);
  }
  check(ready, 'Server startup failed: ' + output);
  const caps = await req('/api/auth/capabilities');
  check(caps.data.privateWorkspacesOnly === true, 'Public capabilities must announce private workspaces');
  for (const role of ['organizer', 'sponsor']) {
    await req('/api/auth/signup', { method: 'POST', body: { role, email: role + '@example.invalid', password: 'PrivateAcceptance123!', name: 'Blocked public signup' }, expected: 403 });
  }
  const owner = await signup(ownerEmail);
  const normal = await signup('private-normal@example.invalid');
  check(owner.data.user.ownerPreview === true && owner.data.user.hasPaidAccess === true, 'Owner must retain authenticated admin preview');
  check(!normal.data.user.ownerPreview && normal.data.user.hasPaidAccess, 'Professional access must remain open');
  await req('/api/sponsors/preferences/mine', { cookie: normal.cookie, expected: 403 });
  await req('/api/activity/conferences', { method: 'POST', cookie: normal.cookie, body: { id: 'forbidden', title: 'Must stay blocked', dates: {}, location: {} }, expected: 403 });
  await req('/api/sponsors/preferences/mine', { cookie: owner.cookie });
  await req('/api/activity/conferences', { method: 'POST', cookie: owner.cookie, body: { id: 'private-owner-conference', title: 'Owner private conference', industry: 'Energy', dates: { start: '2027-05-10', end: '2027-05-11' }, location: { city: 'Manama', country: 'Bahrain' }, topics: [], tracks: [], format: 'Physical', cfpStatus: 'Closed' }, expected: 201 });
  const fixture = createClient({ url: 'file:' + dbPath });
  try {
    for (const role of ['organizer', 'sponsor']) {
      await fixture.execute({ sql: "UPDATE users SET role=?,subscription_status='active' WHERE id=?", args: [role, normal.data.user.id] });
      const login = await req('/api/auth/login', { method: 'POST', body: { email: 'private-normal@example.invalid', password: 'PrivateAcceptance123!' } });
      check(login.data.user.workspaceAccessRestricted === true && login.data.user.hasPaidAccess === false, 'Existing paid ' + role + ' must be restricted');
      await req('/api/auth/me', { cookie: normal.cookie, expected: 403 });
      await req('/api/sponsors/preferences/mine', { cookie: normal.cookie, expected: 403 });
      await req('/api/workspaces/mine', { cookie: normal.cookie, expected: 403 });
    }
  } finally { fixture.close(); }
  await req('/api/sponsors/preferences/mine', { cookie: owner.cookie });
  check((await req('/api/auth/me', { cookie: owner.cookie })).data.user.ownerPreview, 'Owner access must survive other-role checks');
  console.log('PASS: owner Organizer/Sponsor access preserved; public role signup, existing paid accounts, and direct API requests blocked; Professional remains open');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) { try { fs.rmSync(dbPath + suffix, { force: true }); } catch {} }
}
