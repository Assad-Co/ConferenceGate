from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


discovery_path = Path("src/components/DiscoveryEngine.tsx")
discovery = discovery_path.read_text()

discovery = replace_once(
    discovery,
    """            const isSaved = savedIds.includes(conf.id);\n            const isFollowed = followedIds.includes(conf.id);\n\n            return (""",
    """            const isSaved = savedIds.includes(conf.id);\n            const isFollowed = followedIds.includes(conf.id);\n            const cfpAcceptingSubmissions = conf.cfpStatus === 'Open' || conf.cfpStatus === 'Extended';\n\n            return (""",
    "derive internal CFP actionability",
)

discovery = replace_once(
    discovery,
    """                        <span className=\"font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-md text-[11px]\">\n                          {conf.cfpStatus}\n                        </span>""",
    """                        <span\n                          className={`font-bold px-2 py-0.5 rounded-md text-[11px] ${\n                            conf.cfpStatus === 'Open'\n                              ? 'text-emerald-700 bg-emerald-100/60'\n                              : conf.cfpStatus === 'Extended'\n                                ? 'text-amber-800 bg-amber-100/70'\n                                : 'text-slate-600 bg-slate-200/80'\n                          }`}\n                        >\n                          {conf.cfpStatus}\n                        </span>""",
    "truthful internal CFP status styling",
)

discovery = replace_once(
    discovery,
    """                      <button\n                        onClick={(e) => {\n                          e.stopPropagation();\n                          onOpenSubmitAbstract(conf.id);\n                        }}\n                        className=\"px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer\"\n                      >\n                        Submit Abstract\n                      </button>""",
    """                      <button\n                        type=\"button\"\n                        onClick={(e) => {\n                          e.stopPropagation();\n                          if (cfpAcceptingSubmissions) onOpenSubmitAbstract(conf.id);\n                        }}\n                        disabled={!cfpAcceptingSubmissions}\n                        className=\"px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed\"\n                        title={cfpAcceptingSubmissions ? 'Submit an abstract' : 'This conference is not accepting submissions'}\n                      >\n                        {cfpAcceptingSubmissions ? 'Submit Abstract' : 'CFP Closed'}\n                      </button>""",
    "prevent closed-CFP submission from discovery",
)

discovery = discovery.replace(
    "'px-3 py-2 rounded-xl border text-[11px] font-bold bg-emerald-50 border-emerald-200 text-emerald-700'",
    "'px-3 py-2 rounded-xl border text-[11px] font-bold bg-emerald-50 border-emerald-200 text-emerald-700 cursor-pointer'",
    1,
)
discovery = discovery.replace(
    "'px-3 py-2 rounded-xl border text-[11px] font-bold bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700'",
    "'px-3 py-2 rounded-xl border text-[11px] font-bold bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700 cursor-pointer'",
    1,
)

discovery = replace_once(
    discovery,
    """            <div className=\"flex flex-wrap items-center justify-center gap-2 mt-4\">\n              {DISCOVERY_SUGGESTIONS.slice(0, 8).map((suggestion) => (""",
    """            <div className=\"flex flex-wrap items-center justify-center gap-2 mt-4\">\n              <button\n                type=\"button\"\n                onClick={() => {\n                  setSearchInput('');\n                  setSubmittedSearchTerm('');\n                  lastWebQueryRef.current = null;\n                  setSearchSubmitCount((count) => count + 1);\n                  setStartFromMonth(DISCOVERY_MINIMUM_MONTH);\n                  setEndAtMonth('');\n                  setLocationFilter('');\n                  setCountryFilter('');\n                  setFormatFilter('');\n                  setTimingFilter('');\n                  setCategoryFilter('');\n                  setCfpOnly(false);\n                  setRichDetailsOnly(false);\n                  setResultSort('recommended');\n                  setPriceRange(null);\n                }}\n                className=\"px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[11px] font-bold text-blue-700 transition-colors cursor-pointer\"\n              >\n                Clear all filters\n              </button>\n              {DISCOVERY_SUGGESTIONS.slice(0, 8).map((suggestion) => (""",
    "zero-result recovery action",
)

discovery = replace_once(
    discovery,
    """                  className=\"px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-[11px] font-bold text-slate-600 transition-colors\"""",
    """                  className=\"px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-[11px] font-bold text-slate-600 transition-colors cursor-pointer\"""",
    "make zero-result suggestions visibly actionable",
)

discovery = replace_once(
    discovery,
    """                    className=\"inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors\"""",
    """                    className=\"inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors cursor-pointer\"""",
    "make result CTA visibly actionable",
)

discovery_path.write_text(discovery)


detail_path = Path("src/components/ConferenceDetail.tsx")
detail = detail_path.read_text()

detail = replace_once(
    detail,
    """                    <button\n                      onClick={() => onRegister?.(conference.id, conference.title, pkg.id, pkg.name)}\n                      className={`w-full py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${\n                        registeredPackage === pkg.id\n                          ? 'bg-emerald-600 text-white'\n                          : 'bg-blue-900 hover:bg-blue-950 text-white'\n                      }`}\n                    >\n                      {registeredPackage === pkg.id ? 'Registered ✓ — Verified Attendance' : 'Register Package'}\n                    </button>""",
    """                    <button\n                      type=\"button\"\n                      onClick={() => {\n                        if (registeredPackage !== pkg.id) {\n                          onRegister?.(conference.id, conference.title, pkg.id, pkg.name);\n                        }\n                      }}\n                      disabled={registeredPackage === pkg.id}\n                      title={registeredPackage === pkg.id ? 'You are already registered for this conference' : `Register with the ${pkg.name} package`}\n                      className={`w-full py-2.5 rounded-xl font-bold text-xs transition-colors ${\n                        registeredPackage === pkg.id\n                          ? 'bg-emerald-600 text-white cursor-default'\n                          : 'bg-blue-900 hover:bg-blue-950 text-white cursor-pointer'\n                      }`}\n                    >\n                      {registeredPackage === pkg.id ? 'Registered ✓' : 'Register Package'}\n                    </button>""",
    "registration button integrity",
)

detail = replace_once(
    detail,
    """                className=\"px-3.5 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors\"""",
    """                className=\"px-3.5 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors cursor-pointer\"""",
    "committee CTA cursor affordance",
)

detail_path.write_text(detail)

print("Phase 25 functional/search audit patch applied.")
