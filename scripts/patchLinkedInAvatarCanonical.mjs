import fs from 'node:fs';

// Final avatar ownership rule:
// - The dedicated LinkedIn profile scraper is authoritative for the member portrait because its
//   returned profile URL/publicIdentifier is already checked against the requested member.
// - The posts scraper is NEVER allowed to write the account avatar; reposts, organisations and
//   event pages can expose logos in post author/media fields and previously caused the AAPG logo
//   to overwrite the member portrait.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const strictBlockStart = source.indexOf('  const looksLikeLinkedInPersonPhoto =');
  const strictBlockEndMarker = ' || null;';
  if (strictBlockStart !== -1) {
    const photoDecl = source.indexOf('  const profilePhotoUrl = photoCandidates', strictBlockStart);
    const strictBlockEnd = source.indexOf(strictBlockEndMarker, photoDecl);
    if (photoDecl === -1 || strictBlockEnd === -1) {
      throw new Error('[linkedin-avatar-canonical] dedicated profile photo block bounds not found');
    }

    // Find the beginning of the looksLike function and replace through the profilePhotoUrl block.
    const replacement = [
      '  // The dedicated profile actor has already passed the exact requested-profile identity check.',
      '  // Its documented `photo` field is therefore the canonical member portrait. Do not infer',
      '  // avatars from generic image/logo fields or from conference posts.',
      '  const profilePhotoCandidate = text(profile.photo);',
      '  const profilePhotoUrl = profilePhotoCandidate && /^https?:\\/\\//i.test(profilePhotoCandidate)',
      '    ? profilePhotoCandidate',
      '    : null;',
    ].join('\n');

    source = source.slice(0, strictBlockStart) + replacement + source.slice(strictBlockEnd + strictBlockEndMarker.length);
  } else if (!source.includes('const profilePhotoCandidate = text(profile.photo);')) {
    throw new Error('[linkedin-avatar-canonical] strict profile-photo block not found');
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-canonical] dedicated profile.photo is the sole authoritative avatar source');
}

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // Keep the post-author diagnostic extraction available, but permanently prevent it from writing
  // users.avatar. Conference-post data remains useful for conference evidence only.
  const active = '  if (authorAvatarUrl) {';
  const disabled = '  if (false && authorAvatarUrl) {';
  if (!source.includes(disabled)) {
    const index = source.indexOf(active);
    if (index === -1) {
      throw new Error('[linkedin-avatar-canonical] post-author avatar write block not found');
    }
    source = source.slice(0, index) + disabled + source.slice(index + active.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-canonical] conference-post importer cannot overwrite member avatars');
}
