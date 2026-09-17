import fs from 'node:fs';

// ConferenceGate public-LinkedIn signup should feel automatic:
// the member enters a public LinkedIn URL once, and ConferenceGate builds the profile,
// including the profile photo, without a second "Sync LinkedIn Photo" action.
//
// This runs after patchLinkedInOauthAvatarOwnership.mjs so it intentionally restores the
// exact-profile public importer as the avatar source for accounts that supplied a LinkedIn URL.

function replaceOnce(source, before, after, label, path) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-auto-avatar] ${path}: anchor not found (${label})`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

// 1) Restore automatic avatar writes from the identity-checked public LinkedIn profile import.
//    Also support the actual HarvestAPI output field `avatarUrl` (plus `avatar`) before the older
//    photo/profilePicture aliases. The earlier code never read avatarUrl, so valid portraits could
//    be present in the provider response while ConferenceGate still displayed generated initials.
{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const oauthOwned = [
    "       avatar = CASE",
    "         WHEN ? IS NOT NULL THEN avatar",
    "         WHEN ? IS NULL THEN avatar",
    "         ELSE avatar",
    "       END",
  ].join('\n');

  const automaticPublicAvatar = [
    "       avatar = CASE",
    "         WHEN ? IS NOT NULL THEN ?",
    "         ELSE avatar",
    "       END",
  ].join('\n');

  if (source.includes(oauthOwned)) {
    source = source.replace(oauthOwned, automaticPublicAvatar);
  } else if (!source.includes(automaticPublicAvatar)) {
    throw new Error('[linkedin-auto-avatar] final avatar SQL block not found');
  }

  const providerPhotoBefore = [
    '  const providerProfilePhotoUrl = [',
    '    imageUrlFrom(profile.photo),',
  ].join('\n');

  const providerPhotoAfter = [
    '  const providerProfilePhotoUrl = [',
    '    imageUrlFrom(profile.avatarUrl),',
    '    imageUrlFrom(profile.avatar),',
    '    imageUrlFrom(profile.photo),',
  ].join('\n');

  if (!source.includes(providerPhotoAfter)) {
    if (source.includes(providerPhotoBefore)) {
      source = source.replace(providerPhotoBefore, providerPhotoAfter);
    } else {
      console.warn('[linkedin-auto-avatar] provider photo list shape changed; avatarUrl alias was not inserted');
    }
  }

  // Keep the temporary signed-in diagnostic useful if it is present in this build.
  const diagnosticBefore = [
    '      describePhotoField("photo", profile.photo),',
  ].join('\n');
  const diagnosticAfter = [
    '      describePhotoField("avatarUrl", profile.avatarUrl),',
    '      describePhotoField("avatar", profile.avatar),',
    '      describePhotoField("photo", profile.photo),',
  ].join('\n');
  if (!source.includes(diagnosticAfter) && source.includes(diagnosticBefore)) {
    source = source.replace(diagnosticBefore, diagnosticAfter);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-auto-avatar] public LinkedIn profile import reads avatarUrl and sets the ConferenceGate avatar automatically');
}

// 2) Remove the separate Sync LinkedIn Photo control. The public URL flow is the primary UX.
{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const syncControl = [
    '                  <a',
    '                    href="/api/auth/linkedin/start"',
    '                    title="Securely sync your authenticated LinkedIn profile photo"',
    '                    className="text-[11px] font-bold text-[#0A66C2] hover:underline cursor-pointer inline-flex items-center gap-1"',
    '                  >',
    '                    <Linkedin className="w-3.5 h-3.5" />',
    '                    Sync LinkedIn Photo',
    '                  </a>',
  ].join('\n');

  if (source.includes(syncControl)) {
    source = source.replace(syncControl + '\n', '');
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-auto-avatar] removed redundant Sync LinkedIn Photo button');
}

// 3) Background repair for existing accounts that already have a LinkedIn URL but still show
// generated initials. The versioned key intentionally forces one fresh attempt after this fix.
{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = replaceOnce(
    source,
    "import { LiveSearchResult } from './api/search';",
    "import { LiveSearchResult } from './api/search';\nimport { syncLinkedInOnboarding } from './api/linkedinOnboarding';",
    'onboarding import',
    path,
  );

  const before = [
    '  useEffect(() => {',
    '    fetchCurrentUser()',
    '      .then((user) => {',
    '        if (user) applyAuthUser(user);',
    '      })',
    '      .finally(() => setAuthLoading(false));',
    '  }, []);',
  ].join('\n');

  const after = [
    '  useEffect(() => {',
    '    fetchCurrentUser()',
    '      .then((user) => {',
    '        if (!user) return;',
    '        applyAuthUser(user);',
    '',
    '        // Existing members who joined with a public LinkedIn URL should never have to press',
    '        // another sync button just to get the same profile picture. If the stored avatar is',
    '        // still empty/generated initials, perform one background LinkedIn rebuild this session.',
    '        const needsLinkedInAvatar = Boolean(',
    '          user.linkedinUrl && (!user.avatar || user.avatar.startsWith("data:image/svg+xml"))',
    '        );',
    '        if (needsLinkedInAvatar) {',
    '          const repairKey = `cg_linkedin_avatar_repair_v2:${user.id}`;',
    '          if (!sessionStorage.getItem(repairKey)) {',
    '            sessionStorage.setItem(repairKey, "1");',
    '            syncLinkedInOnboarding(user.linkedinUrl!)',
    '              .then(() => fetchCurrentUser())',
    '              .then((refreshedUser) => {',
    '                if (refreshedUser) applyAuthUser(refreshedUser);',
    '              })',
    '              .catch(() => {',
    '                // A provider/network failure should not lock the account out of future retries.',
    '                sessionStorage.removeItem(repairKey);',
    '              });',
    '          }',
    '        }',
    '      })',
    '      .finally(() => setAuthLoading(false));',
    '  }, []);',
  ].join('\n');

  source = replaceOnce(source, before, after, 'automatic repair after login', path);
  fs.writeFileSync(path, source);
  console.log('[linkedin-auto-avatar] existing LinkedIn accounts auto-repair missing profile photos and refresh the live UI');
}
