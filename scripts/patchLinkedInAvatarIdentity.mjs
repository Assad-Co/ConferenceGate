import fs from 'node:fs';

function replaceRequired(source, before, after, label, path) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-avatar-identity] ${path}: anchor not found (${label})`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

// 1) Dedicated profile scraper: accept only LinkedIn member portrait URLs, never generic
// organisation/event/logo image fields.
{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const before = [
    '  const photoCandidates = [',
    '    profile.photo,',
    '    profile.photoUrl,',
    '    profile.profilePicture,',
    '    profile.profilePictureUrl,',
    '    profile.profilePictures,',
    '    profile.profileImage,',
    '    profile.profileImageUrl,',
    '    profile.displayPhoto,',
    '    profile.displayPicture,',
    '    profile.picture,',
    '    profile.pictureUrl,',
    '    profile.avatar,',
    '    profile.image,',
    '    profile.imageUrl,',
    '  ];',
    '  const profilePhotoUrl = photoCandidates.map((candidate) => imageUrlFrom(candidate)).find(Boolean) || null;',
  ].join('\n');

  const after = [
    '  const looksLikeLinkedInPersonPhoto = (value: string | null): value is string => {',
    '    if (!value) return false;',
    '    try {',
    '      const url = new URL(value);',
    '      const host = url.hostname.toLowerCase();',
    '      const pathAndQuery = (url.pathname + url.search).toLowerCase();',
    "      return host.endsWith('licdn.com') && /profile-(?:displayphoto|framedphoto)/i.test(pathAndQuery);",
    '    } catch {',
    '      return false;',
    '    }',
    '  };',
    '',
    '  // Only fields that can represent the member portrait. Generic image/avatar fields can',
    '  // contain employer, school, association or event logos and are intentionally excluded.',
    '  const photoCandidates = [',
    '    profile.photo,',
    '    profile.profilePictureUrl,',
    '    profile.profilePicture,',
    '    profile.profileImageUrl,',
    '    profile.displayPhoto,',
    '  ];',
    '  const profilePhotoUrl = photoCandidates',
    '    .map((candidate) => imageUrlFrom(candidate))',
    '    .find((candidate) => looksLikeLinkedInPersonPhoto(candidate)) || null;',
  ].join('\n');

  source = replaceRequired(source, before, after, 'strict member-photo selection', path);
  fs.writeFileSync(path, source);
  console.log(`[linkedin-avatar-identity] patched ${path}`);
}

// 2) Posts fallback: require an exact member identity match, then accept only LinkedIn person-photo
// CDN URLs. This patch intentionally uses bounded anchors instead of exact full-block matching so it
// remains compatible with the earlier deep-evidence and refresh-reliability patches.
{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const authorOld = [
    '    for (const rawPost of posts) {',
    '      const post = rawPost && typeof rawPost === "object" ? rawPost as Record<string, any> : {};',
    '      if (!targetAuthorMatches(post, requestedUrl)) continue;',
    '      const author = post.author && typeof post.author === "object" ? post.author : {};',
    '      const candidates = [',
  ].join('\n');

  const authorNew = [
    '    const requestedSlug = profileSlug(requestedUrl);',
    '    if (!requestedSlug) return null;',
    '    for (const rawPost of posts) {',
    '      const post = rawPost && typeof rawPost === "object" ? rawPost as Record<string, any> : {};',
    '      const author = post.author && typeof post.author === "object" ? post.author : {};',
    '      const authorUrl = author.linkedinUrl || author.url || post.authorProfileUrl;',
    '      const authorSlug = profileSlug(authorUrl);',
    '      const authorPublicIdentifier = clean(author.publicIdentifier).toLowerCase();',
    '      const authorType = clean(author.type).toLowerCase();',
    '',
    '      // Never accept an unknown/missing author. Reposts and organisation posts can carry logos.',
    '      if (authorType && authorType !== "profile") continue;',
    '      if (authorSlug !== requestedSlug && authorPublicIdentifier !== requestedSlug) continue;',
    '',
    '      const candidates = [',
  ].join('\n');

  source = replaceRequired(source, authorOld, authorNew, 'require exact post author identity', path);

  const strictMatcherMarker = 'return url.hostname.toLowerCase().endsWith("licdn.com") && /profile-(?:displayphoto|framedphoto)/i.test';
  if (!source.includes(strictMatcherMarker)) {
    const scopeStart = source.indexOf('  const authorAvatarUrl = (() => {');
    if (scopeStart === -1) throw new Error(`[linkedin-avatar-identity] ${path}: author avatar fallback not found`);
    const foundStart = source.indexOf('      const found = candidates.find(', scopeStart);
    const foundEndMarker = '      if (found) return found.trim();';
    const foundEnd = source.indexOf(foundEndMarker, foundStart);
    if (foundStart === -1 || foundEnd === -1) {
      throw new Error(`[linkedin-avatar-identity] ${path}: candidate matcher bounds not found`);
    }
    const strictMatcher = [
      '      const found = candidates.find((value) => {',
      '        if (typeof value !== "string" || !/^https?:\\/\\//i.test(value.trim())) return false;',
      '        try {',
      '          const url = new URL(value.trim());',
      '          return url.hostname.toLowerCase().endsWith("licdn.com") && /profile-(?:displayphoto|framedphoto)/i.test((url.pathname + url.search).toLowerCase());',
      '        } catch {',
      '          return false;',
      '        }',
      '      });',
      '      if (found) return found.trim();',
    ].join('\n');
    source = source.slice(0, foundStart) + strictMatcher + source.slice(foundEnd + foundEndMarker.length);
  }

  const replacementMarker = 'UPDATE users SET avatar = ? WHERE id = ?';
  if (!source.includes(replacementMarker)) {
    const scopeStart = source.indexOf('  if (authorAvatarUrl) {');
    const updateStart = source.indexOf('    await dbRun(', scopeStart);
    const updateEndMarker = '    );';
    const updateEnd = source.indexOf(updateEndMarker, updateStart);
    if (scopeStart === -1 || updateStart === -1 || updateEnd === -1) {
      throw new Error(`[linkedin-avatar-identity] ${path}: avatar update block bounds not found`);
    }
    const updateBlock = [
      '    // Explicit Refresh LinkedIn sync: the exact matched member portrait repairs stale/wrong',
      '    // auto-imported logos. The member can still use Change Photo afterwards.',
      '    await dbRun(',
      '      `UPDATE users SET avatar = ? WHERE id = ?`,',
      '      [avatarValue, userId],',
      '    );',
    ].join('\n');
    source = source.slice(0, updateStart) + updateBlock + source.slice(updateEnd + updateEndMarker.length);
  }

  fs.writeFileSync(path, source);
  console.log(`[linkedin-avatar-identity] patched ${path}`);
}

console.log('[linkedin-avatar-identity] member avatar now requires an exact LinkedIn profile-author match and person-photo URL');
