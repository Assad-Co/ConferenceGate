import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src/components/auth/AuthScreen.tsx');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`[professional-onboarding] Could not find ${label}`);
  return source.replace(before, after);
}

let source = fs.readFileSync(target, 'utf8');

source = replaceOnce(
  source,
  "import { LinkedInSignInButton } from './LinkedInSignInButton';",
  "import { LinkedInSignInButton } from './LinkedInSignInButton';\nimport { ProfessionalSignupOnboarding } from './ProfessionalSignupOnboarding';",
  'onboarding import',
);

source = replaceOnce(
  source,
  "  const [oauthRole, setOauthRole] = useState<AuthRole>('professional');",
  "  const [oauthRole, setOauthRole] = useState<AuthRole>('professional');\n  const [newProfessionalUser, setNewProfessionalUser] = useState<AuthUser | null>(null);",
  'new professional state',
);

source = replaceOnce(
  source,
  "        const result = await googleAuth(pendingGoogleCredential, oauthRole);\n        if (!('needsRole' in result)) onAuthenticated(result);",
  "        const result = await googleAuth(pendingGoogleCredential, oauthRole);\n        if (!('needsRole' in result)) {\n          if (oauthRole === 'professional') setNewProfessionalUser(result);\n          else onAuthenticated(result);\n        }",
  'Google signup completion',
);

source = replaceOnce(
  source,
  "        const user = await completeLinkedInSignup(oauthRole);\n        onAuthenticated(user);",
  "        const user = await completeLinkedInSignup(oauthRole);\n        if (oauthRole === 'professional') setNewProfessionalUser(user);\n        else onAuthenticated(user);",
  'LinkedIn signup completion',
);

source = replaceOnce(
  source,
  "      const user = await signup(payload);\n      onAuthenticated(user);",
  "      const user = await signup(payload);\n      if (user.role === 'professional') setNewProfessionalUser(user);\n      else onAuthenticated(user);",
  'email signup completion',
);

source = replaceOnce(
  source,
  "  return (\n    <div className=\"min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 flex flex-col items-center justify-center px-4 py-10\">",
  "  if (newProfessionalUser) {\n    return (\n      <ProfessionalSignupOnboarding\n        user={newProfessionalUser}\n        onContinue={() => onAuthenticated(newProfessionalUser)}\n      />\n    );\n  }\n\n  return (\n    <div className=\"min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 flex flex-col items-center justify-center px-4 py-10\">",
  'onboarding render gate',
);

fs.writeFileSync(target, source);
console.log('[professional-onboarding] Professional signup welcome screen is wired.');
