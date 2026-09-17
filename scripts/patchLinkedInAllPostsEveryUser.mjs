import fs from 'node:fs';

// Full-history LinkedIn conference evidence for every ConferenceGate member who supplied a
// public linkedin.com/in/... URL. HarvestAPI documents maxPosts=0 as "scrape all posts".
// This patch runs LAST among the LinkedIn patches so it can safely upgrade the final generated
// server/client behavior without disturbing older migration patches.

// ---------------------------------------------------------------------------
// 1) SERVER: ask the public-profile posts actor for the complete available history.
// ---------------------------------------------------------------------------
{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  // The role-integration patch previously raised the scan to 1000. Zero is the provider's
  // documented all-posts mode and overrides pagination.
  if (source.includes('const MAX_POSTS = 1000;')) {
    source = source.replace('const MAX_POSTS = 1000;', 'const MAX_POSTS = 0;');
  } else if (!source.includes('const MAX_POSTS = 0;')) {
    throw new Error('[linkedin-all-posts] MAX_POSTS anchor not found');
  }

  // maxItems=0 on the synchronous dataset endpoint is ambiguous and can suppress output.
  // In all-posts mode let the actor return its complete dataset instead.
  const maxItemsBefore = '    endpoint.searchParams.set("maxItems", String(MAX_POSTS));';
  const maxItemsAfter = '    if (MAX_POSTS > 0) endpoint.searchParams.set("maxItems", String(MAX_POSTS));';
  if (!source.includes(maxItemsAfter)) {
    if (!source.includes(maxItemsBefore)) throw new Error('[linkedin-all-posts] maxItems anchor not found');
    source = source.replace(maxItemsBefore, maxItemsAfter);
  }

  // A hard request-level charge ceiling can stop an all-history run before the oldest posts are
  // reached. Complete history is therefore the default. Operators can still set an explicit cap
  // in Render with LINKEDIN_POST_SCAN_MAX_CHARGE_USD if they later want one.
  const chargeCandidates = [
    '    endpoint.searchParams.set("maxTotalChargeUsd", "2.50");',
    '    endpoint.searchParams.set("maxTotalChargeUsd", "1.20");',
    '    endpoint.searchParams.set("maxTotalChargeUsd", "0.30");',
  ];
  const chargeAfter = [
    '    const configuredLinkedInScanChargeCap = process.env.LINKEDIN_POST_SCAN_MAX_CHARGE_USD?.trim();',
    '    if (configuredLinkedInScanChargeCap) {',
    '      endpoint.searchParams.set("maxTotalChargeUsd", configuredLinkedInScanChargeCap);',
    '    }',
  ].join('\n');
  if (!source.includes('configuredLinkedInScanChargeCap')) {
    const before = chargeCandidates.find((candidate) => source.includes(candidate));
    if (!before) throw new Error('[linkedin-all-posts] maxTotalChargeUsd anchor not found');
    source = source.replace(before, chargeAfter);
  }

  const postsAnchor = '  const posts = Array.isArray(result) ? result.filter((item) => item && typeof item === "object") : [];';
  const postsAfter = postsAnchor + '\n  console.log(`[linkedin-all-posts] scanned=${posts.length} complete public-history posts for ${requestedUrl}`);';
  if (!source.includes('[linkedin-all-posts] scanned=')) {
    if (!source.includes(postsAnchor)) throw new Error('[linkedin-all-posts] posts result anchor not found');
    source = source.replace(postsAnchor, postsAfter);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-all-posts] server configured for complete available public LinkedIn post history');
}

// ---------------------------------------------------------------------------
// 2) ONBOARDING: when a new member supplies a LinkedIn URL, remember that the complete-history
//    conference scan succeeded. This prevents an immediate duplicate scan when App mounts.
// ---------------------------------------------------------------------------
{
  const path = 'src/api/linkedinOnboarding.ts';
  let source = fs.readFileSync(path, 'utf8');

  const returnAnchor = `  return {
    profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
    conference: conferenceResult.status === 'fulfilled' ? conferenceResult.value : null,
    warnings,
  };`;

  if (!source.includes('cg_linkedin_all_posts_v1:')) {
    const replacement = `  const conference = conferenceResult.status === 'fulfilled' ? conferenceResult.value : null;
  if (conference && typeof window !== 'undefined') {
    const normalizedUrl = linkedinUrl.trim().toLowerCase().replace(/\\/+$/, '');
    localStorage.setItem('cg_linkedin_all_posts_v1:' + normalizedUrl, new Date().toISOString());
    window.dispatchEvent(new CustomEvent('conferencegate:linkedin-activity-refreshed', { detail: conference.activity }));
  }

  return {
    profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
    conference,
    warnings,
  };`;
    if (!source.includes(returnAnchor)) throw new Error('[linkedin-all-posts] onboarding return anchor not found');
    source = source.replace(returnAnchor, replacement);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-all-posts] onboarding marks successful complete-history scans');
}

