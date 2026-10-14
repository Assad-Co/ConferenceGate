import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/components/HomeLanding.tsx');
let source = fs.readFileSync(file, 'utf8');

const badgeBlock = `          <button\n            onClick={onOpenDigitalBadge}\n            className="w-full flex items-center gap-3 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-blue-700 cursor-pointer transition-colors group"\n          >\n            <QrCode className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors" />\n            <span>Digital Badge</span>\n          </button>\n`;

if (source.includes(badgeBlock)) {
  source = source.replace(badgeBlock, '');
  fs.writeFileSync(file, source);
  console.log('Professional final acceptance patch applied: removed Home Digital Badge shortcut.');
} else if (!source.includes('<span>Digital Badge</span>')) {
  console.log('Professional final acceptance patch already applied.');
} else {
  throw new Error('Professional final acceptance patch target missing: Home Digital Badge shortcut');
}
