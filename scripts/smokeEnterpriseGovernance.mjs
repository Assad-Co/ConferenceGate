import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.ENTERPRISE_SMOKE_PORT || 3114);
const dbPath = process.env.ENTERPRISE_SMOKE_DB || '/tmp/conferencegate-enterprise-smoke.db';
const billingSecret = 'enterprise-smoke-secret';

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
  throw new Error('Timed out waiting for server health.');
}

async function request(path, { method = 'GET', cookie, body, billing = false, expectedStatus } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) {
      throw new Error(`${method} ${path}: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(data)}`);
    }
    return data;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function signup(name, email) {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'organizer',
      name,
      email,
      password: 'EnterpriseSmoke123!',
      organization: 'Enterprise Smoke Events',
    }),
  });
  const data = await response.json();
  const setCookie = response.headers.get('set-cookie');
  if (!response.ok || !data?.user?.id || !setCookie) {
    throw new Error('Organizer signup failed: ' + JSON.stringify(data));
  }
  return { user: data.user, cookie: setCookie.split(';')[0] };
}

try {
  await waitForHealth();

  const owner = await signup('Enterprise Owner', 'enterprise-owner@example.com');
  const admin = await signup('Enterprise Admin', 'enterprise-admin@example.com');
  const candidate = await signup('Enterprise Candidate', 'enterprise-candidate@example.com');

  await request('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'smoke-provider',
      eventId: 'enterprise_owner_active_1',
      userId: owner.user.id,
      status: 'active',
      plan: 'organizer_pro_enterprise_smoke',
      customerRef: 'enterprise_owner_customer',
    },
  });

  await request('/api/workspaces/mine', { cookie: owner.cookie });

  await request('/api/workspaces/enterprise-settings', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      requireAllowedDomain: true,
      allowedEmailDomains: ['example.com'],
    },
  });

  const verification = await request('/api/workspaces/enterprise-domain/start', {
    method: 'POST',
    cookie: owner.cookie,
    body: { domain: 'example.com' },
  });
  if (verification?.verification?.status !== 'pending') {
    throw new Error('Enterprise domain challenge was not created.');
  }

  const addAdmin = await request('/api/workspaces/members', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      email: admin.user.email,
      memberRole: 'admin',
    },
  });
  const adminMember = (addAdmin?.workspace?.members || []).find((item) => item.id === admin.user.id);
  if (!adminMember || adminMember.workspaceRole !== 'admin') {
    throw new Error('Admin seat was not created.');
  }

  const savedControls = await request('/api/workspaces/data-controls', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      adminsCanManageMembers: false,
      allowAdminExports: false,
      auditVisibilityDays: 90,
    },
  });
  if (savedControls?.controls?.adminsCanManageMembers !== false ||
      savedControls?.controls?.allowAdminExports !== false ||
      savedControls?.controls?.auditVisibilityDays !== 90) {
    throw new Error('Enterprise data controls did not persist.');
  }

  await request('/api/workspaces/enterprise-settings', {
    method: 'PUT',
    cookie: admin.cookie,
    expectedStatus: 403,
    body: {
      requireAllowedDomain: false,
      allowedEmailDomains: [],
    },
  });

  await request('/api/workspaces/members', {
    method: 'POST',
    cookie: admin.cookie,
    expectedStatus: 403,
    body: {
      email: candidate.user.email,
      memberRole: 'member',
    },
  });

  const adminReport = await request('/api/workspaces/enterprise-report', {
    cookie: admin.cookie,
  });
  if (adminReport?.report?.workspace?.roleCounts?.admin !== 1 ||
      adminReport?.report?.governance?.dataControls?.allowAdminExports !== false) {
    throw new Error('Admin enterprise report did not reflect governance state.');
  }

  for (const path of [
    '/api/workspaces/audit.csv',
    '/api/workspaces/data-export.json',
    '/api/workspaces/enterprise-report.csv',
  ]) {
    const response = await fetch(base + path, { headers: { cookie: admin.cookie } });
    if (response.status !== 403) {
      throw new Error(`Admin export policy was not enforced for ${path}.`);
    }
  }

  const ownerDataExport = await fetch(base + '/api/workspaces/data-export.json', {
    headers: { cookie: owner.cookie },
  });
  const ownerData = await ownerDataExport.json();
  if (!ownerDataExport.ok || ownerData?.workspace?.accountRole !== 'organizer') {
    throw new Error('Owner workspace data export failed.');
  }

  const ownerReportCsv = await fetch(base + '/api/workspaces/enterprise-report.csv', {
    headers: { cookie: owner.cookie },
  });
  const reportText = await ownerReportCsv.text();
  if (!ownerReportCsv.ok || !reportText.includes('seat_utilization_pct')) {
    throw new Error('Owner enterprise report export failed.');
  }

  const auditCsvResponse = await fetch(base + '/api/workspaces/audit.csv', {
    headers: { cookie: owner.cookie },
  });
  const auditCsv = await auditCsvResponse.text();
  if (!auditCsvResponse.ok ||
      !auditCsv.includes('workspace_data_controls_updated') ||
      !auditCsv.includes('enterprise_domain_verification_started') ||
      !auditCsv.includes('workspace_data_exported') ||
      !auditCsv.includes('enterprise_report_exported')) {
    throw new Error('Enterprise audit trail is missing governance/export events.');
  }

  console.log(JSON.stringify({
    enterpriseGovernanceSmoke: 'passed',
    ownerOnlyPolicyChanges: true,
    adminMemberManagementPolicy: true,
    adminExportPolicy: true,
    domainVerificationChallenge: true,
    workspaceDataExport: true,
    enterpriseReporting: true,
    auditTrail: true,
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
