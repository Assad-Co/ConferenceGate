import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.COMMERCIAL_SMOKE_PORT || 3112);
const dbPath = process.env.COMMERCIAL_SMOKE_DB || '/tmp/conferencegate-commercial-smoke.db';
const billingSecret = 'commercial-smoke-secret';

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
    SPONSORSHIP_PLATFORM_FEE_BPS: '500',
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
    await sleep(400);
  }
  throw new Error('Timed out waiting for server health.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr);
}

async function jsonRequest(path, { method = 'GET', cookie, body, billing = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function signup(role, email) {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role,
      name: role === 'organizer' ? 'Commercial Smoke Organizer' : 'Commercial Smoke Sponsor',
      email,
      password: 'CommercialSmoke123!',
      organization: role === 'organizer' ? 'Commercial Smoke Events' : 'Commercial Smoke Brand',
    }),
  });
  const data = await response.json();
  if (!response.ok || !data?.user?.id) {
    throw new Error(`Signup failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`No session cookie returned for ${role}`);
  return { user: data.user, cookie: setCookie.split(';')[0] };
}

async function activatePaid(userId, eventId, plan) {
  await jsonRequest('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'smoke-provider',
      eventId,
      eventType: 'subscription.activated',
      userId,
      status: 'active',
      plan,
      customerRef: 'customer_' + userId,
    },
  });
}

try {
  await waitForHealth();

  const organizer = await signup('organizer', 'commercial-smoke-organizer@example.com');
  const sponsor = await signup('sponsor', 'commercial-smoke-sponsor@example.com');
  await activatePaid(organizer.user.id, 'commercial_org_active_1', 'organizer_pro_smoke');
  await activatePaid(sponsor.user.id, 'commercial_sponsor_active_1', 'sponsor_pro_smoke');

  const organizerStatus = await jsonRequest('/api/billing/status', { cookie: organizer.cookie });
  const sponsorStatus = await jsonRequest('/api/billing/status', { cookie: sponsor.cookie });
  if (!organizerStatus.hasPaidAccess || !sponsorStatus.hasPaidAccess) {
    throw new Error('Paid workspace activation failed.');
  }

  const conferenceId = 'conf_commercial_smoke_2027';
  await jsonRequest('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      id: conferenceId,
      title: 'Commercial Smoke Energy Conference 2027',
      dates: { start: '2027-03-10', end: '2027-03-12' },
      location: { city: 'Test City', country: 'Test Country' },
    },
  });

  const needResult = await jsonRequest('/api/sponsors/needs', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      conferenceId,
      title: 'Technical Session Sponsorship',
      description: 'Commercial lifecycle smoke opportunity',
      categories: ['Energy', 'Petroleum & Geoscience'],
      targetSectors: ['Energy'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      priceOnRequest: false,
      priceAmount: 10000,
      totalSlots: 1,
      benefits: ['Logo placement', 'Session recognition'],
      deadline: '2027-02-01',
    },
  });
  const needId = needResult?.need?.id;
  if (!needId) throw new Error('Organizer sponsorship need was not created.');

  await jsonRequest('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie: sponsor.cookie,
    body: {
      sectors: ['Energy'],
      categories: ['Energy', 'Petroleum & Geoscience'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      budgetMin: 5000,
      budgetMax: 15000,
      alertFrequency: 'instant',
    },
  });

  const matches = await jsonRequest('/api/sponsors/needs/matched', { cookie: sponsor.cookie });
  const matchedNeed = (matches.needs || []).find((item) => item.id === needId);
  if (!matchedNeed) throw new Error('Sponsor did not receive the Organizer Pro sponsorship need.');

  const inquiryResult = await jsonRequest(`/api/sponsors/needs/${needId}/inquiries`, {
    method: 'POST',
    cookie: sponsor.cookie,
    body: {
      message: 'We are interested in this technical-session opportunity.',
      budget: 10000,
    },
  });
  const inquiryId = inquiryResult?.inquiry?.id;
  if (!inquiryId) throw new Error('Sponsor inquiry was not created.');

  const wonResult = await jsonRequest(`/api/sponsors/needs/inquiries/${inquiryId}`, {
    method: 'PATCH',
    cookie: organizer.cookie,
    body: { status: 'won' },
  });
  const dealId = wonResult?.deal?.id;
  if (!dealId || wonResult?.deal?.status !== 'agreement_reached') {
    throw new Error('Won inquiry did not create an agreement-reached Deal Room.');
  }

  const contractDeal = await jsonRequest(`/api/sponsors/deals/${dealId}`, {
    method: 'PATCH',
    cookie: organizer.cookie,
    body: {
      agreedAmount: 10000,
      currency: 'USD',
      deliverables: ['Technical-session recognition', 'Logo placement'],
      contractUrl: 'https://example.com/contract',
      invoiceUrl: 'https://example.com/invoice',
      status: 'contract_pending',
    },
  });
  if (contractDeal?.deal?.status !== 'contract_pending') {
    throw new Error('Deal did not enter contract_pending.');
  }

  const paymentPendingDeal = await jsonRequest(`/api/sponsors/deals/${dealId}`, {
    method: 'PATCH',
    cookie: organizer.cookie,
    body: { status: 'payment_pending' },
  });
  if (paymentPendingDeal?.deal?.status !== 'payment_pending') {
    throw new Error('Deal did not enter payment_pending.');
  }

  await jsonRequest('/api/billing/deal-payment-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'smoke-payments',
      eventId: 'commercial_payment_1',
      dealId,
      paid: true,
      paymentReference: 'payment_commercial_smoke_1',
      amount: 10000,
      currency: 'USD',
    },
  });

  let organizerLedger = await jsonRequest('/api/billing/ledger/mine', { cookie: organizer.cookie });
  const paidPayment = (organizerLedger.payments || []).find((item) => item.dealId === dealId);
  if (!paidPayment || paidPayment.status !== 'settled' || paidPayment.payoutStatus !== 'pending') {
    throw new Error('Provider payment did not create a pending organizer payout obligation: ' + JSON.stringify(paidPayment));
  }
  if (Number(paidPayment.payoutAmount) !== 9500 || Number(paidPayment.platformFeeAmount) !== 500) {
    throw new Error('5% platform fee/payout math is incorrect: ' + JSON.stringify(paidPayment));
  }

  await jsonRequest('/api/billing/payout-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'smoke-payouts',
      eventId: 'commercial_payout_1',
      dealId,
      payoutReference: 'payout_commercial_smoke_1',
      paid: true,
    },
  });

  organizerLedger = await jsonRequest('/api/billing/ledger/mine', { cookie: organizer.cookie });
  const paidOut = (organizerLedger.payments || []).find((item) => item.dealId === dealId);
  if (!paidOut || paidOut.payoutStatus !== 'paid' || paidOut.payoutReference !== 'payout_commercial_smoke_1') {
    throw new Error('Organizer payout was not confirmed in the ledger: ' + JSON.stringify(paidOut));
  }

  const refundResult = await jsonRequest('/api/billing/deal-refund-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'smoke-payments',
      eventId: 'commercial_refund_1',
      dealId,
      refundReference: 'refund_commercial_smoke_1',
      refunded: true,
    },
  });
  if (refundResult.payoutStatus !== 'held') {
    throw new Error('Refund after organizer payout should require reconciliation hold.');
  }

  organizerLedger = await jsonRequest('/api/billing/ledger/mine', { cookie: organizer.cookie });
  const refunded = (organizerLedger.payments || []).find((item) => item.dealId === dealId);
  if (!refunded || refunded.status !== 'refunded' || refunded.payoutStatus !== 'held') {
    throw new Error('Refund/payout reconciliation state is incorrect: ' + JSON.stringify(refunded));
  }

  const analytics = await jsonRequest('/api/sponsors/needs/analytics', { cookie: organizer.cookie });
  const needAnalytics = (analytics.needs || []).find((item) => item.needId === needId);
  if (!needAnalytics || Number(needAnalytics.realizedRevenue) !== 0 || Number(needAnalytics.payments) !== 0) {
    throw new Error('Refunded payment is still counted as realized sponsorship revenue: ' + JSON.stringify(needAnalytics));
  }

  console.log(JSON.stringify({
    commercialLifecycleSmoke: 'passed',
    matched: true,
    inquiry: true,
    dealRoom: true,
    sponsorPayment: 'settled then refunded',
    organizerPayout: 'paid then held for reconciliation',
    feeMath: { gross: 10000, platformFee: 500, payout: 9500, currency: 'USD' },
    refundedRevenueExcluded: true,
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
