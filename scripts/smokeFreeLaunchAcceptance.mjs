import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

const port = 3137;
const db = '/tmp/conferencegate-free-launch-acceptance-' + process.pid + '.db';
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), TEST_DATABASE_PATH: db, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', c => { output += String(c); });
child.stderr.on('data', c => { output += String(c); });
const base = 'http://127.0.0.1:' + port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
try {
  let healthy = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + output);
    try {
      const { response, data } = await request('/api/health');
      if (response.ok && data.status === 'ok' && data.database === 'ready') { healthy = true; break; }
    } catch {}
    await sleep(300);
  }
  assert(healthy, 'Server health timeout: ' + output);
  const email = 'free-acceptance-' + crypto.randomUUID() + '@example.invalid';
  const signup = await request('/api/auth/signup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'professional', name: 'Free Launch Acceptance', email, password: 'FreeAcceptance123!', organization: 'Independent Research' }),
  });
  assert(signup.response.status === 201 && signup.data.user?.role === 'professional', 'Free professional signup failed: ' + JSON.stringify(signup.data));
  const cookie = signup.response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'Signup missing session cookie');
  const headers = { cookie, 'content-type': 'application/json' };
  const settings = await request('/api/auth/me/account-settings', { headers });
  assert(settings.response.ok, 'Account settings failed');
  const prefs = await request('/api/auth/me/professional-preferences', {
    method: 'PATCH', headers,
    body: JSON.stringify({ professionalExpertise: ['Geochemistry'], technicalSpecialization: ['GC-MS'], researchInterests: ['Source rocks'], preferredRegions: ['Middle East'], committeeAvailable: true, sessionChairAvailable: true, speakerAvailable: true, reviewerMaxLoad: 3 }),
  });
  assert(prefs.response.ok && prefs.data.user?.committeeAvailable === true, 'Professional preferences failed: ' + JSON.stringify(prefs.data));
  const cert = await request('/api/certificates/issue/abstract/nonexistent-submission', { method: 'POST', headers });
  assert(cert.response.status === 404, 'Unowned abstract certificate must be rejected');
  const invalid = await request('/api/certificates/verify/not-a-certificate');
  assert(invalid.response.status === 400 && invalid.data.valid === false, 'Malformed certificate accepted');
  const missing = await request('/api/certificates/verify/CG-AA-00000000000000000000000000000000');
  assert(missing.response.status === 404 && missing.data.valid === false, 'Unknown certificate accepted');
  console.log('PASS: free signup, authenticated settings, profile persistence, certificate authorization and verification safeguards');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), sleep(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) { try { fs.rmSync(db + suffix, { force: true }); } catch {} }
}
