import fs from 'node:fs';

const path = 'server/linkedinProfileBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = [
  '  const profilePhotoUrl = [',
  '    imageUrlFrom(profile.photo),',
  '    imageUrlFrom(profile.photoUrl),',
  '    imageUrlFrom(profile.profilePicture),',
  '    imageUrlFrom(profile.profilePictureUrl),',
  '    imageUrlFrom(profile.displayPhoto),',
  '  ].find(Boolean) || null;',
].join('\n');

if (!source.includes(oldBlock)) {
  throw new Error('[linkedin-public-avatar] final profilePhotoUrl block not found');
}

const newBlock = String.raw`  // Prefer the profile Actor's photo fields. Some LinkedIn profiles legitimately return no
  // photo through the Actor even though the public LinkedIn profile page displays one. In that
  // case, recover the portrait from the same public profile URL. This is profile-scoped only:
  // conference/event images are never considered here.
  const providerProfilePhotoUrl = [
    imageUrlFrom(profile.photo),
    imageUrlFrom(profile.photoUrl),
    imageUrlFrom(profile.profilePicture),
    imageUrlFrom(profile.profilePictureUrl),
    imageUrlFrom(profile.displayPhoto),
  ].find(Boolean) || null;

  const decodeLinkedInImageUrl = (value: string): string | null => {
    if (!value) return null;
    const decoded = value
      .replace(/\\u0026/gi, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .trim();
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  };

  const isLikelyMemberPortrait = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (!host.endsWith('licdn.com')) return false;
      const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
      if (/logo|company|organization|school|banner|cover|feedshare|article-cover|background/i.test(pathAndQuery)) return false;
      return /profile|displayphoto|framedphoto|dms\/image/i.test(pathAndQuery);
    } catch {
      return false;
    }
  };

  let publicLinkedInPhotoUrl: string | null = null;
  if (!providerProfilePhotoUrl) {
    const pageController = new AbortController();
    const pageTimeout = setTimeout(() => pageController.abort(), 15_000);
    try {
      const publicResponse = await fetch(requestedUrl, {
        redirect: 'follow',
        signal: pageController.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        },
      });

      if (publicResponse.ok) {
        const html = await publicResponse.text();
        const lowerHtml = html.toLowerCase();
        const firstName = (text(profile.firstName) || '').toLowerCase();
        const lastName = (text(profile.lastName) || '').toLowerCase();
        const identityVisible = Boolean(
          (!firstName || lowerHtml.includes(firstName)) &&
          (!lastName || lowerHtml.includes(lastName)),
        );

        if (identityVisible) {
          const candidates: string[] = [];
          const metaPatterns = [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/ig,
            /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/ig,
            /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/ig,
          ];
          for (const pattern of metaPatterns) {
            for (const match of html.matchAll(pattern)) {
              if (match[1]) candidates.push(match[1]);
            }
          }

          // Public LinkedIn pages also embed image URLs inside JSON when og:image is omitted.
          for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'<>\\s]{1,1500}licdn\.com[^"'<>\\s]{0,1500}/ig)) {
            if (match[0]) candidates.push(match[0]);
          }

          const normalized = candidates
            .map((candidate) => decodeLinkedInImageUrl(candidate))
            .filter((candidate): candidate is string => Boolean(candidate));

          // Prefer explicit profile-photo URLs, then any non-logo LinkedIn DMS image from this
          // identity-matched public profile page.
          publicLinkedInPhotoUrl = normalized.find((candidate) => isLikelyMemberPortrait(candidate)) || null;
        }
      }
    } catch {
      // LinkedIn may occasionally block anonymous page reads. The profile/posts import still works;
      // the user can keep the generated initials or set a photo manually in that case.
    } finally {
      clearTimeout(pageTimeout);
    }
  }

  const profilePhotoUrl = providerProfilePhotoUrl || publicLinkedInPhotoUrl;`;

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source);
console.log('[linkedin-public-avatar] public LinkedIn profile-page portrait fallback enabled for all members');
