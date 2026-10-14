import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patch(pathname, replacements) {
  const file = path.join(root, pathname);
  let source = fs.readFileSync(file, 'utf8');
  for (const { before, after } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error(`Save-only conference patch target missing in ${pathname}: ${before.slice(0, 120)}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source);
}

patch('src/components/DiscoveryEngineAdvanced.tsx', [
  {
    before: `<div className="flex items-center gap-2">\n                        <button\n                          type="button"\n                          onClick={(event) => { event.stopPropagation(); onToggleSave?.(conf.id); }}\n                          className={saved ? 'p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200' : 'p-2 rounded-xl bg-slate-50 text-slate-400 border border-slate-200'}\n                          title="Save conference"\n                        >\n                          <Bookmark className="w-4 h-4 fill-current" />\n                        </button>\n                        <button\n                          type="button"\n                          onClick={(event) => { event.stopPropagation(); onToggleFollow?.(conf.id); }}\n                          className={followed ? 'px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold' : 'px-3 py-2 rounded-xl bg-slate-50 text-slate-600 border border-slate-200 text-xs font-bold'}\n                        >\n                          {followed ? 'Following' : '+ Follow'}\n                        </button>\n                      </div>`,
    after: `<div className="flex items-center gap-2">\n                        <button\n                          type="button"\n                          onClick={(event) => { event.stopPropagation(); onToggleSave?.(conf.id); }}\n                          className={saved ? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold' : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold hover:border-blue-300'}\n                          title={saved ? 'Remove from saved conferences' : 'Save conference'}\n                        >\n                          <Bookmark className={\`w-4 h-4 ${saved ? 'fill-current' : ''}\`} />\n                          {saved ? 'Saved' : 'Save'}\n                        </button>\n                      </div>`,
  },
  {
    before: `<div className="flex flex-wrap items-center gap-1.5">\n                        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleSave?.(result.link); }} className={saved ? 'p-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200' : 'p-1.5 rounded-lg bg-slate-50 text-slate-400 border border-slate-200'} title={saved ? 'Remove from saved' : 'Save conference'}>\n                          <Bookmark className={\`w-3.5 h-3.5 ${saved ? 'fill-current' : ''}\`} />\n                        </button>\n                        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleFollow?.(result.link); }} className={followed ? 'px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold' : 'px-2.5 py-1 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-[10px] font-bold'}>\n                          {followed ? 'Following' : '+ Follow'}\n                        </button>\n                        {result.cfpOpen && <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>}`,
    after: `<div className="flex flex-wrap items-center gap-1.5">\n                        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleSave?.(result.link); }} className={saved ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold' : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-200 text-[10px] font-bold hover:border-blue-300'} title={saved ? 'Remove from saved conferences' : 'Save conference'}>\n                          <Bookmark className={\`w-3.5 h-3.5 ${saved ? 'fill-current' : ''}\`} />\n                          {saved ? 'Saved' : 'Save'}\n                        </button>\n                        {result.cfpOpen && <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>}`,
  },
]);

console.log('My Conferences save-only UX patch applied.');
