import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.GROWTH_AUTOMATION_SMOKE_PORT || 3120);
const dbPath = process.env.GROWTH_AUTOMATION_SMOKE_DB || '/tmp/conferencegate-growth-automation-smoke.db';
const billingSecret = 'growth-automation-billing-secret';
const adminToken = 'growth-automation-admin-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
}

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    TEST_DATABASE_PATH: dbPath,
    DATABASE_PATH: dbPath,
    TURSO_DATABASE_URL: '',
    TURSO_AUTH_TOKEN: '',
    BILLING_SYNC_SECRET: billingSecret,
    DISCOVERY_ADMIN_TOKEN: adminToken,
    BILLING_CHECKOUT_PROVIDER: 'hosted',
    ORGANIZER_CHECKOUT_URL: 'https://checkout.example.test/organizer',
    SPONSOR_CHECKOUT_URL: 'https://checkout.example.test/sponsor',
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
      throw new Error('Server exited early.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr);
    }
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('Timed out waiting for server health.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr);
}

async function request(path, { method = 'GET', cookie, body, admin = false, billing = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (admin) headers['x-discovery-admin-token'] = adminToken;
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function ok(path, options = {}) {
  const result = await request(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || 'GET'} ${path}: ${result.response.status} ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function signup(role, email, name) {
  const result = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      role,
      name,
      email,
      password: 'GrowthAutomation123!',
      organization: role === 'organizer' ? 'Phase 9 Events' : 'Phase 9 Brand',
    },
  });
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  if (!result.response.ok || !result.data?.user?.id || !cookie) {
    throw new Error(`Signup failed: ${result.response.status} ${JSON.stringify(result.data)}`);
  }
  return { user: result.data.user, cookie };
}

async function activate(account, role) {
  await ok('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'growth-automation-smoke',
      eventId: `activate_${role}_${account.user.id}`,
      eventType: 'subscription.activated',
      userId: account.user.id,
      status: 'active',
      plan: `${role}_pro_growth_automation`,
      customerRef: `growth_automation_${role}_${account.user.id}`,
      periodEnd: '2027-09-26T00:00:00Z',
    },
  });
}

const db = createClient({ url: 'file:' + dbPath });

