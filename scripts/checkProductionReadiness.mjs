const checkoutProvider = (process.env.BILLING_CHECKOUT_PROVIDER || 'hosted').trim().toLowerCase();

const coreRequired = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'BILLING_SYNC_SECRET',
];

const checkoutRequired =
  checkoutProvider === 'paddle'
    ? ['PADDLE_API_KEY', 'PADDLE_ORGANIZER_PRICE_ID', 'PADDLE_SPONSOR_PRICE_ID', 'PADDLE_WEBHOOK_SECRET']
    : ['ORGANIZER_CHECKOUT_URL', 'SPONSOR_CHECKOUT_URL'];

const required = [...coreRequired, ...checkoutRequired];

const optionalIntegrations = [
  'JWT_SECRET',
  'FASTSPRING_WEBHOOK_SECRET',
  'PADDLE_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'BRAVE_SEARCH_API_KEY',
  'SERPER_API_KEY',
  'JINA_API_KEY',
  'FIRECRAWL_API_KEY',
  'GEMINI_API_KEY',
  'PUBLIC_BASE_URL',
  'APP_BASE_URL',
  'APIFY_TOKEN',
  'DISCOVERY_ADMIN_TOKEN',
];

const missingRequired = required.filter((name) => !process.env[name]?.trim());
const enabledBillingProviders = [
  process.env.FASTSPRING_WEBHOOK_SECRET?.trim() ? 'fastspring' : null,
  process.env.PADDLE_WEBHOOK_SECRET?.trim() ? 'paddle' : null,
].filter(Boolean);

function validHttpsUrl(value) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && Boolean(url.host);
  } catch {
    return false;
  }
}

const invalid = [];
if (!['hosted', 'paddle'].includes(checkoutProvider)) {
  invalid.push('BILLING_CHECKOUT_PROVIDER must be hosted or paddle.');
}
if (checkoutProvider === 'hosted') {
  if (process.env.ORGANIZER_CHECKOUT_URL?.trim() && !validHttpsUrl(process.env.ORGANIZER_CHECKOUT_URL)) {
    invalid.push('ORGANIZER_CHECKOUT_URL must be an https URL.');
  }
  if (process.env.SPONSOR_CHECKOUT_URL?.trim() && !validHttpsUrl(process.env.SPONSOR_CHECKOUT_URL)) {
    invalid.push('SPONSOR_CHECKOUT_URL must be an https URL.');
  }
}
if (checkoutProvider === 'paddle') {
  const paddleEnv = (process.env.PADDLE_ENV || 'live').trim().toLowerCase();
  if (!['live', 'sandbox'].includes(paddleEnv)) {
    invalid.push('PADDLE_ENV must be live or sandbox.');
  }
}
if (process.env.PUBLIC_BASE_URL?.trim() && !validHttpsUrl(process.env.PUBLIC_BASE_URL)) {
  invalid.push('PUBLIC_BASE_URL must be an https URL.');
}
if (process.env.APP_BASE_URL?.trim() && !validHttpsUrl(process.env.APP_BASE_URL)) {
  invalid.push('APP_BASE_URL must be an https URL.');
}

const payoutFeeBps = Number(process.env.SPONSORSHIP_PLATFORM_FEE_BPS || 0);
if (!Number.isFinite(payoutFeeBps) || payoutFeeBps < 0 || payoutFeeBps > 10000) {
  invalid.push('SPONSORSHIP_PLATFORM_FEE_BPS must be a number between 0 and 10000.');
}

const workspaceSeatLimitRaw = process.env.WORKSPACE_SEAT_LIMIT?.trim();
const workspaceSeatLimit = workspaceSeatLimitRaw ? Number(workspaceSeatLimitRaw) : 10;
if (
  workspaceSeatLimitRaw &&
  (!Number.isInteger(workspaceSeatLimit) || workspaceSeatLimit < 2 || workspaceSeatLimit > 1000)
) {
  invalid.push('WORKSPACE_SEAT_LIMIT must be an integer between 2 and 1000.');
}

const webhookToleranceRaw = process.env.PADDLE_WEBHOOK_TOLERANCE_SECONDS?.trim();
const webhookToleranceSeconds = webhookToleranceRaw ? Number(webhookToleranceRaw) : 5;
if (
  webhookToleranceRaw &&
  (!Number.isFinite(webhookToleranceSeconds) || webhookToleranceSeconds <= 0 || webhookToleranceSeconds > 300)
) {
  invalid.push('PADDLE_WEBHOOK_TOLERANCE_SECONDS must be greater than 0 and at most 300.');
}

const report = {
  mode: process.env.NODE_ENV || 'development',
  checkoutProvider,
  required: Object.fromEntries(required.map((name) => [name, Boolean(process.env[name]?.trim())])),
  billingProviders: enabledBillingProviders,
  integrations: Object.fromEntries(optionalIntegrations.map((name) => [name, Boolean(process.env[name]?.trim())])),
  workspaceSeatLimit,
  payoutFeeBps,
  paddleWebhookToleranceSeconds: webhookToleranceSeconds,
  ready:
    missingRequired.length === 0 &&
    enabledBillingProviders.length > 0 &&
    invalid.length === 0,
  warnings: [],
};

if (missingRequired.length) {
  report.warnings.push('Missing required production configuration: ' + missingRequired.join(', '));
}
if (enabledBillingProviders.length === 0) {
  report.warnings.push('No verified subscription webhook provider is configured.');
}
if (checkoutProvider === 'paddle' && !enabledBillingProviders.includes('paddle')) {
  report.warnings.push('Paddle checkout is selected but the Paddle webhook secret is not configured.');
}
if (!process.env.JWT_SECRET?.trim()) {
  report.warnings.push('JWT_SECRET is not set; ConferenceGate will use the persisted database secret.');
}
if (!process.env.PUBLIC_BASE_URL?.trim()) {
  report.warnings.push('PUBLIC_BASE_URL is not set; same-origin checks will rely on the request Host header.');
}
if (!process.env.APP_BASE_URL?.trim()) {
  report.warnings.push('APP_BASE_URL is not set; LinkedIn OAuth callbacks cannot be verified as production-ready.');
}
if (!process.env.BRAVE_SEARCH_API_KEY?.trim() && !process.env.SERPER_API_KEY?.trim()) {
  report.warnings.push('No live web-search provider is configured; conference discovery will rely on stored data only.');
}
for (const message of invalid) report.warnings.push(message);

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && !report.ready) process.exit(1);
