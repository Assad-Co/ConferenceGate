import fs from 'node:fs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('src/components/auth/LinkedInSignInButton.tsx', (source) => {
  source = source.replace(
    "{text === 'signup_with' ? 'Sign up with LinkedIn' : 'Sign in with LinkedIn'}",
    "{text === 'signup_with' ? 'Create profile with LinkedIn' : 'Continue with LinkedIn'}"
  );
  source = source.replace(
    'LinkedIn verifies your identity. ConferenceGate may then match it to public professional evidence such as publications, conference roles and public bios. Private LinkedIn data is not accessed.',
    "LinkedIn authenticates your account. ConferenceGate then refreshes your profile using permitted LinkedIn profile fields and public professional evidence. We do not use a LinkedIn profile URL as a password or store your LinkedIn access token."
  );
  return source;
});

patchFile('src/components/auth/AuthScreen.tsx', (source) => {
  const oldBlock = `          {capabilities.linkedin && <LinkedInSignInButton text={text} />}`;
  const newBlock = `          {capabilities.linkedin && (\n            <div className=\"rounded-2xl border border-[#0A66C2]/20 bg-[#0A66C2]/5 p-3\">\n              <div className=\"mb-2\">\n                <div className=\"text-xs font-extrabold text-slate-800\">\n                  {text === 'signup_with' ? 'New to ConferenceGate?' : 'Already have a ConferenceGate profile?'}\n                </div>\n                <div className=\"mt-1 text-[11px] leading-relaxed text-slate-600\">\n                  {text === 'signup_with'\n                    ? 'Create your account with LinkedIn. After LinkedIn authenticates your account, choose your role and ConferenceGate will build and enrich your professional profile from permitted LinkedIn profile fields and public professional evidence.'\n                    : 'Continue with LinkedIn to sign in to your existing ConferenceGate profile. We will also refresh your photo and public professional evidence so your profile stays current.'}\n                </div>\n              </div>\n              <LinkedInSignInButton text={text} />\n            </div>\n          )}`;
  if (!source.includes(newBlock)) {
    if (!source.includes(oldBlock)) throw new Error('[linkedin-auth-ux] LinkedIn render anchor not found');
    source = source.replace(oldBlock, newBlock);
  }

  const oldOauthTitle = `<h1 className=\"text-xl font-extrabold text-slate-900 mb-1\">One last step</h1>\n            <p className=\"text-sm text-slate-500 mb-5\">Choose the account type that fits you best.</p>`;
  const newOauthTitle = `<h1 className=\"text-xl font-extrabold text-slate-900 mb-1\">{oauthPending.kind === 'linkedin' ? 'Build your ConferenceGate profile' : 'One last step'}</h1>\n            <p className=\"text-sm text-slate-500 mb-5\">{oauthPending.kind === 'linkedin' ? 'LinkedIn authenticated your account. Choose your ConferenceGate role and we’ll create your account, then start enriching your professional profile from permitted LinkedIn profile fields and public evidence.' : 'Choose the account type that fits you best.'}</p>`;
  if (!source.includes(newOauthTitle) && source.includes(oldOauthTitle)) {
    source = source.replace(oldOauthTitle, newOauthTitle);
  }

  return source;
});

console.log('[linkedin-auth-ux] new/returning LinkedIn onboarding copy applied');
