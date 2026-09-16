import fs from 'node:fs';

// Final fallback for profile photos:
// 1) Prefer the dedicated profile scraper's `photo` field.
// 2) If that actor does not expose a photo, allow the posts actor to fill the avatar ONLY after
//    the earlier identity patch has proved the post author is the exact requested LinkedIn member
//    and the image URL is a LinkedIn profile-displayphoto/framedphoto URL.
// 3) Refresh the authenticated-user snapshot after the posts import finishes so the new avatar is
//    visible immediately instead of requiring logout/reload.

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const hasExactIdentityGuard = source.includes('authorPublicIdentifier') &&
    source.includes('authorSlug !== requestedSlug') &&
    source.includes('authorType && authorType !== "profile"');
  const hasPersonPhotoGuard = source.includes('/profile-(?:displayphoto|framedphoto)/i.test');
  if (!hasExactIdentityGuard || !hasPersonPhotoGuard) {
    throw new Error('[linkedin-avatar-strict-fallback] refusing to enable post avatar fallback without strict identity/photo guards');
  }

  const disabled = '  if (false && authorAvatarUrl) {';
  const enabled = '  if (authorAvatarUrl) {';
  if (source.includes(disabled)) {
    source = source.replace(disabled, enabled);
  } else if (!source.includes(enabled)) {
    throw new Error('[linkedin-avatar-strict-fallback] guarded author-avatar block not found');
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-strict-fallback] exact member post-author portrait fallback enabled');
}

{
  const path = 'src/api/linkedinConferenceActivity.ts';
  let source = fs.readFileSync(path, 'utf8');

  const before = [
    "  const body = await readJson(response);",
    "  if (!response.ok) throw new Error(body.error || 'Could not import LinkedIn conference activity.');",
    "  return body;",
    "}",
  ].join('\n');

  const after = [
    "  const body = await readJson(response);",
    "  if (!response.ok) throw new Error(body.error || 'Could not import LinkedIn conference activity.');",
    "",
    "  // The strictly matched post-author portrait fallback may have updated users.avatar.",
    "  // Refresh the signed-in user only after that server request has completed so App receives",
    "  // the final avatar instead of the stale image that existed before the posts scan finished.",
    "  try {",
    "    const authResponse = await fetch('/api/auth/me', { credentials: 'include' });",
    "    const authBody = await readJson(authResponse);",
    "    if (authResponse.ok && authBody?.user && typeof window !== 'undefined') {",
    "      window.dispatchEvent(new CustomEvent('conferencegate:auth-user-refreshed', { detail: authBody.user }));",
    "    }",
    "  } catch {",
    "    // Non-critical; the persisted avatar will appear after the next page reload.",
    "  }",
    "",
    "  return body;",
    "}",
  ].join('\n');

  if (!source.includes(after)) {
    const index = source.lastIndexOf(before);
    if (index === -1) throw new Error('[linkedin-avatar-strict-fallback] client refresh return block not found');
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-strict-fallback] conference refresh now reapplies the final authenticated avatar immediately');
}
