import fs from 'node:fs';

// Final LinkedIn avatar repair:
// - keep the dedicated profile scraper authoritative when it returns a real member portrait,
//   including object/nested photo shapes (not only a plain string);
// - if the profile actor omits the portrait, accept a posts-actor portrait only when the post
//   itself belongs to the requested LinkedIn vanity slug and the author name matches the member.
// This runs last so earlier avatar patches cannot narrow the photo back to the stale/logo case.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const oldBlock = [
    '  // The dedicated profile actor has already passed the exact requested-profile identity check.',
    '  // Its documented `photo` field is therefore the canonical member portrait. Do not infer',
    '  // avatars from generic image/logo fields or from conference posts.',
    '  const profilePhotoCandidate = text(profile.photo);',
    '  const profilePhotoUrl = profilePhotoCandidate && /^https?:\\/\\//i.test(profilePhotoCandidate)',
    '    ? profilePhotoCandidate',
    '    : null;',
  ].join('\n');

  const newBlock = [
    '  // The dedicated profile actor has already passed the exact requested-profile identity check.',
    '  // Resolve only photo-specific fields, but support either a direct URL or nested { url/src }',
    '  // provider shapes. Generic company/event image fields are intentionally excluded.',
    '  const profilePhotoUrl = [',
    '    imageUrlFrom(profile.photo),',
    '    imageUrlFrom(profile.photoUrl),',
    '    imageUrlFrom(profile.profilePicture),',
    '    imageUrlFrom(profile.profilePictureUrl),',
    '    imageUrlFrom(profile.displayPhoto),',
    '  ].find((candidate) => {',
    '    if (!candidate) return false;',
    '    try {',
    '      const url = new URL(candidate);',
    '      const host = url.hostname.toLowerCase();',
    '      const pathAndQuery = (url.pathname + url.search).toLowerCase();',
    '      return host.endsWith("licdn.com") && /profile-(?:displayphoto|framedphoto)/i.test(pathAndQuery);',
    '    } catch {',
    '      return false;',
    '    }',
    '  }) || null;',
  ].join('\n');

  if (!source.includes(newBlock)) {
    const index = source.indexOf(oldBlock);
    if (index === -1) throw new Error('[linkedin-avatar-final] canonical profile photo block not found');
    source = source.slice(0, index) + newBlock + source.slice(index + oldBlock.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-final] profile portrait supports safe nested photo fields');
}

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replace(
    'SELECT id, linkedin_url FROM users WHERE id = ?',
    'SELECT id, linkedin_url, name FROM users WHERE id = ?',
  );

  const oldGuard = [
    '      const authorUrl = author.linkedinUrl || author.url || post.authorProfileUrl;',
    '      const authorSlug = profileSlug(authorUrl);',
    '      const authorPublicIdentifier = clean(author.publicIdentifier).toLowerCase();',
    '      const authorType = clean(author.type).toLowerCase();',
    '',
    '      // Never accept an unknown/missing author. Reposts and organisation posts can carry logos.',
    '      if (authorType && authorType !== "profile") continue;',
    '      if (authorSlug !== requestedSlug && authorPublicIdentifier !== requestedSlug) continue;',
  ].join('\n');

  const newGuard = [
    '      const authorUrl = author.linkedinUrl || author.url || post.authorProfileUrl;',
    '      const authorSlug = profileSlug(authorUrl);',
    '      const authorPublicIdentifier = clean(author.publicIdentifier).toLowerCase();',
    '      const authorType = clean(author.type).toLowerCase();',
    '      const postOwnerSlug = (() => {',
    '        try {',
    '          const url = new URL(clean(post.linkedinUrl || post.postUrl || post.url));',
    '          const match = url.pathname.match(/^\\/posts\\/([^_/?#]+)/i);',
    '          return match?.[1]?.toLowerCase() || null;',
    '        } catch {',
    '          return null;',
    '        }',
    '      })();',
    '      const normalizeName = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();',
    '      const authorName = normalizeName(author.name);',
    '      const memberName = normalizeName(user.name);',
    '      const authorParts = authorName.split(/\\s+/).filter(Boolean);',
    '      const memberParts = memberName.split(/\\s+/).filter(Boolean);',
    '      const nameMatches = Boolean(authorParts.length && memberParts.length &&',
    '        authorParts[0] === memberParts[0] &&',
    '        authorParts[authorParts.length - 1] === memberParts[memberParts.length - 1]);',
    '',
    '      // Primary match: LinkedIn author profile/publicIdentifier equals the requested profile.',
    '      // Backstop: LinkedIn post URL belongs to that exact vanity slug and first+last name match.',
    '      if (authorType && authorType !== "profile") continue;',
    '      const directIdentityMatch = authorSlug === requestedSlug || authorPublicIdentifier === requestedSlug;',
    '      const postOwnerIdentityMatch = postOwnerSlug === requestedSlug && nameMatches;',
    '      if (!directIdentityMatch && !postOwnerIdentityMatch) continue;',
  ].join('\n');

  if (!source.includes(newGuard)) {
    const index = source.indexOf(oldGuard);
    if (index === -1) throw new Error('[linkedin-avatar-final] post author identity guard not found');
    source = source.slice(0, index) + newGuard + source.slice(index + oldGuard.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-final] exact post-owner/name portrait fallback enabled');
}
