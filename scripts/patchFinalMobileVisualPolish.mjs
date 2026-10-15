import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, content) => fs.writeFileSync(path.join(root, p), content);
const replace = (source, from, to, label) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Final mobile polish patch: ${label} anchor missing`);
  return source.replace(from, to);
};

{
  const file = 'src/components/SponsorPortal.tsx';
  let source = read(file);
  source = replace(
    source,
    '<div className="flex items-center gap-2">\n              <span className="px-3 py-1 bg-white text-blue-700 border border-blue-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">',
    '<div className="flex flex-wrap items-center gap-2">\n              <span className="px-3 py-1 bg-white text-blue-700 border border-blue-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">',
    'Sponsor header badges wrap on mobile'
  );
  source = replace(
    source,
    '<div className="flex gap-2">\n                    <input\n                      value={dealNotes[deal.id] || \'\'}',
    '<div className="flex flex-col sm:flex-row gap-2">\n                    <input\n                      value={dealNotes[deal.id] || \'\'}',
    'Deal Room note controls stack on mobile'
  );
  source = replace(
    source,
    'className="flex-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"',
    'className="flex-1 min-w-0 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"',
    'Deal Room note input can shrink'
  );
  source = replace(
    source,
    'className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"\n                    >\n                      Send',
    'className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"\n                    >\n                      Send',
    'Deal Room Send button mobile width'
  );
  write(file, source);
}

{
  const file = 'src/components/OrganizerDashboard.tsx';
  let source = read(file);
  source = replace(
    source,
    'className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition-colors cursor-pointer shrink-0"',
    'className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0"',
    'Organizer create conference CTA mobile width'
  );
  source = replace(
    source,
    'className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"',
    'className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 shrink-0"',
    'Organizer Edit Profile mobile width'
  );
  write(file, source);
}
