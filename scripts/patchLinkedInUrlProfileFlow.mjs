import fs from 'node:fs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('src/components/auth/AuthScreen.tsx', (source) => {
  // Without LinkedIn OAuth credentials, keep Google as the only social sign-in option.
  source = source.replace(
    'const oauthAvailable = Boolean(capabilities.googleClientId || capabilities.linkedin);',
    'const oauthAvailable = Boolean(capabilities.googleClientId);'
  );

  // Remove LinkedIn OAuth entry from the sign-in/signup social area. LinkedIn URL is used only as
  // an optional professional-profile reference after secure Google/email authentication.
  source = source.replace(/\n\s*\{capabilities\.linkedin && \([\s\S]*?<LinkedInSignInButton text=\{text\} \/>[\s\S]*?\)\}/m, '');
  source = source.replace(/\n\s*\{capabilities\.linkedin && <LinkedInSignInButton text=\{text\} \/>\}/m, '');

  // Returning-user explanation.
  const signinIntro = '<p className="text-sm text-slate-500 mb-6">Sign in to your ConferenceGate account.</p>';
  const signinEnhanced = `<p className="text-sm text-slate-500 mb-3">Sign in to your ConferenceGate account.</p>\n                  <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-[11px] leading-relaxed text-blue-900">\n                    <strong>Returning professional?</strong> Sign in normally with Google or email. If your profile has a LinkedIn URL, ConferenceGate refreshes your public professional evidence so your profile can stay current.\n                  </div>`;
  if (!source.includes('Returning professional?') && source.includes(signinIntro)) {
    source = source.replace(signinIntro, signinEnhanced);
  }

  // Make the optional LinkedIn URL clearly about enrichment, not authentication.
  const linkedinBlock = `<div>\n                        <label className="block text-xs font-bold text-slate-600 mb-1.5">LinkedIn profile <span className="font-normal text-slate-400">(optional)</span></label>\n                        <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="linkedin.com/in/yourname" className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600" />\n                      </div>`;
  const linkedinEnhanced = `<div className="rounded-xl border border-[#0A66C2]/20 bg-[#0A66C2]/5 p-3.5">\n                        <label className="block text-xs font-extrabold text-slate-700 mb-1.5">Build my profile from my LinkedIn URL <span className="font-normal text-slate-400">(optional)</span></label>\n                        <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="linkedin.com/in/yourname" className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600" />\n                        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Use your public LinkedIn profile as a professional reference. ConferenceGate does not use this URL as a login credential and does not access private LinkedIn data. After account creation, we enrich your profile from available public professional sources.</p>\n                      </div>`;
  if (!source.includes('Build my profile from my LinkedIn URL') && source.includes(linkedinBlock)) {
    source = source.replace(linkedinBlock, linkedinEnhanced);
  }

  return source;
});

patchFile('server/auth.ts', (source) => {
  // New Professional: start public-evidence enrichment immediately after signup when a LinkedIn URL is supplied.
  const signupAnchor = '  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;\n  const token = signToken(row.id);';
  const signupReplacement = `  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;\n  if (row.role === "professional" && row.linkedin_url) {\n    void queueProfessionalEvidenceResearch(row.id, { trigger: "linkedin_url_signup" })\n      .catch((err) => console.error("[professional-evidence] signup enrichment failed", err));\n  }\n  const token = signToken(row.id);`;
  if (!source.includes('trigger: "linkedin_url_signup"') && source.includes(signupAnchor)) {
    source = source.replace(signupAnchor, signupReplacement);
  }

  // Returning Professional: refresh evidence on a normal email/password login when LinkedIn is linked.
  const loginAnchor = '  if (!bcrypt.compareSync(password, row.password_hash)) {\n    return res.status(401).json({ error: "Invalid email or password" });\n  }\n\n  const token = signToken(row.id);';
  const loginReplacement = `  if (!bcrypt.compareSync(password, row.password_hash)) {\n    return res.status(401).json({ error: "Invalid email or password" });\n  }\n\n  if (row.role === "professional" && row.linkedin_url) {\n    void queueProfessionalEvidenceResearch(row.id, { trigger: "returning_login" })\n      .catch((err) => console.error("[professional-evidence] returning login refresh failed", err));\n  }\n\n  const token = signToken(row.id);`;
  if (!source.includes('trigger: "returning_login"') && source.includes(loginAnchor)) {
    source = source.replace(loginAnchor, loginReplacement);
  }

  return source;
});

console.log('[linkedin-url-profile] OAuth-free LinkedIn URL onboarding and returning-user refresh applied');
