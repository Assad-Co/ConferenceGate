import fs from 'node:fs';

const path = 'src/components/CommunityFeed.tsx';
let text = fs.readFileSync(path, 'utf8');
const pattern = /return current\.trim\(\) \? tag \+ '\s*' \+ current : tag \+ '\s*';/;
if (!pattern.test(text)) throw new Error('broken conference-tag literal not found');
text = text.replace(
  pattern,
  "return current.trim() ? tag + '\\n\\n' + current : tag + '\\n\\n';"
);
fs.writeFileSync(path, text);
console.log('Fixed Community conference-tag newline literal');
