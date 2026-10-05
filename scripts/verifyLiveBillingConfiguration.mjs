const base = (process.env.PHASE116_BASE_URL || 'https://conferencegate.onrender.com').replace(/\/$/, '');

async function probeWebhook(provider) {
  const response = await fetch(`${base}/api/billing/webhooks/${provider}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const text = await response.text().catch(() => '');

  // Both provider adapters intentionally return 503 before signature verification when their
  // webhook secret is absent. Once configured, this deliberately unsigned probe must fail at
  // signature verification with 400. No event is processed and no customer data is changed.
  const configured = response.status === 400;
  const safelyUnavailable = response.status === 503;
  const safe = configured || safelyUnavailable;

  return {
    provider,
    configured,
    safe,
    httpStatus: response.status,
    state: configured ? 'configured_signature_rejected' : safelyUnavailable ? 'not_configured' : 'unexpected_response',
    detail: text.slice(0, 120),
  };
}

const healthResponse = await fetch(`${base}/api/health`);
const health = await healthResponse.json().catch(() => ({}));
if (!healthResponse.ok || health?.status !== 'ok') {
  throw new Error(`Production health check failed: ${healthResponse.status} ${JSON.stringify(health)}`);
}

const [paddle, fastspring] = await Promise.all([
  probeWebhook('paddle'),
  probeWebhook('fastspring'),
]);

if (!paddle.safe || !fastspring.safe) {
  throw new Error(`Unexpected webhook probe response: ${JSON.stringify({ paddle, fastspring })}`);
}

const configuredProviders = [paddle, fastspring]
  .filter((provider) => provider.configured)
  .map((provider) => provider.provider);

const report = {
  phase: '33.1',
  target: base,
  release: health.release || null,
  database: health.database || null,
  databaseBackend: health.databaseBackend || null,
  webhookConfiguration: { paddle, fastspring },
  configuredWebhookProviders: configuredProviders,
  atLeastOneVerifiedWebhookProviderConfigured: configuredProviders.length > 0,
  checkoutCredentialAudit: 'requires_server_environment_or_real_provider_checkout; unsigned webhook probes intentionally cannot inspect API keys or price/product bindings',
  note: 'Unsigned probes cannot process billing events. HTTP 400 means a provider webhook secret is configured and signature verification rejected the probe. HTTP 503 means that provider webhook secret is absent. A configured webhook secret alone does not prove checkout API keys or Organizer/Sponsor price/product bindings are present.',
};

console.log(JSON.stringify(report, null, 2));
