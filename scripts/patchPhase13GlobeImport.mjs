import fs from 'node:fs';
const path = 'src/components/HomeLanding.tsx';
let text = fs.readFileSync(path, 'utf8');
const needle = '  ExternalLink,\n} from \'lucide-react\';';
if (!text.includes(needle)) throw new Error('lucide import marker not found');
text = text.replace(needle, '  ExternalLink,\n  Globe,\n} from \'lucide-react\';');
fs.writeFileSync(path, text);
console.log('Added Globe import');
