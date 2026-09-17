import fs from 'node:fs';

// This runs after every legacy LinkedIn-avatar repair patch.
// The authenticated OpenID Connect picture is now the authoritative automatic account avatar.
// Public-profile/post enrichment may still collect photo evidence, but it must not replace an
// avatar that comes from the member-authenticated LinkedIn flow.

{
  const path = 'server/linkedinProfileBootstrap.ts';
  let source = fs.readFileSync(path, 'utf8');

  const legacyForceSync = [
    "       avatar = CASE",
    "         WHEN ? IS NOT NULL THEN ?",
    "         ELSE avatar",
    "       END",
  ].join('\n');

  // Keep both SQL placeholders so the existing parameter list remains valid, but make the
  // assignment a deliberate no-op. This prevents the public scraper from replacing the verified
  // OAuth copy while leaving all non-avatar profile enrichment unchanged.
  const oauthOwned = [
    "       avatar = CASE",
    "         WHEN ? IS NOT NULL THEN avatar",
    "         WHEN ? IS NULL THEN avatar",
    "         ELSE avatar",
    "       END",
  ].join('\n');

  if (!source.includes(oauthOwned)) {
    if (!source.includes(legacyForceSync)) {
      throw new Error('[linkedin-oauth-avatar] legacy public-profile avatar writer not found');
    }
    source = source.replace(legacyForceSync, oauthOwned);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-oauth-avatar] authenticated LinkedIn OAuth picture owns the account avatar');
}

{
  const path = 'src/components/UserProfileView.tsx';
  let source = fs.readFileSync(path, 'utf8');

  const before = [
    '                  >',
    '                    Change Photo',
    '                  </button>',
    '                  {hasCustomAvatar && (',
  ].join('\n');

  const after = [
    '                  >',
    '                    Change Photo',
    '                  </button>',
    '                  <a',
    '                    href="/api/auth/linkedin/start"',
    '                    title="Securely sync your authenticated LinkedIn profile photo"',
    '                    className="text-[11px] font-bold text-[#0A66C2] hover:underline cursor-pointer inline-flex items-center gap-1"',
    '                  >',
    '                    <Linkedin className="w-3.5 h-3.5" />',
    '                    Sync LinkedIn Photo',
    '                  </a>',
    '                  {hasCustomAvatar && (',
  ].join('\n');

  if (!source.includes(after)) {
    const index = source.indexOf(before);
    if (index === -1) {
      throw new Error('[linkedin-oauth-avatar] profile Change Photo anchor not found');
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }

  fs.writeFileSync(path, source);
  console.log('[linkedin-oauth-avatar] profile now exposes a secure Sync LinkedIn Photo action');
}
