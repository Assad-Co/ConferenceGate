const requiredCore = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'ORGANIZER_CHECKOUT_URL',
  'SPONSOR_CHECKOUT_URL',
  'BILLING_SYNC_SECRET',
];

const optionalIntegrations = [
  'JWT_SECRET',
  'FASTSPRING_WEBHOOK_SECRET',
  'PADDLE_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'BRAVE_API_KEY',
  'JINA_API_KEY',
  'FIRECRAWL_API_KEY',
  'GEMINI_API_KEY',
];

const missingCore = requiredCore.filter((name) => !process.env[name]?.trim());
const enabledBillingProviders = [
  process.env.FASTSPRING_WEBHOOK_SECRET?.trim() ? 'fastspring' : null,
  process.env.PADDLE_WEBHOOK_SECRET?.trim() ? 'paddle' : null,
].filter(Boolean);

const report = {
  mode: process.env.NODE_ENV || 'development',
  core: Object.fromEntries(requiredCore.map((name) => [name, Boolean(process.env[name]?.trim())])),
  billingProviders: enabledBillingProviders,
  integrations: Object.fromEntries(optionalIntegrations.map((name) => [name, Boolean(process.env[name]?.trim())])),
  payoutFeeBps: Number(process.env.SPONSORSHIP_PLATFORM_FEE_BPS || 0),
  ready:
    missingCore.length === 0 &&
    enabledBillingProviders.length > 0,
  warnings: [],
};

if (missingCore.length) {
  report.warnings.push('Missing required production configuration: ' + missingCore.join(', '));
}
if (enabledBillingProviders.length === 0) {
  report.warnings.push('No verified subscription webhook provider is configured.');
}
if (!process.env.JWT_SECRET?.trim()) {
  report.warnings.push('JWT_SECRET is not set; ConferenceGate will use the persisted database secret.');
}
if (!process.env.PUBLIC_BASE_URL?.trim()) {
  report.warnings.push('PUBLIC_BASE_URL is not set; same-origin checks will rely on the request Host header.');
}

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && !report.ready) process.exit(1);
