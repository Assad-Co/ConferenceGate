import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.GROWTH_DASHBOARD_SMOKE_PORT || 3116);
const dbPath = process.env.GROWTH_DASHBOARD_SMOKE_DB || '/tmp/conferencegate-growth-dashboard-smoke.db';
const billingSecret = 'growth-dashboard-billing-secret';
const adminToken = 'growth-dashboard-admin-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
}

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    TEST_DATABASE_PATH: dbPath,
    BILLING_SYNC_SECRET: billingSecret,
    DISCOVERY_ADMIN_TOKEN: adminToken,
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

async function signupOrganizer() {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'organizer',
      name: 'Dashboard Smoke Organizer',
      email: 'growth-dashboard-smoke@example.com',
      password: 'GrowthDashboard123!',
      organization: 'Dashboard Smoke Events',
    }),
  });
  const body = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !body?.user?.id || !cookie) {
    throw new Error(`Organizer signup failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return { user: body.user, cookie };
}

async function jsonRequest(path, { method = 'GET', cookie, body, token, billing = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (token) headers['x-discovery-admin-token'] = token;
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

try {
  await waitForHealth();

  const pageResponse = await fetch(base + '/growth.html');
  const pageHtml = await pageResponse.text();
  if (!pageResponse.ok || !pageHtml.includes('Growth Operations') || !pageHtml.includes('/api/admin/discovery/growth-dashboard')) {
    throw new Error(`Built server did not serve the private growth dashboard page correctly: ${pageResponse.status}`);
  }

  const unauth = await jsonRequest('/api/admin/discovery/growth-dashboard', { token: adminToken });
  if (unauth.response.status !== 401) {
    throw new Error(`Dashboard must require a signed-in session; got ${unauth.response.status}`);
  }

  const organizer = await signupOrganizer();

  const withoutToken = await jsonRequest('/api/admin/discovery/growth-dashboard', { cookie: organizer.cookie });
  if (withoutToken.response.status !== 403) {
    throw new Error(`Dashboard must require admin token; got ${withoutToken.response.status}`);
  }

  const badToken = await jsonRequest('/api/admin/discovery/growth-dashboard', {
    cookie: organizer.cookie,
    token: 'not-the-admin-token',
  });
  if (badToken.response.status !== 403) {
    throw new Error(`Dashboard must reject invalid admin token; got ${badToken.response.status}`);
  }

  const activation = await jsonRequest('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'dashboard-smoke',
      eventId: 'dashboard_smoke_activate_1',
      eventType: 'subscription.activated',
      userId: organizer.user.id,
      status: 'active',
      plan: 'organizer_pro_dashboard_smoke',
      customerRef: 'dashboard_smoke_customer',
    },
  });
  if (!activation.response.ok) {
    throw new Error(`Could not activate organizer: ${activation.response.status} ${JSON.stringify(activation.data)}`);
  }

  const workspace = await jsonRequest('/api/workspaces/mine', { cookie: organizer.cookie });
  if (!workspace.response.ok || !workspace.data?.workspace?.id) {
    throw new Error(`Could not create paid workspace: ${workspace.response.status} ${JSON.stringify(workspace.data)}`);
  }

  const conference = await jsonRequest('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      id: 'conf_growth_dashboard_smoke',
      title: 'Growth Dashboard Smoke Conference',
      dates: { start: '2027-05-10', end: '2027-05-11' },
      location: { city: 'Test City', country: 'Test Country' },
    },
  });
  if (!conference.response.ok) {
    throw new Error(`Could not create conference: ${conference.response.status} ${JSON.stringify(conference.data)}`);
  }

  const allowed = await jsonRequest('/api/admin/discovery/growth-dashboard', {
    cookie: organizer.cookie,
    token: adminToken,
  });
  if (!allowed.response.ok) {
    throw new Error(`Authorized dashboard failed: ${allowed.response.status} ${JSON.stringify(allowed.data)}`);
  }

  const dashboard = allowed.data?.dashboard;
  if (!dashboard || dashboard.deployment?.database !== 'ready') {
    throw new Error('Dashboard deployment readiness is missing: ' + JSON.stringify(dashboard?.deployment));
  }
  if (dashboard.organizer?.signups !== 1 || dashboard.organizer?.paid !== 1 || dashboard.organizer?.activated !== 1) {
    throw new Error('Organizer dashboard funnel is incorrect: ' + JSON.stringify(dashboard?.organizer));
  }
  if (dashboard.retention?.organizer?.paidWorkspaces !== 1) {
    throw new Error('Paid workspace retention summary is incorrect: ' + JSON.stringify(dashboard?.retention));
  }

  const serialized = JSON.stringify(allowed.data);
  if (serialized.includes(adminToken) || serialized.includes(billingSecret)) {
    throw new Error('Dashboard response leaked an administrative secret.');
  }

  console.log(JSON.stringify({
    growthDashboardSmoke: 'passed',
    builtPageServed: true,
    accessControl: {
      sessionRequired: true,
      adminTokenRequired: true,
      invalidTokenRejected: true,
      secretsNotReturned: true,
    },
    organizer: {
      signups: dashboard.organizer.signups,
      paid: dashboard.organizer.paid,
      activated: dashboard.organizer.activated,
      paidWorkspaces: dashboard.retention.organizer.paidWorkspaces,
    },
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
