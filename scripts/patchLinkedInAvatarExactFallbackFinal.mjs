import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

// The dedicated profile scraper can legitimately return no portrait. Re-enable the posts
// fallback only when the already-patched conference importer still has strict member identity
// and person-photo safeguards. Earlier build patches may express the identity guard in either
// its original form or the later refined directIdentityMatch/postOwnerIdentityMatch form.
const hasStrictIdentity =
  source.includes('authorSlug !== requestedSlug && authorPublicIdentifier !== requestedSlug') ||
  (
    source.includes('const directIdentityMatch = authorSlug === requestedSlug || authorPublicIdentifier === requestedSlug;') &&
    source.includes('const postOwnerIdentityMatch = postOwnerSlug === requestedSlug && nameMatches;') &&
    source.includes('if (!directIdentityMatch && !postOwnerIdentityMatch) continue;')
  );

if (!hasStrictIdentity) {
  throw new Error('[linkedin-avatar-exact-final] refusing to enable fallback; strict member identity guard is missing');
}

const requiredMarkers = [
  'authorType && authorType !== "profile"',
  '/profile-(?:displayphoto|framedphoto)/i.test',
  'UPDATE users SET avatar = ? WHERE id = ?',
];

for (const marker of requiredMarkers) {
  if (!source.includes(marker)) {
    throw new Error(`[linkedin-avatar-exact-final] refusing to enable fallback; strict guard missing: ${marker}`);
  }
}

const disabled = '  if (false && authorAvatarUrl) {';
const enabled = '  if (authorAvatarUrl) {';

if (source.includes(disabled)) {
  source = source.replace(disabled, enabled);
} else if (!source.includes(enabled)) {
  throw new Error('[linkedin-avatar-exact-final] guarded author avatar block not found');
}

fs.writeFileSync(path, source);
console.log('[linkedin-avatar-exact-final] exact matched LinkedIn post-author portrait fallback enabled');
