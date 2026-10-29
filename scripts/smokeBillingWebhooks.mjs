import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import assert from 'node:assert/strict';

const port = Number(process.env.BILLING_SMOKE_PORT || 3111);
const dbPath = process.env.BILLING_SMOKE_DB || '/tmp/conferencegate-billing-smoke.db';
const fsSecret = 'fastspring-test-secret';
const paddleSecret = 'paddle-test-secret';
const organizerPriceId = 'pri_organizer_smoke_1';
const sponsorPriceId = 'pri_sponsor_smoke_1';
const organizerFastSpringProduct = 'organizer-pro-smoke';
const sponsorFastSpringProduct = 'sponsor-pro-smoke';

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
    FASTSPRING_ORGANIZER_PRODUCT_PATH: organizerFastSpringProduct,
    FASTSPRING_SPONSOR_PRODUCT_PATH: sponsorFastSpringProduct,
    PADDLE_WEBHOOK_SECRET: paddleSecret,
    PADDLE_WEBHOOK_TOLERANCE_SECONDS: '60',
    PADDLE_ORGANIZER_PRICE_ID: organizerPriceId,
    PADDLE_SPONSOR_PRICE_ID: sponsorPriceId,
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
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Server exited early.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr);
    }
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch {}
    await sleep(500);
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

async function sendPaddle(event, expectedStatus=200, options={}) {
  const raw = Buffer.from(JSON.stringify(event));
  const ts = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signedPayload = Buffer.from(ts + ':' + raw.toString('utf8'));
  const signature = options.invalidSignature ? '00' : crypto.createHmac('sha256', paddleSecret).update(signedPayload).digest('hex');
  const response = await fetch(base + (options.path || '/api/billing/paddle-webhook'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'paddle-signature': `ts=${ts};h1=${signature}`,
    },
    body: raw,
  });
  const text = await response.text();
  if (response.status !== expectedStatus) throw new Error(`Paddle webhook expected ${expectedStatus}: ${response.status} ${text}`);
}

