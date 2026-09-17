import fs from 'node:fs';

function replaceOnce(source, before, after, label, path) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-avatar-diagnostics] ${path}: anchor not found (${label})`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

// Server: return exactly what the profile provider exposed for photo-specific fields,
// what URL ConferenceGate resolved, and what avatar is stored after the refresh.
{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');
  const before = [
    '  const stored = await readStoredProfile(userId);',
    '  res.json({',
    '    profile: stored,',
  ].join('\n');
  const after = [
    '  const stored = await readStoredProfile(userId);',
    '  const avatarRow = await dbGet<any>("SELECT avatar FROM users WHERE id = ?", [userId]);',
    '  const describePhotoField = (field: string, value: unknown) => {',
    '    const resolved = imageUrlFrom(value);',
    '    return {',
    '      field,',
    '      type: value == null ? "missing" : Array.isArray(value) ? "array" : typeof value,',
    '      resolvedUrl: resolved || null,',
    '    };',
    '  };',
    '  const accountAvatar = typeof avatarRow?.avatar === "string" ? avatarRow.avatar.trim() : "";',
    '  const accountAvatarSummary = !accountAvatar',
    '    ? "empty"',
    '    : accountAvatar.startsWith("data:image/")',
    '      ? "cached-data-image"',
    '      : /^https?:\\/\\//i.test(accountAvatar)',
    '        ? accountAvatar',
    '        : "other";',
    '  const avatarDiagnostics = {',
    '    requestedLinkedInUrl: requestedUrl,',
    '    returnedLinkedInUrl: returnedUrl,',
    '    returnedPublicIdentifier: text(profile.publicIdentifier),',
    '    returnedFullName: fullName,',
    '    resolvedProfilePhotoUrl: profilePhotoUrl || null,',
    '    storedProfilePhotoUrl: stored?.photoUrl || null,',
    '    accountAvatarSummary,',
    '    providerPhotoFields: [',
    '      describePhotoField("photo", profile.photo),',
    '      describePhotoField("photoUrl", profile.photoUrl),',
    '      describePhotoField("profilePicture", profile.profilePicture),',
    '      describePhotoField("profilePictureUrl", profile.profilePictureUrl),',
    '      describePhotoField("displayPhoto", profile.displayPhoto),',
    '    ],',
    '  };',
    '  res.json({',
    '    profile: stored,',
    '    avatarDiagnostics,',
  ].join('\n');
  source = replaceOnce(source, before, after, 'server response diagnostics', path);
  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-diagnostics] profile refresh returns provider photo diagnostics');
}

// Client type: keep diagnostics available to the profile panel.
{
  const path = 'src/api/linkedinProfile.ts';
  let source = fs.readFileSync(path, 'utf8');
  const before = [
    'export interface LinkedInProfileImportResult {',
    '  profile: LinkedInProfileEnrichment;',
    '  imported: boolean;',
  ].join('\n');
  const after = [
    'export interface LinkedInProfileImportResult {',
    '  profile: LinkedInProfileEnrichment;',
    '  imported: boolean;',
    '  avatarDiagnostics?: {',
    '    requestedLinkedInUrl: string;',
    '    returnedLinkedInUrl: string;',
    '    returnedPublicIdentifier: string | null;',
    '    returnedFullName: string | null;',
    '    resolvedProfilePhotoUrl: string | null;',
    '    storedProfilePhotoUrl: string | null;',
    '    accountAvatarSummary: string;',
    '    providerPhotoFields: Array<{ field: string; type: string; resolvedUrl: string | null }>;',
    '  };',
  ].join('\n');
  source = replaceOnce(source, before, after, 'client diagnostics type', path);
  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-diagnostics] client accepts avatar diagnostics');
}

// UI: show a small diagnostic card only after an explicit refresh. This is temporary diagnostic
// information for the signed-in member and contains no API tokens or credentials.
{
  const path = 'src/components/LinkedInProfilePanel.tsx';
  let source = fs.readFileSync(path, 'utf8');

  source = replaceOnce(
    source,
    '  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);',
    '  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);\n  const [avatarDiagnostics, setAvatarDiagnostics] = useState<any | null>(null);',
    'diagnostics state',
    path,
  );

  source = replaceOnce(
    source,
    '    setRefreshSummary(null);',
    '    setRefreshSummary(null);\n    setAvatarDiagnostics(null);',
    'clear diagnostics',
    path,
  );

  source = replaceOnce(
    source,
    "      if (p.status === 'fulfilled') setProfile(p.value.profile);",
    "      if (p.status === 'fulfilled') {\n        setProfile(p.value.profile);\n        setAvatarDiagnostics(p.value.avatarDiagnostics || null);\n      }",
    'capture diagnostics',
    path,
  );

  const beforeCard = [
    '      {refreshSummary && !error && (',
    '        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">',
    '          {refreshSummary}',
    '        </div>',
    '      )}',
    '',
    '      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">',
  ].join('\n');

  const afterCard = [
    '      {refreshSummary && !error && (',
    '        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">',
    '          {refreshSummary}',
    '        </div>',
    '      )}',
    '',
    '      {avatarDiagnostics && (',
    '        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">',
    '          <div className="font-extrabold">Avatar diagnostic</div>',
    '          <div>Returned profile: <span className="font-semibold">{avatarDiagnostics.returnedFullName || "unknown"}</span> · {avatarDiagnostics.returnedPublicIdentifier || "no publicIdentifier"}</div>',
    '          <div>Resolved profile photo: {avatarDiagnostics.resolvedProfilePhotoUrl ? (',
    '            <a className="font-bold text-blue-700 underline" href={avatarDiagnostics.resolvedProfilePhotoUrl} target="_blank" rel="noopener noreferrer">Open provider photo</a>',
    '          ) : <span className="font-bold text-rose-700">NONE</span>}</div>',
    '          <div>Account avatar after refresh: <span className="font-semibold">{avatarDiagnostics.accountAvatarSummary}</span></div>',
    '          <div className="break-all">Photo fields: {avatarDiagnostics.providerPhotoFields?.map((item: any) => `${item.field}=${item.type}${item.resolvedUrl ? " ✓" : " ✕"}`).join(" · ")}</div>',
    '        </div>',
    '      )}',
    '',
    '      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">',
  ].join('\n');

  source = replaceOnce(source, beforeCard, afterCard, 'diagnostic card', path);
  fs.writeFileSync(path, source);
  console.log('[linkedin-avatar-diagnostics] profile panel shows exact provider photo diagnostics after refresh');
}
