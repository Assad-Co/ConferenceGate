import fs from 'node:fs';

const path = 'scripts/patchLinkedInDeepEvidence.mjs';
let source = fs.readFileSync(path, 'utf8');

const broken = '`      evidenceText: content.length > 900 ? `${content.slice(0, 897)}…` : content,`,';
const fixed = '`      evidenceText: content.length > 900 ? content.slice(0, 897) + "…" : content,`,';

if (source.includes(broken)) {
  source = source.replace(broken, fixed);
  fs.writeFileSync(path, source);
  console.log('[linkedin-deep-syntax] repaired nested template literal in deep-evidence patch');
} else if (source.includes(fixed)) {
  console.log('[linkedin-deep-syntax] deep-evidence patch already repaired');
} else {
  throw new Error('[linkedin-deep-syntax] expected deep-evidence syntax anchor not found');
}
