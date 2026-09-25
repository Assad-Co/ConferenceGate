import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@libsql/client';

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

  // Simulate the exact post-migration situation: a current owner account exists, while an older
  // Professional profile remains under a legacy user id in the same database.
  const initialRecoveryStatus = await jsonRequest('/api/linkedin-profile/recovery-status', {
    cookie: owner.cookie,
  });
  if (!initialRecoveryStatus.response.ok) {
    throw new Error(
      `Owner recovery status failed before fixture setup: ${initialRecoveryStatus.response.status} ${JSON.stringify(initialRecoveryStatus.data)}`
    );
  }

  const fixtureDb = createClient({ url: 'file:' + dbPath });
  const legacyUserId = 'legacy_professional_owner_preview_smoke';
  const legacyAvatar = 'https://example.test/legacy-professional-photo.jpg';
  try {
    await fixtureDb.execute({
      sql: `INSERT INTO users(id,email,role,name,avatar,linkedin_url)
            VALUES(?,?,'professional',?,?,?)`,
      args: [
        legacyUserId,
        'legacy-professional-owner-preview@example.com',
        'Owner Preview Smoke',
        legacyAvatar,
        'https://www.linkedin.com/in/owner-preview-smoke',
      ],
    });
    await fixtureDb.execute({
      sql: `INSERT INTO linkedin_profile_enrichment(
              user_id,linkedin_url,linkedin_id,public_identifier,full_name,
              headline,about,location_text,city,country,photo_url,verified,
              experience,education,publications,patents,certifications,projects,
              skills,honors_awards,languages,raw_profile,source_actor,consented_at,fetched_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        legacyUserId,
        'https://www.linkedin.com/in/owner-preview-smoke',
        'legacy-linkedin-id',
        'owner-preview-smoke',
        'Owner Preview Smoke',
        'Legacy Petroleum Geochemist',
        'Legacy Professional profile biography',
        'Dhahran, Saudi Arabia',
        'Dhahran',
        'Saudi Arabia',
        legacyAvatar,
        1,
        JSON.stringify([{ position: 'Petroleum Geochemist', companyName: 'Legacy Energy Co.' }]),
        JSON.stringify([{ schoolName: 'Legacy University', degreeName: 'PhD' }]),
        JSON.stringify([{ title: 'Legacy Professional Publication', date: '2025' }]),
        JSON.stringify([{ title: 'Legacy Professional Patent', patentNumber: 'LEGACY-001' }]),
        '[]',
        '[]',
        JSON.stringify(['Organic Geochemistry']),
        '[]',
        '[]',
        JSON.stringify({ source: 'legacy-owner-preview-smoke' }),
        'legacy-test-fixture',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z',
      ],
    });
    await fixtureDb.execute({
      sql: `INSERT INTO external_paper_matches(
              id,user_id,doi,title,venue,year,url,status
            ) VALUES(?,?,?,?,?,?,?,'confirmed')`,
      args: [
        'legacy-paper-owner-preview-smoke',
        legacyUserId,
        '10.0000/legacy.owner.preview',
        'Legacy Confirmed Conference Paper',
        'Legacy Conference',
        '2025',
        'https://example.test/legacy-paper',
      ],
    });
  } finally {
    fixtureDb.close();
  }

  const recoveryStatus = await jsonRequest('/api/linkedin-profile/recovery-status', {
    cookie: owner.cookie,
  });
  if (
    !recoveryStatus.response.ok ||
    recoveryStatus.data?.localLegacy?.recoverable !== true ||
    recoveryStatus.data?.localLegacy?.candidateCount !== 1
  ) {
    throw new Error(
      `Owner legacy Professional profile was not detected: ${recoveryStatus.response.status} ${JSON.stringify(recoveryStatus.data)}`
    );
  }

  const recovery = await jsonRequest('/api/linkedin-profile/recover-local', {
    method: 'POST',
    cookie: owner.cookie,
    body: { confirm: true },
  });
  if (
    !recovery.response.ok ||
    recovery.data?.restored !== true ||
    recovery.data?.profile?.publications?.[0]?.title !== 'Legacy Professional Publication'
  ) {
    throw new Error(
      `Owner legacy Professional profile was not restored: ${recovery.response.status} ${JSON.stringify(recovery.data)}`
    );
  }

  const ownerAfterRecovery = await jsonRequest('/api/auth/me', { cookie: owner.cookie });
  if (
    !ownerAfterRecovery.response.ok ||
    ownerAfterRecovery.data?.user?.role !== 'professional' ||
    ownerAfterRecovery.data?.user?.ownerPreview !== true ||
    ownerAfterRecovery.data?.user?.avatar !== legacyAvatar
  ) {
    throw new Error(
      'Professional recovery did not restore the original primary identity or avatar: ' +
        JSON.stringify(ownerAfterRecovery.data)
    );
  }

  const restoredPapersDb = createClient({ url: 'file:' + dbPath });
  try {
    const restoredPaper = await restoredPapersDb.execute({
      sql: `SELECT user_id,title FROM external_paper_matches
             WHERE doi='10.0000/legacy.owner.preview' AND user_id=?`,
      args: [owner.data.user.id],
    });
    if (!restoredPaper.rows?.length) {
      throw new Error('Confirmed legacy Professional publication evidence was not attached to current owner id.');
    }
  } finally {
    restoredPapersDb.close();
  }

  const sponsorPreferences = await jsonRequest('/api/sponsors/preferences/mine', { cookie: owner.cookie });
  if (!sponsorPreferences.response.ok) {
    throw new Error(
      `Owner preview could not open Sponsor Pro API: ${sponsorPreferences.response.status} ${JSON.stringify(sponsorPreferences.data)}`
    );
  }

  const professionalPreferences = await jsonRequest('/api/auth/me/professional-preferences', {
    method: 'PATCH',
    cookie: owner.cookie,
    body: {
      professionalExpertise: ['Petroleum Geochemistry'],
      technicalSpecialization: ['Organic Geochemistry'],
      researchInterests: ['Source rock evaluation'],
      preferredRegions: ['Middle East'],
      committeeAvailable: true,
      sessionChairAvailable: true,
      speakerAvailable: true,
      reviewerMaxLoad: 5,
    },
  });
  if (
    !professionalPreferences.response.ok ||
    !professionalPreferences.data?.user?.ownerPreview ||
    !professionalPreferences.data?.user?.professionalExpertise?.includes('Petroleum Geochemistry')
  ) {
    throw new Error(
      `Owner preview could not use Professional profile APIs: ${professionalPreferences.response.status} ${JSON.stringify(professionalPreferences.data)}`
    );
  }

  const professionalOpportunities = await jsonRequest('/api/activity/professional-opportunities', {
    cookie: owner.cookie,
  });
  if (!professionalOpportunities.response.ok || !Array.isArray(professionalOpportunities.data?.opportunities)) {
    throw new Error(
      `Owner preview could not open Professional opportunities: ${professionalOpportunities.response.status} ${JSON.stringify(professionalOpportunities.data)}`
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
      professionalContextReadable: true,
      professionalPreferencesWritable: true,
      originalProfessionalRoleRestored: true,
      legacyProfessionalProfileRecovered: true,
      legacyAvatarRestored: true,
      legacyPublicationEvidenceRecovered: true,
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
