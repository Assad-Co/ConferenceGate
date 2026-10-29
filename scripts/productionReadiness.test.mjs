import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function check(overrides = {}, strict = false) {
  // Do not inherit developer/provider credentials or launch flags into these fixtures.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'].includes(key.toUpperCase())));
  Object.assign(env, {
    NODE_ENV: 'production', DATABASE_PATH: '/persistent/test.db',
    BILLING_CHECKOUT_PROVIDER: 'paddle', BILLING_SYNC_SECRET: 'fixture-sync',
    PADDLE_ENV: 'live', PADDLE_API_KEY: 'fixture-api', PADDLE_WEBHOOK_SECRET: 'fixture-webhook',
    PADDLE_ORGANIZER_PRICE_ID: 'pri_organizer_fixture', PADDLE_SPONSOR_PRICE_ID: 'pri_sponsor_fixture',
  }, overrides);
  const result = spawnSync(process.execPath,
    [fileURLToPath(new URL('./checkProductionReadiness.mjs', import.meta.url)), ...(strict ? ['--strict'] : [])],
    { env, encoding: 'utf8' });
  assert.ifError(result.error);
  return { ...JSON.parse(result.stdout), exitCode: result.status, output: result.stdout };
}

test('Sandbox can be configured correctly but cannot pass the paid launch gate', () => {
  const result = check({ PADDLE_ENV: 'sandbox' }, true);
  assert.equal(result.configurationReady, true);
  assert.equal(result.ready, false);
  assert.equal(result.exitCode, 1);
  assert.ok(result.paidLaunchBlockers.some(message => message.includes('Sandbox')));
});

test('Paddle environment must be explicit instead of silently assuming live', () => {
  const result = check({ PADDLE_ENV: '' }, true);
  assert.equal(result.required.PADDLE_ENV, false);
  assert.equal(result.configurationReady, false);
  assert.equal(result.ready, false);
  assert.equal(result.exitCode, 1);
});

test('private workspaces and free-access overrides block public paid readiness', () => {
  for (const flag of ['PRIVATE_WORKSPACES_ONLY', 'FREE_LAUNCH_ORGANIZER_ACCESS', 'FREE_LAUNCH_SPONSOR_ACCESS']) {
    const result = check({ [flag]: 'true' }, true);
    assert.equal(result.configurationReady, true);
    assert.equal(result.ready, false);
    assert.equal(result.exitCode, 1);
  }
});

test('live configuration passes only the configuration gate and does not disclose credentials', () => {
  const result = check({}, true);
  assert.equal(result.ready, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.scope, 'paid_launch_configuration_only');
  assert.equal(result.externalVerificationRequired.length, 3);
  assert.ok(!result.output.includes('fixture-api'));
  assert.ok(!result.output.includes('fixture-webhook'));
});

test('hosted provider configuration remains supported', () => {
  const result = check({ BILLING_CHECKOUT_PROVIDER: 'hosted', PADDLE_ENV: '',
    ORGANIZER_CHECKOUT_URL: 'https://checkout.example/organizer',
    SPONSOR_CHECKOUT_URL: 'https://checkout.example/sponsor' }, true);
  assert.equal(result.ready, true);
  assert.equal(result.paddleEnvironment, null);
});

