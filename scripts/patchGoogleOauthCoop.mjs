import fs from 'node:fs';

const target = 'server.ts';
const original = fs.readFileSync(target, 'utf8');
const from = 'res.setHeader("Cross-Origin-Opener-Policy", "same-origin");';
const to = 'res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");';

if (original.includes(to)) {
  console.log('[google-oauth-coop] already applied');
  process.exit(0);
}

if (!original.includes(from)) {
  throw new Error('[google-oauth-coop] expected COOP header not found; refusing unsafe patch');
}

fs.writeFileSync(target, original.replace(from, to));
console.log('[google-oauth-coop] applied same-origin-allow-popups for Google Sign-In popup compatibility');
