import fs from 'node:fs';

function patch(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of replacements) {
    if (!text.includes(from)) throw new Error(`${path}: missing patch marker: ${label}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
  console.log(`patched ${path}`);
}

patch('src/components/ConferenceDetail.tsx', [
  [
    "  const registeredPackage = registeredPackageId;\n  const saved = isSaved;\n  const followed = isFollowed;\n",
    "  const registeredPackage = registeredPackageId;\n  const saved = isSaved;\n  const followed = isFollowed;\n  const cfpAcceptingSubmissions = conference.cfpStatus === 'Open' || conference.cfpStatus === 'Extended';\n  const publishedPriceRange = conference.priceRange?.trim() || 'See registration packages';\n",
    'derived action state'
  ],
  [
    "            <button\n              onClick={() => onOpenSubmitAbstract(conference.id)}\n              className=\"px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer\"\n            >\n              <FileText className=\"w-4 h-4\" />\n              <span>Submit Abstract</span>\n            </button>",
    "            <button\n              onClick={() => cfpAcceptingSubmissions && onOpenSubmitAbstract(conference.id)}\n              disabled={!cfpAcceptingSubmissions}\n              className=\"px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed\"\n            >\n              <FileText className=\"w-4 h-4\" />\n              <span>{cfpAcceptingSubmissions ? 'Submit Abstract' : 'CFP Closed'}</span>\n            </button>",
    'hero CFP action'
  ],
  [
    "            <div className=\"text-sm font-bold text-slate-900\">{conference.priceRange}</div>",
    "            <div className=\"text-sm font-bold text-slate-900\">{publishedPriceRange}</div>",
    'hero price range'
  ],
  [
    "                <div className=\"text-sm font-bold text-slate-900\">${conference.priceRange || 'See registration packages'}</div>",
    "                <div className=\"text-sm font-bold text-slate-900\">{publishedPriceRange}</div>",
    'fees price range'
  ],
  [
    "                  Early-bird registration deadline: <strong>${conference.earlyBirdDeadline}</strong>",
    "                  Early-bird registration deadline: <strong>{conference.earlyBirdDeadline}</strong>",
    'early bird date currency bug'
  ],
  [
    "                      <h4 className=\"font-bold text-sm text-slate-900\">${pkg.name}</h4>",
    "                      <h4 className=\"font-bold text-sm text-slate-900\">{pkg.name}</h4>",
    'package name currency bug'
  ],
  [
    "                      <p className=\"text-xs text-slate-600 leading-relaxed\">${pkg.description}</p>",
    "                      <p className=\"text-xs text-slate-600 leading-relaxed\">{pkg.description}</p>",
    'package description currency bug'
  ],
  [
    "                        <p className=\"text-[11px] font-semibold text-amber-700\">Early bird until ${pkg.earlyBirdDeadline}</p>",
    "                        <p className=\"text-[11px] font-semibold text-amber-700\">Early bird until {pkg.earlyBirdDeadline}</p>",
    'package early bird currency bug'
  ],
  [
    "                            <span>${feat}</span>",
    "                            <span>{feat}</span>",
    'feature currency bug'
  ],
  [
    "              <button\n                onClick={() => onOpenSubmitAbstract(conference.id)}\n                className=\"px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shrink-0 cursor-pointer\"\n              >\n                Submit Abstract Now\n              </button>",
    "              <button\n                onClick={() => cfpAcceptingSubmissions && onOpenSubmitAbstract(conference.id)}\n                disabled={!cfpAcceptingSubmissions}\n                className=\"px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shrink-0 cursor-pointer disabled:bg-slate-500 disabled:text-slate-200 disabled:cursor-not-allowed\"\n              >\n                {cfpAcceptingSubmissions ? 'Submit Abstract Now' : 'Submissions Closed'}\n              </button>",
    'CFP tab action'
  ],
  [
    "                <div className=\"p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2\">\n                  <h5 className=\"font-bold text-slate-900\">Peer Review Policy</h5>\n                  <p>Double-blind peer review handled by accredited Conference Gate technical committee reviewers.</p>\n                </div>",
    "                <div className=\"p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2\">\n                  <h5 className=\"font-bold text-slate-900\">Review & Decision Process</h5>\n                  <p>ConferenceGate does not infer a review model. Use the organizer's published guidance for review method, decision criteria, and notification timing.</p>\n                  {conference.officialWebsite && (\n                    <a href={conference.officialWebsite} target=\"_blank\" rel=\"noopener noreferrer\" className=\"inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline\">\n                      Check official guidance <ExternalLink className=\"w-3 h-3\" />\n                    </a>\n                  )}\n                </div>",
    'fabricated peer review claim'
  ],
  [
    "                <div className=\"space-y-2\">\n                  {(conference.mainThemes || []).map((theme, i) => (",
    "                <div className=\"space-y-2\">\n                  {(conference.mainThemes || []).length === 0 && (\n                    <p className=\"text-xs text-slate-400\">Focus areas have not been published on ConferenceGate yet.</p>\n                  )}\n                  {(conference.mainThemes || []).map((theme, i) => (",
    'theme empty state'
  ],
  [
    "                <div className=\"space-y-2\">\n                  {(conference.tracks || []).map((track, i) => (",
    "                <div className=\"space-y-2\">\n                  {(conference.tracks || []).length === 0 && (\n                    <p className=\"text-xs text-slate-400\">Scientific tracks have not been published on ConferenceGate yet.</p>\n                  )}\n                  {(conference.tracks || []).map((track, i) => (",
    'track empty state'
  ],
]);

patch('src/components/DiscoveryEngine.tsx', [
  [
    "                  setStartFromMonth(nextMonthValue());",
    "                  setStartFromMonth(DISCOVERY_MINIMUM_MONTH);",
    'clear-filter start boundary'
  ],
  [
    "                key={idx}",
    "                key={`${result.link}|${result.title}`}",
    'stable result key'
  ],
  [
    "                          Stored conference details",
    "                          Verified detail sections",
    'stored details badge copy'
  ],
  [
    "                          { tab: 'fees', label: 'Fees', icon: MapPin },",
    "                          { tab: 'fees', label: 'Fees', icon: DollarSign },",
    'fees icon'
  ],
]);
