// Smoke-checks the Organizer Conference Wizard import endpoint contract without requiring
// a paid browser session. The route must stay mounted and protected by auth; a missing route
// (404) or server crash (5xx) means Import & Prefill is broken in production.
const base = (process.env.CONFERENCEGATE_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:10000').replace(/\/$/, '');
const res = await fetch(`${base}/api/workspaces/organizer/import-conference`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com/conference' }),
});

if (res.status === 404) {
  throw new Error('Organizer conference import route is not mounted (404).');
}
if (res.status >= 500) {
  const text = await res.text().catch(() => '');
  throw new Error(`Organizer conference import route crashed: HTTP ${res.status} ${text.slice(0, 200)}`);
}
if (![401, 403, 402].includes(res.status)) {
  throw new Error(`Expected auth/subscription protection from organizer import route, got HTTP ${res.status}.`);
}

console.log(`Organizer import API route reachable and protected correctly (HTTP ${res.status}).`);
