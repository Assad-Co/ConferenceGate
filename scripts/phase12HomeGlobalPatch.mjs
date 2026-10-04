import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`[phase12-home] ${label}: expected pattern not found`);
  return source.replace(before, after);
}

function patchApp() {
  const file = path.resolve('src/App.tsx');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceOnce(
    source,
    "import { LiveSearchResult } from './api/search';",
    "import { LiveSearchResult, searchConferencesOnTheWeb } from './api/search';",
    'search API import'
  );

  source = replaceOnce(
    source,
    "  const [posts, setPosts] = useState<Post[]>([]);\n  const [userProfile, setUserProfile] = useState(currentUserProfile);",
    "  const [posts, setPosts] = useState<Post[]>([]);\n  const [homeCatalogueHighlights, setHomeCatalogueHighlights] = useState<LiveSearchResult[]>([]);\n  const [userProfile, setUserProfile] = useState(currentUserProfile);",
    'Home catalogue state'
  );

  const effectAnchor = "  useEffect(() => {\n    if (!authUser) return;\n    fetchSubmissions().then(setSubmissions).catch(() => {});";
  const effectReplacement = `  useEffect(() => {\n    if (!authUser) return;\n    // Home should feel alive even for a brand-new professional account. This is a stored-catalogue\n    // browse only: no visitor-triggered crawling and no static demo conference records.\n    if (authUser.role === 'professional') {\n      searchConferencesOnTheWeb('', 'low')\n        .then((results) => {\n          const today = new Date().toISOString().slice(0, 10);\n          const upcoming = (Array.isArray(results) ? results : [])\n            .filter((result) => !result.startDate || result.startDate >= today)\n            .sort((a, b) => String(a.startDate || '9999-12-31').localeCompare(String(b.startDate || '9999-12-31')))\n            .slice(0, 10);\n          setHomeCatalogueHighlights(upcoming);\n        })\n        .catch(() => setHomeCatalogueHighlights([]));\n    } else {\n      setHomeCatalogueHighlights([]);\n    }\n    fetchSubmissions().then(setSubmissions).catch(() => {});`;
  source = replaceOnce(source, effectAnchor, effectReplacement, 'Home catalogue browse effect');

  source = replaceOnce(
    source,
    "            posts={posts}\n            onAddPost={handleAddPost}",
    "            posts={posts}\n            catalogueHighlights={homeCatalogueHighlights}\n            onOpenCatalogueConference={handleOpenExternalResult}\n            onAddPost={handleAddPost}",
    'Home catalogue props'
  );

  fs.writeFileSync(file, source);
}

