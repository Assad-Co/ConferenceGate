import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.PRO_COMM_SMOKE_PORT || 3121);
const dbPath = process.env.PRO_COMM_SMOKE_DB || '/tmp/conferencegate-professional-communications-smoke.db';
const billingSecret = 'professional-communications-smoke-secret';
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
    if (child.exitCode !== null) throw new Error(`Server exited early.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for server.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

async function request(path, { method = 'GET', cookie, body, billing = false, expected } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
  if (expected !== undefined) {
    const statuses = Array.isArray(expected) ? expected : [expected];
    if (!statuses.includes(response.status)) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  } else if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function signup(role, email, name, organization) {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, email, name, organization, password: 'ProfessionalCommSmoke123!' }),
  });
  const data = await response.json();
  if (!response.ok || !data?.user?.id) throw new Error(`Signup failed: ${response.status} ${JSON.stringify(data)}`);
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('Signup did not return a session cookie.');
  return { user: data.user, cookie: setCookie.split(';')[0] };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForHealth();

  const professional = await signup('professional', 'comm-professional@example.com', 'Communication Professional', 'Research Institute');
  const colleague = await signup('professional', 'comm-colleague@example.com', 'Communication Colleague', 'Energy Company');
  const organizer = await signup('organizer', 'comm-organizer@example.com', 'Communication Organizer', 'Conference Organizer');

  await request('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'communications-smoke',
      eventId: 'communications_org_activation',
      eventType: 'subscription.activated',
      userId: organizer.user.id,
      status: 'active',
      plan: 'organizer_pro_smoke',
      customerRef: `customer_${organizer.user.id}`,
    },
  });

  // Chat: send -> unread -> fetch thread -> mark read -> unread clears.
  const sent = await request(`/api/messages/conversations/${professional.user.id}/messages`, {
    method: 'POST',
    cookie: colleague.cookie,
    body: { text: 'ConferenceGate communication smoke message.' },
  });
  assert(sent.message?.text === 'ConferenceGate communication smoke message.', 'Message send did not persist.');

  const inbox = await request('/api/messages/conversations', { cookie: professional.cookie });
  const conversation = (inbox.conversations || []).find((item) => item.partnerId === colleague.user.id);
  assert(conversation?.unreadCount === 1, 'Incoming message did not create an unread conversation.');

  const unreadBefore = await request('/api/messages/unread-count', { cookie: professional.cookie });
  assert(unreadBefore.unreadCount === 1, 'Unread message count is incorrect before reading.');

  const thread = await request(`/api/messages/conversations/${colleague.user.id}/messages`, { cookie: professional.cookie });
  assert((thread.messages || []).some((item) => item.id === sent.message.id), 'Sent message is missing from conversation history.');

  await request(`/api/messages/conversations/${colleague.user.id}/read`, { method: 'POST', cookie: professional.cookie });
  const unreadAfter = await request('/api/messages/unread-count', { cookie: professional.cookie });
  assert(unreadAfter.unreadCount === 0, 'Unread message count did not clear after mark-read.');

  // Notifications: real organizer invitation -> Professional notification -> mark read persists.
  const conferenceId = 'conf_professional_communications_smoke';
  const conferenceTitle = 'Professional Communications Smoke Conference';
  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      id: conferenceId,
      title: conferenceTitle,
      description: 'Communication reliability validation.',
      industry: 'Technology',
      topics: ['Professional networking'],
      tracks: ['Professional development'],
      dates: { start: '2027-09-10', end: '2027-09-11' },
      location: { city: 'Manama', country: 'Bahrain', venue: 'Test Venue' },
      format: 'Physical',
      cfpStatus: 'Open',
    },
  });

  const invitation = await request('/api/activity/professional-invitations', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      professionalId: professional.user.id,
      conferenceId,
      roleType: 'speaker',
      title: 'Invited Speaker',
      message: 'Please join the program as an invited speaker.',
    },
  });
  assert(invitation.invitation?.id, 'Organizer invitation was not created.');

  const notificationsBefore = await request('/api/activity/notifications/mine', { cookie: professional.cookie });
  const invitationNotification = (notificationsBefore.notifications || []).find((item) => !item.read && /invitation|speaker/i.test(`${item.title} ${item.message}`));
  assert(invitationNotification?.id, 'Professional did not receive the invitation notification.');

  await request(`/api/activity/notifications/${invitationNotification.id}/read`, {
    method: 'POST',
    cookie: professional.cookie,
  });
  const notificationsAfter = await request('/api/activity/notifications/mine', { cookie: professional.cookie });
  const persisted = (notificationsAfter.notifications || []).find((item) => item.id === invitationNotification.id);
  assert(persisted?.read === true, 'Notification mark-read did not persist.');

  console.log(JSON.stringify({
    professionalCommunicationsSmoke: 'passed',
    messages: { persisted: true, unreadCount: true, markRead: true },
    notifications: { delivered: true, markRead: true },
  }));
} finally {
  child.kill('SIGTERM');
  await sleep(200);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
  }
}
