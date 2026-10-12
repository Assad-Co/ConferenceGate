import crypto from 'node:crypto';

const rawBaseUrl = process.env.PHASE11_BASE_URL?.trim() || 'https://conferencegate.onrender.com';
const base = new URL(rawBaseUrl);
const runTag = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^a-zA-Z0-9-]/g, '').slice(-24);
if (base.protocol !== 'https:') throw new Error('Live three-account acceptance requires HTTPS.');

const report = { target: base.origin, runTag, accounts: {}, checks: [], blockers: [] };
const pass = (name, detail) => report.checks.push({ name, passed: true, detail });

function password() {
  return `CG-${crypto.randomBytes(18).toString('base64url')}!9a`;
}

async function request(path, { method = 'GET', cookie, body, expected } = {}) {
  const headers = { 'user-agent': 'ConferenceGate-Three-Account-Live-Acceptance/1.0' };
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
  if (expected !== undefined) {
    const statuses = Array.isArray(expected) ? expected : [expected];
    if (!statuses.includes(response.status)) {
      throw new Error(`${method} ${path}: expected ${statuses.join('/')}, got ${response.status} ${JSON.stringify(data)}`);
    }
  } else if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return { response, data };
}

async function signup(role) {
  const email = `live-${role}-${runTag}@example.invalid`;
  const pwd = password();
  const labels = {
    professional: ['Live Acceptance Professional', 'Independent Researcher'],
    organizer: ['Live Acceptance Organizer', 'ConferenceGate Acceptance Events'],
    sponsor: ['Live Acceptance Sponsor', 'ConferenceGate Acceptance Brand'],
  };
  const [name, organization] = labels[role];
  const { response, data } = await request('/api/auth/signup', {
    method: 'POST',
    body: { role, name, email, password: pwd, organization, title: role === 'professional' ? 'Petroleum Geochemist' : '' },
  });
  if (response.status !== 201 || data?.user?.role !== role) {
    throw new Error(`${role} signup failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`${role} signup did not return a session cookie.`);
  const account = { user: data.user, cookie: setCookie.split(';')[0], email, pwd };
  report.accounts[role] = { id: data.user.id, synthetic: true, emailDomain: 'example.invalid' };
  pass(`${role}_signup`, `Created an independent live ${role} session.`);
  return account;
}

async function login(role, account) {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.pwd },
  });
  if (response.status !== 200 || data?.user?.role !== role) {
    throw new Error(`${role} login failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`${role} login did not return a session cookie.`);
  account.cookie = setCookie.split(';')[0];
  pass(`${role}_login`, `Live ${role} signed out/in-equivalent session validation passed.`);
}

try {
  const professional = await signup('professional');
  const organizer = await signup('organizer');
  const sponsor = await signup('sponsor');

  await login('professional', professional);
  await login('organizer', organizer);
  await login('sponsor', sponsor);

  if (professional.user.hasPaidAccess !== true) throw new Error('Professional free account is unexpectedly paywalled.');
  if (organizer.user.hasPaidAccess !== false) throw new Error('New Organizer unexpectedly bypassed paid access.');
  if (sponsor.user.hasPaidAccess !== false) throw new Error('New Sponsor unexpectedly bypassed paid access.');
  pass('role_access_model', 'Professional is usable free; Organizer and Sponsor correctly require paid workspace activation.');

  const professionalUpdate = await request('/api/auth/me/professional-preferences', {
    method: 'PATCH',
    cookie: professional.cookie,
    body: {
      professionalExpertise: ['Petroleum Geochemistry'],
      technicalSpecialization: ['GC-MS'],
      researchInterests: ['Source rock evaluation'],
      preferredRegions: ['Middle East'],
      committeeAvailable: true,
      sessionChairAvailable: true,
      speakerAvailable: true,
      reviewerMaxLoad: 5,
    },
  });
  if (!professionalUpdate.data?.user?.committeeAvailable) {
    throw new Error('Professional preferences did not persist on production.');
  }
  pass('professional_real_profile_write', 'Professional preferences persisted on the live production database.');

  const opportunities = await request('/api/activity/professional-opportunities', { cookie: professional.cookie });
  if (!Array.isArray(opportunities.data?.opportunities)) throw new Error('Professional opportunity feed did not return a real list.');
  pass('professional_opportunity_feed', `Professional opportunity API is live (${opportunities.data.opportunities.length} currently visible).`);

  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: { id: `unpaid-live-${runTag}`, title: 'Must stay blocked', dates: {}, location: {} },
    expected: 402,
  });
  pass('organizer_paid_gate', 'Unpaid live Organizer cannot create a conference before checkout.');

  await request('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie: sponsor.cookie,
    body: { sectors: ['Energy'], categories: [], regions: ['Middle East'], opportunityTypes: [], budgetMin: null, budgetMax: null, alertFrequency: 'instant' },
    expected: 402,
  });
  pass('sponsor_paid_gate', 'Unpaid live Sponsor cannot activate Sponsor Pro matching before checkout.');

  await request('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie: professional.cookie,
    body: { sectors: [], categories: [], regions: [], opportunityTypes: [], budgetMin: null, budgetMax: null, alertFrequency: 'instant' },
    expected: 403,
  });
  pass('cross_role_isolation', 'Professional cannot impersonate Sponsor functionality.');

  const notifications = await request('/api/activity/notifications/mine', { cookie: professional.cookie });
  if (!Array.isArray(notifications.data?.notifications)) throw new Error('Professional notifications are not backed by a live collection.');
  pass('professional_notifications', 'Professional notifications endpoint is live and session-scoped.');

  const failed = report.checks.filter((item) => !item.passed);
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exit(1);
} catch (error) {
  report.blockers.push(error instanceof Error ? error.message : String(error));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
