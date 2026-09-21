import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const port = Number(process.env.BILLING_SMOKE_PORT || 3111);
const dbPath = process.env.BILLING_SMOKE_DB || '/tmp/conferencegate-billing-smoke.db';
const fsSecret = 'fastspring-test-secret';
const paddleSecret = 'paddle-test-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
}

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    TEST_DATABASE_PATH: dbPath,
    FASTSPRING_WEBHOOK_SECRET: fsSecret,
    PADDLE_WEBHOOK_SECRET: paddleSecret,
    PADDLE_WEBHOOK_TOLERANCE_SECONDS: '60',
    BILLING_SYNC_SECRET: 'billing-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base = `http://127.0.0.1:${port}`;

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

async function signup(role, email) {
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role,
      name: role === 'sponsor' ? 'Smoke Sponsor' : 'Smoke Organizer',
      email,
      password: 'BillingSmoke123!',
      organization: role === 'sponsor' ? 'Smoke Sponsor Co' : 'Smoke Organizer Co',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.user?.id) {
    throw new Error(`Signup failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error(`Signup did not return a session cookie for ${role}`);
  return { user: data.user, cookie: cookie.split(';')[0] };
}

async function billingStatus(cookie) {
  const response = await fetch(base + '/api/billing/status', {
    headers: { cookie },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Billing status failed: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function sendFastSpring(event) {
  const raw = Buffer.from(JSON.stringify({ events: [event] }));
  const signature = crypto.createHmac('sha256', fsSecret).update(raw).digest('base64');
  const response = await fetch(base + '/api/billing/webhooks/fastspring', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fs-signature': signature,
    },
    body: raw,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`FastSpring webhook failed: ${response.status} ${text}`);
}

async function sendPaddle(event) {
  const raw = Buffer.from(JSON.stringify(event));
  const ts = String(Math.floor(Date.now() / 1000));
  const signedPayload = Buffer.from(ts + ':' + raw.toString('utf8'));
  const signature = crypto.createHmac('sha256', paddleSecret).update(signedPayload).digest('hex');
  const response = await fetch(base + '/api/billing/webhooks/paddle', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'paddle-signature': `ts=${ts};h1=${signature}`,
    },
    body: raw,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Paddle webhook failed: ${response.status} ${text}`);
}

try {
  await waitForHealth();

  const sponsor = await signup('sponsor', 'billing-smoke-sponsor@example.com');
  const organizer = await signup('organizer', 'billing-smoke-organizer@example.com');

  const sponsorBefore = await billingStatus(sponsor.cookie);
  const organizerBefore = await billingStatus(organizer.cookie);
  if (sponsorBefore.hasPaidAccess || organizerBefore.hasPaidAccess) {
    throw new Error('New paid-role accounts unexpectedly started with paid access.');
  }

  const fastSpringEvent = {
    id: 'fs_smoke_subscription_1',
    type: 'subscription.activated',
    data: {
      id: 'sub_fs_smoke_1',
      state: 'active',
      active: true,
      account: {
        id: 'acc_fs_smoke_1',
        contact: { email: 'billing-smoke-sponsor@example.com' },
      },
      product: { path: 'sponsor-pro-smoke' },
    },
  };
  await sendFastSpring(fastSpringEvent);
  await sendFastSpring(fastSpringEvent);

  const sponsorAfter = await billingStatus(sponsor.cookie);
  if (!sponsorAfter.hasPaidAccess || sponsorAfter.status !== 'active' || sponsorAfter.provider !== 'fastspring') {
    throw new Error('FastSpring webhook did not activate Sponsor Pro: ' + JSON.stringify(sponsorAfter));
  }

  const paddleEvent = {
    event_id: 'evt_paddle_smoke_1',
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_paddle_smoke_1',
      status: 'active',
      customer_id: 'ctm_paddle_smoke_1',
      custom_data: {
        conferencegate_user_id: organizer.user.id,
        conferencegate_role: 'organizer',
      },
      items: [{ price: { id: 'pri_organizer_smoke_1' } }],
      current_billing_period: {
        ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
  };
  await sendPaddle(paddleEvent);
  await sendPaddle(paddleEvent);

  const organizerAfter = await billingStatus(organizer.cookie);
  if (!organizerAfter.hasPaidAccess || organizerAfter.status !== 'active' || organizerAfter.provider !== 'paddle') {
    throw new Error('Paddle webhook did not activate Organizer Pro: ' + JSON.stringify(organizerAfter));
  }

  console.log(JSON.stringify({
    billingWebhookSmoke: 'passed',
    fastspring: {
      sponsorAccess: sponsorAfter.hasPaidAccess,
      provider: sponsorAfter.provider,
      status: sponsorAfter.status,
    },
    paddle: {
      organizerAccess: organizerAfter.hasPaidAccess,
      provider: organizerAfter.provider,
      status: organizerAfter.status,
    },
    idempotency: 'duplicate provider events accepted without duplicate processing',
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
