import fs from 'node:fs';
const file = 'scripts/syncRequestedCategoryExpansion.mjs';
let source = fs.readFileSync(file, 'utf8');
const before = `const PHASE12_EVENTS = JSON.parse(\n  fs.readFileSync(path.join(process.cwd(), 'data', 'phase12-verified-expansion.json'), 'utf8')\n);\n\nconst EVENTS=[...PHASE12_EVENTS,`;
const after = `const PHASE12_EVENTS = JSON.parse(\n  fs.readFileSync(path.join(process.cwd(), 'data', 'phase12-verified-expansion.json'), 'utf8')\n);\nconst PHASE12_REGIONAL_EVENTS = JSON.parse(\n  fs.readFileSync(path.join(process.cwd(), 'data', 'phase12-regional-expansion.json'), 'utf8')\n);\n\nconst EVENTS=[...PHASE12_EVENTS,...PHASE12_REGIONAL_EVENTS,`;
if (!source.includes(before)) throw new Error('Phase 12 event loader anchor not found');
source = source.replace(before, after);
fs.writeFileSync(file, source);
const rows = JSON.parse(fs.readFileSync('data/phase12-regional-expansion.json','utf8'));
if (rows.length !== 4) throw new Error('Expected exactly four verified regional expansion records');
for (const row of rows) {
  if (!row.title || !row.url || !row.start || !row.country || !Array.isArray(row.sourceUrls) || !row.sourceUrls.length) throw new Error('Incomplete regional row: ' + JSON.stringify(row));
}
console.log('[phase12-regional] added', rows.length, 'verified regional conferences');
