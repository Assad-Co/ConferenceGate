import fs from 'node:fs';

// Public-profile-page avatar source only.
// The member's avatar belongs to the public LinkedIn profile top card, not to post media.
// This patch runs after the older LinkedIn patches, removes post-based avatar recovery, and
// adds a real rendered-profile/Jina reader fallback before the paid public-profile actors.

{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const marker = '  // FINAL_RECURSIVE_LINKEDIN_AVATAR';
  const anchor = '  const { conferenceActivity, callsForPapers } = classifyPosts(posts, requestedUrl);';
  const start = source.indexOf(marker);
  const end = source.indexOf(anchor, start === -1 ? 0 : start);

  if (start !== -1 && end !== -1) {
    source = source.slice(0, start) +
      '  // Avatar recovery is intentionally profile-page-only. Posts are still scanned for conference evidence.\n' +
      source.slice(end);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-profile-page-avatar] disabled post-based avatar recovery; posts remain conference evidence only');
}

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const marker = '  let profileAvatar: string | null = null;';
  if (!source.includes(marker)) {
    throw new Error('[linkedin-profile-page-avatar] profileAvatar anchor not found');
  }

  const block = String.raw`  // PROFILE_PAGE_AVATAR_ONLY
  // The public LinkedIn profile top card is authoritative for the member portrait. Try the
  // already-installed Chromium renderer first, then the hosted Jina reader. Both read only the
  // exact linkedin.com/in/... URL supplied by the member. Post images are never considered here.
  if (!profilePhotoUrl) {
    const requestedProfileSlug = profileSlug(requestedUrl) || '';
    const firstNameForPhoto = (text(profile.firstName) || '').toLowerCase();
    const lastNameForPhoto = (text(profile.lastName) || '').toLowerCase();
    const fullNameForPhoto = [firstNameForPhoto, lastNameForPhoto].filter(Boolean).join(' ').trim();

    type ProfilePortraitCandidate = { url: string; score: number; source: string };
    const profilePortraitCandidates: ProfilePortraitCandidate[] = [];

    const normalizeProfileImageUrl = (raw: unknown): string | null => {
      if (typeof raw !== 'string' || !raw.trim()) return null;
      const decoded = raw.trim().replace(/&amp;/gi, '&').replace(/&#x26;/gi, '&');
      try {
        const parsed = new URL(decoded);
        const host = parsed.hostname.toLowerCase();
        const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
        if (parsed.protocol !== 'https:') return null;
        if (host !== 'licdn.com' && !host.endsWith('.licdn.com')) return null;
        if (/logo|company|organization|school|banner|cover|background|feedshare|article-cover/i.test(pathAndQuery)) return null;
        return parsed.toString();
      } catch {
        return null;
      }
    };

    const addProfilePortraitCandidate = (raw: unknown, context: string, sourceName: string) => {
      const url = normalizeProfileImageUrl(raw);
      if (!url) return;
      const lowerContext = context.toLowerCase();
      const lowerUrl = url.toLowerCase();
      let score = 0;

      if (/top-card-layout__entity-image|pv-top-card-profile-picture|profile-photo|profile-picture|entity-image/i.test(lowerContext)) score += 14;
      if (/profile-(?:displayphoto|framedphoto)|displayphoto|profilephoto/i.test(lowerUrl)) score += 12;
      if (/dms\/image/i.test(lowerUrl)) score += 3;
      if (fullNameForPhoto && lowerContext.includes(fullNameForPhoto)) score += 14;
      else if (firstNameForPhoto && lastNameForPhoto && lowerContext.includes(firstNameForPhoto) && lowerContext.includes(lastNameForPhoto)) score += 10;
      if (/logo|company|organization|school|banner|cover|background|feedshare|article-cover/i.test(lowerContext)) score -= 30;

      profilePortraitCandidates.push({ url, score, source: sourceName });
    };

    const readHtmlAttribute = (tag: string, name: string): string => {
      const doubleQuoted = tag.match(new RegExp(name + '="([^"]+)"', 'i'))?.[1];
      const singleQuoted = tag.match(new RegExp(name + "='([^']+)'", 'i'))?.[1];
      return (doubleQuoted || singleQuoted || '').replace(/&amp;/gi, '&');
    };

    const collectProfileImagesFromHtml = (html: string, sourceName: string) => {
      const lowerHtml = html.toLowerCase();
      const identityVisible = Boolean(
        (requestedProfileSlug && lowerHtml.includes(requestedProfileSlug.toLowerCase())) ||
        ((!firstNameForPhoto || lowerHtml.includes(firstNameForPhoto)) &&
         (!lastNameForPhoto || lowerHtml.includes(lastNameForPhoto)))
      );
      if (!identityVisible) return;

      for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
        const tag = match[0];
        const context = [
          readHtmlAttribute(tag, 'class'),
          readHtmlAttribute(tag, 'id'),
          readHtmlAttribute(tag, 'alt'),
          readHtmlAttribute(tag, 'data-test-id'),
        ].join(' ');
        for (const attr of ['src', 'data-delayed-url', 'data-src', 'data-ghost-url']) {
          addProfilePortraitCandidate(readHtmlAttribute(tag, attr), context, sourceName);
        }
      }
    };

    try {
      const { fetchRenderedHtml } = await import('./browserFetch');
      const renderedProfileHtml = await fetchRenderedHtml(requestedUrl);
      if (renderedProfileHtml) {
        collectProfileImagesFromHtml(renderedProfileHtml, 'rendered-profile-top-card');
      }
    } catch (error: any) {
      console.warn('[linkedin-profile-page-avatar] rendered public profile read failed', error?.message || String(error));
    }

    if (!profilePortraitCandidates.some((candidate) => candidate.score >= 8)) {
      try {
        const { jinaReadPageDetailed } = await import('./jinaReader');
        const jinaResult = await jinaReadPageDetailed(requestedUrl);
        const markdown = jinaResult.markdown || '';
        const lowerMarkdown = markdown.toLowerCase();
        const identityVisible = Boolean(
          (requestedProfileSlug && lowerMarkdown.includes(requestedProfileSlug.toLowerCase())) ||
          ((!firstNameForPhoto || lowerMarkdown.includes(firstNameForPhoto)) &&
           (!lastNameForPhoto || lowerMarkdown.includes(lastNameForPhoto)))
        );

        if (identityVisible) {
          for (const match of markdown.matchAll(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/gi)) {
            addProfilePortraitCandidate(match[2], match[1] || '', 'jina-public-profile');
          }
        }
      } catch (error: any) {
        console.warn('[linkedin-profile-page-avatar] Jina public profile read failed', error?.message || String(error));
      }
    }

    const selectedProfilePortrait = profilePortraitCandidates
      .filter((candidate) => candidate.score >= 8)
      .sort((a, b) => b.score - a.score)[0] || null;

    if (selectedProfilePortrait) {
      profilePhotoUrl = selectedProfilePortrait.url;
      console.log('[linkedin-profile-page-avatar] recovered public profile top-card portrait via ' + selectedProfilePortrait.source);
    } else {
      console.warn('[linkedin-profile-page-avatar] no portrait found on rendered public profile top card');
    }
  }
`;

  if (!source.includes('// PROFILE_PAGE_AVATAR_ONLY')) {
    const index = source.indexOf(marker);
    source = source.slice(0, index) + block + '\n' + source.slice(index);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-profile-page-avatar] rendered public profile top-card portrait recovery installed');
}

{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/cg_linkedin_avatar_repair_v\d+:/g, 'cg_linkedin_avatar_repair_v6:');
  fs.writeFileSync(path, source);
  console.log('[linkedin-profile-page-avatar] forced a fresh repair attempt for existing LinkedIn accounts');
}
