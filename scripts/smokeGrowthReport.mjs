import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.GROWTH_SMOKE_PORT || 3114);
const dbPath = process.env.GROWTH_SMOKE_DB || '/tmp/conferencegate-growth-smoke.db';
const billingSecret = 'growth-smoke-secret';

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
const testEnv = () => ({
  ...process.env,
  NODE_ENV: 'test',
  TEST_DATABASE_PATH: dbPath,
  TURSO_DATABASE_URL: '',
  TURSO_AUTH_TOKEN: '',
});

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

async function request(path, { method = 'GET', cookie, body, billing = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function signup(role, email) {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role,
      name: role === 'organizer' ? 'Growth Smoke Organizer' : 'Growth Smoke Sponsor',
      email,
      password: 'GrowthSmoke123!',
      organization: role === 'organizer' ? 'Growth Smoke Events' : 'Growth Smoke Brand',
    }),
  });
  const data = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !data?.user?.id || !cookie) {
    throw new Error(`Signup failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return { user: data.user, cookie };
}

async function recordAcquisition(account, source, campaign) {
  return request('/api/workspaces/acquisition', {
    method: 'POST',
    cookie: account.cookie,
    body: {
      source,
      medium: 'paid-social',
      campaign,
      content: 'growth-smoke',
      landingPath: '/join',
    },
  });
}

async function startCheckout(account, expectedSuffix) {
  const checkout = await request('/api/billing/checkout', { cookie: account.cookie });
  if (!checkout.checkoutUrl?.endsWith(expectedSuffix) || checkout.provider !== 'hosted') {
    throw new Error('Hosted checkout response is incorrect: ' + JSON.stringify(checkout));
  }
  await request('/api/workspaces/checkout-start', {
    method: 'POST',
    cookie: account.cookie,
    body: { provider: checkout.provider },
  });
}

async function activate(userId, role, eventId = `activate_${role}_1`, status = 'active', periodEnd = '2026-10-22T00:00:00Z') {
  await request('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'growth-smoke',
      eventId,
      eventType: status === 'active' ? 'subscription.activated' : `subscription.${status}`,
      userId,
      status,
      plan: `${role}_pro_growth_smoke`,
      customerRef: `growth_customer_${role}`,
      periodEnd,
    },
  });
}

async function runJsonScript(script) {
  return new Promise((resolve, reject) => {
    const report = spawn(process.execPath, [script, '--compact'], {
      env: testEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    report.stdout.on('data', (chunk) => { out += String(chunk); });
    report.stderr.on('data', (chunk) => { err += String(chunk); });
    report.once('error', reject);
    report.once('exit', (code) => {
      if (code !== 0) return reject(new Error(`${script} exited ${code}: ${err}`));
      try { resolve(JSON.parse(out)); }
      catch (error) { reject(new Error(`${script} did not return JSON: ${out}\n${err}\n${error}`)); }
    });
  });
}

try {
  await waitForHealth();
  const schema = await runJsonScript('scripts/ensureGrowthSchema.mjs');
  if (schema?.growthSchema !== 'ready') throw new Error('Growth schema did not initialize: ' + JSON.stringify(schema));

  const organizer = await signup('organizer', 'growth-smoke-organizer@example.com');
  const sponsor = await signup('sponsor', 'growth-smoke-sponsor@example.com');

  const organizerAcquisition = await recordAcquisition(organizer, 'linkedin', 'organizer-launch');
  await recordAcquisition(organizer, 'should-not-overwrite', 'later-campaign');
  const sponsorAcquisition = await recordAcquisition(sponsor, 'industry-newsletter', 'sponsor-launch');
  if (organizerAcquisition?.acquisition?.source !== 'linkedin') {
    throw new Error('Organizer acquisition was not recorded.');
  }
  const organizerAcquisitionAfterRetry = await recordAcquisition(organizer, 'another-source', 'another-campaign');
  if (organizerAcquisitionAfterRetry?.acquisition?.source !== 'linkedin') {
    throw new Error('First-touch acquisition was overwritten.');
  }
  if (sponsorAcquisition?.acquisition?.source !== 'industry-newsletter') {
    throw new Error('Sponsor acquisition was not recorded.');
  }

  await startCheckout(organizer, '/organizer');
  await startCheckout(sponsor, '/sponsor');

  await activate(organizer.user.id, 'organizer');
  await activate(sponsor.user.id, 'sponsor');
  // Exercise real status-history transitions: cancel/reactivate organizer and extend sponsor period.
  await activate(organizer.user.id, 'organizer', 'cancel_organizer_1', 'canceled', '2026-10-22T00:00:00Z');
  await activate(organizer.user.id, 'organizer', 'reactivate_organizer_1', 'active', '2026-11-22T00:00:00Z');
  await activate(sponsor.user.id, 'sponsor', 'renew_sponsor_1', 'active', '2026-11-22T00:00:00Z');

  const conferenceId = 'conf_growth_smoke_2027';
  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      id: conferenceId,
      title: 'Growth Smoke Conference 2027',
      dates: { start: '2027-04-10', end: '2027-04-11' },
      location: { city: 'Test City', country: 'Test Country' },
    },
  });

  const needResult = await request('/api/sponsors/needs', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      conferenceId,
      title: 'Growth Smoke Sponsorship',
      categories: ['Energy'],
      targetSectors: ['Energy'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      priceOnRequest: false,
      priceAmount: 5000,
      totalSlots: 1,
    },
  });

  await request('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie: sponsor.cookie,
    body: {
      sectors: ['Energy'],
      categories: ['Energy'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      budgetMin: 1000,
      budgetMax: 10000,
      alertFrequency: 'instant',
    },
  });

  const matchedBeforeInquiry = await request('/api/sponsors/needs/matched', { cookie: sponsor.cookie });
  const matchedNeed = matchedBeforeInquiry?.needs?.find((item) => item.id === needResult.need.id);
  if (
    !matchedNeed ||
    matchedNeed.matchScore < 70 ||
    !Array.isArray(matchedNeed.matchReasons) ||
    !matchedNeed.matchReasons.some((reason) => reason.includes('Sector match')) ||
    !matchedNeed.matchBreakdown
  ) {
    throw new Error('Explainable Sponsor Pro matching is incorrect: ' + JSON.stringify(matchedNeed));
  }

  const launchpadBeforeInquiry = await request('/api/sponsors/launchpad', { cookie: sponsor.cookie });
  if (
    !launchpadBeforeInquiry?.launchpad?.preferencesReady ||
    launchpadBeforeInquiry.launchpad.meaningfulMatches < 1
  ) {
    throw new Error('Sponsor Launchpad readiness is incorrect: ' + JSON.stringify(launchpadBeforeInquiry));
  }

  await request('/api/sponsors/watchlist', {
    method: 'PUT',
    cookie: sponsor.cookie,
    body: { sourceType: 'internal_need', sourceId: needResult.need.id },
  });

  await request(`/api/sponsors/needs/${needResult.need.id}/inquiries`, {
    method: 'POST',
    cookie: sponsor.cookie,
    body: { message: 'Growth smoke inquiry', budget: 5000 },
  });

  const launchpadAfterInquiry = await request('/api/sponsors/launchpad', { cookie: sponsor.cookie });
  if (
    launchpadAfterInquiry?.launchpad?.savedOpportunities !== 1 ||
    launchpadAfterInquiry?.launchpad?.inquiriesSent !== 1
  ) {
    throw new Error('Sponsor Launchpad did not advance after inquiry: ' + JSON.stringify(launchpadAfterInquiry));
  }

  const organizerActivation = await request('/api/workspaces/activation', { cookie: organizer.cookie });
  const sponsorActivation = await request('/api/workspaces/activation', { cookie: sponsor.cookie });
  if (organizerActivation?.activation?.completedCount !== 3 || organizerActivation?.activation?.totalCount !== 5) {
    throw new Error('Organizer activation checklist is incorrect: ' + JSON.stringify(organizerActivation));
  }
  if (sponsorActivation?.activation?.completedCount !== 3 || sponsorActivation?.activation?.totalCount !== 5) {
    throw new Error('Sponsor activation checklist is incorrect: ' + JSON.stringify(sponsorActivation));
  }

  const report = await runJsonScript('scripts/growthReport.mjs');
  const cohortReport = await runJsonScript('scripts/growthCohortReport.mjs');
  const executive = await runJsonScript('scripts/executiveGrowthSnapshot.mjs');

  if (report?.organizer?.signups !== 1 || report?.organizer?.paidSubscriptions !== 1) {
    throw new Error('Organizer signup/paid funnel is incorrect: ' + JSON.stringify(report?.organizer));
  }
  if (report?.organizer?.firstValueActivated !== 1 || report?.organizer?.publishedSponsorshipInventory !== 1) {
    throw new Error('Organizer activation funnel is incorrect: ' + JSON.stringify(report?.organizer));
  }
  if (report?.sponsor?.signups !== 1 || report?.sponsor?.paidSubscriptions !== 1) {
    throw new Error('Sponsor signup/paid funnel is incorrect: ' + JSON.stringify(report?.sponsor));
  }
  if (report?.sponsor?.firstValueActivated !== 1 || report?.sponsor?.sentSponsorInquiry !== 1) {
    throw new Error('Sponsor activation funnel is incorrect: ' + JSON.stringify(report?.sponsor));
  }
  if (report?.checkout?.byRole?.organizer?.starts30d !== 1 || report?.checkout?.byRole?.organizer?.currentlyPaidAccounts !== 1) {
    throw new Error('Organizer checkout funnel is incorrect: ' + JSON.stringify(report?.checkout));
  }
  if (report?.checkout?.byRole?.sponsor?.starts30d !== 1 || report?.checkout?.byRole?.sponsor?.currentlyPaidAccounts !== 1) {
    throw new Error('Sponsor checkout funnel is incorrect: ' + JSON.stringify(report?.checkout));
  }
  if (cohortReport?.acquisitionCoverage?.attributedSignups !== 2 || cohortReport?.acquisitionCoverage?.coveragePct !== 100) {
    throw new Error('Acquisition coverage is incorrect: ' + JSON.stringify(cohortReport?.acquisitionCoverage));
  }
  if (!cohortReport?.acquisition?.some((row) => row.source === 'linkedin' && row.role === 'organizer')) {
    throw new Error('Organizer acquisition source missing: ' + JSON.stringify(cohortReport?.acquisition));
  }
  if (!cohortReport?.cohorts?.some((row) => row.role === 'organizer' && row.currentPaidConversionPct === 100)) {
    throw new Error('Organizer cohort conversion missing: ' + JSON.stringify(cohortReport?.cohorts));
  }
  if (!cohortReport?.subscriptionHistory?.available || !cohortReport.subscriptionHistory.instrumentedSince) {
    throw new Error('Subscription history instrumentation missing: ' + JSON.stringify(cohortReport?.subscriptionHistory));
  }
  const organizerTransitions = cohortReport.subscriptionHistory.transitions30d.find((row) => row.role === 'organizer');
  const sponsorTransitions = cohortReport.subscriptionHistory.transitions30d.find((row) => row.role === 'sponsor');
  if (!organizerTransitions || organizerTransitions.cancellations < 1 || organizerTransitions.reactivations < 1) {
    throw new Error('Organizer subscription transitions are incorrect: ' + JSON.stringify(organizerTransitions));
  }
  if (!sponsorTransitions || sponsorTransitions.periodEndChanges < 1) {
    throw new Error('Sponsor period extension signal is missing: ' + JSON.stringify(sponsorTransitions));
  }
  if (executive?.movement?.organizerSignups?.current7d !== 1 || executive?.movement?.sponsorSignups?.current7d !== 1) {
    throw new Error('Executive signup movement is incorrect: ' + JSON.stringify(executive?.movement));
  }
  if (executive?.currentState?.acquisitionCoverage?.coveragePct !== 100) {
    throw new Error('Executive acquisition coverage is incorrect: ' + JSON.stringify(executive?.currentState));
  }

  console.log(JSON.stringify({
    growthReportSmoke: 'passed',
    phase62: {
      checkoutTracking: true,
      organizerActivation: `${organizerActivation.activation.completedCount}/${organizerActivation.activation.totalCount}`,
      sponsorActivation: `${sponsorActivation.activation.completedCount}/${sponsorActivation.activation.totalCount}`,
    },
    phase63: { retention: true, nextBestAction: true },
    phase64: {
      explicitFirstTouchAttribution: true,
      acquisitionCoveragePct: cohortReport.acquisitionCoverage.coveragePct,
      executiveMovement: true,
    },
    phase65: {
      signupCohorts: true,
      cleanSubscriptionHistoryFromInstrumentationStart: true,
      cancellationsAndReactivations: true,
      renewalPeriodSignals: true,
    },
    phase74: {
      sponsorLaunchpad: true,
      nextBestAction: launchpadAfterInquiry.launchpad.nextAction.key,
    },
    phase75: {
      explainableMatching: true,
      matchScore: matchedNeed.matchScore,
      matchReasons: matchedNeed.matchReasons,
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