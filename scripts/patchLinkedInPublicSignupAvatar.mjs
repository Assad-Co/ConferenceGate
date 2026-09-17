import fs from 'node:fs';

// Public-LinkedIn quick-join owns the automatic profile-photo experience.
// The member provides their exact public linkedin.com/in/... URL during signup. ConferenceGate
// resolves the photo only from that identity-matched profile import, downloads it server-side,
// and stores a ConferenceGate-owned data:image URL. Conference-post images are never allowed to
// become the account avatar.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // Never store the LinkedIn CDN URL itself as the account avatar. The earlier profile importer
  // already attempts a server-side download; only a successful ConferenceGate-owned data URL may
  // be written to users.avatar.
  source = source.replace(
    '  let profileAvatar: string | null = profilePhotoUrl;',
    '  let profileAvatar: string | null = null;',
  );

  source = source.replace(
    '      // The remote URL is still usable as a fallback if LinkedIn blocks server-side image fetch.',
    '      // Keep the existing ConferenceGate avatar if LinkedIn blocks the server-side copy.',
  );

  const oauthNoop = [
    "       avatar = CASE",
    "         WHEN ? IS NOT NULL THEN avatar",
    "         WHEN ? IS NULL THEN avatar",
    "         ELSE avatar",
    "       END",
  ].join('\n');

  const publicOwnedCopy = [
    "       avatar = CASE",
    "         WHEN ? IS NOT NULL THEN ?",
    "         ELSE avatar",
    "       END",
  ].join('\n');

  if (source.includes(oauthNoop)) {
    source = source.replace(oauthNoop, publicOwnedCopy);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-public-signup-avatar] identity-matched public LinkedIn profile photo is copied into ConferenceGate automatically');
}

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // Conference posts are useful evidence, but their author/media images can be company logos,
  // event artwork, repost avatars, or stale assets. They must never change the member's avatar.
  source = source.replaceAll('  if (authorAvatarUrl) {', '  if (false && authorAvatarUrl) {');
  source = source.replaceAll('  if (safeMemberPortrait) {', '  if (false && safeMemberPortrait) {');

  fs.writeFileSync(path, source);
  console.log('[linkedin-public-signup-avatar] conference-post avatar writers disabled');
}

{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  // Public-URL signup is meant to be zero-extra-step. If an earlier build patch inserted a
  // separate Sync LinkedIn Photo link, remove it. OAuth remains available from the normal auth UI
  // as a fallback; it is not required for the public-profile quick-join path.
  const syncLink = [
    '                  <a',
    '                    href="/api/auth/linkedin/start"',
    '                    title="Securely sync your authenticated LinkedIn profile photo"',
    '                    className="text-[11px] font-bold text-[#0A66C2] hover:underline cursor-pointer inline-flex items-center gap-1"',
    '                  >',
    '                    <Linkedin className="w-3.5 h-3.5" />',
    '                    Sync LinkedIn Photo',
    '                  </a>',
  ].join('\n');

  if (source.includes(syncLink)) {
    source = source.replace(syncLink + '\n', '');
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-public-signup-avatar] no extra photo-sync step shown after public LinkedIn signup');
}
