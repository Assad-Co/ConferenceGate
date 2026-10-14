import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/components/DiscoveryEngineAdvanced.tsx');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Save-only conference patch target missing: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
  "              const saved = savedConferenceIds.includes(conf.id);\n              const followed = followedConferenceIds.includes(conf.id);",
  "              const saved = savedConferenceIds.includes(conf.id);",
  'hosted followed variable',
);
replaceOnce(
  "              const saved = savedConferenceIds.includes(result.link);\n              const followed = followedConferenceIds.includes(result.link);",
  "              const saved = savedConferenceIds.includes(result.link);",
  'worldwide followed variable',
);

// Remove Follow buttons from hosted and worldwide result cards.
source = source.replace(/\n\s*<button\n\s*type="button"\n\s*onClick=\{\(event\) => \{ event\.stopPropagation\(\); onToggleFollow\?\.\(conf\.id\); \}\}[\s\S]*?\{followed \? 'Following' : '\+ Follow'\}\n\s*<\/button>/, '');
source = source.replace(/\n\s*<button type="button" onClick=\{\(event\) => \{ event\.stopPropagation\(\); onToggleFollow\?\.\(result\.link\); \}\}[\s\S]*?\{followed \? 'Following' : '\+ Follow'\}\n\s*<\/button>/, '');

replaceOnce(
  "className={saved ? 'p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200' : 'p-2 rounded-xl bg-slate-50 text-slate-400 border border-slate-200'}",
  "className={saved ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold' : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold hover:border-blue-300'}",
  'hosted Save styling',
);
replaceOnce(
  'title="Save conference"',
  "title={saved ? 'Remove from saved conferences' : 'Save conference'}",
  'hosted Save title',
);
replaceOnce(
  '<Bookmark className="w-4 h-4 fill-current" />',
  "<Bookmark className={saved ? 'w-4 h-4 fill-current' : 'w-4 h-4'} />\n                          {saved ? 'Saved' : 'Save'}",
  'hosted Save label',
);

replaceOnce(
  "className={saved ? 'p-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200' : 'p-1.5 rounded-lg bg-slate-50 text-slate-400 border border-slate-200'} title={saved ? 'Remove from saved' : 'Save conference'}",
  "className={saved ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold' : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-200 text-[10px] font-bold hover:border-blue-300'} title={saved ? 'Remove from saved conferences' : 'Save conference'}",
  'worldwide Save styling',
);

const worldwideBookmark = '<Bookmark className={`w-3.5 h-3.5 ${saved ? \'fill-current\' : \'\'}`} />';
replaceOnce(
  worldwideBookmark,
  worldwideBookmark + "\n                          {saved ? 'Saved' : 'Save'}",
  'worldwide Save label',
);

fs.writeFileSync(file, source);
console.log('My Conferences save-only UX patch applied.');
