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
  const outsider = await signup('Workspace Outsider', 'workspace-outsider@other.org');
  const candidate = await signup('Workspace Candidate', 'workspace-candidate@example.com');

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

  const enterpriseSettings = await request('/api/workspaces/enterprise-settings', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      requireAllowedDomain: true,
      allowedEmailDomains: ['example.com'],
    },
  });
  if (!enterpriseSettings?.settings?.requireAllowedDomain || !enterpriseSettings?.settings?.allowedEmailDomains?.includes('example.com')) {
    throw new Error('Enterprise email-domain policy was not saved.');
  }

  await request('/api/workspaces/members', {
    method: 'POST',
    cookie: owner.cookie,
    expectedStatus: 403,
    body: {
      email: outsider.user.email,
      memberRole: 'member',
    },
  });

  const verificationStart = await request('/api/workspaces/enterprise-domain/start', {
    method: 'POST',
    cookie: owner.cookie,
    body: { domain: 'example.com' },
  });
  if (verificationStart?.verification?.status !== 'pending' ||
      verificationStart?.verification?.txtName !== '_conferencegate.example.com' ||
      !String(verificationStart?.verification?.txtValue || '').startsWith('conferencegate-verification=')) {
    throw new Error('Enterprise domain verification challenge was not created correctly.');
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

  const dataControls = await request('/api/workspaces/data-controls', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      adminsCanManageMembers: false,
      allowAdminExports: false,
      auditVisibilityDays: 90,
    },
  });
  if (dataControls?.controls?.adminsCanManageMembers !== false ||
      dataControls?.controls?.allowAdminExports !== false ||
      dataControls?.controls?.auditVisibilityDays !== 90) {
    throw new Error('Workspace data controls were not saved correctly.');
  }

  const adminRoleChange = await request(`/api/workspaces/members/${member.user.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { memberRole: 'admin' },
  });
  const adminRow = (adminRoleChange?.workspace?.members || []).find((item) => item.id === member.user.id);
  if (!adminRow || adminRow.workspaceRole !== 'admin') {
    throw new Error('Workspace member was not promoted to admin.');
  }

  await request('/api/workspaces/members', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: {
      email: candidate.user.email,
      memberRole: 'member',
    },
  });

  const blockedAdminExport = await fetch(base + '/api/workspaces/data-export.json', {
    headers: { cookie: member.cookie },
  });
  if (blockedAdminExport.status !== 403) {
    throw new Error('Admin data export was not blocked by owner policy.');
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

  const createdTask = await request('/api/activity/organizer/committee-tasks', {
    method: 'POST',
    cookie: member.cookie,
    body: {
      assignee: 'Technical Committee Chair',
      title: 'Review Track 1 assignments',
      description: 'Confirm reviewer coverage.',
      dueDate: '2027-04-20',
      priority: 'High',
    },
  });
  if (!createdTask?.task?.id || createdTask.task.status !== 'Pending') {
    throw new Error('Organizer committee task was not persisted.');
  }
  const ownerTasks = await request('/api/activity/organizer/committee-tasks', { cookie: owner.cookie });
  if (!(ownerTasks.tasks || []).some((task) => task.id === createdTask.task.id)) {
    throw new Error('Organizer task was not shared across workspace seats.');
  }
  const progressedTask = await request(`/api/activity/organizer/committee-tasks/${createdTask.task.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { status: 'In Progress' },
  });
  if (progressedTask?.task?.status !== 'In Progress') {
    throw new Error('Organizer task status was not persisted.');
  }

  const createdNote = await request('/api/activity/organizer/coordination-notes', {
    method: 'POST', cookie: member.cookie,
    body: { from: 'Conference Organizer', to: 'Technical Committee Chair', message: 'Please confirm reviewer coverage.' },
  });
  if (!createdNote?.note?.id) throw new Error('Organizer coordination note was not persisted.');
  const ownerNotes = await request('/api/activity/organizer/coordination-notes', { cookie: owner.cookie });
  if (!(ownerNotes.notes || []).some((note) => note.id === createdNote.note.id)) {
    throw new Error('Organizer coordination note was not shared across workspace seats.');
  }

  const createdMeeting = await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,
    body: {
      title: 'Committee Planning Sync',
      attendees: ['Technical Committee Chair'],
      date: '2027-04-21',
      time: '10:00',
      organizerTimezone: 'Asia/Dubai',
      meetingLink: 'https://meet.example.com/conferencegate-smoke',
    },
  });
  if (!createdMeeting?.meeting?.id) throw new Error('Organizer meeting plan was not persisted.');
  const ownerMeetings = await request('/api/activity/organizer/meeting-plans', { cookie: owner.cookie });
  if (!(ownerMeetings.meetings || []).some((meeting) => meeting.id === createdMeeting.meeting.id)) {
    throw new Error('Organizer meeting plan was not shared across workspace seats.');
  }

  const adminEnterpriseReport = await request('/api/workspaces/enterprise-report', {
    cookie: member.cookie,
  });
  if (adminEnterpriseReport?.report?.workspace?.accountRole !== 'organizer' ||
      Number(adminEnterpriseReport?.report?.productMetrics?.conferences || 0) < 1 ||
      Number(adminEnterpriseReport?.report?.workspace?.seatsUsed || 0) < 2) {
    throw new Error('Enterprise workspace report did not reflect shared workspace activity.');
  }

  const blockedAdminReportCsv = await fetch(base + '/api/workspaces/enterprise-report.csv', {
    headers: { cookie: member.cookie },
  });
  if (blockedAdminReportCsv.status !== 403) {
    throw new Error('Admin enterprise report export was not blocked by owner policy.');
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
  await request('/api/activity/organizer/committee-tasks', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: { assignee: 'Blocked', title: 'Viewer must not write', priority: 'Low' },
  });
  await request('/api/activity/organizer/coordination-notes', {
    method: 'POST', cookie: member.cookie, expectedStatus: 403,
    body: { from: 'Blocked', to: 'Blocked', message: 'Viewer must not write' },
  });
  await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: {
      title: 'Viewer must not schedule', attendees: ['Blocked'], date: '2027-04-22', time: '11:00',
      organizerTimezone: 'UTC', meetingLink: 'https://meet.example.com/blocked'
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

  const ownerReportCsv = await fetch(base + '/api/workspaces/enterprise-report.csv', {
    headers: { cookie: owner.cookie },
  });
  const ownerReportText = await ownerReportCsv.text();
  if (!ownerReportCsv.ok || !ownerReportText.includes('seat_utilization_pct') || !ownerReportText.includes('conferences')) {
    throw new Error('Owner enterprise report CSV was not generated correctly.');
  }

  const ownerDataExport = await fetch(base + '/api/workspaces/data-export.json', {
    headers: { cookie: owner.cookie },
  });
  const ownerDataPayload = await ownerDataExport.json();
  if (!ownerDataExport.ok ||
      ownerDataPayload?.workspace?.accountRole !== 'organizer' ||
      !Array.isArray(ownerDataPayload?.records?.conferences)) {
    throw new Error('Owner workspace data export did not return organizer workspace data.');
  }

  const auditResponse = await fetch(base + '/api/workspaces/audit.csv', {
    headers: { cookie: owner.cookie },
  });
  const auditCsv = await auditResponse.text();
  if (!auditResponse.ok || !auditCsv.includes('enterprise_settings_updated') || !auditCsv.includes('enterprise_domain_verification_started')) {
    throw new Error('Workspace audit CSV did not include enterprise governance events.');
  }

  console.log(JSON.stringify({
    workspaceSeatSmoke: 'passed',
    inheritedPaidAccess: true,
    sharedOrganizerData: true,
    viewerReadOnly: true,
    removalRevokesInheritedAccess: true,
    enterpriseDomainPolicy: true,
    enterpriseDomainChallenge: true,
    enterpriseAuditExport: true,
    enterpriseDataControls: true,
    adminExportPolicy: true,
    workspaceDataExport: true,
    enterpriseReporting: true,
    enterpriseReportExportPolicy: true,
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