try {
  await waitForHealth();

  const sponsor = await signup('sponsor', 'billing-smoke-sponsor@example.com');
  const organizer = await signup('organizer', 'billing-smoke-organizer@example.com');
  const roleMismatchSponsor = await signup('sponsor', 'billing-smoke-role-mismatch@example.com');
  const fastSpringMismatchOrganizer = await signup('organizer', 'billing-smoke-fastspring-mismatch@example.com');

  const sponsorBefore = await billingStatus(sponsor.cookie);
  const organizerBefore = await billingStatus(organizer.cookie);
  const mismatchBefore = await billingStatus(roleMismatchSponsor.cookie);
  const fastSpringMismatchBefore = await billingStatus(fastSpringMismatchOrganizer.cookie);
  if (
    sponsorBefore.hasPaidAccess ||
    organizerBefore.hasPaidAccess ||
    mismatchBefore.hasPaidAccess ||
    fastSpringMismatchBefore.hasPaidAccess
  ) {
    throw new Error('New paid-role accounts unexpectedly started with paid access.');
  }

  // A correctly signed FastSpring event may identify a first-time account by purchaser email, but
  // the purchased product still has to be the product configured for that ConferenceGate role.
  await sendFastSpring({
    id: 'fs_smoke_role_mismatch_1',
    type: 'subscription.activated',
    data: {
      id: 'sub_fs_smoke_role_mismatch_1',
      state: 'active',
      active: true,
      account: {
        id: 'acc_fs_smoke_role_mismatch_1',
        contact: { email: 'billing-smoke-fastspring-mismatch@example.com' },
      },
      product: { path: sponsorFastSpringProduct },
    },
  });

  const fastSpringMismatchAfter = await billingStatus(fastSpringMismatchOrganizer.cookie);
  if (fastSpringMismatchAfter.hasPaidAccess || fastSpringMismatchAfter.status === 'active') {
    throw new Error(
      'FastSpring role/product mismatch unexpectedly activated paid access: ' +
        JSON.stringify(fastSpringMismatchAfter)
    );
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
      product: { path: sponsorFastSpringProduct },
    },
  };
  await sendFastSpring(fastSpringEvent);
  await sendFastSpring(fastSpringEvent);

  const sponsorAfter = await billingStatus(sponsor.cookie);
  if (!sponsorAfter.hasPaidAccess || sponsorAfter.status !== 'active' || sponsorAfter.provider !== 'fastspring') {
    throw new Error('FastSpring webhook did not activate Sponsor Pro: ' + JSON.stringify(sponsorAfter));
  }

  // A correctly signed Paddle event must still not activate an account when its role/product
  // evidence conflicts with the ConferenceGate account referenced in custom_data.
  await sendPaddle({
    event_id: 'evt_paddle_role_mismatch_1',
    event_type: 'subscription.activated',
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_paddle_role_mismatch_1',
      status: 'active',
      customer_id: 'ctm_paddle_role_mismatch_1',
      custom_data: {
        conferencegate_user_id: roleMismatchSponsor.user.id,
        conferencegate_role: 'organizer',
      },
      items: [{ price: { id: organizerPriceId } }],
    },
  });

  const mismatchAfter = await billingStatus(roleMismatchSponsor.cookie);
  if (mismatchAfter.hasPaidAccess || mismatchAfter.status === 'active') {
    throw new Error('Paddle role/product mismatch unexpectedly activated paid access: ' + JSON.stringify(mismatchAfter));
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
      items: [{ price: { id: organizerPriceId } }],
      current_billing_period: {
        ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
  };
  await sendPaddle(paddleEvent);
  await sendPaddle(paddleEvent, 200, {path: '/api/billing/webhooks/paddle'});

  const organizerAfter = await billingStatus(organizer.cookie);
  if (!organizerAfter.hasPaidAccess || organizerAfter.status !== 'active' || organizerAfter.provider !== 'paddle') {
    throw new Error('Paddle webhook did not activate Organizer Pro: ' + JSON.stringify(organizerAfter));
  }

  const fixture = createClient({url:'file:'+dbPath});
  try {
    const sponsorPaddleEvent = {
      ...paddleEvent,
      event_id: 'evt_paddle_sponsor_activation',
      data: {...paddleEvent.data, id: 'sub_paddle_sponsor_smoke', customer_id: 'ctm_paddle_sponsor_smoke',
        custom_data: {conferencegate_user_id: sponsor.user.id, conferencegate_role: 'sponsor'},
        items: [{price: {id: sponsorPriceId}}]},
    };
    await sendPaddle(sponsorPaddleEvent);
    const sponsorPaddleStatus = await billingStatus(sponsor.cookie);
    assert.equal(sponsorPaddleStatus.hasPaidAccess, true);
    assert.equal(sponsorPaddleStatus.provider, 'paddle');
    assert.equal((await fixture.execute({sql: 'SELECT subscription_plan FROM users WHERE id=?', args: [sponsor.user.id]})).rows[0].subscription_plan, sponsorPriceId);
    assert.equal((await fixture.execute({sql: 'SELECT subscription_plan FROM users WHERE id=?', args: [organizer.user.id]})).rows[0].subscription_plan, organizerPriceId);
    await sendPaddle({...paddleEvent,event_id:'evt_bad_signature'},400,{invalidSignature:true});
    await sendPaddle({...paddleEvent,event_id:'evt_expired_signature'},400,{timestamp:Math.floor(Date.now()/1000)-3600});
    await sendPaddle({...paddleEvent,event_id:'evt_missing_clock',occurred_at:null},400);
    const time = Date.parse(paddleEvent.occurred_at);
    const lifecycle = (id,status,offset,subscriptionId=paddleEvent.data.id,type='subscription.updated') => ({
      ...paddleEvent,event_id:id,event_type:type,occurred_at:new Date(time+offset).toISOString(),data:{...paddleEvent.data,id:subscriptionId,status}});
    await sendPaddle(lifecycle('evt_past_due','past_due',1000));
    assert.equal((await billingStatus(organizer.cookie)).hasPaidAccess,false);
    await sendPaddle(lifecycle('evt_canceled','canceled',2000));
    await sendPaddle(lifecycle('evt_equal_timestamp_active','active',2000));
    assert.equal((await billingStatus(organizer.cookie)).status,'canceled');
    await sendPaddle(lifecycle('evt_stale_active','active',1500));
    assert.equal((await billingStatus(organizer.cookie)).status,'canceled');
    await sendPaddle(lifecycle('evt_newer_active','active',3000));
    assert.equal((await billingStatus(organizer.cookie)).hasPaidAccess,true);
    await Promise.all([sendPaddle(lifecycle('evt_concurrent_cancel','canceled',5000)),sendPaddle(lifecycle('evt_concurrent_stale','active',4000))]);
    assert.equal((await billingStatus(organizer.cookie)).status,'canceled');
    // An unrelated/old subscription cannot override this account, even with a later delivery.
    await sendPaddle(lifecycle('evt_foreign_subscription','active',6000,'sub_other'));
    assert.equal((await billingStatus(organizer.cookie)).status,'canceled');
    await sendPaddle(lifecycle('evt_replacement_subscription','active',7000,'sub_replacement','subscription.created'));
    assert.equal((await billingStatus(organizer.cookie)).hasPaidAccess,true);
    await sendPaddle(lifecycle('evt_old_subscription_cancel','canceled',8000));
    assert.equal((await billingStatus(organizer.cookie)).hasPaidAccess,true);

    await fixture.execute({sql:"INSERT INTO sponsorship_needs(id,conference_id,conference_title,organizer_id,title) VALUES('billing-need','isolated-conference','Isolated fixture',?,'Fixture need')",args:[organizer.user.id]});
    await fixture.execute({sql:"INSERT INTO sponsorship_need_inquiries(id,need_id,sponsor_id) VALUES('billing-inquiry','billing-need',?)",args:[sponsor.user.id]});
    await fixture.execute({sql:"INSERT INTO sponsorship_deals(id,inquiry_id,need_id,organizer_id,sponsor_id,conference_id,conference_title,opportunity_title,agreed_amount,status) VALUES('billing-deal','billing-inquiry','billing-need',?,?,'isolated-conference','Isolated fixture','Fixture opportunity',10000,'payment_pending')",args:[organizer.user.id,sponsor.user.id]});
    await sendPaddle({event_id:'evt_unrelated_one_off',event_type:'transaction.completed',occurred_at:new Date().toISOString(),data:{id:'txn_unrelated',custom_data:{conferencegate_deal_id:'billing-deal'},details:{totals:{total:'100'}},currency_code:'USD'}});
    assert.equal((await fixture.execute("SELECT status FROM sponsorship_deals WHERE id='billing-deal'")).rows[0].status,'payment_pending');
    assert.equal(Number((await fixture.execute("SELECT count(*) AS n FROM sponsorship_payments WHERE deal_id='billing-deal'")).rows[0].n),0);
    assert.equal(Number((await fixture.execute("SELECT count(*) AS n FROM sponsorship_payout_obligations WHERE deal_id='billing-deal'")).rows[0].n),0);
  } finally {fixture.close();}

  console.log(JSON.stringify({
    billingWebhookSmoke: 'passed',
    fastspring: {
      sponsorAccess: sponsorAfter.hasPaidAccess,
      provider: sponsorAfter.provider,
      status: sponsorAfter.status,
      roleAndProductBindingRejectedMismatch: !fastSpringMismatchAfter.hasPaidAccess,
    },
    paddle: {
      organizerAccess: organizerAfter.hasPaidAccess,
      provider: organizerAfter.provider,
      status: organizerAfter.status,
      roleAndProductBindingRejectedMismatch: !mismatchAfter.hasPaidAccess,
    },
    idempotency: 'duplicate provider events accepted without duplicate processing',
    outOfOrderAndConcurrentEvents:true,
    pastDueRevokesAccess:true,
    subscriptionIdentityBound:true,
    marketplaceSettlementIsolated:true,
    invalidAndExpiredSignaturesRejected:true,
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

