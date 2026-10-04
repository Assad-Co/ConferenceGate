import fs from 'node:fs';

const path = 'src/components/DiscoveryEngine.tsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  text = text.replace(from, to);
}

replaceOnce(
  "  Leaf,\n  ArrowRight,\n} from 'lucide-react';",
  "  Leaf,\n  ArrowRight,\n  ArrowUpDown,\n  CheckCircle2,\n} from 'lucide-react';",
  'icons'
);

const helperMarker = '/** The host the organiser\'s mark came from, for the badge\'s tooltip. */';
if (!text.includes(helperMarker)) throw new Error('helper marker not found');
text = text.replace(
  helperMarker,
  "function resultDetailCoverage(result: LiveSearchResult): number {\n" +
  "  return Math.min(9, 1 + new Set(result.sections || []).size);\n" +
  "}\n\n" +
  "function preferredResultTab(result: LiveSearchResult): ExternalDetailTab {\n" +
  "  if (result.cfpOpen && result.sections?.includes('cfp')) return 'cfp';\n" +
  "  if (result.sections?.includes('fees')) return 'fees';\n" +
  "  if (result.sections?.includes('agenda')) return 'agenda';\n" +
  "  if (result.sections?.includes('speakers')) return 'speakers';\n" +
  "  return 'overview';\n" +
  "}\n\n" +
  "function preferredResultAction(result: LiveSearchResult): string {\n" +
  "  const tab = preferredResultTab(result);\n" +
  "  if (tab === 'cfp') return 'Review Open CFP';\n" +
  "  if (tab === 'fees') return 'Check Fees';\n" +
  "  if (tab === 'agenda') return 'View Program';\n" +
  "  if (tab === 'speakers') return 'View Speakers';\n" +
  "  return 'View Details';\n" +
  "}\n\n" +
  helperMarker
);

replaceOnce(
  "  const [cfpOnly, setCfpOnly] = useState(false);\n  const [categoryFilter, setCategoryFilter] = useState('');\n",
  "  const [cfpOnly, setCfpOnly] = useState(false);\n" +
  "  const [categoryFilter, setCategoryFilter] = useState('');\n" +
  "  const [richDetailsOnly, setRichDetailsOnly] = useState(false);\n" +
  "  const [resultSort, setResultSort] = useState<'recommended' | 'soonest' | 'complete' | 'cfp'>('recommended');\n",
  'state'
);

const locationMarker = '\n\n  const locationOptions = useMemo(() => {';
const locationIndex = text.indexOf(locationMarker);
if (locationIndex < 0) throw new Error('location marker not found');
const decisionBlock = "\n\n  const displayedWebResults = [...visibleWebResults]\n" +
  "    .filter((result) => !richDetailsOnly || resultDetailCoverage(result) >= 6)\n" +
  "    .sort((left, right) => {\n" +
  "      if (resultSort === 'soonest') {\n" +
  "        const leftDate = left.startDate ? Date.parse(left.startDate) : Number.POSITIVE_INFINITY;\n" +
  "        const rightDate = right.startDate ? Date.parse(right.startDate) : Number.POSITIVE_INFINITY;\n" +
  "        return leftDate - rightDate;\n" +
  "      }\n" +
  "      if (resultSort === 'complete') return resultDetailCoverage(right) - resultDetailCoverage(left);\n" +
  "      if (resultSort === 'cfp') {\n" +
  "        const cfpDifference = Number(right.cfpOpen === true) - Number(left.cfpOpen === true);\n" +
  "        return cfpDifference || resultDetailCoverage(right) - resultDetailCoverage(left);\n" +
  "      }\n" +
  "      return 0;\n" +
  "    });";
text = text.slice(0, locationIndex) + decisionBlock + text.slice(locationIndex);

replaceOnce(
  "                  setCategoryFilter('');\n                  setCfpOnly(false);\n                  setPriceRange(null);\n",
  "                  setCategoryFilter('');\n" +
  "                  setCfpOnly(false);\n" +
  "                  setRichDetailsOnly(false);\n" +
  "                  setResultSort('recommended');\n" +
  "                  setPriceRange(null);\n",
  'clear filters'
);

const loadingMarker = '        {webSearchLoading && (!webResults || webResults.length === 0) && (';
if (!text.includes(loadingMarker)) throw new Error('results controls marker not found');
const controls = `        {webResults && webResults.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">{displayedWebResults.length} conference{displayedWebResults.length === 1 ? '' : 's'} ready to compare</div>
                <div className="text-[10px] text-slate-500">Sort by timing, completeness or open CFP status before opening a conference.</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRichDetailsOnly((value) => !value)}
                className={richDetailsOnly
                  ? 'px-3 py-2 rounded-xl border text-[11px] font-bold bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'px-3 py-2 rounded-xl border text-[11px] font-bold bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700'}
              >
                6+ detail sections
              </button>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={resultSort}
                  onChange={(event) => setResultSort(event.target.value as typeof resultSort)}
                  aria-label="Sort conference results"
                  className="bg-transparent text-[11px] font-bold text-slate-700 focus:outline-hidden"
                >
                  <option value="recommended">Recommended</option>
                  <option value="soonest">Soonest first</option>
                  <option value="complete">Most complete</option>
                  <option value="cfp">Open CFP first</option>
                </select>
              </label>
            </div>
          </div>
        )}

`;
text = text.replace(loadingMarker, controls + loadingMarker);

text = text.replace('!webSearchError && webResults && visibleWebResults.length === 0', '!webSearchError && webResults && displayedWebResults.length === 0');
text = text.replace('!webSearchError && webResults && visibleWebResults.length > 0', '!webSearchError && webResults && displayedWebResults.length > 0');
text = text.replace('visibleWebResults.map((result, idx) => (', 'displayedWebResults.map((result, idx) => (');

replaceOnce(
  '                  <h2 className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug">\n                    {result.title}\n                  </h2>\n',
  `                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug min-w-0 flex-1">
                      {result.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {result.cfpOpen && (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>
                      )}
                      <span className={resultDetailCoverage(result) >= 6
                        ? 'px-2.5 py-1 rounded-full border text-[10px] font-bold bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'px-2.5 py-1 rounded-full border text-[10px] font-bold bg-slate-50 border-slate-200 text-slate-600'}>
                        {resultDetailCoverage(result)}/9 details
                      </span>
                    </div>
                  </div>
`,
  'card badges'
);

replaceOnce(
  `                <div className="shrink-0 flex sm:justify-end">
                  <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors">
                    View Details
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </span>
                </div>`,
  `                <div className="shrink-0 flex sm:justify-end">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenExternalResult(result, preferredResultTab(result));
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors"
                  >
                    {preferredResultAction(result)}
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                </div>`,
  'smart action'
);

fs.writeFileSync(path, text);
console.log('Phase 14 Discovery decision tools applied');
