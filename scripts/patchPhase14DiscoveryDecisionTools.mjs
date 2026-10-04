import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(from, to);
}

function patch(path, fn) {
  const before = fs.readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  fs.writeFileSync(path, after);
  console.log(`patched ${path}`);
}

patch('src/components/DiscoveryEngine.tsx', (input) => {
  let text = input;

  text = replaceOnce(
    text,
    `  Leaf,\n  ArrowRight,\n} from 'lucide-react';`,
    `  Leaf,\n  ArrowRight,\n  ArrowUpDown,\n  CheckCircle2,\n} from 'lucide-react';`,
    'discovery icons'
  );

  text = replaceOnce(
    text,
    `function formatChipLabel(format?: string | null): string | null {\n  if (format === 'in-person') return 'In-Person';\n  if (format === 'hybrid') return 'Hybrid';\n  if (format === 'online') return 'Online';\n  return null;\n}\n`,
    `function formatChipLabel(format?: string | null): string | null {\n  if (format === 'in-person') return 'In-Person';\n  if (format === 'hybrid') return 'Hybrid';\n  if (format === 'online') return 'Online';\n  return null;\n}\n\nfunction resultDetailCoverage(result: LiveSearchResult): number {\n  // Overview is the core conference record; every additional section is a real structured tab.\n  return Math.min(9, 1 + new Set(result.sections || []).size);\n}\n\nfunction preferredResultTab(result: LiveSearchResult): ExternalDetailTab {\n  if (result.cfpOpen && result.sections?.includes('cfp')) return 'cfp';\n  if (result.sections?.includes('fees')) return 'fees';\n  if (result.sections?.includes('agenda')) return 'agenda';\n  if (result.sections?.includes('speakers')) return 'speakers';\n  return 'overview';\n}\n\nfunction preferredResultAction(result: LiveSearchResult): string {\n  const tab = preferredResultTab(result);\n  if (tab === 'cfp') return 'Review Open CFP';\n  if (tab === 'fees') return 'Check Fees';\n  if (tab === 'agenda') return 'View Program';\n  if (tab === 'speakers') return 'View Speakers';\n  return 'View Details';\n}\n`,
    'discovery result helpers'
  );

  text = replaceOnce(
    text,
    `  const [cfpOnly, setCfpOnly] = useState(false);\n  const [categoryFilter, setCategoryFilter] = useState('');\n`,
    `  const [cfpOnly, setCfpOnly] = useState(false);\n  const [categoryFilter, setCategoryFilter] = useState('');\n  const [richDetailsOnly, setRichDetailsOnly] = useState(false);\n  const [resultSort, setResultSort] = useState<'recommended' | 'soonest' | 'complete' | 'cfp'>('recommended');\n`,
    'discovery decision state'
  );

  text = replaceOnce(
    text,
    `    if (cfpOnly && result.cfpOpen !== true) return false;\n    return true;\n  });\n\n  const locationOptions = useMemo(() => {`,
    `    if (cfpOnly && result.cfpOpen !== true) return false;\n    return true;\n  });\n\n  const displayedWebResults = [...visibleWebResults]\n    .filter((result) => !richDetailsOnly || resultDetailCoverage(result) >= 6)\n    .sort((left, right) => {\n      if (resultSort === 'soonest') {\n        const leftDate = left.startDate ? Date.parse(left.startDate) : Number.POSITIVE_INFINITY;\n        const rightDate = right.startDate ? Date.parse(right.startDate) : Number.POSITIVE_INFINITY;\n        return leftDate - rightDate;\n      }\n      if (resultSort === 'complete') {\n        return resultDetailCoverage(right) - resultDetailCoverage(left);\n      }\n      if (resultSort === 'cfp') {\n        const cfpDifference = Number(right.cfpOpen === true) - Number(left.cfpOpen === true);\n        return cfpDifference || resultDetailCoverage(right) - resultDetailCoverage(left);\n      }\n      return 0;\n    });\n\n  const locationOptions = useMemo(() => {`,
    'discovery sorted results'
  );

  text = replaceOnce(
    text,
    `                  setCategoryFilter('');\n                  setCfpOnly(false);\n                  setPriceRange(null);\n`,
    `                  setCategoryFilter('');\n                  setCfpOnly(false);\n                  setRichDetailsOnly(false);\n                  setResultSort('recommended');\n                  setPriceRange(null);\n`,
    'discovery clear decision filters'
  );

  text = replaceOnce(
    text,
    `        {webSearchLoading && (!webResults || webResults.length === 0) && (`,
    `        {webResults && webResults.length > 0 && (\n          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">\n            <div className="flex items-center gap-3 min-w-0">\n              <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">\n                <CheckCircle2 className="w-4 h-4 text-emerald-600" />\n              </div>\n              <div className="min-w-0">\n                <div className="text-xs font-bold text-slate-900">{displayedWebResults.length} conference{displayedWebResults.length === 1 ? '' : 's'} ready to compare</div>\n                <div className="text-[10px] text-slate-500">Use completeness and sorting to get to the most decision-ready records first.</div>\n              </div>\n            </div>\n            <div className="flex flex-wrap items-center gap-2">\n              <button\n                type="button"\n                onClick={() => setRichDetailsOnly((value) => !value)}\n                className={\`px-3 py-2 rounded-xl border text-[11px] font-bold transition-colors \${\n                  richDetailsOnly\n                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'\n                    : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700'\n                }\`}\n              >\n                6+ detail sections\n              </button>\n              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white">\n                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />\n                <select\n                  value={resultSort}\n                  onChange={(event) => setResultSort(event.target.value as typeof resultSort)}\n                  aria-label="Sort conference results"\n                  className="bg-transparent text-[11px] font-bold text-slate-700 focus:outline-hidden"\n                >\n                  <option value="recommended">Recommended</option>\n                  <option value="soonest">Soonest first</option>\n                  <option value="complete">Most complete</option>\n                  <option value="cfp">Open CFP first</option>\n                </select>\n              </label>\n            </div>\n          </div>\n        )}\n\n        {webSearchLoading && (!webResults || webResults.length === 0) && (`,
    'discovery comparison controls'
  );

  text = text.replace(
    `!webSearchError && webResults && visibleWebResults.length === 0`,
    `!webSearchError && webResults && displayedWebResults.length === 0`
  );
  text = text.replace(
    `!webSearchError && webResults && visibleWebResults.length > 0`,
    `!webSearchError && webResults && displayedWebResults.length > 0`
  );
  text = text.replace(
    `visibleWebResults.map((result, idx) => (`,
    `displayedWebResults.map((result, idx) => (`
  );

  text = replaceOnce(
    text,
    `                  <h2 className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug">\n                    {result.title}\n                  </h2>\n`,
    `                  <div className="flex flex-wrap items-start justify-between gap-2">\n                    <h2 className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug min-w-0 flex-1">\n                      {result.title}\n                    </h2>\n                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">\n                      {result.cfpOpen && (\n                        <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>\n                      )}\n                      <span\n                        className={\`px-2.5 py-1 rounded-full border text-[10px] font-bold \${\n                          resultDetailCoverage(result) >= 6\n                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'\n                            : 'bg-slate-50 border-slate-200 text-slate-600'\n                        }\`}\n                      >\n                        {resultDetailCoverage(result)}/9 details\n                      </span>\n                    </div>\n                  </div>\n`,
    'discovery card decision badges'
  );

  text = replaceOnce(
    text,
    `                <div className="shrink-0 flex sm:justify-end">\n                  <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors">\n                    View Details\n                    <ArrowRight className="w-4 h-4 shrink-0" />\n                  </span>\n                </div>`,
    `                <div className="shrink-0 flex sm:justify-end">\n                  <button\n                    type="button"\n                    onClick={(event) => {\n                      event.stopPropagation();\n                      onOpenExternalResult(result, preferredResultTab(result));\n                    }}\n                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors"\n                  >\n                    {preferredResultAction(result)}\n                    <ArrowRight className="w-4 h-4 shrink-0" />\n                  </button>\n                </div>`,
    'discovery smart card action'
  );

  return text;
});

