import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.WORKSPACE_SMOKE_PORT || 3113);
const dbPath = process.env.WORKSPACE_SMOKE_DB || '/tmp/conferencegate-workspace-smoke.db';
const billingSecret = 'workspace-smoke-secret';

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
      password: 'WorkspaceSmoke123!',
      organization: 'Workspace Smoke Events',
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

  const owner = await signup('Workspace Owner', 'workspace-owner@example.com');
  const member = await signup('Workspace Member', 'workspace-member@example.com');

  await request('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'smoke-provider',
      eventId: 'workspace_owner_active_1',
      userId: owner.user.id,
      status: 'active',
      plan: 'organizer_pro_workspace_smoke',
      customerRef: 'workspace_owner_customer',
    },
  });

  const workspaceResult = await request('/api/workspaces/mine', { cookie: owner.cookie });
  if (workspaceResult?.workspace?.myRole !== 'owner') {
    throw new Error('Owner workspace was not created correctly.');
  }

  const addResult = await request('/api/workspaces/members', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      email: 'workspace-member@example.com',
      memberRole: 'member',
    },
  });
  const memberRow = (addResult?.workspace?.members || []).find((item) => item.id === member.user.id);
  if (!memberRow || memberRow.workspaceRole !== 'member') {
    throw new Error('Workspace member was not added with member role.');
  }

  const inheritedStatus = await request('/api/billing/status', { cookie: member.cookie });
  if (!inheritedStatus.hasPaidAccess || inheritedStatus.workspaceRole !== 'member') {
    throw new Error('Member did not inherit owner paid access: ' + JSON.stringify(inheritedStatus));
  }

  const memberConferenceId = 'conf_workspace_member_2027';
  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: member.cookie,
    body: {
      id: memberConferenceId,
      title: 'Workspace Member Conference 2027',
      dates: { start: '2027-05-01', end: '2027-05-02' },
      location: { city: 'Test City', country: 'Test Country' },
    },
  });

  const ownerConferences = await request('/api/activity/conferences/mine', { cookie: owner.cookie });
  if (!(ownerConferences.conferences || []).some((conference) => conference.id === memberConferenceId)) {
    throw new Error('Member-created conference was not stored in the shared owner workspace.');
  }

  const roleChange = await request(`/api/workspaces/members/${member.user.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { memberRole: 'viewer' },
  });
  const viewerRow = (roleChange?.workspace?.members || []).find((item) => item.id === member.user.id);
  if (!viewerRow || viewerRow.workspaceRole !== 'viewer') {
    throw new Error('Member was not changed to viewer.');
  }

  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: {
      id: 'conf_viewer_must_fail',
      title: 'Viewer Must Not Create',
    },
  });

  const removeResult = await request(`/api/workspaces/members/${member.user.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  if ((removeResult?.workspace?.members || []).some((item) => item.id === member.user.id)) {
    throw new Error('Removed member is still present in active workspace roster.');
  }

  const removedStatus = await request('/api/billing/status', { cookie: member.cookie });
  if (removedStatus.hasPaidAccess) {
    throw new Error('Removed team seat still has inherited paid access.');
  }

  console.log(JSON.stringify({
    workspaceSeatSmoke: 'passed',
    inheritedPaidAccess: true,
    sharedOrganizerData: true,
    viewerReadOnly: true,
    removalRevokesInheritedAccess: true,
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
