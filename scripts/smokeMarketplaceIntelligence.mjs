import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.MARKETPLACE_INTELLIGENCE_SMOKE_PORT || 3118);
const dbPath = process.env.MARKETPLACE_INTELLIGENCE_SMOKE_DB || '/tmp/conferencegate-marketplace-intelligence-smoke.db';
const billingSecret = 'marketplace-intelligence-billing-secret';
const adminToken = 'marketplace-intelligence-admin-secret';

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

async function request(path, { method = 'GET', cookie, body, billing = false, admin = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  if (admin) headers['x-discovery-admin-token'] = adminToken;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function signup(role, email) {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role,
      name: role === 'organizer' ? 'Marketplace Intelligence Organizer' : 'Marketplace Intelligence Sponsor',
      email,
      password: 'Marketplace123!',
      organization: role === 'organizer' ? 'Marketplace Intelligence Events' : 'Marketplace Intelligence Brand',
    }),
  });
  const data = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !data?.user?.id || !cookie) {
    throw new Error(`Signup failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return { user: data.user, cookie };
}

async function activate(account, role) {
  await request('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'marketplace-intelligence-smoke',
      eventId: `activate_${role}_marketplace_intelligence`,
      eventType: 'subscription.activated',
      userId: account.user.id,
      status: 'active',
      plan: `${role}_pro_marketplace_intelligence`,
      customerRef: `marketplace_intelligence_${role}`,
      periodEnd: '2027-09-24T00:00:00Z',
    },
  });
}

async function runWorker() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['scripts/refreshMarketplaceActionAlerts.mjs'], {
      env: { ...process.env, DATABASE_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => { out += String(chunk); });
    proc.stderr.on('data', (chunk) => { err += String(chunk); });
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (code !== 0) return reject(new Error(`Marketplace alert worker exited ${code}: ${err}`));
      try { resolve(JSON.parse(out.trim())); }
      catch (error) { reject(new Error(`Marketplace alert worker returned invalid JSON: ${out}\n${err}\n${error}`)); }
    });
  });
}

function hasAction(queue, key) {
  return Array.isArray(queue?.actions) && queue.actions.some((item) => item.key === key);
}

const db = createClient({ url: 'file:' + dbPath });

try {
  await waitForHealth();

  const organizer = await signup('organizer', 'marketplace-intelligence-organizer@example.com');
  const sponsor = await signup('sponsor', 'marketplace-intelligence-sponsor@example.com');
  await activate(organizer, 'organizer');
  await activate(sponsor, 'sponsor');

  const organizerInitial = await request('/api/marketplace-intelligence/actions?role=organizer', {
    cookie: organizer.cookie,
  });
  if (!hasAction(organizerInitial, 'create_first_conference')) {
    throw new Error('Organizer queue should start with create_first_conference: ' + JSON.stringify(organizerInitial));
  }

  const conferenceId = 'conf_marketplace_intelligence_2027';
  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      id: conferenceId,
      title: 'Marketplace Intelligence Conference 2027',
      dates: { start: '2027-06-10', end: '2027-06-12' },
      location: { city: 'Test City', country: 'Test Country' },
    },
  });

  const organizerAfterConference = await request('/api/marketplace-intelligence/actions?role=organizer', {
    cookie: organizer.cookie,
  });
  if (!hasAction(organizerAfterConference, 'publish_sponsorship_inventory')) {
    throw new Error('Organizer queue should request sponsorship inventory: ' + JSON.stringify(organizerAfterConference));
  }

  const needResult = await request('/api/sponsors/needs', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      conferenceId,
      title: 'Technical Leadership Sponsorship',
      description: 'Sponsor a technical leadership session.',
      categories: ['Energy'],
      targetSectors: ['Energy'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      priceAmount: 5000,
      priceOnRequest: false,
      totalSlots: 2,
      benefits: ['Brand visibility', 'Technical session recognition'],
    },
  });
  const needId = needResult?.need?.id;
  if (!needId) throw new Error('Sponsorship need was not created.');

  const sponsorInitial = await request('/api/marketplace-intelligence/actions?role=sponsor', {
    cookie: sponsor.cookie,
  });
  if (!hasAction(sponsorInitial, 'complete_matching_preferences')) {
    throw new Error('Sponsor queue should request matching preferences: ' + JSON.stringify(sponsorInitial));
  }

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

  const sponsorReady = await request('/api/marketplace-intelligence/actions?role=sponsor', {
    cookie: sponsor.cookie,
  });
  if (!hasAction(sponsorReady, 'review_marketplace')) {
    throw new Error('Sponsor queue should move to marketplace review: ' + JSON.stringify(sponsorReady));
  }

  const matches = await request('/api/sponsors/needs/matched', { cookie: sponsor.cookie });
  if (!matches?.needs?.some((item) => item.id === needId)) {
    throw new Error('Sponsor did not receive the organizer opportunity in matched needs.');
  }

  const inquiry = await request(`/api/sponsors/needs/${needId}/inquiries`, {
    method: 'POST',
    cookie: sponsor.cookie,
    body: { message: 'Interested in this sponsorship.', budget: 5000 },
  });
  const inquiryId = inquiry?.inquiry?.id;
  if (!inquiryId) throw new Error('Sponsorship inquiry was not created.');

  const organizerWithInquiry = await request('/api/marketplace-intelligence/actions?role=organizer', {
    cookie: organizer.cookie,
  });
  if (!hasAction(organizerWithInquiry, 'respond_to_sponsor_inquiries')) {
    throw new Error('Organizer queue did not surface the Sponsor inquiry: ' + JSON.stringify(organizerWithInquiry));
  }

  await db.execute({
    sql: "UPDATE sponsorship_need_inquiries SET created_at=datetime('now','-4 days'),updated_at=datetime('now','-4 days') WHERE id=?",
    args: [inquiryId],
  });

  const beforeInquiryNudges = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM marketplace_nudge_events WHERE account_id=? AND action_key='respond_to_sponsor_inquiry'",
    args: [organizer.user.id],
  });
  const worker1 = await runWorker();
  const afterInquiryNudges = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM marketplace_nudge_events WHERE account_id=? AND action_key='respond_to_sponsor_inquiry'",
    args: [organizer.user.id],
  });
  if (
    Number(beforeInquiryNudges.rows?.[0]?.count || 0) !== 0 ||
    Number(afterInquiryNudges.rows?.[0]?.count || 0) !== 1 ||
    Number(worker1.notificationsEmitted || 0) < 1
  ) {
    throw new Error('Marketplace inquiry nudge was not emitted correctly: ' + JSON.stringify(worker1));
  }

  const notificationCountBeforeRepeat = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND title='Sponsor inquiry needs follow-up'",
    args: [organizer.user.id],
  });
  const worker2 = await runWorker();
  const notificationCountAfterRepeat = await db.execute({
    sql: "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND title='Sponsor inquiry needs follow-up'",
    args: [organizer.user.id],
  });
  if (
    Number(notificationCountAfterRepeat.rows?.[0]?.count || 0) !==
    Number(notificationCountBeforeRepeat.rows?.[0]?.count || 0)
  ) {
    throw new Error('Marketplace nudge cooldown did not prevent duplicate notification: ' + JSON.stringify(worker2));
  }

  const negotiation = await request(`/api/sponsors/needs/inquiries/${inquiryId}`, {
    method: 'PATCH',
    cookie: organizer.cookie,
    body: { status: 'negotiating' },
  });
  const dealId = negotiation?.deal?.id;
  if (!dealId) throw new Error('Negotiation did not create a Deal Room.');

  await db.execute({
    sql: "UPDATE sponsorship_deals SET updated_at=datetime('now','-8 days') WHERE id=?",
    args: [dealId],
  });

  const organizerStalled = await request('/api/marketplace-intelligence/actions?role=organizer', {
    cookie: organizer.cookie,
  });
  const sponsorStalled = await request('/api/marketplace-intelligence/actions?role=sponsor', {
    cookie: sponsor.cookie,
  });
  if (!hasAction(organizerStalled, 'advance_stalled_deal_rooms')) {
    throw new Error('Organizer queue did not surface stalled Deal Room: ' + JSON.stringify(organizerStalled));
  }
  if (!hasAction(sponsorStalled, 'advance_sponsor_deal_rooms')) {
    throw new Error('Sponsor queue did not surface stalled Deal Room: ' + JSON.stringify(sponsorStalled));
  }

  const worker3 = await runWorker();
  if (Number(worker3.notificationsEmitted || 0) < 2) {
    throw new Error('Expected both parties to receive stalled Deal Room nudges: ' + JSON.stringify(worker3));
  }

  const dashboard = await request('/api/admin/discovery/growth-dashboard', {
    cookie: organizer.cookie,
    admin: true,
  });
  const intelligence = dashboard?.dashboard?.marketplaceIntelligence;
  if (
    !intelligence ||
    intelligence.activeInventory !== 1 ||
    intelligence.inventoryWithViews !== 1 ||
    intelligence.inventoryWithInquiries !== 1 ||
    intelligence.activeDeals !== 1 ||
    intelligence.stalledDeals7d !== 1 ||
    !intelligence.bottlenecks?.some((item) => item.key === 'stalled_deals')
  ) {
    throw new Error('Private marketplace health metrics are incorrect: ' + JSON.stringify(intelligence));
  }

  console.log(JSON.stringify({
    marketplaceIntelligenceSmoke: 'passed',
    phase81: { marketplaceHealth: true, stalledDeals7d: intelligence.stalledDeals7d },
    phase82: { organizerActionQueue: true, sponsorActionQueue: true },
    phase83: { rateLimitedActionNotifications: true },
    phase84: { operatorIntelligence: true, bottlenecks: intelligence.bottlenecks.map((item) => item.key) },
    phase85: { deterministicFeedbackLoop: true },
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
