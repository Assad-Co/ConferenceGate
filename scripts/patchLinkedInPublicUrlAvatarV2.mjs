import fs from 'node:fs';

// Public-URL-only LinkedIn avatar fallback.
//
// This intentionally does NOT use LinkedIn OAuth. ConferenceGate receives the member's public
// linkedin.com/in/... URL, asks independent public-profile actors for the guest-view portrait,
// validates that the returned profile is the exact requested vanity slug, then lets the existing
// ConferenceGate avatar cache copy the image into users.avatar as a data URL.
//
// Provider order here is deliberately separate from the older HarvestAPI/public-page fallbacks:
// 1) datascraperes/linkedin-public-profile-scraper -> profile.profilePictureUrl
// 2) getanyapi/linkedin-profile-scraper            -> avatarUrl
// Both use the already-configured APIFY_TOKEN; no LinkedIn app, OAuth client, cookies, or user
// action beyond supplying the public profile URL is required.

const path = 'server/linkedinProfileBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

const marker = '  let profileAvatar: string | null = null;';
if (!source.includes(marker)) {
  throw new Error('[linkedin-public-avatar-v2] profileAvatar anchor not found');
}

const injected = String.raw`  // Public-URL-only avatar fallback v2. This runs only if all earlier public-profile
  // methods failed to expose a portrait. It uses two independent Apify public-profile actors
  // with documented portrait fields, so no LinkedIn OAuth setup is needed.
  if (!profilePhotoUrl) {
    const publicAvatarToken = process.env.APIFY_TOKEN?.trim();

    const exactRequestedSlug = profileSlug(requestedUrl);
    const isExactReturnedProfile = (raw: unknown): boolean => {
      const normalized = normalizeLinkedInProfileUrl(raw);
      const returned = profileSlug(normalized || requestedUrl);
      return !exactRequestedSlug || !returned || returned === exactRequestedSlug;
    };

    const safePortrait = (raw: unknown): string | null => {
      const candidate = imageUrlFrom(raw);
      if (!candidate) return null;
      try {
        const parsed = new URL(candidate);
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol !== 'https:') return null;
        if (host !== 'licdn.com' && !host.endsWith('.licdn.com')) return null;
        const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
        if (/logo|company|organization|school|banner|cover|background|feedshare|article-cover/i.test(pathAndQuery)) return null;
        return candidate;
      } catch {
        return null;
      }
    };

    if (publicAvatarToken) {
      // Provider A: DataScraperES public guest-view scraper. Its documented successful output is
      // row.profile.profilePictureUrl and it requires only profileUrls: [public LinkedIn URL].
      const controllerA = new AbortController();
      const timeoutA = setTimeout(() => controllerA.abort(), 60_000);
      try {
        const endpointA = new URL(
          'https://api.apify.com/v2/actors/datascraperes~linkedin-public-profile-scraper/run-sync-get-dataset-items',
        );
        endpointA.searchParams.set('format', 'json');
        endpointA.searchParams.set('clean', 'true');
        endpointA.searchParams.set('maxItems', '1');
        endpointA.searchParams.set('maxTotalChargeUsd', '0.02');

        const responseA = await fetch(endpointA, {
          method: 'POST',
          signal: controllerA.signal,
          headers: {
            Authorization: \`Bearer \${publicAvatarToken}\`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ profileUrls: [requestedUrl] }),
        });

        if (responseA.ok) {
          const bodyA = await responseA.json().catch(() => null);
          const rowsA = Array.isArray(bodyA) ? bodyA : [];
          const rowA = rowsA.find((item) => item && typeof item === 'object' && item.success !== false) as Record<string, any> | undefined;
          const profileA = rowA?.profile && typeof rowA.profile === 'object' ? rowA.profile as Record<string, any> : {};
          const portraitA = safePortrait(
            profileA.profilePictureUrl ||
            profileA.profileImageUrl ||
            profileA.avatarUrl ||
            rowA?.profilePictureUrl ||
            rowA?.profileImageUrl ||
            rowA?.avatarUrl,
          );

          if (rowA && portraitA && isExactReturnedProfile(rowA.profileUrl || rowA.inputUrl || requestedUrl)) {
            profilePhotoUrl = portraitA;
            console.log('[linkedin-public-avatar-v2] recovered exact public portrait via DataScraperES');
          } else {
            console.warn('[linkedin-public-avatar-v2] DataScraperES returned no exact portrait', rowA?.status || 'empty');
          }
        } else {
          console.warn('[linkedin-public-avatar-v2] DataScraperES HTTP', responseA.status);
        }
      } catch (error: any) {
        console.warn('[linkedin-public-avatar-v2] DataScraperES failed', error?.message || String(error));
      } finally {
        clearTimeout(timeoutA);
      }

      // Provider B: AnyAPI public profile scraper. It accepts one exact public URL and documents
      // avatarUrl as the member portrait. Run only if Provider A did not recover a portrait.
      if (!profilePhotoUrl) {
        const controllerB = new AbortController();
        const timeoutB = setTimeout(() => controllerB.abort(), 60_000);
        try {
          const endpointB = new URL(
            'https://api.apify.com/v2/actors/getanyapi~linkedin-profile-scraper/run-sync-get-dataset-items',
          );
          endpointB.searchParams.set('format', 'json');
          endpointB.searchParams.set('clean', 'true');
          endpointB.searchParams.set('maxItems', '1');
          endpointB.searchParams.set('maxTotalChargeUsd', '0.02');

          const responseB = await fetch(endpointB, {
            method: 'POST',
            signal: controllerB.signal,
            headers: {
              Authorization: \`Bearer \${publicAvatarToken}\`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ url: requestedUrl }),
          });

          if (responseB.ok) {
            const bodyB = await responseB.json().catch(() => null);
            const rowsB = Array.isArray(bodyB) ? bodyB : [];
            const rowB = rowsB.find((item) => item && typeof item === 'object') as Record<string, any> | undefined;
            const portraitB = safePortrait(
              rowB?.avatarUrl ||
              rowB?.profilePictureUrl ||
              rowB?.profileImageUrl ||
              rowB?.image,
            );

            // This actor is invoked with exactly one URL and may not echo it. If it does echo a
            // profile URL, require the same vanity slug; otherwise trust only the portrait field.
            const echoedUrl = rowB?.linkedinUrl || rowB?.profileUrl || rowB?.url;
            if (rowB && portraitB && (!echoedUrl || isExactReturnedProfile(echoedUrl))) {
              profilePhotoUrl = portraitB;
              console.log('[linkedin-public-avatar-v2] recovered exact public portrait via AnyAPI');
            } else {
              console.warn('[linkedin-public-avatar-v2] AnyAPI returned no exact portrait');
            }
          } else {
            console.warn('[linkedin-public-avatar-v2] AnyAPI HTTP', responseB.status);
          }
        } catch (error: any) {
          console.warn('[linkedin-public-avatar-v2] AnyAPI failed', error?.message || String(error));
        } finally {
          clearTimeout(timeoutB);
        }
      }
    } else {
      console.warn('[linkedin-public-avatar-v2] APIFY_TOKEN missing; public URL avatar lookup unavailable');
    }
  }

${marker}`;

if (!source.includes('[linkedin-public-avatar-v2] recovered exact public portrait via DataScraperES')) {
  source = source.replace(marker, injected);
}

// Force one new repair generation for existing accounts that still display generated initials.
source = source.replace(/cg_linkedin_avatar_repair_v\d+:/g, 'cg_linkedin_avatar_repair_v5:');

fs.writeFileSync(path, source);
console.log('[linkedin-public-avatar-v2] installed public-URL-only LinkedIn portrait waterfall');
