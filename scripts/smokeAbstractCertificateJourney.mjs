import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

const port = 3141;
const db = '/tmp/cg-abstract-certificate-' + process.pid + '.db';
const secret = crypto.randomUUID();
const child = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(port), TEST_DATABASE_PATH: db, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', BILLING_SYNC_SECRET: secret }, stdio: ['ignore','pipe','pipe'] });
let log = '';
child.stdout.on('data', c => log += String(c));
child.stderr.on('data', c => log += String(c));
const base = 'http://127.0.0.1:' + port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(path, { method = 'GET', cookie, body, expected } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(path.includes('provider-sync') ? { 'x-billing-sync-secret': secret } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (expected ? response.status !== expected : !response.ok) throw new Error(method + ' ' + path + ': ' + response.status + ' ' + JSON.stringify(data));
  return { data, response };
}
async function signup(role) {
  const email = role + '-' + crypto.randomUUID() + '@example.invalid';
  const { data, response } = await req('/api/auth/signup', { method: 'POST', body: { role, email, name: role + ' acceptance', password: 'Acceptance123!', organization: 'Integration Test' }, expected: 201 });
  if (!data.user?.id) throw Error('Signup missing user');
  return { ...data.user, cookie: response.headers.get('set-cookie')?.split(';')[0], email };
}
function check(value, message) { if (!value) throw Error(message); }
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error('Server terminated: ' + log);
    try { const x = await req('/api/health'); if (x.data.database === 'ready') { ready = true; break; } } catch {}
    await sleep(250);
  }
  check(ready, 'Server health timeout: ' + log);
  const author = await signup('professional');
  const reviewer = await signup('professional');
  const organizer = await signup('organizer');
  await req('/api/billing/provider-sync', { method: 'POST', body: { provider: 'acceptance-test', eventId: crypto.randomUUID(), eventType: 'subscription.activated', userId: organizer.id, status: 'active', plan: 'organizer_pro_smoke', customerRef: 'local-' + organizer.id } });
  const conferenceId = 'conf_acceptance_' + crypto.randomUUID();
  const title = 'Isolated Acceptance Conference';
  const created = await req('/api/activity/conferences', { method: 'POST', cookie: organizer.cookie, body: { id: conferenceId, title, description: 'Automated acceptance only', industry: 'Energy', topics: ['Geochemistry'], tracks: ['Geochemistry'], dates: { start: '2027-05-10', end: '2027-05-12' }, location: { city: 'Manama', country: 'Bahrain' }, format: 'Physical', cfpStatus: 'Open' } });
  check(created.data.conference?.id === conferenceId, 'Conference not created');
  const submission = await req('/api/activity/submissions', { method: 'POST', cookie: author.cookie, body: { conferenceId, conferenceTitle: title, title: 'Geochemistry Abstract', abstractText: 'Synthetic scientific abstract for isolated integration acceptance.', preferredType: 'Oral', primaryAuthor: { name: author.name, email: author.email, affiliation: 'Integration Test' } } });
  const id = submission.data.submission?.id;
  check(id, 'Abstract not persisted');
  await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: author.cookie, expected: 409 });
  await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: reviewer.cookie, expected: 404 });
  const assigned = await req('/api/activity/submissions/' + id + '/assign-reviewer', { method: 'POST', cookie: organizer.cookie, body: { reviewerId: reviewer.id } });
  check(assigned.data.submission?.id === id, 'Reviewer assignment not persisted');
  await req('/api/activity/submissions/' + id + '/reviews', { method: 'POST', cookie: author.cookie, body: { commentsToAuthor: 'Self approval', recommendation: 'Accept' }, expected: 403 });
  const reviewed = await req('/api/activity/submissions/' + id + '/reviews', { method: 'POST', cookie: reviewer.cookie, body: { commentsToAuthor: 'Accepted after peer review', recommendation: 'Accept', scores: { quality: 5 } }, expected: 201 });
  check(reviewed.data.submission?.status === 'Accepted', 'Review did not approve abstract');
  const issued = await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: author.cookie, expected: 201 });
  const certificate = issued.data.certificate;
  check(/^CG-AA-[A-F0-9]{32}$/.test(certificate?.id || ''), 'Certificate ID invalid');
  const verified = await req('/api/certificates/verify/' + certificate.id);
  check(verified.data.valid === true && verified.data.certificate?.recipientName === author.name, 'Certificate verification failed');
  const repeat = await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: author.cookie });
  check(repeat.data.certificate?.id === certificate.id, 'Certificate issuance not idempotent');
  console.log('PASS: conference, abstract, reviewer assignment, acceptance, authorized issuance, public verification, idempotency and cross-user isolation');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), sleep(2000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) try { fs.rmSync(db + suffix, { force: true }); } catch {}
}
