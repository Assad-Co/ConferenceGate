import fs from 'node:fs';

const path = 'scripts/patchLinkedInDeepEvidence.mjs';
let source = fs.readFileSync(path, 'utf8');

const replacements = [
  [
    '`      evidenceText: content.length > 900 ? `${content.slice(0, 897)}…` : content,`,',
    '`      evidenceText: content.length > 900 ? content.slice(0, 897) + "…" : content,`,',
  ],
  ["key={`cert-${index}`}", "key={'cert-' + index}"],
  ["key={`honor-${index}`}", "key={'honor-' + index}"],
  ["key={`${title}-${index}`}", "key={title + '-' + index}"],
  ["key={`profile-committee-${index}`}", "key={'profile-committee-' + index}"],
  ["key={`profile-review-${index}`}", "key={'profile-review-' + index}"],
];

let changed = 0;
for (const [broken, fixed] of replacements) {
  if (source.includes(broken)) {
    source = source.split(broken).join(fixed);
    changed += 1;
  }
}

fs.writeFileSync(path, source);
console.log(`[linkedin-deep-syntax] sanitized ${changed} nested template-literal pattern(s) in deep-evidence patch`);
