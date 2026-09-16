import fs from 'node:fs';

function patchFile(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  for (const [before, after, label] of transforms) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    if (index === -1) throw new Error(`[linkedin-avatar-identity] ${path}: anchor not found (${label})`);
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  fs.writeFileSync(path, source);
  console.log(`[linkedin-avatar-identity] patched ${path}`);
}

patchFile('server/linkedinProfileBootstrap.ts', [
  [
`  const photoCandidates = [
    profile.photo,
    profile.photoUrl,
    profile.profilePicture,
    profile.profilePictureUrl,
    profile.profilePictures,
    profile.profileImage,
    profile.profileImageUrl,
    profile.displayPhoto,
    profile.displayPicture,
    profile.picture,
    profile.pictureUrl,
    profile.avatar,
    profile.image,
    profile.imageUrl,
  ];
  const profilePhotoUrl = photoCandidates.map((candidate) => imageUrlFrom(candidate)).find(Boolean) || null;`,
`  const looksLikeLinkedInPersonPhoto = (value: string | null): value is string => {
    if (!value) return false;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const pathAndQuery = (url.pathname + url.search).toLowerCase();
      return host.endsWith('licdn.com') && /profile-(?:displayphoto|framedphoto)/i.test(pathAndQuery);
    } catch {
      return false;
    }
  };

  // Use only fields that can represent the member's own portrait. Broad fields such as generic
  // image/avatar values may contain employer, school, association or badge logos and must never
  // become the ConferenceGate member avatar.
  const photoCandidates = [
    profile.photo,
    profile.profilePictureUrl,
    profile.profilePicture,
    profile.profileImageUrl,
    profile.displayPhoto,
  ];
  const profilePhotoUrl = photoCandidates
    .map((candidate) => imageUrlFrom(candidate))
    .find((candidate) => looksLikeLinkedInPersonPhoto(candidate)) || null;`,
    'strict member-photo selection',
  ],
]);

patchFile('server/linkedinConferenceActivityBootstrap.ts', [
  [
`    for (const rawPost of posts) {
      const post = rawPost && typeof rawPost === "object" ? rawPost as Record<string, any> : {};
      if (!targetAuthorMatches(post, requestedUrl)) continue;
      const author = post.author && typeof post.author === "object" ? post.author : {};
      const candidates = [`,
`    const requestedSlug = profileSlug(requestedUrl);
    if (!requestedSlug) return null;
    for (const rawPost of posts) {
      const post = rawPost && typeof rawPost === "object" ? rawPost as Record<string, any> : {};
      const author = post.author && typeof post.author === "object" ? post.author : {};
      const authorUrl = author.linkedinUrl || author.url || post.authorProfileUrl;
      const authorSlug = profileSlug(authorUrl);
      const authorPublicIdentifier = clean(author.publicIdentifier).toLowerCase();
      const authorType = clean(author.type).toLowerCase();

      // Never accept an unknown/missing author here. Reposts and organisation posts can carry logos.
      // The avatar source must identify the exact requested LinkedIn member.
      if (authorType && authorType !== "profile") continue;
      if (authorSlug !== requestedSlug && authorPublicIdentifier !== requestedSlug) continue;

      const candidates = [`,
    'require exact post author identity',
  ],
  [
`      const found = candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value.trim()));
      if (found) return found.trim();`,
`      const found = candidates.find((value) => {
        if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return false;
        try {
          const url = new URL(value.trim());
          return url.hostname.toLowerCase().endsWith("licdn.com") && /profile-(?:displayphoto|framedphoto)/i.test((url.pathname + url.search).toLowerCase());
        } catch {
          return false;
        }
      });
      if (found) return found.trim();`,
    'accept only LinkedIn person-photo URLs',
  ],
  [
`    await dbRun(
      `UPDATE users SET avatar = CASE
         WHEN COALESCE(TRIM(avatar), '') = '' OR avatar LIKE 'data:image/svg+xml%' THEN ?
         ELSE avatar
       END
       WHERE id = ?`,
      [avatarValue, userId],
    );`,
`    // Refresh LinkedIn is an explicit sync action. Once the author identity matches the requested
    // profile exactly, use that portrait to repair any stale/wrong auto-imported logo. Members can
    // still use Change Photo afterwards if they prefer a custom image.
    await dbRun(
      `UPDATE users SET avatar = ? WHERE id = ?`,
      [avatarValue, userId],
    );`,
    'replace stale auto-imported logo with exact member portrait',
  ],
]);

console.log('[linkedin-avatar-identity] member avatar now requires an exact LinkedIn profile-author match and person-photo URL');