function patchHome() {
  const file = path.resolve('src/components/HomeLanding.tsx');
  let source = fs.readFileSync(file, 'utf8');

  source = replaceOnce(
    source,
    "import { formatDate, formatDateRange } from '../utils/date';",
    "import { formatDate, formatDateRange } from '../utils/date';\nimport type { LiveSearchResult } from '../api/search';",
    'LiveSearchResult import'
  );

  source = replaceOnce(
    source,
    "  posts: Post[];\n  onAddPost: (content: string) => void;",
    "  posts: Post[];\n  catalogueHighlights?: LiveSearchResult[];\n  onOpenCatalogueConference?: (result: LiveSearchResult) => void;\n  onAddPost: (content: string) => void;",
    'Home props interface'
  );

  source = replaceOnce(
    source,
    "  posts,\n  onAddPost,",
    "  posts,\n  catalogueHighlights = [],\n  onOpenCatalogueConference,\n  onAddPost,",
    'Home props destructuring'
  );

  source = replaceOnce(
    source,
    "  const featuredPool = [...safeConferences].sort(\n    (a, b) => new Date(a.dates.start).getTime() - new Date(b.dates.start).getTime()\n  );",
    "  const featuredPool = [...safeConferences].sort(\n    (a, b) => new Date(a.dates.start).getTime() - new Date(b.dates.start).getTime()\n  );\n  const worldwideHighlights = catalogueHighlights.slice(0, 4);\n  const worldwideOpenCfps = catalogueHighlights.filter((item) => item.cfpOpen).slice(0, 4);",
    'Home global derived lists'
  );

  const insertionAnchor = `        {/* Highlights teaser: a couple of top posts, not the full feed (see Feed tab for that) */}`;
  const insertion = `        {worldwideHighlights.length > 0 && (\n          <section className=\"bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden\">\n            <div className=\"px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3\">\n              <div>\n                <div className=\"text-[10px] font-bold uppercase tracking-wider text-blue-700\">Worldwide Conference Radar</div>\n                <div className=\"text-sm font-bold text-slate-900 mt-0.5\">Upcoming from the live ConferenceGate catalogue</div>\n              </div>\n              <button type=\"button\" onClick={() => onNavigateTab('discover')} className=\"text-[11px] font-bold text-blue-700 hover:text-blue-900 shrink-0\">View all</button>\n            </div>\n            <div className=\"grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:[&>*:nth-child(n+3)]:border-t divide-slate-100\">\n              {worldwideHighlights.map((item) => (\n                <button\n                  key={item.link + item.title}\n                  type=\"button\"\n                  onClick={() => onOpenCatalogueConference?.(item)}\n                  className=\"p-4 text-left hover:bg-slate-50 transition-colors border-slate-100 sm:odd:border-r group\"\n                >\n                  <div className=\"flex items-start gap-3\">\n                    <div className=\"w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 font-extrabold text-sm overflow-hidden\">\n                      {item.favicon ? <img src={item.favicon} alt=\"\" className=\"w-full h-full object-contain p-1\" /> : item.title.charAt(0).toUpperCase()}\n                    </div>\n                    <div className=\"min-w-0 flex-1\">\n                      <div className=\"text-xs font-bold text-slate-900 line-clamp-2 group-hover:text-blue-700 transition-colors\">{item.title}</div>\n                      <div className=\"mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500\">\n                        {item.startDate && <span className=\"flex items-center gap-1\"><Calendar className=\"w-3 h-3\" />{formatDateRange(item.startDate, item.endDate || item.startDate)}</span>}\n                        {(item.location?.city || item.location?.country) && <span className=\"flex items-center gap-1\"><MapPin className=\"w-3 h-3\" />{[item.location?.city, item.location?.country].filter(Boolean).join(', ')}</span>}\n                      </div>\n                      <div className=\"mt-2 flex flex-wrap gap-1\">\n                        {item.cfpOpen && <span className=\"px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-bold\">Open CFP</span>}\n                        {item.category && <span className=\"px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[9px] font-bold\">{item.category}</span>}\n                      </div>\n                    </div>\n                  </div>\n                </button>\n              ))}\n            </div>\n          </section>\n        )}\n\n        {/* Highlights teaser: a couple of top posts, not the full feed (see Feed tab for that) */}`;
  source = replaceOnce(source, insertionAnchor, insertion, 'Worldwide radar insertion');

  const rightSidebarAnchor = `        <div className=\"bg-white rounded-lg border border-slate-200 shadow-xs\">\n          <div className=\"px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-900\">\n            Upcoming Abstract Deadlines`;
  const rightSidebarReplacement = `        {worldwideOpenCfps.length > 0 && (\n          <div className=\"bg-white rounded-lg border border-slate-200 shadow-xs\">\n            <div className=\"px-4 py-3 border-b border-slate-100\">\n              <div className=\"font-bold text-sm text-slate-900\">Open CFPs worldwide</div>\n              <div className=\"text-[10px] text-slate-400 mt-0.5\">Verified catalogue records currently accepting submissions</div>\n            </div>\n            <div className=\"divide-y divide-slate-100\">\n              {worldwideOpenCfps.map((item) => (\n                <button key={item.link + item.title} type=\"button\" onClick={() => onOpenCatalogueConference?.(item)} className=\"w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors\">\n                  <div className=\"text-xs font-bold text-slate-900 line-clamp-2\">{item.title}</div>\n                  <div className=\"text-[10px] text-emerald-700 font-bold mt-1\">Open call for papers</div>\n                </button>\n              ))}\n            </div>\n          </div>\n        )}\n\n        <div className=\"bg-white rounded-lg border border-slate-200 shadow-xs\">\n          <div className=\"px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-900\">\n            Upcoming Abstract Deadlines`;
  source = replaceOnce(source, rightSidebarAnchor, rightSidebarReplacement, 'Open CFP sidebar');

  fs.writeFileSync(file, source);
}

patchApp();
patchHome();
console.log('[phase12-home] global catalogue Home upgrade applied');
