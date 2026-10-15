import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appFile = path.join(root, 'src/App.tsx');
let source = fs.readFileSync(appFile, 'utf8');

const replace = (from, to, label) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Organizer Edit Profile patch: ${label} anchor missing`);
  source = source.replace(from, to);
};

replace(
  `{(authUser.role === 'organizer' || authUser.role === 'sponsor') && (`,
  `{(activeRole === 'Organizer' || activeRole === 'Sponsor' || authUser.role === 'organizer' || authUser.role === 'sponsor') && (`,
  'modal role gate'
);

replace(
  `variant={authUser.role}`,
  `variant={activeRole === 'Organizer' ? 'organizer' : activeRole === 'Sponsor' ? 'sponsor' : authUser.role}`,
  'modal active preview variant'
);

replace(
  `if (updatedUser.role === 'organizer') {\n        setOrganizerNameOverride(updatedUser.organization || updatedUser.name);\n      } else if (updatedUser.role === 'sponsor') {\n        setSponsorNameOverride(updatedUser.organization || updatedUser.name);\n      }`,
  `if (activeRole === 'Organizer' || updatedUser.role === 'organizer') {\n        setOrganizerNameOverride(updatedUser.organization || updatedUser.name);\n      } else if (activeRole === 'Sponsor' || updatedUser.role === 'sponsor') {\n        setSponsorNameOverride(updatedUser.organization || updatedUser.name);\n      }`,
  'save updates active paid-role identity'
);

fs.writeFileSync(appFile, source);
console.log('Organizer Edit Profile owner-preview patch applied.');
