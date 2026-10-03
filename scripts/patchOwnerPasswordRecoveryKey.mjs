import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function patchOwnerRecoveryKey() {
  const authPath = resolve(process.cwd(), 'server/auth.ts');
  const source = readFileSync(authPath, 'utf8');
  const broken = 'return `owner_password_reset_used_\\${digest.slice(0, 40)}`;';
  const fixed = 'return `owner_password_reset_used_${digest.slice(0, 40)}`;';

  if (source.includes(fixed)) {
    console.log('[owner-recovery-patch] Recovery key interpolation is already correct.');
    return;
  }
  if (!source.includes(broken)) {
    throw new Error('[owner-recovery-patch] Expected recovery-key pattern was not found; refusing to patch an unknown source state.');
  }

  writeFileSync(authPath, source.replace(broken, fixed), 'utf8');
  console.log('[owner-recovery-patch] Fixed per-token owner recovery key derivation.');
}

function mountAuthRecoveryRouter() {
  const serverPath = resolve(process.cwd(), 'server.ts');
  let source = readFileSync(serverPath, 'utf8');
  const importLine = 'import { authRecoveryRouter } from "./server/authRecovery";';
  const importAnchor = 'import { authRouter, verifySessionToken, COOKIE_NAME, initAuthSecret } from "./server/auth";';
  const mountLine = '  app.use("/api/auth", authRecoveryRouter);';
  const mountAnchor = '  app.use("/api/auth", authRouter);';
  let changed = false;

  if (!source.includes(importLine)) {
    if (!source.includes(importAnchor)) {
      throw new Error('[auth-recovery-patch] Could not find the auth import anchor in server.ts.');
    }
    source = source.replace(importAnchor, `${importAnchor}\n${importLine}`);
    changed = true;
  }

  if (!source.includes(mountLine)) {
    if (!source.includes(mountAnchor)) {
      throw new Error('[auth-recovery-patch] Could not find the auth mount anchor in server.ts.');
    }
    source = source.replace(mountAnchor, `${mountAnchor}\n${mountLine}`);
    changed = true;
  }

  if (changed) {
    writeFileSync(serverPath, source, 'utf8');
    console.log('[auth-recovery-patch] Mounted the Phase 11.3 account recovery router.');
  } else {
    console.log('[auth-recovery-patch] Account recovery router is already mounted.');
  }
}

try {
  patchOwnerRecoveryKey();
  mountAuthRecoveryRouter();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
