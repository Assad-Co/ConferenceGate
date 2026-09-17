import fs from 'node:fs';

function patchFile(file, transforms) {
  let source = fs.readFileSync(file, 'utf8');
  for (const [from, to, label] of transforms) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`[linkedin-profile-ui] ${file}: anchor not found (${label})`);
    }
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source);
  console.log(`[linkedin-profile-ui] patched ${file}`);
}

patchFile('src/components/UserProfileView.tsx', [
  [
    "import type { KeynoteSpeakerMatch } from '../api/auth';",
    "import type { KeynoteSpeakerMatch } from '../api/auth';\nimport { LinkedInProfilePanel } from './LinkedInProfilePanel';",
    'panel import',
  ],
  [
    "type ProfileTab = 'conferences' | 'papers' | 'reviews' | 'committee' | 'badges' | 'analytics' | 'notifications';",
    "type ProfileTab = 'conferences' | 'linkedin' | 'papers' | 'reviews' | 'committee' | 'badges' | 'analytics' | 'notifications';",
    'tab type',
  ],
  [
    "                { id: 'notifications', label: 'Notifications' },\n                { id: 'conferences', label: 'Conferences History' },",
    "                { id: 'notifications', label: 'Notifications' },\n                { id: 'linkedin', label: 'LinkedIn Profile' },\n                { id: 'conferences', label: 'Conferences History' },",
    'tab button',
  ],
  [
    "        {activeTab === 'conferences' && keynoteSpeakerMatches.length > 0 && (",
    "        {activeTab === 'linkedin' && (\n          <LinkedInProfilePanel currentUserId={currentUserId} linkedinUrl={userProfile.linkedinUrl} />\n        )}\n\n        {activeTab === 'conferences' && keynoteSpeakerMatches.length > 0 && (",
    'tab content',
  ],
]);

patchFile('src/components/auth/AuthScreen.tsx', [
  [
    "import { LinkedInSignInButton } from './LinkedInSignInButton';",
    "import { LinkedInSignInButton } from './LinkedInSignInButton';\nimport { syncLinkedInOnboarding } from '../../api/linkedinOnboarding';",
    'onboarding import',
  ],
  [
    "      const user = await signup(payload);\n      onAuthenticated(user);",
    "      const user = await signup(payload);\n      if (linkedinUrl.trim()) {\n        // Explicitly provided public URL = consent to build the ConferenceGate profile now.\n        // A failed enrichment never destroys the account; the member can retry from Profile.\n        await syncLinkedInOnboarding(linkedinUrl.trim()).catch(() => null);\n      }\n      onAuthenticated(user);",
    'automatic import after signup',
  ],
  [
    "                    LinkedIn Username or URL <span className=\"font-normal text-slate-400\">(optional)</span>",
    "                    Public LinkedIn profile <span className=\"font-normal text-blue-600\">— auto-build my profile</span>",
    'linkedin label',
  ],
  [
    "                  <p className=\"text-[11px] text-slate-400 mt-1\">Shown on your public profile.</p>",
    "                  <p className=\"text-[11px] text-slate-500 mt-1\">\n                    Add your public LinkedIn URL and ConferenceGate will import professional history, publications, patents, and conference-related public posts after account creation. No LinkedIn password is required.\n                  </p>",
    'linkedin help',
  ],
  [
    "                <LinkedInSignInButton text=\"signin_with\" />",
    "                <LinkedInSignInButton text=\"signin_with\" onUnavailable={() => switchMode('signup')} />",
    'signin fallback',
  ],
  [
    "                <LinkedInSignInButton text=\"signup_with\" />",
    "                <LinkedInSignInButton text=\"signup_with\" onUnavailable={() => setMode('signup')} />",
    'signup fallback',
  ],
]);

patchFile('src/components/EditProfileModal.tsx', [
  [
    "import { refreshLinkedInProfileEnrichment } from '../api/linkedinProfile';",
    "import { syncLinkedInOnboarding } from '../api/linkedinOnboarding';",
    'edit profile onboarding import',
  ],
  [
    "      const result = await refreshLinkedInProfileEnrichment(linkedinUrl.trim());\n      const profile = result.profile;",
    "      const synced = await syncLinkedInOnboarding(linkedinUrl.trim());\n      const result = synced.profile;\n      const profile = result?.profile;\n      if (!profile) throw new Error('Professional profile data was not returned.');",
    'combined refresh',
  ],
  [
    "        `${result.counts.experience} experience`,\n        `${result.counts.education} education`,\n        `${result.counts.publications} publication${result.counts.publications === 1 ? '' : 's'}`,\n        `${result.counts.patents} patent${result.counts.patents === 1 ? '' : 's'}`,",
    "        `${result.counts.experience} experience`,\n        `${result.counts.education} education`,\n        `${result.counts.publications} publication${result.counts.publications === 1 ? '' : 's'}`,\n        `${result.counts.patents} patent${result.counts.patents === 1 ? '' : 's'}`,\n        ...(synced.conference ? [\n          `${synced.conference.counts.explicitMemberClaims} conference claims`,\n          `${synced.conference.counts.callsForPapers} calls/opportunities`,\n        ] : []),",
    'expanded import summary',
  ],
]);

// Public-URL-only LinkedIn UX. This button never starts OAuth. It simply moves the user to
// the signup form where they paste their public linkedin.com/in/... URL; the existing onboarding
// import then builds the profile automatically.
patchFile('src/components/auth/LinkedInSignInButton.tsx', [
  [
    "interface LinkedInSignInButtonProps {\n  text?: 'signin_with' | 'signup_with';\n}",
    "interface LinkedInSignInButtonProps {\n  text?: 'signin_with' | 'signup_with';\n  onUnavailable?: () => void;\n}",
    'fallback prop',
  ],
  [
    "export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with' }) => {\n  if (!CLIENT_ID) return null;\n\n  return (\n    <a\n      href=\"/api/auth/linkedin/start\"\n      className=\"w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-bold rounded-full transition-colors cursor-pointer\"\n    >\n      <Linkedin className=\"w-4 h-4 text-[#0A66C2]\" />\n      {text === 'signup_with' ? 'Sign up with LinkedIn' : 'Sign in with LinkedIn'}\n    </a>\n  );\n};",
    "export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with', onUnavailable }) => {\n  return (\n    <button\n      type=\"button\"\n      onClick={onUnavailable}\n      className=\"w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-bold rounded-full transition-colors cursor-pointer\"\n    >\n      <Linkedin className=\"w-4 h-4 text-[#0A66C2]\" />\n      {text === 'signup_with' ? 'Build profile from LinkedIn' : 'Use public LinkedIn profile'}\n    </button>\n  );\n};",
    'public URL fallback button',
  ],
]);
