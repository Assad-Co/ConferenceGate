import crypto from 'node:crypto';

const rawBaseUrl = process.env.PHASE11_BASE_URL?.trim() || 'https://conferencegate.onrender.com';
const base = new URL(rawBaseUrl);
const runTag = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^a-zA-Z0-9-]/g, '').slice(-24);

if (base.protocol !== 'https:') throw new Error('Live customer journey acceptance requires HTTPS.');

const report = {
  phase: '11.5',
  target: base.origin,
  runTag,
  accounts: {},
  checks: [],
  checkout: {},
  readyForPaidCustomerJourney: false,
  blockers: [],
};

const pass = (name, detail) => report.checks.push({ name, passed: true, detail });
const fail = (name, detail) => report.checks.push({ name, passed: false, detail });

function password() {
  return `P11-${crypto.randomBytes(20).toString('base64url')}!9a`;
}

async function request(path, { method = 'GET', cookie, body } = {}) {
  const headers = { 'user-agent': 'ConferenceGate-Phase11-Live-Acceptance/1.0' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  return { response, data };
}

async function signup(role, email, pwd) {
  const { response, data } = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      role,
      name: role === 'organizer' ? 'Phase 11 Acceptance Organizer' : 'Phase 11 Acceptance Sponsor',
      email,
      password: pwd,
      organization: role === 'organizer' ? 'ConferenceGate Acceptance Events' : 'ConferenceGate Acceptance Brand',
    },
  });
  if (response.status !== 201 || data?.user?.role !== role) {
    throw new Error(`Synthetic ${role} signup failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  if (data?.user?.hasPaidAccess !== false) {
    throw new Error(`New ${role} unexpectedly received paid access.`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`Synthetic ${role} signup did not return a session cookie.`);
  pass(`${role}_signup`, `Synthetic ${role} account created without paid access.`);
  return { user: data.user, cookie: setCookie.split(';')[0] };
}

async function login(role, email, pwd) {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: pwd },
  });
  if (response.status !== 200 || data?.user?.role !== role) {
    throw new Error(`Synthetic ${role} login failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`Synthetic ${role} login did not return a session cookie.`);
  pass(`${role}_login`, `Synthetic ${role} account signed back in successfully.`);
  return { user: data.user, cookie: setCookie.split(';')[0] };
}

async function verifyBilling(role, cookie) {
  const { response, data } = await request('/api/billing/status', { cookie });
  if (!response.ok || data?.role !== role || data?.hasPaidAccess !== false) {
    throw new Error(`${role} billing status is incorrect: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  pass(`${role}_paid_gate_state`, `${role} correctly reports paid access as inactive before checkout.`);

  const checkout = await request('/api/billing/checkout', { cookie });
  if (checkout.response.status === 200) {
    const checkoutUrl = checkout.data?.checkoutUrl;
    if (typeof checkoutUrl !== 'string' || !/^https:\/\//i.test(checkoutUrl)) {
      throw new Error(`${role} checkout returned HTTP 200 without a valid HTTPS checkout URL.`);
    }
    report.checkout[role] = {
      configured: true,
      provider: checkout.data?.provider || 'hosted',
      httpsCheckoutUrl: true,
    };
    pass(`${role}_checkout`, `${role} checkout is configured and returned a valid HTTPS checkout URL.`);
  } else if (checkout.response.status === 503) {
    report.checkout[role] = { configured: false, provider: null, httpsCheckoutUrl: false };
    const message = String(checkout.data?.error || `${role} checkout is not configured.`);
    report.blockers.push(message);
    pass(`${role}_checkout_safe_unavailable`, `${role} checkout is safely unavailable rather than granting access without payment.`);
  } else {
    throw new Error(`${role} checkout returned unexpected HTTP ${checkout.response.status}: ${JSON.stringify(checkout.data)}`);
  }
}

async function verifyOrganizerGate(cookie) {
  const { response, data } = await request('/api/activity/conferences', {
    method: 'POST',
    cookie,
    body: {
      id: `phase11_acceptance_conf_${runTag}`,
      title: 'Phase 11 Acceptance Conference — must not be created while unpaid',
      dates: { start: '2027-08-01', end: '2027-08-02' },
      location: { city: 'Acceptance City', country: 'Acceptance Country' },
    },
  });
  if (response.status !== 402) {
    fail('organizer_paid_endpoint_gate', `Expected HTTP 402; received ${response.status}: ${JSON.stringify(data)}`);
    throw new Error('Unpaid Organizer was not correctly blocked from a paid Organizer write endpoint.');
  }
  pass('organizer_paid_endpoint_gate', 'Unpaid Organizer is blocked from conference creation with HTTP 402.');
}

async function verifySponsorGate(cookie) {
  const { response, data } = await request('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie,
    body: {
      sectors: ['Energy'],
      categories: ['Energy'],
      regions: ['Middle East'],
      opportunityTypes: ['Technical Session'],
      budgetMin: 5000,
      budgetMax: 15000,
      alertFrequency: 'instant',
    },
  });
  if (response.status !== 402) {
    fail('sponsor_paid_endpoint_gate', `Expected HTTP 402; received ${response.status}: ${JSON.stringify(data)}`);
    throw new Error('Unpaid Sponsor was not correctly blocked from a paid Sponsor write endpoint.');
  }
  pass('sponsor_paid_endpoint_gate', 'Unpaid Sponsor is blocked from Sponsor preferences with HTTP 402.');
}

const organizerEmail = `phase11-organizer-${runTag}@example.invalid`;
const sponsorEmail = `phase11-sponsor-${runTag}@example.invalid`;
const organizerPassword = password();
const sponsorPassword = password();

try {
  const organizerSignup = await signup('organizer', organizerEmail, organizerPassword);
  const sponsorSignup = await signup('sponsor', sponsorEmail, sponsorPassword);
  report.accounts.organizer = { id: organizerSignup.user.id, emailDomain: 'example.invalid', synthetic: true };
  report.accounts.sponsor = { id: sponsorSignup.user.id, emailDomain: 'example.invalid', synthetic: true };

  const organizer = await login('organizer', organizerEmail, organizerPassword);
  const sponsor = await login('sponsor', sponsorEmail, sponsorPassword);

  await verifyBilling('organizer', organizer.cookie);
  await verifyBilling('sponsor', sponsor.cookie);
  await verifyOrganizerGate(organizer.cookie);
  await verifySponsorGate(sponsor.cookie);

  report.readyForPaidCustomerJourney = Boolean(
    report.checkout.organizer?.configured && report.checkout.sponsor?.configured
  );

  const failed = report.checks.filter((item) => !item.passed);
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
} catch (error) {
  fail('live_customer_journey', error instanceof Error ? error.message : String(error));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
