const rawBaseUrl =
  process.env.PHASE11_BASE_URL?.trim() ||
  process.env.PUBLIC_BASE_URL?.trim() ||
  process.env.APP_BASE_URL?.trim() ||
  '';

const expectedRelease = process.env.EXPECTED_RELEASE?.trim() || '';

function normalizeBaseUrl(value) {
  if (!value) throw new Error(
    'Set PHASE11_BASE_URL (preferred), PUBLIC_BASE_URL, or APP_BASE_URL before running the live launch gate.'
  );

  const url = new URL(value);
  const localhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) {
    throw new Error('The Phase 11 base URL must use HTTPS, except deliberate localhost testing.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function releaseMatches(actual, expected) {
  if (!expected) return true;
  const a = String(actual || '').trim().toLowerCase();
  const e = String(expected || '').trim().toLowerCase();
  return Boolean(a && e && (a.startsWith(e) || e.startsWith(a)));
}

const base = normalizeBaseUrl(rawBaseUrl);
const checks = [];
const evidence = {};
const fail = (name, detail) => checks.push({ name, passed: false, detail });
const pass = (name, detail) => checks.push({ name, passed: true, detail });

try {
  const healthUrl = new URL('/api/health', base);
  const response = await fetchWithTimeout(healthUrl);
  const body = await response.json().catch(() => ({}));

  evidence.healthHttpStatus = response.status;
  evidence.databaseBackend = body?.databaseBackend ?? null;
  evidence.databasePersistentPathConfigured = body?.databasePersistentPathConfigured ?? null;
  evidence.databasePersistenceConfigured = body?.databasePersistenceConfigured ?? null;
  evidence.tursoRuntimeConfigured = body?.tursoRuntimeConfigured ?? null;
  evidence.legacyRecoveryConfigured = body?.legacyRecoveryConfigured ?? null;
  evidence.release = body?.release ?? null;

  if (response.ok) pass('health_http', 'GET /api/health returned HTTP ' + response.status);
  else fail('health_http', 'GET /api/health returned HTTP ' + response.status);

  if (body?.status === 'ok') pass('health_status', 'status=ok');
  else fail('health_status', 'Expected status=ok; received ' + JSON.stringify(body?.status ?? null));

  if (body?.database === 'ready') pass('database_ready', 'database=ready');
  else fail('database_ready', 'Expected database=ready; received ' + JSON.stringify(body?.database ?? null));

  if (typeof body?.databaseBackend === 'string' && body.databaseBackend.trim()) {
    pass('database_backend_reported', 'databaseBackend=' + body.databaseBackend);
  } else {
    fail('database_backend_reported', 'Health response did not report the database backend.');
  }

  if (body?.databasePersistenceConfigured === true) {
    pass('database_persistence', 'Durable database persistence is configured.');
  } else {
    fail('database_persistence', 'The live process does not report durable database persistence.');
  }

  if (body?.databaseBackend === 'sqlite') {
    if (body?.databasePersistentPathConfigured === true) {
      pass('sqlite_persistent_path', 'SQLite is using a configured persistent path.');
    } else {
      fail('sqlite_persistent_path', 'SQLite is live without a configured persistent path.');
    }
  } else if (body?.databaseBackend === 'turso') {
    if (body?.tursoRuntimeConfigured === true) {
      pass('turso_runtime', 'Turso is configured as the durable runtime backend.');
    } else {
      fail('turso_runtime', 'Turso backend reported without a complete Turso runtime configuration.');
    }
  }

  const release = String(body?.release || '').trim();
  if (release) pass('release_present', 'release=' + release);
  else fail('release_present', 'Health response did not expose a release identifier.');

  if (expectedRelease) {
    if (releaseMatches(release, expectedRelease)) {
      pass('release_match', 'Deployed release matches expected commit prefix ' + expectedRelease);
    } else {
      fail('release_match', 'Expected release prefix ' + expectedRelease + '; received ' + (release || '<missing>'));
    }
  }
} catch (error) {
  fail('health_request', error instanceof Error ? error.message : String(error));
}

try {
  const response = await fetchWithTimeout(new URL('/', base));
  evidence.applicationHttpStatus = response.status;
  if (response.ok) pass('application_shell', 'GET / returned HTTP ' + response.status);
  else fail('application_shell', 'GET / returned HTTP ' + response.status);
} catch (error) {
  fail('application_shell', error instanceof Error ? error.message : String(error));
}

try {
  const response = await fetchWithTimeout(new URL('/api/admin/discovery/growth-dashboard', base));
  evidence.unauthenticatedGrowthDashboardStatus = response.status;
  if ([401, 403].includes(response.status)) {
    pass('growth_dashboard_protected', 'Unauthenticated private API returned HTTP ' + response.status);
  } else {
    fail(
      'growth_dashboard_protected',
      'Expected unauthenticated private API to return 401/403; received HTTP ' + response.status
    );
  }
} catch (error) {
  fail('growth_dashboard_protected', error instanceof Error ? error.message : String(error));
}

const failed = checks.filter((check) => !check.passed);
const report = {
  phase: '11.2',
  target: base.origin,
  expectedRelease: expectedRelease || null,
  ready: failed.length === 0,
  evidence,
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