try {
  await waitForHealth();

  // Private surface must remain private.
  const unauth = await request('/api/admin/discovery/growth-automation', { admin: true });
  if (unauth.response.status !== 401) {
    throw new Error(`Growth automation must require a signed-in session; got ${unauth.response.status}`);
  }

  const operator = await signup('organizer', 'phase9-operator@example.com', 'Phase 9 Operator');

  const withoutToken = await request('/api/admin/discovery/growth-automation', { cookie: operator.cookie });
  if (withoutToken.response.status !== 403) {
    throw new Error(`Growth automation must require the admin token; got ${withoutToken.response.status}`);
  }

  const leadEmail = 'phase9-sponsor-lead@example.com';
  const leadCreate = await ok('/api/admin/discovery/growth-leads', {
    method: 'POST',
    cookie: operator.cookie,
    admin: true,
    body: {
      role: 'sponsor',
      organization: 'Phase 9 Sponsor Lead',
      contactName: 'Sponsor Lead',
      email: leadEmail,
      source: 'linkedin',
      campaign: 'phase9-launch',
      score: 68,
      nextAction: 'Send launch invitation',
      nextActionAt: '2026-09-25T10:00:00Z',
    },
  });
  const leadId = leadCreate?.lead?.id;
  if (!leadId || leadCreate?.growthAutomation?.sponsor?.total !== 1) {
    throw new Error('Could not create Sponsor growth lead: ' + JSON.stringify(leadCreate));
  }

  const initial = await ok('/api/admin/discovery/growth-automation', {
    cookie: operator.cookie,
    admin: true,
  });
  if (initial?.growthAutomation?.overdueFollowUps !== 1) {
    throw new Error('Overdue follow-up was not detected: ' + JSON.stringify(initial));
  }

  const outreach = await ok(`/api/admin/discovery/growth-leads/${leadId}/outreach`, {
    method: 'POST',
    cookie: operator.cookie,
    admin: true,
    body: {
      channel: 'linkedin',
      eventType: 'manual_touch',
      note: 'Sent initial ConferenceGate launch introduction.',
    },
  });
  const touchedLead = outreach?.growthAutomation?.leads?.find((item) => item.id === leadId);
  if (!touchedLead || Number(touchedLead.outreach_count || 0) !== 1 || !touchedLead.last_outreach_at) {
    throw new Error('Outreach touch was not logged: ' + JSON.stringify(outreach));
  }

  const referral = await ok('/api/admin/discovery/growth-referrals', {
    method: 'POST',
    cookie: operator.cookie,
    admin: true,
    body: {
      roleTarget: 'sponsor',
      label: 'Phase 9 sponsor launch',
    },
  });
  const referralCode = referral?.referral?.code;
  if (!referralCode) {
    throw new Error('Referral code was not created: ' + JSON.stringify(referral));
  }

  const sponsor = await signup('sponsor', leadEmail, 'Phase 9 Sponsor Customer');

  const acquisition = await ok('/api/workspaces/acquisition', {
    method: 'POST',
    cookie: sponsor.cookie,
    body: {
      source: 'referral',
      medium: 'direct_outreach',
      campaign: 'phase9-launch',
      referralCode,
      landingPath: '/?ref=' + referralCode,
    },
  });
  if (acquisition?.acquisition?.referralCode !== referralCode) {
    throw new Error('Referral first-touch attribution was not saved: ' + JSON.stringify(acquisition));
  }

  const afterSignup = await ok('/api/admin/discovery/growth-automation', {
    cookie: operator.cookie,
    admin: true,
  });
  const convertedLead = afterSignup?.growthAutomation?.leads?.find((item) => item.id === leadId);
  const referralRow = afterSignup?.growthAutomation?.referrals?.find((item) => item.code === referralCode);
  if (
    !convertedLead ||
    convertedLead.stage !== 'signup' ||
    convertedLead.converted_user_id !== sponsor.user.id ||
    Number(referralRow?.conversions || 0) !== 1
  ) {
    throw new Error('Lead/referral conversion was not captured: ' + JSON.stringify(afterSignup));
  }

  await activate(sponsor, 'sponsor');

  const afterPaid = await ok('/api/admin/discovery/growth-automation', {
    cookie: operator.cookie,
    admin: true,
  });
  const paidLead = afterPaid?.growthAutomation?.leads?.find((item) => item.id === leadId);
  if (!paidLead || paidLead.stage !== 'paid') {
    throw new Error('Real subscription state did not auto-advance lead to paid: ' + JSON.stringify(afterPaid));
  }

  // Create real Organizer inventory and Sponsor inquiry so liquidity metrics are grounded in app activity.
  await activate(operator, 'organizer');
  await ok('/api/activity/conferences', {
    method: 'POST',
    cookie: operator.cookie,
    body: {
      id: 'conf_phase9_growth_2027',
      title: 'Phase 9 Growth Conference 2027',
      dates: { start: '2027-04-10', end: '2027-04-12' },
      location: { city: 'Test City', country: 'Test Country' },
    },
  });

  const need = await ok('/api/sponsors/needs', {
    method: 'POST',
    cookie: operator.cookie,
    body: {
      conferenceId: 'conf_phase9_growth_2027',
      title: 'Phase 9 Technical Sponsorship',
      description: 'Launch-cohort sponsorship inventory.',
      categories: ['Engineering'],
      targetSectors: ['Engineering'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      priceOnRequest: true,
      totalSlots: 2,
      benefits: ['Technical audience visibility'],
    },
  });
  const needId = need?.need?.id;
  if (!needId) throw new Error('Could not create Phase 9 sponsorship inventory.');

  await ok('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie: sponsor.cookie,
    body: {
      sectors: ['Engineering'],
      categories: ['Engineering'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      budgetMin: 1000,
      budgetMax: 10000,
      alertFrequency: 'instant',
    },
  });

  await ok(`/api/sponsors/needs/${needId}/inquiries`, {
    method: 'POST',
    cookie: sponsor.cookie,
    body: { message: 'Interested in this Phase 9 opportunity.' },
  });

  const targetUpdate = await ok('/api/admin/discovery/growth-targets/sponsor_pipeline', {
    method: 'PATCH',
    cookie: operator.cookie,
    admin: true,
    body: { targetValue: 25 },
  });
  if (Number(targetUpdate?.target?.target_value) !== 25) {
    throw new Error('Growth target update was not persisted: ' + JSON.stringify(targetUpdate));
  }

  const dashboard = await ok('/api/admin/discovery/growth-dashboard', {
    cookie: operator.cookie,
    admin: true,
  });
  const ga = dashboard?.dashboard?.growthAutomation;
  if (
    !ga ||
    ga.sponsor?.paid !== 1 ||
    ga.liquidity?.activeInventory !== 1 ||
    ga.liquidity?.inquiryCoveragePct !== 100 ||
    ga.liquidity?.targets?.sponsorPipeline !== 25
  ) {
    throw new Error('Phase 9 dashboard state is incorrect: ' + JSON.stringify(ga));
  }

  const row = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM growth_referral_conversions",
    args: [],
  });
  if (Number(row.rows?.[0]?.count || 0) !== 1) {
    throw new Error('Referral conversion was not durably stored.');
  }

  console.log(JSON.stringify({
    growthAutomationSmoke: 'passed',
    phase91: { organizerSponsorLeadPipelines: true },
    phase92: { explicitCampaignTracking: true, leadAutoConversion: true },
    phase93: { referralLoop: true, conversions: 1 },
    phase94: { liquidityTargets: true, activeInventory: ga.liquidity.activeInventory, inquiryCoveragePct: ga.liquidity.inquiryCoveragePct },
    phase95: { outreachTracking: true, overdueFollowUps: ga.overdueFollowUps },
    security: { sessionRequired: true, adminTokenRequired: true },
  }));
} finally {
  db.close();
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
