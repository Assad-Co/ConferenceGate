import fs from 'node:fs';

// Final persistence backstop for public-URL LinkedIn avatars.
// Earlier diagnostics proved that ConferenceGate successfully recovered and downloaded the
// exact public-profile portrait, but that log happened before the users.avatar write. This patch
// makes the final write explicit after all profile-enrichment SQL, verifies what is actually stored,
// and forces a fresh client repair generation so the live profile re-fetches /api/auth/me.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const anchor = '  const stored = await readStoredProfile(userId);';
  if (!source.includes(anchor)) {
    throw new Error('[linkedin-avatar-persist-final] stored-profile response anchor not found');
  }

  const block = [
    '  // LINKEDIN_AVATAR_PERSIST_FINAL',
    '  // At this point profileAvatar is the exact public-profile portrait already validated and',
    '  // copied to a ConferenceGate-owned data URL. Persist it directly so no earlier CASE/placeholder',
    '  // transformation can prevent the final users.avatar write.',
    '  if (profileAvatar) {',
    '    await dbRun("UPDATE users SET avatar = ? WHERE id = ?", [profileAvatar, userId]);',
    '  }',
    '  const persistedAvatarRow = await dbGet<{ avatar: string | null }>("SELECT avatar FROM users WHERE id = ?", [userId]);',
    '  const persistedAvatar = typeof persistedAvatarRow?.avatar === "string" ? persistedAvatarRow.avatar : "";',
    '  console.log(',
    '    "[linkedin-avatar-persist-final] persisted=" +',
    '      (persistedAvatar.startsWith("data:image/") ? "data-image" : persistedAvatar ? "other" : "missing") +',
    '      " length=" + persistedAvatar.length,',
    '  );',
    '',
    anchor,
  ].join('\n');

  if (!source.includes('// LINKEDIN_AVATAR_PERSIST_FINAL')) {
    source = source.replace(anchor, block);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-persist-final] explicit users.avatar persistence and verification installed');
}

{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/cg_linkedin_avatar_repair_v\d+:/g, 'cg_linkedin_avatar_repair_v7:');
  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-persist-final] forced fresh client avatar repair v7');
}
