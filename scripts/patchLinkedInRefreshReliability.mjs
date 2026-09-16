import fs from 'node:fs';

function patchFile(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  for (const [before, after, label] of transforms) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    if (index === -1) throw new Error(`[linkedin-refresh-reliability] ${path}: anchor not found (${label})`);
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  fs.writeFileSync(path, source);
  console.log(`[linkedin-refresh-reliability] patched ${path}`);
}

patchFile('server/linkedinConferenceActivityBootstrap.ts', [
  [
    '  const posts = Array.isArray(result) ? result.filter((item) => item && typeof item === "object") : [];\n  const { conferenceActivity, callsForPapers } = classifyPosts(posts, requestedUrl);',
    '  const posts = Array.isArray(result) ? result.filter((item) => item && typeof item === "object") : [];\n\n  // The posts actor exposes the member photo under author.avatar.url even when the dedicated\n  // profile actor omits/blocks the photo. Use it as a second avatar source, but never overwrite a\n  // real user-selected/Google photo. Generated initials are safe to replace.\n  const authorAvatarUrl = (() => {\n    for (const rawPost of posts) {\n      const post = rawPost && typeof rawPost === "object" ? rawPost as Record<string, any> : {};\n      if (!targetAuthorMatches(post, requestedUrl)) continue;\n      const author = post.author && typeof post.author === "object" ? post.author : {};\n      const candidates = [\n        author?.avatar?.url,\n        author?.picture?.url,\n        author?.pictureUrl,\n        author?.photo,\n        author?.photoUrl,\n        author?.image?.url,\n        author?.imageUrl,\n      ];\n      const found = candidates.find((value) => typeof value === "string" && /^https?:\\/\\//i.test(value.trim()));\n      if (found) return found.trim();\n    }\n    return null;\n  })();\n\n  if (authorAvatarUrl) {\n    let avatarValue = authorAvatarUrl;\n    const avatarController = new AbortController();\n    const avatarTimeout = setTimeout(() => avatarController.abort(), 12_000);\n    try {\n      const avatarResponse = await fetch(authorAvatarUrl, {\n        signal: avatarController.signal,\n        headers: {\n          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",\n          "User-Agent": "Mozilla/5.0 ConferenceGate LinkedIn Post Import",\n        },\n      });\n      const contentType = (avatarResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();\n      if (avatarResponse.ok && contentType.startsWith("image/")) {\n        const bytes = Buffer.from(await avatarResponse.arrayBuffer());\n        if (bytes.length > 0 && bytes.length <= 1_500_000) {\n          avatarValue = "data:" + contentType + ";base64," + bytes.toString("base64");\n        }\n      }\n    } catch {\n      // Keep the fresh LinkedIn CDN URL as fallback.\n    } finally {\n      clearTimeout(avatarTimeout);\n    }\n\n    await dbRun(\n      `UPDATE users SET avatar = CASE\n         WHEN COALESCE(TRIM(avatar), \'\') = \'\' OR avatar LIKE \'data:image/svg+xml%\' THEN ?\n         ELSE avatar\n       END\n       WHERE id = ?`,\n      [avatarValue, userId],\n    );\n  }\n\n  const { conferenceActivity, callsForPapers } = classifyPosts(posts, requestedUrl);',
    'post author avatar fallback',
  ],
]);

patchFile('src/components/LinkedInProfilePanel.tsx', [
  [
    "  const [error, setError] = useState<string | null>(null);",
    "  const [error, setError] = useState<string | null>(null);\n  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);",
    'refresh summary state',
  ],
  [
`  const handleRefresh = async () => {
    const url = linkedinUrl || profile?.linkedinUrl || activity?.linkedinUrl;
    if (!url) {
      setError('Add your public LinkedIn profile URL in Edit Profile first.');
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const [p, a] = await Promise.allSettled([
        refreshLinkedInProfileEnrichment(url),
        refreshLinkedInConferenceActivity(url),
      ]);
      if (p.status === 'rejected' && a.status === 'rejected') {
        throw new Error(p.reason?.message || a.reason?.message || 'LinkedIn import failed.');
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not refresh LinkedIn data.');
    } finally {
      setRefreshing(false);
    }
  };`,
`  const handleRefresh = async () => {
    const url = linkedinUrl || profile?.linkedinUrl || activity?.linkedinUrl;
    if (!url) {
      setError('Add your public LinkedIn profile URL in Edit Profile first.');
      return;
    }
    setRefreshing(true);
    setError(null);
    setRefreshSummary(null);
    try {
      const [p, a] = await Promise.allSettled([
        refreshLinkedInProfileEnrichment(url),
        refreshLinkedInConferenceActivity(url),
      ]);

      if (p.status === 'rejected' && a.status === 'rejected') {
        throw new Error('LinkedIn profile failed: ' + (p.reason?.message || 'unknown error') + ' | Conference history failed: ' + (a.reason?.message || 'unknown error'));
      }

      if (p.status === 'fulfilled') setProfile(p.value.profile);
      if (a.status === 'fulfilled') setActivity(a.value.activity);
      await load();

      if (p.status === 'rejected') {
        setError('Conference posts refreshed, but the professional-profile import failed: ' + (p.reason?.message || 'unknown error'));
      } else if (a.status === 'rejected') {
        setError('Professional profile refreshed, but conference-history import failed: ' + (a.reason?.message || 'unknown error'));
      } else {
        const c = a.value.counts;
        setRefreshSummary('LinkedIn refresh complete: ' + c.posts + ' posts scanned · ' + c.conferenceActivity + ' conference signals · ' + c.explicitMemberClaims + ' member claims · ' + c.callsForPapers + ' calls/opportunities.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not refresh LinkedIn data.');
    } finally {
      setRefreshing(false);
    }
  };`,
    'do not hide partial LinkedIn refresh failures',
  ],
  [
`      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">`,
`      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {refreshSummary && !error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          {refreshSummary}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">`,
    'show LinkedIn refresh counts',
  ],
]);

console.log('[linkedin-refresh-reliability] refresh now exposes partial provider failures, reports scan counts, and falls back to the post author avatar');
