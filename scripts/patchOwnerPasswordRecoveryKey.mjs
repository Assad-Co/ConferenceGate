import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authPath = resolve(process.cwd(), 'server/auth.ts');
const source = readFileSync(authPath, 'utf8');

const broken = 'return `owner_password_reset_used_\\${digest.slice(0, 40)}`;';
const fixed = 'return `owner_password_reset_used_${digest.slice(0, 40)}`;';

if (source.includes(fixed)) {
  console.log('[owner-recovery-patch] Recovery key interpolation is already correct.');
  process.exit(0);
}

if (!source.includes(broken)) {
  console.error('[owner-recovery-patch] Expected recovery-key pattern was not found; refusing to patch an unknown source state.');
  process.exit(1);
}

const patched = source.replace(broken, fixed);
writeFileSync(authPath, patched, 'utf8');
console.log('[owner-recovery-patch] Fixed per-token owner recovery key derivation.');
