import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

// The dedicated profile scraper currently returns no portrait for some profiles.
// Re-enable the posts fallback only after the earlier identity patch has made it strict:
// - exact requested LinkedIn slug/publicIdentifier match
// - author must be a personal profile (when type is present)
// - image must be a LinkedIn profile-displayphoto/profile-framedphoto URL
// This prevents employer/event/association logos from being used as the member avatar.
const strictIdentityMarkers = [
  'authorSlug !== requestedSlug && authorPublicIdentifier !== requestedSlug',
  'authorType && authorType !== "profile"',
  '/profile-(?:displayphoto|framedphoto)/i.test',
  'UPDATE users SET avatar = ? WHERE id = ?',
];

for (const marker of strictIdentityMarkers) {
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
