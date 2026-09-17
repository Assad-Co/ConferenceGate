import fs from 'node:fs';

// Final simplification: LinkedIn is the authoritative source of a member's LinkedIn photo.
// Public-profile scraping remains useful for profile enrichment, but it is not a reliable identity/photo
// transport. The simplest user experience is therefore: Continue with LinkedIn -> receive the OIDC
// `picture` claim -> cache it in ConferenceGate (or keep that authenticated picture URL as a fallback).

// 1) Always render the LinkedIn sign-in button. The server route already owns configuration checks,
// so the frontend must not hide the button based on a VITE_ variable that Render may not expose.
{
  const path = 'src/components/auth/LinkedInSignInButton.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replace(/\nconst CLIENT_ID = import\.meta\.env\.VITE_LINKEDIN_CLIENT_ID as string \| undefined;\n/, '\n');
  source = source.replace(/\n  if \(!CLIENT_ID\) return null;\n/, '\n');
  source = source.replace(
    "{text === 'signup_with' ? 'Sign up with LinkedIn' : 'Sign in with LinkedIn'}",
    "Continue with LinkedIn",
  );

  fs.writeFileSync(path, source);
  console.log('[linkedin-login-first] LinkedIn button is always visible and uses one simple Continue action');
}

// 2) Make authenticated LinkedIn OIDC the avatar source. Prefer a ConferenceGate-owned copy; if the
// CDN refuses the server-side copy, retain the authenticated picture URL returned by LinkedIn. It is
// refreshed on every LinkedIn sign-in, so this fallback is much safer than scraping a public page URL.
{
  const path = 'server/auth.ts';
  let source = fs.readFileSync(path, 'utf8');

  const callbackBefore = '    const ownedAvatar = await copyLinkedInAvatarToDataUrl(picture);';
  const callbackAfter = [
    '    const copiedAvatar = await copyLinkedInAvatarToDataUrl(picture);',
    '    const ownedAvatar = copiedAvatar || (picture && /^https:\\/\\//i.test(picture) ? picture : null);',
    '    console.log(`[linkedin-oauth-avatar] picture_claim=${picture ? "yes" : "no"} copied=${copiedAvatar ? "yes" : "no"} stored=${ownedAvatar ? "yes" : "no"}`);',
  ].join('\n');
  if (!source.includes(callbackAfter)) {
    if (!source.includes(callbackBefore)) throw new Error('[linkedin-login-first] OAuth callback avatar anchor not found');
    source = source.replace(callbackBefore, callbackAfter);
  }

  const pendingBefore = '  const ownedAvatar = await copyLinkedInAvatarToDataUrl(pending.avatar);';
  const pendingAfter = [
    '  const copiedAvatar = await copyLinkedInAvatarToDataUrl(pending.avatar);',
    '  const ownedAvatar = copiedAvatar || (pending.avatar && /^https:\\/\\//i.test(pending.avatar) ? pending.avatar : null);',
  ].join('\n');
  if (!source.includes(pendingAfter)) {
    if (!source.includes(pendingBefore)) throw new Error('[linkedin-login-first] pending LinkedIn avatar anchor not found');
    source = source.replace(pendingBefore, pendingAfter);
  }

  const passwordBefore = [
    '  if (!row.password_hash) {',
    '    return res.status(401).json({ error: "This account uses Google Sign-In. Please continue with Google." });',
    '  }',
  ].join('\n');
  const passwordAfter = [
    '  if (!row.password_hash) {',
    '    if (row.linkedin_id) {',
    '      return res.status(401).json({ error: "This account uses LinkedIn Sign-In. Please continue with LinkedIn." });',
    '    }',
    '    if (row.google_id) {',
    '      return res.status(401).json({ error: "This account uses Google Sign-In. Please continue with Google." });',
    '    }',
    '    return res.status(401).json({ error: "This account uses social sign-in. Please continue with your sign-in provider." });',
    '  }',
  ].join('\n');
  if (!source.includes(passwordAfter)) {
    if (!source.includes(passwordBefore)) throw new Error('[linkedin-login-first] password social-login message anchor not found');
    source = source.replace(passwordBefore, passwordAfter);
  }

  const configAnchor = 'const LINKEDIN_OAUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes — just long enough to complete the redirect round trip';
  const configAfter = `${configAnchor}\nconsole.log(\`[linkedin-oauth] configured=\${LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET ? "yes" : "no"}\`);`;
  if (!source.includes('[linkedin-oauth] configured=')) {
    if (!source.includes(configAnchor)) throw new Error('[linkedin-login-first] LinkedIn OAuth config anchor not found');
    source = source.replace(configAnchor, configAfter);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-login-first] authenticated LinkedIn sign-in now owns profile-photo sync');
}

// 3) Do not classify an authenticated LinkedIn picture URL as a broken legacy avatar. If the OIDC
// image could not be copied, the fresh authenticated URL is still valid and should render directly.
{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replace(
    'user.linkedinUrl && (!user.avatar || user.avatar.startsWith("data:image/svg+xml") || /^https?:\\/\\//i.test(user.avatar))',
    'user.linkedinUrl && (!user.avatar || user.avatar.startsWith("data:image/svg+xml"))',
  );
  source = source.replace(
    'if (!refreshedUser.avatar || refreshedUser.avatar.startsWith("data:image/svg+xml") || /^https?:\\/\\//i.test(refreshedUser.avatar)) {',
    'if (!refreshedUser.avatar || refreshedUser.avatar.startsWith("data:image/svg+xml")) {',
  );

  fs.writeFileSync(path, source);
  console.log('[linkedin-login-first] authenticated LinkedIn picture URLs are treated as valid avatars');
}
