import fs from 'node:fs';

function patchFile(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  for (const [before, after, label] of transforms) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    if (index === -1) throw new Error(`[linkedin-avatar] ${path}: anchor not found (${label})`);
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  fs.writeFileSync(path, source);
  console.log(`[linkedin-avatar] patched ${path}`);
}

patchFile('server/linkedinProfileBootstrap.ts', [
  [
    `  const about = text(profile.about);\n\n  await ensureSchema();`,
    `  const about = text(profile.about);\n  // HarvestAPI has used more than one field name for the public profile image over time.\n  // Keep the first valid public image URL and use it as the ConferenceGate avatar only when\n  // the member does not already have a manually chosen/Google/LinkedIn-OAuth avatar.\n  const profilePhoto =\n    text(profile.photo) ||\n    text(profile.photoUrl) ||\n    text(profile.profilePicture) ||\n    text(profile.profilePictureUrl) ||\n    text(profile.avatar) ||\n    null;\n\n  await ensureSchema();`,
    'profile photo normalization',
  ],
  [
    `      text(profile.photo),`,
    `      profilePhoto,`,
    'store normalized LinkedIn photo',
  ],
  [
    `       country = CASE WHEN COALESCE(TRIM(country), '') = '' THEN ? ELSE country END,\n       bio = CASE WHEN COALESCE(TRIM(bio), '') = '' THEN ? ELSE bio END\n     WHERE id = ?\``,
    `       country = CASE WHEN COALESCE(TRIM(country), '') = '' THEN ? ELSE country END,\n       bio = CASE WHEN COALESCE(TRIM(bio), '') = '' THEN ? ELSE bio END,\n       avatar = CASE WHEN COALESCE(TRIM(avatar), '') = '' THEN ? ELSE avatar END\n     WHERE id = ?\``,
    'avatar additive update',
  ],
  [
    `      about ? about.slice(0, 600) : null,\n      userId,`,
    `      about ? about.slice(0, 600) : null,\n      profilePhoto,\n      userId,`,
    'avatar update parameter',
  ],
]);

patchFile('src/api/linkedinProfile.ts', [
  [
    `  if (!response.ok) {\n    throw new Error(body.error || 'Could not import your LinkedIn profile.');\n  }\n  return body;\n}`,
    `  if (!response.ok) {\n    throw new Error(body.error || 'Could not import your LinkedIn profile.');\n  }\n\n  // The server may have filled a previously-empty ConferenceGate avatar from the member's\n  // public LinkedIn profile photo. Refresh the authenticated user snapshot and notify App so\n  // the profile header changes immediately without requiring a page reload.\n  try {\n    const authResponse = await fetch('/api/auth/me', { credentials: 'include' });\n    const authBody = await readJson(authResponse);\n    if (authResponse.ok && authBody?.user && typeof window !== 'undefined') {\n      window.dispatchEvent(new CustomEvent('conferencegate:auth-user-refreshed', { detail: authBody.user }));\n    }\n  } catch {\n    // Non-critical: the imported profile remains persisted and will appear after the next reload.\n  }\n\n  return body;\n}`,
    'refresh auth snapshot after LinkedIn import',
  ],
]);

patchFile('src/App.tsx', [
  [
    `  const [userProfile, setUserProfile] = useState(currentUserProfile);\n\n  // Real tracked activity`,
    `  const [userProfile, setUserProfile] = useState(currentUserProfile);\n\n  // LinkedIn public-profile import can fill a previously-empty avatar and other blank identity\n  // fields server-side. Apply that refreshed auth snapshot in place so the profile picture and\n  // header update immediately without navigating the member away from the tab they are viewing.\n  useEffect(() => {\n    const handleLinkedInAuthRefresh = (event: Event) => {\n      const user = (event as CustomEvent<AuthUser>).detail;\n      if (!user?.id) return;\n      setAuthUser(user);\n      const avatar = resolveAvatar(user.avatar, user.name);\n      setUserProfile((prev) => ({\n        ...prev,\n        name: user.name,\n        title: user.title || '',\n        organization: user.organization || '',\n        department: user.department || '',\n        city: user.city || '',\n        country: user.country || '',\n        bio: user.bio || '',\n        linkedinUrl: user.linkedinUrl || '',\n        avatar,\n      }));\n      if (user.role === 'organizer') setOrganizerLogoOverride(avatar);\n      if (user.role === 'sponsor') setSponsorLogoOverride(avatar);\n    };\n    window.addEventListener('conferencegate:auth-user-refreshed', handleLinkedInAuthRefresh as EventListener);\n    return () => window.removeEventListener('conferencegate:auth-user-refreshed', handleLinkedInAuthRefresh as EventListener);\n  }, []);\n\n  // Real tracked activity`,
    'live auth/avatar refresh listener',
  ],
]);

patchFile('src/components/auth/AuthScreen.tsx', [
  [
    `  googleAuth,\n  fetchPendingLinkedInProfile,`,
    `  googleAuth,\n  fetchCurrentUser,\n  fetchPendingLinkedInProfile,`,
    'fetchCurrentUser import',
  ],
  [
    `      const user = await signup(payload);\n      if (linkedinUrl.trim()) {\n        // Explicitly provided public URL = consent to build the ConferenceGate profile now.\n        // A failed enrichment never destroys the account; the member can retry from Profile.\n        await syncLinkedInOnboarding(linkedinUrl.trim()).catch(() => null);\n      }\n      onAuthenticated(user);`,
    `      let user = await signup(payload);\n      if (linkedinUrl.trim()) {\n        // Explicitly provided public URL = consent to build the ConferenceGate profile now.\n        // A failed enrichment never destroys the account; the member can retry from Profile.\n        await syncLinkedInOnboarding(linkedinUrl.trim()).catch(() => null);\n        const refreshedUser = await fetchCurrentUser().catch(() => null);\n        if (refreshedUser) user = refreshedUser;\n      }\n      onAuthenticated(user);`,
    'manual signup receives imported avatar',
  ],
  [
    `      const user = await signup({\n        role: 'professional',`,
    `      let user = await signup({\n        role: 'professional',`,
    'quick signup mutable user',
  ],
  [
    `      await syncLinkedInOnboarding(normalizedLinkedIn).catch(() => null);\n      onAuthenticated(user);`,
    `      await syncLinkedInOnboarding(normalizedLinkedIn).catch(() => null);\n      const refreshedUser = await fetchCurrentUser().catch(() => null);\n      if (refreshedUser) user = refreshedUser;\n      onAuthenticated(user);`,
    'quick signup receives imported avatar',
  ],
]);

console.log('[linkedin-avatar] LinkedIn public profile photos now fill empty ConferenceGate avatars without overwriting user-selected photos');
