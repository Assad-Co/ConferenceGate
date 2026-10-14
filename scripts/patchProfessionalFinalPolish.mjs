import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const navbarFile = path.join(root, 'src/components/LegacyNavbar.tsx');
let navbar = fs.readFileSync(navbarFile, 'utf8');

const badgeBlock = `            {isAttendeeRole && (\n              <button\n                onClick={onOpenDigitalBadge}\n                className="p-1 sm:p-1.5 md:p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors relative cursor-pointer"\n                title="ConferenceGate Professional Badge"\n              >\n                <Award className="w-4 h-4" />\n              </button>\n            )}\n\n`;

if (navbar.includes(badgeBlock)) {
  navbar = navbar.replace(badgeBlock, '');
  fs.writeFileSync(navbarFile, navbar);
  console.log('Professional final polish applied: removed duplicate top Digital Badge shortcut.');
} else if (!navbar.includes('title="ConferenceGate Professional Badge"')) {
  console.log('Professional final polish already applied.');
} else {
  throw new Error('Professional final polish target missing: top Digital Badge shortcut');
}
