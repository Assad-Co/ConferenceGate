import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

// This runs LAST after all earlier avatar patches.
// The dedicated profile actor can legitimately return photoUrl=null. In that case use the
// profile-post actor's author portrait, but only when it is clearly the requested member:
// - personal-profile author (not company/event),
// - LinkedIn profile-displayphoto/profile-framedphoto URL,
// - and either exact publicIdentifier/profile URL, exact post-owner slug, or exact member name.
// Because the posts actor itself was invoked with the member's exact public profile URL, an exact
// member-name match is a safe fallback when HarvestAPI omits publicIdentifier on some rows.

// Ensure the member name is available to the refresh handler.
source = source.replace(
  'SELECT id, linkedin_url FROM users WHERE id = ?',
  'SELECT id, linkedin_url, name FROM users WHERE id = ?',
);

// Disable the older post-avatar writer. Earlier patches may have enabled or disabled it; this
// script owns the final fallback so there is only one writer and no logo race.
source = source.replace('  if (authorAvatarUrl) {', '  if (false && authorAvatarUrl) {');

const anchor = '  const posts = Array.isArray(result) ? result.filter((item) => item && typeof item === "object") : [];';
if (!source.includes(anchor)) {
  throw new Error('[linkedin-avatar-member-final] posts anchor not found');
}

const marker = '  // FINAL_MEMBER_AVATAR_FALLBACK';
if (!source.includes(marker)) {
  const block = `

  // FINAL_MEMBER_AVATAR_FALLBACK
  const normalizeAvatarName = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const requestedAvatarSlug = profileSlug(requestedUrl);
  const memberAvatarName = normalizeAvatarName(user.name);

  const safeMemberPortrait = (() => {
    if (!requestedAvatarSlug) return null;

    const memberParts = memberAvatarName.split(/\\s+/).filter(Boolean);
    const memberFirst = memberParts[0] || "";
    const memberLast = memberParts[memberParts.length - 1] || "";

    const isPersonPhoto = (value: unknown): value is string => {
      if (typeof value !== "string" || !/^https?:\\/\\//i.test(value.trim())) return false;
      try {
        const url = new URL(value.trim());
        const host = url.hostname.toLowerCase();
        const pathAndQuery = (url.pathname + url.search).toLowerCase();
        return host.endsWith("licdn.com") && /profile-(?:displayphoto|framedphoto)/i.test(pathAndQuery);
      } catch {
        return false;
      }
    };

    for (const rawPost of posts) {
      const post = rawPost && typeof rawPost === "object" ? rawPost as Record<string, any> : {};
      const author = post.author && typeof post.author === "object" ? post.author as Record<string, any> : {};
      const authorType = clean(author.type).toLowerCase();
      if (authorType && authorType !== "profile") continue;

      const avatarCandidates = [
        author?.avatar?.url,
        author?.picture?.url,
        author?.pictureUrl,
        author?.photo,
        author?.photoUrl,
        author?.image?.url,
        author?.imageUrl,
      ];
      const portrait = avatarCandidates.find(isPersonPhoto)?.trim() || null;
      if (!portrait) continue;

      const authorPublicIdentifier = clean(author.publicIdentifier).toLowerCase();
      const authorSlug = profileSlug(author.linkedinUrl || author.url || post.authorProfileUrl);
      const authorName = normalizeAvatarName(author.name);
      const authorParts = authorName.split(/\\s+/).filter(Boolean);
      const authorFirst = authorParts[0] || "";
      const authorLast = authorParts[authorParts.length - 1] || "";
      const nameMatches = Boolean(memberFirst && memberLast && authorFirst === memberFirst && authorLast === memberLast);

      const postOwnerSlug = (() => {
        try {
          const rawUrl = clean(post.linkedinUrl || post.postUrl || post.url || post.shareUrl);
          const url = new URL(rawUrl);
          const match = url.pathname.match(/^\\/posts\\/([^_/?#]+)/i);
          return match?.[1]?.toLowerCase() || null;
        } catch {
          return null;
        }
      })();

      const exactProfileMatch = authorPublicIdentifier === requestedAvatarSlug || authorSlug === requestedAvatarSlug;
      const exactPostOwnerMatch = postOwnerSlug === requestedAvatarSlug;

      if (exactProfileMatch || (exactPostOwnerMatch && nameMatches) || nameMatches) {
        return portrait;
      }
    }
    return null;
  })();

  if (safeMemberPortrait) {
    const currentAvatarRow = await dbGet<any>("SELECT avatar FROM users WHERE id = ?", [userId]);
    const currentAvatar = typeof currentAvatarRow?.avatar === "string" ? currentAvatarRow.avatar.trim() : "";
    const canAutoFillAvatar = !currentAvatar || currentAvatar.startsWith("data:image/svg+xml");

    if (canAutoFillAvatar) {
      let avatarValue = safeMemberPortrait;
      const avatarController = new AbortController();
      const avatarTimeout = setTimeout(() => avatarController.abort(), 12_000);
      try {
        const avatarResponse = await fetch(safeMemberPortrait, {
          signal: avatarController.signal,
          headers: {
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 ConferenceGate LinkedIn Member Avatar",
          },
        });
        const contentType = (avatarResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (avatarResponse.ok && contentType.startsWith("image/")) {
          const bytes = Buffer.from(await avatarResponse.arrayBuffer());
          if (bytes.length > 0 && bytes.length <= 1_500_000) {
            avatarValue = "data:" + contentType + ";base64," + bytes.toString("base64");
          }
        }
      } catch {
        // Keep the fresh LinkedIn CDN URL if server-side caching is blocked.
      } finally {
        clearTimeout(avatarTimeout);
      }

      await dbRun("UPDATE users SET avatar = ? WHERE id = ?", [avatarValue, userId]);
    }
  }
`;
  source = source.replace(anchor, anchor + block);
}

fs.writeFileSync(path, source);
console.log('[linkedin-avatar-member-final] robust exact/member-name LinkedIn portrait fallback installed last');
