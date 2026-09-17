import fs from 'node:fs';

// Complete public LinkedIn conference-history scan for every ConferenceGate member who supplied a
// linkedin.com/in/... URL. HarvestAPI documents maxPosts=0 as "scrape all posts". A server-side
// source version makes this a one-time historical backfill per account (across devices), while
// future logins only perform a cheap status read unless the scan failed or the version changes.

const FULL_HISTORY_SOURCE_ACTOR = 'harvestapi/linkedin-profile-posts:all-v1';

// ---------------------------------------------------------------------------
// 1) SERVER: ask the public-profile posts actor for the complete available history.
// ---------------------------------------------------------------------------
{
  const path = 'server/linkedinConferenceActivityBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  if (source.includes('const MAX_POSTS = 1000;')) {
    source = source.replace('const MAX_POSTS = 1000;', 'const MAX_POSTS = 0;');
  } else if (!source.includes('const MAX_POSTS = 0;')) {
    throw new Error('[linkedin-all-posts] MAX_POSTS anchor not found');
  }

  const actorBefore = 'const SOURCE_ACTOR = "harvestapi/linkedin-profile-posts";';
  const actorAfter = `const SOURCE_ACTOR = "${FULL_HISTORY_SOURCE_ACTOR}";`;
  if (!source.includes(actorAfter)) {
    if (!source.includes(actorBefore)) throw new Error('[linkedin-all-posts] SOURCE_ACTOR anchor not found');
    source = source.replace(actorBefore, actorAfter);
  }

  // maxItems=0 on the dataset endpoint can suppress the response. In all-posts mode simply omit
  // that output limiter and let the actor return the complete dataset it scraped.
  const maxItemsBefore = '    endpoint.searchParams.set("maxItems", String(MAX_POSTS));';
  const maxItemsAfter = '    if (MAX_POSTS > 0) endpoint.searchParams.set("maxItems", String(MAX_POSTS));';
  if (!source.includes(maxItemsAfter)) {
    if (!source.includes(maxItemsBefore)) throw new Error('[linkedin-all-posts] maxItems anchor not found');
    source = source.replace(maxItemsBefore, maxItemsAfter);
  }

  // Do not silently truncate old history with the previous hard charge ceiling. Complete history
  // is the default; an operator can explicitly set LINKEDIN_POST_SCAN_MAX_CHARGE_USD in Render if
  // a budget ceiling is wanted later.
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

  // Classification still examines every returned post, but raw_posts persists only posts that
  // generated useful ConferenceGate evidence. This keeps Turso rows small enough to scale across
  // many members while preserving all evidence-bearing source records for diagnostics.
  const classifyAnchor = '  const { conferenceActivity, callsForPapers } = classifyPosts(posts, requestedUrl);';
  if (!source.includes('const relevantRawLinkedInPosts = posts.filter')) {
    const relevantBlock = `${classifyAnchor}
  const relevantRawPostIds = new Set(
    [...conferenceActivity, ...callsForPapers].map((item: any) => String(item.id || '').split(':')[0]).filter(Boolean),
  );
  const relevantRawLinkedInPosts = posts.filter((post, index) => relevantRawPostIds.has(postId(post, index)));`;
    if (!source.includes(classifyAnchor)) throw new Error('[linkedin-all-posts] classify result anchor not found');
    source = source.replace(classifyAnchor, relevantBlock);
  }

  const rawStoreBefore = '      JSON.stringify(posts),';
  const rawStoreAfter = '      JSON.stringify(relevantRawLinkedInPosts),';
  if (!source.includes(rawStoreAfter)) {
    if (!source.includes(rawStoreBefore)) throw new Error('[linkedin-all-posts] raw_posts storage anchor not found');
    source = source.replace(rawStoreBefore, rawStoreAfter);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-all-posts] server configured for complete available public LinkedIn post history');
}

// ---------------------------------------------------------------------------
// 2) APP: every account with a LinkedIn URL checks whether its stored conference evidence came
//    from the all-history scanner. Existing/legacy accounts get one automatic full backfill;
//    already-migrated accounts do not pay for a repeated scan on later sign-ins or other devices.
// ---------------------------------------------------------------------------
{
  const path = 'src/App.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const onboardingImport = "import { syncLinkedInOnboarding } from './api/linkedinOnboarding';";
  const activityImport = "import { fetchLinkedInConferenceActivity, refreshLinkedInConferenceActivity } from './api/linkedinConferenceActivity';";
  if (!source.includes(activityImport)) {
    if (!source.includes(onboardingImport)) throw new Error('[linkedin-all-posts] App onboarding import anchor not found');
    source = source.replace(onboardingImport, onboardingImport + '\n' + activityImport);
  }

  const logoutAnchor = '  const handleLogout = async () => {';
  if (!source.includes('FULL_LINKEDIN_HISTORY_SOURCE_V1')) {
    const block = `  const FULL_LINKEDIN_HISTORY_SOURCE_V1 = '${FULL_HISTORY_SOURCE_ACTOR}';

  // Backfill every linked account exactly once for this scanner version. Login stays fast because
  // the expensive public-post scan runs in the background; subsequent logins only read the cached
  // server-side source version. If the scan fails, the legacy source remains and a later login can retry.
  useEffect(() => {
    if (!authUser?.id || !authUser.linkedinUrl || typeof window === 'undefined') return;
    let cancelled = false;

    fetchLinkedInConferenceActivity()
      .then((current) => {
        if (cancelled) return null;
        if (current.activity?.sourceActor === FULL_LINKEDIN_HISTORY_SOURCE_V1) {
          window.dispatchEvent(new CustomEvent('conferencegate:linkedin-activity-refreshed', { detail: current.activity }));
          return null;
        }
        return refreshLinkedInConferenceActivity(authUser.linkedinUrl);
      })
      .then((result) => {
        if (cancelled || !result) return;
        window.dispatchEvent(new CustomEvent('conferencegate:linkedin-activity-refreshed', { detail: result.activity }));
      })
      .catch(() => {
        // Do not mark a failed account as migrated; the next login/reload gets another chance.
      });

    return () => { cancelled = true; };
  }, [authUser?.id, authUser?.linkedinUrl]);

`;
    if (!source.includes(logoutAnchor)) throw new Error('[linkedin-all-posts] App logout anchor not found');
    source = source.replace(logoutAnchor, block + logoutAnchor);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-all-posts] every linked ConferenceGate account gets one server-versioned full-history backfill');
}

// ---------------------------------------------------------------------------
// 3) PROFILE UI: update role/attendance cards immediately when the background migration finishes.
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
