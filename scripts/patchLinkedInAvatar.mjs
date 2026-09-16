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
    `  const about = text(profile.about);\n\n  // HarvestAPI has returned LinkedIn profile pictures in several shapes over time: a direct\n  // string, an object with url/src/displayImage, or a list of image variants. Resolve only\n  // photo-related fields so unrelated URLs in the profile can never become the member avatar.\n  const imageUrlFrom = (value: unknown, depth = 0): string | null => {\n    if (depth > 4 || value == null) return null;\n    if (typeof value === \"string\") {\n      const candidate = value.trim();\n      return /^https?:\\/\\//i.test(candidate) ? candidate : null;\n    }\n    if (Array.isArray(value)) {\n      for (const item of value) {\n        const found = imageUrlFrom(item, depth + 1);\n        if (found) return found;\n      }\n      return null;\n    }\n    if (typeof value === \"object\") {\n      const record = value as Record<string, unknown>;\n      const preferredKeys = [\"url\", \"src\", \"photo\", \"photoUrl\", \"image\", \"imageUrl\", \"displayImage\", \"displayImageUrl\", \"profilePicture\", \"profilePictureUrl\", \"avatar\"];\n      for (const key of preferredKeys) {\n        if (!(key in record)) continue;\n        const found = imageUrlFrom(record[key], depth + 1);\n        if (found) return found;\n      }\n      for (const [key, child] of Object.entries(record)) {\n        if (!/photo|picture|avatar|image/i.test(key)) continue;\n        const found = imageUrlFrom(child, depth + 1);\n        if (found) return found;\n      }\n    }\n    return null;\n  };\n\n  const photoCandidates = [\n    profile.photo,\n    profile.photoUrl,\n    profile.profilePicture,\n    profile.profilePictureUrl,\n    profile.profilePictures,\n    profile.profileImage,\n    profile.profileImageUrl,\n    profile.displayPhoto,\n    profile.displayPicture,\n    profile.picture,\n    profile.pictureUrl,\n    profile.avatar,\n    profile.image,\n    profile.imageUrl,\n  ];\n  const profilePhotoUrl = photoCandidates.map((candidate) => imageUrlFrom(candidate)).find(Boolean) || null;\n\n  // Cache a small public LinkedIn profile image as a data URL when possible. This avoids browser\n  // hot-link/CORS/expiry problems from LinkedIn CDN URLs. If caching fails, keep the public URL\n  // as a fallback. Limit the stored avatar to 1.5 MB.\n  let profileAvatar: string | null = profilePhotoUrl;\n  if (profilePhotoUrl) {\n    const pictureController = new AbortController();\n    const pictureTimeout = setTimeout(() => pictureController.abort(), 12_000);\n    try {\n      const pictureResponse = await fetch(profilePhotoUrl, {\n        signal: pictureController.signal,\n        headers: {\n          Accept: \"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8\",\n          \"User-Agent\": \"Mozilla/5.0 ConferenceGate LinkedIn Profile Import\",\n        },\n      });\n      const contentType = (pictureResponse.headers.get(\"content-type\") || \"\").split(\";\")[0].trim().toLowerCase();\n      if (pictureResponse.ok && contentType.startsWith(\"image/\")) {\n        const bytes = Buffer.from(await pictureResponse.arrayBuffer());\n        if (bytes.length > 0 && bytes.length <= 1_500_000) {\n          profileAvatar = \"data:\" + contentType + \";base64,\" + bytes.toString(\"base64\");\n        }\n      }\n    } catch {\n      // The remote URL is still usable as a fallback if LinkedIn blocks server-side image fetch.\n    } finally {\n      clearTimeout(pictureTimeout);\n    }\n  }\n\n  await ensureSchema();`,
    'robust LinkedIn profile photo normalization',
  ],
  [
    `      text(profile.photo),`,
    `      profilePhotoUrl,`,
    'store normalized LinkedIn photo source',
  ],
  [
    `       country = CASE WHEN COALESCE(TRIM(country), '') = '' THEN ? ELSE country END,\n       bio = CASE WHEN COALESCE(TRIM(bio), '') = '' THEN ? ELSE bio END\n     WHERE id = ?\``,
    `       country = CASE WHEN COALESCE(TRIM(country), '') = '' THEN ? ELSE country END,\n       bio = CASE WHEN COALESCE(TRIM(bio), '') = '' THEN ? ELSE bio END,\n       avatar = CASE\n         WHEN COALESCE(TRIM(avatar), '') = '' OR avatar LIKE 'data:image/svg+xml%' THEN ?\n         ELSE avatar\n       END\n     WHERE id = ?\``,
    'replace empty or generated-initials avatar only',
  ],
  [
    `      about ? about.slice(0, 600) : null,\n      userId,`,
    `      about ? about.slice(0, 600) : null,\n      profileAvatar,\n      userId,`,
    'avatar update parameter',
  ],
]);

patchFile('src/api/linkedinProfile.ts', [
  [
    `  if (!response.ok) {\n    throw new Error(body.error || 'Could not import your LinkedIn profile.');\n  }\n  return body;\n}`,
    `  if (!response.ok) {\n    throw new Error(body.error || 'Could not import your LinkedIn profile.');\n  }\n\n  // The server may have filled a ConferenceGate avatar from the member's public LinkedIn\n  // profile photo. Refresh the authenticated user snapshot and notify App so the profile header\n  // changes immediately without requiring logout/reload.\n  try {\n    const authResponse = await fetch('/api/auth/me', { credentials: 'include' });\n    const authBody = await readJson(authResponse);\n    if (authResponse.ok && authBody?.user && typeof window !== 'undefined') {\n      window.dispatchEvent(new CustomEvent('conferencegate:auth-user-refreshed', { detail: authBody.user }));\n    }\n  } catch {\n    // Non-critical: the imported avatar remains persisted and appears after the next reload.\n  }\n\n  return body;\n}`,
    'refresh auth snapshot after LinkedIn import',
  ],
]);

patchFile('src/App.tsx', [
  [
    `  const [userProfile, setUserProfile] = useState(currentUserProfile);\n\n  // Real tracked activity`,
    `  const [userProfile, setUserProfile] = useState(currentUserProfile);\n\n  // LinkedIn public-profile import can fill the avatar and other blank identity fields server-side.\n  // Apply that refreshed auth snapshot in place so the profile picture/header update immediately.\n  useEffect(() => {\n    const handleLinkedInAuthRefresh = (event: Event) => {\n      const user = (event as CustomEvent<AuthUser>).detail;\n      if (!user?.id) return;\n      setAuthUser(user);\n      const avatar = resolveAvatar(user.avatar, user.name);\n      setUserProfile((prev) => ({\n        ...prev,\n        name: user.name,\n        title: user.title || '',\n        organization: user.organization || '',\n        department: user.department || '',\n        city: user.city || '',\n        country: user.country || '',\n        bio: user.bio || '',\n        linkedinUrl: user.linkedinUrl || '',\n        avatar,\n      }));\n      if (user.role === 'organizer') setOrganizerLogoOverride(avatar);\n      if (user.role === 'sponsor') setSponsorLogoOverride(avatar);\n    };\n    window.addEventListener('conferencegate:auth-user-refreshed', handleLinkedInAuthRefresh as EventListener);\n    return () => window.removeEventListener('conferencegate:auth-user-refreshed', handleLinkedInAuthRefresh as EventListener);\n  }, []);\n\n  // Real tracked activity`,
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

console.log('[linkedin-avatar] LinkedIn photo resolves nested provider fields, caches the image when possible, and replaces only empty/generated-initials avatars');
