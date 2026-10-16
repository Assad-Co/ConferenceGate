#!/usr/bin/env node
// Safe, read-only production smoke checks. No test accounts, payments, or data mutations.
const base = (process.env.CONFERENCEGATE_BASE_URL || 'https://conferencegate.onrender.com').replace(/\/$/, '');
const failures = [];
async function check(name, path, expected, inspect) {
  try {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(20000), redirect: 'manual' });
    const body = await response.text();
    const pass = expected.includes(response.status) && (!inspect || inspect(body, response));
    console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + ': HTTP ' + response.status);
    if (!pass) failures.push(name);
  } catch (err) {
    console.error('FAIL ' + name + ': ' + err.message);
    failures.push(name);
  }
}
await check('Database health', '/api/health', [200], (body) => {
  const data = JSON.parse(body); return data.status === 'ok' && data.database === 'ready';
});
await check('Certificate verification page', '/verify.html', [200], (body) => body.includes('Certificate verification') && body.includes('/api/certificates/verify/'));
await check('Unknown certificate rejected', '/api/certificates/verify/CG-AA-00000000000000000000000000000000', [404], (body) => JSON.parse(body).valid === false);
await check('Malformed certificate rejected', '/api/certificates/verify/not-a-certificate', [400], (body) => JSON.parse(body).valid === false);
if (failures.length) {
  console.error('FAILED: ' + failures.join(', '));
  process.exitCode = 1;
} else {
  console.log('All read-only checks passed. Authenticated issuance and payments still require separate end-to-end testing.');
}
