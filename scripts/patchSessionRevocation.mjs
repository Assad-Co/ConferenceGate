import fs from 'node:fs';
import './patchLinkedInAuthUX.mjs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('server/auth.ts', (source) => {
  if (!source.includes('const sessionVersions = new Map<string, number>();')) {
    source = source.replace(
      'let JWT_SECRET: string | null = null;',
      `let JWT_SECRET: string | null = null;\n\n// Per-account session generation. Password changes increment this value so every JWT minted\n// before the change becomes invalid without rotating the global signing secret or affecting\n// other ConferenceGate users. Values are persisted in app_secrets and reloaded on boot.\nconst sessionVersions = new Map<string, number>();\n\nfunction sessionVersionKey(userId: string): string {\n  return \`session_version:\${userId}\`;\n}\n\nfunction currentSessionVersion(userId: string): number {\n  return sessionVersions.get(userId) || 0;\n}\n\nexport async function initSessionVersions(): Promise<void> {\n  const rows = await dbAll<{ key: string; value: string }>(\n    \"SELECT key, value FROM app_secrets WHERE key LIKE 'session_version:%'\"\n  );\n  sessionVersions.clear();\n  for (const row of rows) {\n    const userId = row.key.slice('session_version:'.length);\n    const version = Number(row.value);\n    if (userId && Number.isSafeInteger(version) && version >= 0) sessionVersions.set(userId, version);\n  }\n}\n\nexport async function revokeUserSessions(userId: string): Promise<number> {\n  const next = currentSessionVersion(userId) + 1;\n  sessionVersions.set(userId, next);\n  await dbRun(\"INSERT OR REPLACE INTO app_secrets (key, value) VALUES (?, ?)\", [sessionVersionKey(userId), String(next)]);\n  return next;\n}`
    );
  }

  source = source.replace(
    'function signToken(userId: string) {\n  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: "7d" });\n}',
    'function signToken(userId: string) {\n  return jwt.sign({ sub: userId, sv: currentSessionVersion(userId) }, getJwtSecret(), { expiresIn: "7d" });\n}'
  );

  source = source.replace(
    'const payload = jwt.verify(token, getJwtSecret()) as { sub: string };\n    return payload.sub;',
    'const payload = jwt.verify(token, getJwtSecret()) as { sub: string; sv?: number };\n    if (!payload.sub || Number(payload.sv || 0) !== currentSessionVersion(payload.sub)) return null;\n    return payload.sub;'
  );

  // Account Settings password change: revoke every prior session, including any stolen/forgotten cookie.
  const accountPasswordUpdate = '  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, row.id]);\n  res.json({ ok: true, hasPassword: true });';
  if (source.includes(accountPasswordUpdate) && !source.includes('await revokeUserSessions(row.id);\n  res.json({ ok: true, hasPassword: true')) {
    source = source.replace(
      accountPasswordUpdate,
      '  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, row.id]);\n  await revokeUserSessions(row.id);\n  res.json({ ok: true, hasPassword: true, sessionsRevoked: true });'
    );
  }

  // Emergency owner recovery must revoke old sessions before minting the fresh owner cookie.
  const ownerUpdate = '  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, owner.id]);';
  if (source.includes(ownerUpdate) && !source.includes(ownerUpdate + '\n  await revokeUserSessions(owner.id);')) {
    source = source.replace(ownerUpdate, ownerUpdate + '\n  await revokeUserSessions(owner.id);');
  }

  return source;
});

patchFile('server/authRecovery.ts', (source) => {
  if (!source.includes('revokeUserSessions')) {
    source = source.replace(
      'import { asyncHandler } from "./asyncHandler";',
      'import { asyncHandler } from "./asyncHandler";\nimport { revokeUserSessions } from "./auth";'
    );
  }
  const update = '  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);\n  await removeResetRecord(user.id, tokenHash);';
  if (source.includes(update) && !source.includes('await revokeUserSessions(user.id);\n  await removeResetRecord')) {
    source = source.replace(
      update,
      '  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);\n  await revokeUserSessions(user.id);\n  await removeResetRecord(user.id, tokenHash);'
    );
  }
  return source;
});

patchFile('server.ts', (source) => {
  source = source.replace(
    'import { authRouter, verifySessionToken, COOKIE_NAME, initAuthSecret } from "./server/auth";',
    'import { authRouter, verifySessionToken, COOKIE_NAME, initAuthSecret, initSessionVersions } from "./server/auth";'
  );
  if (!source.includes('await initSessionVersions();')) {
    source = source.replace('  await initAuthSecret();', '  await initAuthSecret();\n  await initSessionVersions();');
  }
  return source;
});

console.log('[session-revocation] per-account session generations wired to password change/reset');
