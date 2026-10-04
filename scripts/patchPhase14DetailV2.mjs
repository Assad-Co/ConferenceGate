import fs from 'node:fs';

const path = 'src/components/ExternalConferenceDetail.tsx';
let text = fs.readFileSync(path, 'utf8');

const helperMarker = "  // Same honesty split as incompleteLabel above, but for the body of a section: a spinner is";
if (!text.includes(helperMarker)) throw new Error('detail helper marker not found');
const helperBlock = `  const detailTabs: Array<{ id: ExternalDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'cfp', label: 'Call for Papers' },
    { id: 'fees', label: incompleteLabel('Fees & Pricing', upcomingRegistrationFees.length) },
    { id: 'agenda', label: incompleteLabel('Program & Agenda', data?.agendaSessions.length ?? 0) },
    { id: 'speakers', label: incompleteLabel('Keynote Speakers', data?.speakers.length ?? 0) },
    { id: 'committee', label: incompleteLabel('Technical Committee', data?.committee.length ?? 0) },
    { id: 'sponsors', label: incompleteLabel('Sponsors & Exhibitors', data?.sponsors.length ?? 0) },
    { id: 'venue', label: 'Venue & Accommodation' },
    { id: 'community', label: 'Community' },
  ];

  const detailTabState = (tab: ExternalDetailTab): 'stated' | 'not_announced' | 'unread' =>
    tab === 'overview' ? 'stated' : sectionState(SECTION_OF[tab]);

  const availableDetailCount = data
    ? detailTabs.filter((tab) => detailTabState(tab.id) === 'stated').length
    : 0;

  const detailTabStateLabel = (tab: ExternalDetailTab): string => {
    const state = detailTabState(tab);
    if (state === 'stated') return 'Available';
    if (state === 'not_announced') return 'Not announced';
    return 'Not retrieved';
  };

`;
text = text.replace(helperMarker, helperBlock + helperMarker);

const navStart = '        {/* Navigation Tabs */}';
const navEndMarker = '      {/* Tab Content Area */}';
const navStartIndex = text.indexOf(navStart);
const navEndIndex = text.indexOf(navEndMarker, navStartIndex);
if (navStartIndex < 0 || navEndIndex < 0) throw new Error('detail navigation block not found');

const replacement = `        {!loading && data && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span><strong className="text-slate-900">{availableDetailCount}/9</strong> conference sections available</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold">
              <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" />Available</span>
              <span className="inline-flex items-center gap-1.5 text-amber-700"><span className="w-2 h-2 rounded-full bg-amber-400" />Not announced</span>
              <span className="inline-flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-300" />Not retrieved</span>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="px-6 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {detailTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={detailTabStateLabel(tab.id)}
              className={'py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ' + (
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent hover:text-slate-900'
              )}
            >
              <span
                aria-hidden="true"
                className={'w-2 h-2 rounded-full shrink-0 ' + (
                  detailTabState(tab.id) === 'stated'
                    ? 'bg-emerald-500'
                    : detailTabState(tab.id) === 'not_announced'
                      ? 'bg-amber-400'
                      : 'bg-slate-300'
                )}
              />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

`;
text = text.slice(0, navStartIndex) + replacement + text.slice(navEndIndex);

fs.writeFileSync(path, text);
console.log('Phase 14 conference detail intelligence applied');
