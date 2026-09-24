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

async function signupSponsor() {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'sponsor',
      name: 'Dashboard Smoke Sponsor',
      email: 'growth-dashboard-sponsor@example.com',
      password: 'GrowthDashboard123!',
      organization: 'Dashboard Smoke Brand',
    }),
  });
  const body = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !body?.user?.id || !cookie) {
    throw new Error(`Sponsor signup failed: ${response.status} ${JSON.stringify(body)}`);
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
  const sponsor = await signupSponsor();

  const firstTouch = await jsonRequest('/api/workspaces/acquisition', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      source: 'linkedin',
      medium: 'paid_social',
      campaign: 'organizer_launch',
      content: 'launch_ad_a',
      landingPath: '/?utm_source=linkedin&utm_campaign=organizer_launch',
    },
  });
  if (!firstTouch.response.ok || firstTouch.data?.acquisition?.source !== 'linkedin') {
    throw new Error('Could not record organizer acquisition first touch: ' + JSON.stringify(firstTouch.data));
  }

  const secondTouch = await jsonRequest('/api/workspaces/acquisition', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      source: 'overwritten_source',
      medium: 'email',
      campaign: 'overwritten_campaign',
      landingPath: '/later-campaign',
    },
  });
  if (
    !secondTouch.response.ok ||
    secondTouch.data?.acquisition?.source !== 'linkedin' ||
    secondTouch.data?.acquisition?.campaign !== 'organizer_launch'
  ) {
    throw new Error('Acquisition attribution must remain immutable first-touch: ' + JSON.stringify(secondTouch.data));
  }

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

  const unsafeImport = await jsonRequest('/api/workspaces/organizer/import-conference', {
    method: 'POST',
    cookie: organizer.cookie,
    body: { url: 'http://127.0.0.1:12345/private-conference' },
  });
  if (unsafeImport.response.status !== 400) {
    throw new Error(`Official URL import must block private/unsafe URLs; got ${unsafeImport.response.status} ${JSON.stringify(unsafeImport.data)}`);
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

  const need = await jsonRequest('/api/sponsors/needs', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      conferenceId: 'conf_growth_dashboard_smoke',
      title: 'Dashboard Smoke Sponsorship',
      categories: ['Energy'],
      targetSectors: ['Energy'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      priceOnRequest: false,
      priceAmount: 5000,
      totalSlots: 1,
    },
  });
  if (!need.response.ok || !need.data?.need?.id) {
    throw new Error(`Could not create organizer sponsorship inventory: ${need.response.status} ${JSON.stringify(need.data)}`);
  }

  const addOrganizerCohort = await jsonRequest('/api/admin/discovery/launch-cohort/members', {
    method: 'POST',
    cookie: organizer.cookie,
    token: adminToken,
    body: { email: organizer.user.email, segment: 'pilot-organizer' },
  });
  if (!addOrganizerCohort.response.ok || addOrganizerCohort.data?.launchCohort?.organizer?.members !== 1) {
    throw new Error('Could not enroll organizer launch cohort member: ' + JSON.stringify(addOrganizerCohort.data));
  }

  const addSponsorCohort = await jsonRequest('/api/admin/discovery/launch-cohort/members', {
    method: 'POST',
    cookie: organizer.cookie,
    token: adminToken,
    body: { email: sponsor.user.email, segment: 'pilot-sponsor' },
  });
  if (
    !addSponsorCohort.response.ok ||
    addSponsorCohort.data?.launchCohort?.organizer?.members !== 1 ||
    addSponsorCohort.data?.launchCohort?.sponsor?.members !== 1
  ) {
    throw new Error('Could not enroll sponsor launch cohort member: ' + JSON.stringify(addSponsorCohort.data));
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

  if (dashboard.acquisition?.coveragePct !== 100) {
    throw new Error('Acquisition coverage is incorrect: ' + JSON.stringify(dashboard?.acquisition));
  }
  const sourceFunnel = dashboard.acquisition?.organizerSources?.find((row) => row.source === 'linkedin');
  if (
    !sourceFunnel ||
    sourceFunnel.signups !== 1 ||
    sourceFunnel.paid !== 1 ||
    sourceFunnel.activated !== 1 ||
    sourceFunnel.sponsorshipInventory !== 1 ||
    sourceFunnel.signupToPaidPct !== 100 ||
    sourceFunnel.signupToActivatedPct !== 100
  ) {
    throw new Error('Organizer source acquisition funnel is incorrect: ' + JSON.stringify(sourceFunnel));
  }
  const campaignFunnel = dashboard.acquisition?.organizerCampaigns?.find(
    (row) => row.campaign === 'organizer_launch' && row.source === 'linkedin'
  );
  if (
    !campaignFunnel ||
    campaignFunnel.signups !== 1 ||
    campaignFunnel.paid !== 1 ||
    campaignFunnel.activated !== 1
  ) {
    throw new Error('Organizer campaign acquisition funnel is incorrect: ' + JSON.stringify(campaignFunnel));
  }
  if (dashboard.acquisition?.organizerCampaigns?.some((row) => row.campaign === 'overwritten_campaign')) {
    throw new Error('A later campaign overwrote immutable first-touch attribution.');
  }

  if (
    dashboard.launchCohort?.totalMembers !== 2 ||
    dashboard.launchCohort?.organizer?.members !== 1 ||
    dashboard.launchCohort?.organizer?.paid !== 1 ||
    dashboard.launchCohort?.organizer?.activated !== 1 ||
    dashboard.launchCohort?.sponsor?.members !== 1
  ) {
    throw new Error('First-customer launch cohort is incorrect: ' + JSON.stringify(dashboard.launchCohort));
  }
  if (
    dashboard.revenueOptimization?.organizerPro?.paidAccounts !== 1 ||
    dashboard.revenueOptimization?.sponsorPro?.paidAccounts !== 0 ||
    !Array.isArray(dashboard.revenueOptimization?.experimentalAddOns) ||
    dashboard.revenueOptimization.experimentalAddOns.some((item) => item.enabled)
  ) {
    throw new Error('Revenue optimization state is incorrect: ' + JSON.stringify(dashboard.revenueOptimization));
  }

  const cohortRead = await jsonRequest('/api/admin/discovery/launch-cohort', {
    cookie: organizer.cookie,
    token: adminToken,
  });
  if (!cohortRead.response.ok || cohortRead.data?.launchCohort?.totalMembers !== 2) {
    throw new Error('Launch cohort private read API is incorrect: ' + JSON.stringify(cohortRead.data));
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
    acquisition: {
      firstTouchImmutable: true,
      source: sourceFunnel.source,
      campaign: campaignFunnel.campaign,
      sponsorshipInventory: sourceFunnel.sponsorshipInventory,
    },
    officialUrlImport: {
      unsafePrivateUrlBlocked: true,
    },
    phase77: {
      revenueOptimization: true,
      paidOrganizerAccounts: dashboard.revenueOptimization.organizerPro.paidAccounts,
      experimentalAddOnsRemainDisabled: true,
    },
    phase78: {
      firstCustomerLaunchCohort: true,
      members: dashboard.launchCohort.totalMembers,
      organizerTarget: dashboard.launchCohort.targets.organizers,
      sponsorTargetRange: [
        dashboard.launchCohort.targets.sponsorsMin,
        dashboard.launchCohort.targets.sponsorsMax,
      ],
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
