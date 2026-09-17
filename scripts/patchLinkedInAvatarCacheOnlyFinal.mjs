import fs from 'node:fs';

// FINAL LinkedIn avatar rule for the public-URL signup flow.
//
// Why this exists:
// Earlier builds could persist a LinkedIn CDN URL even when ConferenceGate failed to download it.
// The browser would then fail to render that stale/protected URL and fall back to initials ("AG"),
// while the app incorrectly believed an avatar already existed and stopped repairing it.
//
// Final behavior:
// 1) Always ask the dedicated URL-only fallback actor for a fresh profileImageUrl.
// 2) Never persist a raw LinkedIn CDN URL as users.avatar.
// 3) Persist only a successfully downloaded ConferenceGate-owned data:image URL.
// 4) Treat old http(s) avatar values as needing repair, because they are legacy hot-links.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // The secondary actor is cheap and purpose-built for public profile photos. Run it even when
  // the primary actor exposed a URL, because that URL may already be stale or protected.
  const conditionalFallback = [
    '  if (!profilePhotoUrl) {',
    '    const fallbackToken = process.env.APIFY_TOKEN?.trim();',
  ].join('\n');
  const unconditionalFallback = [
    '  {',
    '    const fallbackToken = process.env.APIFY_TOKEN?.trim();',
  ].join('\n');

  if (!source.includes(unconditionalFallback)) {
    if (!source.includes(conditionalFallback)) {
      throw new Error('[linkedin-avatar-cache-final] secondary actor block not found');
    }
    source = source.replace(conditionalFallback, unconditionalFallback);
  }

  // Never use the raw CDN URL as the account avatar. Only the successful download below may set it.
  const rawDefault = '  let profileAvatar: string | null = profilePhotoUrl;';
  const ownedDefault = '  let profileAvatar: string | null = null;';
  if (!source.includes(ownedDefault)) {
    if (!source.includes(rawDefault)) {
      throw new Error('[linkedin-avatar-cache-final] profileAvatar initialization not found');
    }
    source = source.replace(rawDefault, ownedDefault);
  }

  // Add explicit production diagnostics immediately before schema/storage work.
  const ensureSchemaAnchor = '  await ensureSchema();';
  const diagnostics = [
    '  if (profileAvatar) {',
    '    console.log("[linkedin-avatar-cache-final] SUCCESS copied LinkedIn portrait into ConferenceGate-owned avatar storage");',
    '  } else if (profilePhotoUrl) {',
    '    console.warn("[linkedin-avatar-cache-final] portrait URL was found but the image could not be copied; account avatar left unchanged");',
    '  } else {',
    '    console.warn("[linkedin-avatar-cache-final] no portrait URL was returned by primary, public-page, or secondary provider");',
    '  }',
    '',
    ensureSchemaAnchor,
  ].join('\n');

  if (!source.includes('[linkedin-avatar-cache-final] SUCCESS')) {
    const index = source.indexOf(ensureSchemaAnchor, source.indexOf('let profileAvatar'));
    if (index === -1) {
      throw new Error('[linkedin-avatar-cache-final] ensureSchema anchor after avatar cache not found');
    }
    source = source.slice(0, index) + diagnostics + source.slice(index + ensureSchemaAnchor.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-cache-final] server now stores only successfully copied LinkedIn portraits');
}

{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  // Force a new repair generation for existing accounts.
  source = source.replace(
    /cg_linkedin_avatar_repair_v\d+:/g,
    'cg_linkedin_avatar_repair_v4:',
  );

  // A legacy http(s) LinkedIn CDN avatar is NOT a valid owned avatar. Repair it too.
  const oldNeeds = '          user.linkedinUrl && (!user.avatar || user.avatar.startsWith("data:image/svg+xml"))';
  const newNeeds = '          user.linkedinUrl && (!user.avatar || user.avatar.startsWith("data:image/svg+xml") || /^https?:\\/\\//i.test(user.avatar))';
  if (!source.includes(newNeeds)) {
    if (!source.includes(oldNeeds)) {
      throw new Error('[linkedin-avatar-cache-final] missing-avatar repair condition not found');
    }
    source = source.replace(oldNeeds, newNeeds);
  }

  // If refresh still leaves a raw URL, do not mark the repair as complete.
  const oldPostCheck = '                  if (!refreshedUser.avatar || refreshedUser.avatar.startsWith("data:image/svg+xml")) {';
  const newPostCheck = '                  if (!refreshedUser.avatar || refreshedUser.avatar.startsWith("data:image/svg+xml") || /^https?:\\/\\//i.test(refreshedUser.avatar)) {';
  if (!source.includes(newPostCheck)) {
    if (source.includes(oldPostCheck)) {
      source = source.replace(oldPostCheck, newPostCheck);
    }
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-cache-final] client repairs empty, initials, and legacy hot-linked avatars');
}