// ---------------------------------------------------------------------------
// 3) APP: every existing ConferenceGate account with a public LinkedIn URL gets one automatic
//    full-history backfill on first use of this version. New accounts are already marked by the
//    onboarding step above. Failures remove no permanent marker, so a later login/reload retries.
// ---------------------------------------------------------------------------
{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const onboardingImport = "import { syncLinkedInOnboarding } from './api/linkedinOnboarding';";
  const activityImport = "import { refreshLinkedInConferenceActivity } from './api/linkedinConferenceActivity';";
  if (!source.includes(activityImport)) {
    if (!source.includes(onboardingImport)) throw new Error('[linkedin-all-posts] App onboarding import anchor not found');
    source = source.replace(onboardingImport, onboardingImport + '\n' + activityImport);
  }

  const logoutAnchor = '  const handleLogout = async () => {';
  if (!source.includes('cg_linkedin_all_posts_v1:')) {
    const block = `  // Complete LinkedIn conference-history backfill for every account that has supplied a public
  // profile URL. It runs in the background and never blocks sign-in or the rest of ConferenceGate.
  // A browser-local version marker prevents paying for the same full historical scan on every page
  // load; a failed scan is not marked and will retry later.
  useEffect(() => {
    if (!authUser?.id || !authUser.linkedinUrl || typeof window === 'undefined') return;
    const normalizedUrl = authUser.linkedinUrl.trim().toLowerCase().replace(/\\/+$/, '');
    const fullHistoryKey = 'cg_linkedin_all_posts_v1:' + normalizedUrl;
    if (localStorage.getItem(fullHistoryKey)) return;

    let cancelled = false;
    refreshLinkedInConferenceActivity(authUser.linkedinUrl)
      .then((result) => {
        if (cancelled) return;
        localStorage.setItem(fullHistoryKey, new Date().toISOString());
        window.dispatchEvent(new CustomEvent('conferencegate:linkedin-activity-refreshed', { detail: result.activity }));
      })
      .catch(() => {
        // No marker on failure: the next session/reload can retry the complete public-history scan.
      });

    return () => { cancelled = true; };
  }, [authUser?.id, authUser?.linkedinUrl]);

`;
    if (!source.includes(logoutAnchor)) throw new Error('[linkedin-all-posts] App logout anchor not found');
    source = source.replace(logoutAnchor, block + logoutAnchor);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-all-posts] every linked ConferenceGate account gets a background complete-history scan');
}

// ---------------------------------------------------------------------------
// 4) PROFILE UI: when the background scan finishes, update role/attendance counters immediately
//    instead of requiring the member to reload the Profile page.
// ---------------------------------------------------------------------------
{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const effectAnchor = `  }, [currentUserId]);`;
  const stateNeedle = 'const [linkedInConferenceActivity, setLinkedInConferenceActivity]';
  if (!source.includes(stateNeedle)) throw new Error('[linkedin-all-posts] LinkedIn role state not found');

  if (!source.includes('conferencegate:linkedin-activity-refreshed')) {
    const stateIndex = source.indexOf(stateNeedle);
    const effectEnd = source.indexOf(effectAnchor, stateIndex);
    if (effectEnd === -1) throw new Error('[linkedin-all-posts] LinkedIn activity load effect end not found');
    const insertAt = effectEnd + effectAnchor.length;
    const listener = `

  useEffect(() => {
    const handleLinkedInActivityRefresh = (event: Event) => {
      const activity = (event as CustomEvent<LinkedInConferenceActivity | null>).detail;
      if (activity) setLinkedInConferenceActivity(activity);
    };
    window.addEventListener('conferencegate:linkedin-activity-refreshed', handleLinkedInActivityRefresh as EventListener);
    return () => window.removeEventListener('conferencegate:linkedin-activity-refreshed', handleLinkedInActivityRefresh as EventListener);
  }, []);`;
    source = source.slice(0, insertAt) + listener + source.slice(insertAt);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-all-posts] profile updates immediately when complete-history evidence arrives');
}
