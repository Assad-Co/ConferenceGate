import fs from 'node:fs';

// Last-resort public LinkedIn portrait lookup.
// HarvestAPI remains the primary profile source. If it returns no photo and the direct public-page
// fallback is also empty/blocked, use a second URL-only Apify actor that is specifically designed
// to read the public profile photo without LinkedIn cookies. The returned portrait is still copied
// into ConferenceGate by the existing avatar cache/write logic; we never make the browser depend on
// this fallback actor or on a second user action.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const before = '  const profilePhotoUrl = providerProfilePhotoUrl || publicLinkedInPhotoUrl;';
  const after = `  let profilePhotoUrl = providerProfilePhotoUrl || publicLinkedInPhotoUrl;

  // Secondary provider only when the primary profile actor and direct public-page read both
  // failed to expose the portrait. accountable_eel/linkedin-profile-lookup accepts the exact
  // public LinkedIn URL and returns profileImageUrl even for many reduced/masked public pages.
  if (!profilePhotoUrl) {
    const fallbackToken = process.env.APIFY_TOKEN?.trim();
    if (fallbackToken) {
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 45_000);
      try {
        const fallbackEndpoint = new URL(
          'https://api.apify.com/v2/acts/accountable_eel~linkedin-profile-lookup/run-sync-get-dataset-items',
        );
        fallbackEndpoint.searchParams.set('format', 'json');
        fallbackEndpoint.searchParams.set('clean', 'true');
        fallbackEndpoint.searchParams.set('maxItems', '1');
        fallbackEndpoint.searchParams.set('maxTotalChargeUsd', '0.02');

        const fallbackResponse = await fetch(fallbackEndpoint, {
          method: 'POST',
          signal: fallbackController.signal,
          headers: {
            Authorization: \`Bearer \${fallbackToken}\`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ profileUrls: [requestedUrl] }),
        });

        if (fallbackResponse.ok) {
          const fallbackResult = await fallbackResponse.json().catch(() => null);
          const rows = Array.isArray(fallbackResult) ? fallbackResult : [];
          const row = rows.find((item) => item && typeof item === 'object' && item.found !== false) as Record<string, any> | undefined;
          if (row) {
            const candidate = imageUrlFrom(row.profileImageUrl);
            const returnedFallbackUrl = normalizeLinkedInProfileUrl(row.profileUrl || row.query);
            const returnedFallbackSlug = profileSlug(returnedFallbackUrl || requestedUrl);

            const isLinkedInPortrait = (() => {
              if (!candidate) return false;
              try {
                const url = new URL(candidate);
                const host = url.hostname.toLowerCase();
                return url.protocol === 'https:' && (host === 'licdn.com' || host.endsWith('.licdn.com'));
              } catch {
                return false;
              }
            })();

            if (
              isLinkedInPortrait &&
              (!requestedSlug || !returnedFallbackSlug || returnedFallbackSlug === requestedSlug)
            ) {
              profilePhotoUrl = candidate;
              console.log('[linkedin-avatar-fallback] recovered public profile portrait with secondary URL-only actor');
            }
          }
        } else {
          console.warn('[linkedin-avatar-fallback] secondary portrait actor returned HTTP', fallbackResponse.status);
        }
      } catch (error: any) {
        console.warn('[linkedin-avatar-fallback] secondary portrait lookup failed', error?.message || String(error));
      } finally {
        clearTimeout(fallbackTimeout);
      }
    }
  }`;

  if (!source.includes(after)) {
    const index = source.indexOf(before);
    if (index === -1) {
      throw new Error('[linkedin-avatar-fallback] final profilePhotoUrl anchor not found');
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-fallback] secondary public-profile portrait provider installed');
}

// Force one fresh repair attempt for existing accounts after this new fallback is deployed.
// If the import completes but still returns no portrait, remove the session key so the next reload
// can retry rather than silently freezing the generated-initials avatar for the whole session.
{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = source.replace(
    'const repairKey = `cg_linkedin_avatar_repair_v2:${user.id}`;',
    'const repairKey = `cg_linkedin_avatar_repair_v3:${user.id}`;',
  );

  const before = [
    '              .then((refreshedUser) => {',
    '                if (refreshedUser) applyAuthUser(refreshedUser);',
    '              })',
  ].join('\n');

  const after = [
    '              .then((refreshedUser) => {',
    '                if (refreshedUser) {',
    '                  applyAuthUser(refreshedUser);',
    '                  if (!refreshedUser.avatar || refreshedUser.avatar.startsWith("data:image/svg+xml")) {',
    '                    sessionStorage.removeItem(repairKey);',
    '                  }',
    '                } else {',
    '                  sessionStorage.removeItem(repairKey);',
    '                }',
    '              })',
  ].join('\n');

  if (!source.includes(after)) {
    const index = source.indexOf(before);
    if (index === -1) {
      throw new Error('[linkedin-avatar-fallback] automatic repair refresh anchor not found');
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-fallback] existing accounts will retry until a real portrait is stored');
}
