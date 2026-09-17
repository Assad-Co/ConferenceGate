import fs from 'node:fs';

// Final avatar source rule:
// - the dedicated profile scraper has already been identity-matched to the requested LinkedIn URL;
// - accept its photo-specific fields regardless of CDN hostname/path formatting;
// - never let conference-post data write users.avatar.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const startMarker = '  const profilePhotoUrl = [';
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error('[linkedin-avatar-profile-only] profile photo resolver start not found');

  const endMarker = '  }) || null;';
  const end = source.indexOf(endMarker, start);
  if (end === -1) throw new Error('[linkedin-avatar-profile-only] profile photo resolver end not found');

  const replacement = [
    '  // The profile actor result already passed the exact requested LinkedIn identity check.',
    '  // Therefore only photo-specific fields are considered, but no brittle CDN-path rule is used.',
    '  const profilePhotoUrl = [',
    '    imageUrlFrom(profile.photo),',
    '    imageUrlFrom(profile.photoUrl),',
    '    imageUrlFrom(profile.profilePicture),',
    '    imageUrlFrom(profile.profilePictureUrl),',
    '    imageUrlFrom(profile.displayPhoto),',
    '  ].find(Boolean) || null;',
  ].join('\n');

  source = source.slice(0, start) + replacement + source.slice(end + endMarker.length);
  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-profile-only] dedicated profile photo fields are authoritative without CDN-path filtering');
}

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const enabled = '  if (authorAvatarUrl) {';
  const disabled = '  if (false && authorAvatarUrl) {';
  if (source.includes(enabled)) {
    source = source.replace(enabled, disabled);
  } else if (!source.includes(disabled)) {
    throw new Error('[linkedin-avatar-profile-only] post avatar block not found');
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-profile-only] conference-post importer is blocked from writing account avatars');
}