patch('src/components/ExternalConferenceDetail.tsx', (input) => {
  let text = input;

  text = replaceOnce(
    text,
    `  const incompleteLabel = (name: string, count: number): string =>\n    count > 0 ? \`${'${name}'} (\${'${count}'})\` : name;\n\n\n  // Same honesty split as incompleteLabel above, but for the body of a section: a spinner is`,
    `  const incompleteLabel = (name: string, count: number): string =>\n    count > 0 ? \`${'${name}'} (\${'${count}'})\` : name;\n\n  const detailTabs: Array<{ id: ExternalDetailTab; label: string }> = [\n    { id: 'overview', label: 'Overview' },\n    { id: 'cfp', label: 'Call for Papers' },\n    { id: 'fees', label: incompleteLabel('Fees & Pricing', upcomingRegistrationFees.length) },\n    { id: 'agenda', label: incompleteLabel('Program & Agenda', data?.agendaSessions.length ?? 0) },\n    { id: 'speakers', label: incompleteLabel('Keynote Speakers', data?.speakers.length ?? 0) },\n    { id: 'committee', label: incompleteLabel('Technical Committee', data?.committee.length ?? 0) },\n    { id: 'sponsors', label: incompleteLabel('Sponsors & Exhibitors', data?.sponsors.length ?? 0) },\n    { id: 'venue', label: 'Venue & Accommodation' },\n    { id: 'community', label: 'Community' },\n  ];\n\n  const detailTabState = (tab: ExternalDetailTab): 'stated' | 'not_announced' | 'unread' =>\n    tab === 'overview' ? 'stated' : sectionState(SECTION_OF[tab]);\n  const availableDetailCount = data\n    ? detailTabs.filter((tab) => detailTabState(tab.id) === 'stated').length\n    : 0;\n\n  const detailTabStateLabel = (tab: ExternalDetailTab): string => {\n    const state = detailTabState(tab);\n    if (state === 'stated') return 'Available';\n    if (state === 'not_announced') return 'Not announced';\n    return 'Not retrieved';\n  };\n\n  // Same honesty split as incompleteLabel above, but for the body of a section: a spinner is`,
    'detail tab intelligence helpers'
  );

  text = replaceOnce(
    text,
    `        {/* Navigation Tabs */}\n        <div className="px-6 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">\n          {(\n            [\n              { id: 'overview', label: 'Overview' },\n              { id: 'cfp', label: 'Call for Papers' },\n              { id: 'fees', label: incompleteLabel('Fees & Pricing', upcomingRegistrationFees.length) },\n              { id: 'agenda', label: incompleteLabel('Program & Agenda', data?.agendaSessions.length ?? 0) },\n              { id: 'speakers', label: incompleteLabel('Keynote Speakers', data?.speakers.length ?? 0) },\n              { id: 'committee', label: incompleteLabel('Technical Committee', data?.committee.length ?? 0) },\n              { id: 'sponsors', label: incompleteLabel('Sponsors & Exhibitors', data?.sponsors.length ?? 0) },\n              { id: 'venue', label: 'Venue & Accommodation' },\n              { id: 'community', label: 'Community' },\n            ] as Array<{ id: ExternalDetailTab; label: string }>\n          )\n            // Keep the full ConferenceGate structure visible on every conference. Missing data is\n            // explained inside the tab instead of making the navigation itself disappear.\n            .map((tab) => (\n            <button\n              key={tab.id}\n              onClick={() => setActiveTab(tab.id)}\n              className={\`py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap \${\n                activeTab === tab.id\n                  ? 'border-blue-600 text-blue-600 font-bold'\n                  : 'border-transparent hover:text-slate-900'\n              }\`}\n            >\n              {tab.label}\n            </button>\n          ))}\n        </div>`,
    `        {!loading && data && (\n          <div className="px-6 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">\n            <div className="flex items-center gap-2 text-[11px] text-slate-600">\n              <CheckCircle2 className="w-4 h-4 text-emerald-600" />\n              <span><strong className="text-slate-900">{availableDetailCount}/9</strong> conference sections available</span>\n            </div>\n            <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold">\n              <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" />Available</span>\n              <span className="inline-flex items-center gap-1.5 text-amber-700"><span className="w-2 h-2 rounded-full bg-amber-400" />Not announced</span>\n              <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-300" />Not retrieved</span>\n            </div>\n          </div>\n        )}\n\n        {/* Navigation Tabs */}\n        <div className="px-6 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">\n          {detailTabs.map((tab) => (\n            <button\n              key={tab.id}\n              onClick={() => setActiveTab(tab.id)}\n              title={detailTabStateLabel(tab.id)}\n              className={\`py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 \${\n                activeTab === tab.id\n                  ? 'border-blue-600 text-blue-600 font-bold'\n                  : 'border-transparent hover:text-slate-900'\n              }\`}\n            >\n              <span\n                aria-hidden="true"\n                className={\`w-2 h-2 rounded-full shrink-0 \${\n                  detailTabState(tab.id) === 'stated'\n                    ? 'bg-emerald-500'\n                    : detailTabState(tab.id) === 'not_announced'\n                      ? 'bg-amber-400'\n                      : 'bg-slate-300'\n                }\`}\n              />\n              {tab.label}\n            </button>\n          ))}\n        </div>`,
    'detail navigation status'
  );

  return text;
});
