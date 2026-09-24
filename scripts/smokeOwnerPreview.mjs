import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const port = Number(process.env.OWNER_PREVIEW_SMOKE_PORT || 3117);
const dbPath = process.env.OWNER_PREVIEW_SMOKE_DB || '/tmp/conferencegate-owner-preview-smoke.db';
const ownerEmail = 'owner-preview-smoke@example.com';
const ownerPreviewHash = crypto.createHash('sha256').update(ownerEmail).digest('hex');

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
}

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    TEST_DATABASE_PATH: dbPath,
    OWNER_PREVIEW_EMAIL_SHA256: ownerPreviewHash,
    TURSO_DATABASE_URL: '',
    TURSO_AUTH_TOKEN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for server health.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

async function jsonRequest(path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || null };
}

async function signup(email, name) {
  const result = await jsonRequest('/api/auth/signup', {
    method: 'POST',
    body: {
      role: 'organizer',
      name,
      email,
      password: 'OwnerPreview123!',
      organization: name + ' Events',
    },
  });
  if (!result.response.ok || !result.data?.user?.id || !result.cookie) {
    throw new Error(`Signup failed for ${email}: ${result.response.status} ${JSON.stringify(result.data)}`);
  }
  return result;
}

try {
  await waitForHealth();

  const missingOwner = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: { email: ownerEmail, password: 'NotUsedBeforeSignup123!' },
  });
  if (
    missingOwner.response.status !== 409 ||
    missingOwner.data?.code !== 'OWNER_ACCOUNT_NOT_INITIALIZED'
  ) {
    throw new Error(
      'Missing owner account must be identified for secure onboarding: ' +
        missingOwner.response.status +
        ' ' +
        JSON.stringify(missingOwner.data)
    );
  }

  const owner = await signup(ownerEmail, 'Owner Preview Smoke');
  if (!owner.data.user.ownerPreview || !owner.data.user.hasPaidAccess) {
    throw new Error('Owner preview account did not receive preview access: ' + JSON.stringify(owner.data.user));
  }
  if (owner.data.user.subscriptionStatus !== 'owner_preview') {
    throw new Error('Owner preview subscription label is incorrect: ' + JSON.stringify(owner.data.user));
  }

  const sponsorPreferences = await jsonRequest('/api/sponsors/preferences/mine', { cookie: owner.cookie });
  if (!sponsorPreferences.response.ok) {
    throw new Error(
      `Owner preview could not open Sponsor Pro API: ${sponsorPreferences.response.status} ${JSON.stringify(sponsorPreferences.data)}`
    );
  }

  const billingStatus = await jsonRequest('/api/billing/status', { cookie: owner.cookie });
  if (!billingStatus.response.ok || billingStatus.data?.hasPaidAccess !== true) {
    throw new Error('Owner preview billing access state is incorrect: ' + JSON.stringify(billingStatus.data));
  }

  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: { email: ownerEmail, password: 'OwnerPreview123!' },
  });
  if (!login.response.ok || login.data?.user?.ownerPreview !== true || login.data?.user?.hasPaidAccess !== true) {
    throw new Error('Owner preview login did not preserve access: ' + JSON.stringify(login.data));
  }

  const normal = await signup('normal-organizer-smoke@example.com', 'Normal Organizer Smoke');
  if (normal.data.user.ownerPreview || normal.data.user.hasPaidAccess) {
    throw new Error('Normal unpaid organizer incorrectly received owner preview access: ' + JSON.stringify(normal.data.user));
  }
  const normalSponsorAccess = await jsonRequest('/api/sponsors/preferences/mine', { cookie: normal.cookie });
  if (normalSponsorAccess.response.status !== 403) {
    throw new Error(
      `Normal organizer must not gain Sponsor Pro access; got ${normalSponsorAccess.response.status} ${JSON.stringify(normalSponsorAccess.data)}`
    );
  }

  console.log(JSON.stringify({
    ownerPreviewSmoke: 'passed',
    owner: {
      authenticated: true,
      ownerPreview: true,
      sponsorApiReadable: true,
      hasPaidAccess: true,
      subscriptionStatus: owner.data.user.subscriptionStatus,
    },
    normalAccountIsolation: true,
  }));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
  }
}
