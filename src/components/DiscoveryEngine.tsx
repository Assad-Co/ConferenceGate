import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Bookmark,
  Users,
  Globe,
  Hotel,
  BookOpen,
  Map,
  Loader2,
  AlertCircle,
  FileText,
  UserCheck,
  Briefcase,
  MapPin,
  CalendarRange,
  X,
} from 'lucide-react';
import { Conference } from '../types';
import { formatDateRange, formatDay, formatMonthShort, conferenceDurationDays } from '../utils/date';
import { searchConferencesOnTheWeb, LiveSearchResult } from '../api/search';
import { ExternalDetailTab } from './ExternalConferenceDetail';

interface DiscoveryEngineProps {
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onOpenSubmitAbstract: (confId?: string) => void;
  onOpenExternalResult: (result: LiveSearchResult, tab?: ExternalDetailTab) => void;
  initialSearchQuery?: string;
  savedConferenceIds?: string[];
  followedConferenceIds?: string[];
  onToggleSave?: (conferenceId: string) => void;
  onToggleFollow?: (conferenceId: string) => void;
}

// A single fixed seed query keeps the default (no-search-term) view populated with real,
// current results — and since it's the same query for every visitor, the server's hourly
// cache means it costs at most one live search per hour, not one per page load. The year is
// computed at load time so this keeps naming the actual current year, not a stale one.
const DEFAULT_DISCOVER_QUERY = `upcoming technology and industry conference ${new Date().getFullYear()}`;

// "YYYY-MM" for next calendar month from today, e.g. "2026-09" when today is any day in
// August 2026 — computed at load time (never hardcoded) so the default start-date filter
// always means "next month onward" and never goes stale.
const nextMonthValue = (): string => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({
  conferences,
  onSelectConference,
  onOpenSubmitAbstract,
  onOpenExternalResult,
  initialSearchQuery = '',
  savedConferenceIds = [],
  followedConferenceIds = [],
  onToggleSave,
  onToggleFollow,
}) => {
  const [searchTerm, setSearchInput] = useState(initialSearchQuery);
  // "YYYY-MM" — only conferences whose real start date falls in this month or later are shown.
  // Defaults to next month onward (see nextMonthValue above); cleared to '' shows every date.
  const [startFromMonth, setStartFromMonth] = useState(nextMonthValue());
  const savedIds = savedConferenceIds;
  const followedIds = followedConferenceIds;

  const toggleSave = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSave?.(id);
  };

  const toggleFollow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFollow?.(id);
  };

  // Real conferences created by organizers through Conference Gate itself — the only ones that
  // support the app's own Submit Abstract / Registration workflows. Only applies to this catalog
  // (not the live web results below), since only these have a real, structured start date to
  // filter on — a web search snippet's date, if any, is free text we'd have to guess-parse.
  const filtered = (conferences || [])
    .filter((conf) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;
      return (
        (conf.title || '').toLowerCase().includes(term) ||
        (conf.description || '').toLowerCase().includes(term) ||
        (conf.topics || []).some((t) => t.toLowerCase().includes(term))
      );
    })
    .filter((conf) => !startFromMonth || conf.dates.start >= `${startFromMonth}-01`);

  // Live web results always populate the page — the typed search term if there is one,
  // otherwise a fixed default query so Discover is never empty.
  const [webResults, setWebResults] = useState<LiveSearchResult[] | null>(null);
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const lastWebQueryRef = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    // Live web results have no structured dates to filter on, so the date preference is applied
    // the only honest way available: biasing the real search query itself toward the chosen
    // month onward. It steers what the search engine returns rather than guaranteeing a cutoff.
    let dateBias = '';
    if (startFromMonth) {
      const [y, m] = startFromMonth.split('-').map(Number);
      const monthName = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' });
      dateBias = ` ${monthName} ${y} onwards`;
    }
    const effectiveQuery = (trimmed || DEFAULT_DISCOVER_QUERY) + dateBias;

    const handle = setTimeout(
      () => {
        if (lastWebQueryRef.current === effectiveQuery) return;
        lastWebQueryRef.current = effectiveQuery;
        setWebSearchLoading(true);
        setWebSearchError(null);
        searchConferencesOnTheWeb(effectiveQuery)
          .then((data) => setWebResults(data))
          .catch((e) => {
            setWebResults(null);
            setWebSearchError(e.message || 'Live search failed. Please try again.');
          })
          .finally(() => setWebSearchLoading(false));
      },
      trimmed ? 500 : 0
    );

    return () => clearTimeout(handle);
  }, [searchTerm, startFromMonth]);

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Global Discovery Engine
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
              Explore Academic & Technical Conferences
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Real conferences created through Conference Gate, plus live results pulled from across the web.
            </p>
          </div>
        </div>

        {/* Keyword Search + Start Date Filter */}
        <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative max-w-xl flex-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, keywords, topics..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden transition-all"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <div className="relative shrink-0">
            <label className="sr-only" htmlFor="discover-start-from">
              Show conferences starting from
            </label>
            <div className="flex items-center gap-1.5 pl-3 pr-2 py-2 bg-slate-50 focus-within:bg-white rounded-xl border border-slate-200 focus-within:border-blue-500 transition-all">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">From:</span>
              <input
                id="discover-start-from"
                type="month"
                value={startFromMonth}
                onChange={(e) => setStartFromMonth(e.target.value)}
                className="text-xs text-slate-800 bg-transparent focus:outline-hidden w-[112px]"
              />
              {startFromMonth && (
                <button
                  type="button"
                  onClick={() => setStartFromMonth('')}
                  title="Show all dates"
                  className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Honest empty state when the date filter (not the keyword search) hides the whole
          catalog — silently dropping the section would look like the catalog doesn't exist. */}
      {filtered.length === 0 && (conferences || []).length > 0 && startFromMonth && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <p className="text-xs text-slate-500">
            No Conference Gate conferences start in {startFromMonth} or later
            {searchTerm.trim() ? ` matching "${searchTerm.trim()}"` : ''}.{' '}
            <button
              type="button"
              onClick={() => setStartFromMonth('')}
              className="text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
            >
              Show all dates
            </button>
          </p>
        </div>
      )}

      {/* Real Conference Gate conferences */}
      {filtered.length > 0 && (
        <div className="space-y-6">
          {filtered.map((conf) => {
            const isSaved = savedIds.includes(conf.id);
            const isFollowed = followedIds.includes(conf.id);

            return (
              <div
                key={conf.id}
                onClick={() => onSelectConference(conf)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-blue-300 shadow-xs hover:shadow-md transition-all p-6 cursor-pointer flex flex-col lg:flex-row gap-6 group"
              >
                {/* Conference Logo & Banner */}
                <div className="w-full lg:w-72 h-48 lg:h-auto rounded-xl overflow-hidden relative shrink-0 bg-slate-900">
                  <img
                    src={conf.banner}
                    alt={conf.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent"></div>

                  <div className="absolute top-3 left-3 bg-white/90 text-slate-800 font-bold text-[10px] uppercase px-2.5 py-1 rounded-full backdrop-blur-md">
                    {conf.format}
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
                    <img
                      src={conf.logo}
                      alt={conf.organizerName}
                      className="w-8 h-8 rounded-lg object-cover ring-2 ring-white/50"
                    />
                    <span className="text-xs text-white/90 font-medium line-clamp-1 drop-shadow-xs">
                      {conf.organizerName}
                    </span>
                  </div>
                </div>

                {/* Info Block */}
                <div className="flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                          {conf.title}
                        </h2>
                        <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 mt-1.5">
                          <span className="flex items-center gap-2">
                            <span className="flex flex-col items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white leading-none shrink-0 shadow-xs">
                              <span className="text-[6.5px] font-bold uppercase tracking-wide">
                                {formatMonthShort(conf.dates.start)}
                              </span>
                              <span className="text-[11px] font-extrabold">{formatDay(conf.dates.start)}</span>
                            </span>
                            <span className="flex flex-col leading-tight">
                              <span className="text-blue-700 font-bold text-[11.5px]">
                                {formatDateRange(conf.dates.start, conf.dates.end)}
                              </span>
                              <span className="text-slate-400 font-medium text-[10px]">
                                {conferenceDurationDays(conf.dates.start, conf.dates.end)}-day event
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Map className="w-3.5 h-3.5 text-rose-500" />
                            {conf.location.city}, {conf.location.country} ({conf.location.venue})
                          </span>
                        </div>
                        {(conf.hasBrochure || conf.hasCityMap || conf.accommodation) && (
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 font-semibold">
                            {conf.accommodation && (
                              <span className="flex items-center gap-1">
                                <Hotel className="w-3 h-3 text-blue-500" />
                                Hotel Partnerships
                              </span>
                            )}
                            {conf.hasBrochure && (
                              <span className="flex items-center gap-1">
                                <BookOpen className="w-3 h-3 text-blue-500" />
                                Brochure
                              </span>
                            )}
                            {conf.hasCityMap && (
                              <span className="flex items-center gap-1">
                                <Map className="w-3 h-3 text-blue-500" />
                                City Map
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Quick Save / Follow Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => toggleSave(conf.id, e)}
                          className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                            isSaved
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
                          }`}
                          title="Save Conference"
                        >
                          <Bookmark className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          onClick={(e) => toggleFollow(conf.id, e)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-colors cursor-pointer ${
                            isFollowed
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {isFollowed ? 'Following' : '+ Follow'}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                      {conf.description}
                    </p>

                    {/* Key Attributes */}
                    <div className="grid grid-cols-1 gap-2 text-xs pt-1">
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Call for Papers:</span>
                        <span className="font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-md text-[11px]">
                          {conf.cfpStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Action Row */}
                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-medium">Price:</span>
                      <span className="text-xs font-bold text-slate-900">{conf.priceRange}</span>
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] text-slate-500">
                        {conf.attendeeCount} Registered Attendee{conf.attendeeCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSubmitAbstract(conf.id);
                        }}
                        className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                      >
                        Submit Abstract
                      </button>
                      <button
                        onClick={() => onSelectConference(conf)}
                        className="px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                      >
                        View Conference Page
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Web Results */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
            <Globe className="w-4.5 h-4.5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {searchTerm.trim() ? `Live Web Results for "${searchTerm.trim()}"` : 'Live Web Results'}
            </h3>
            <p className="text-[11px] text-slate-500">
              Pulled from a live web search, not our own catalog — always confirm details on the organizer's
              official site before registering or submitting.
            </p>
          </div>
        </div>

        {webSearchLoading && (
          <div className="bg-white rounded-2xl border border-slate-200 flex items-center justify-center gap-2 py-12 text-xs text-slate-400 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching the web...
          </div>
        )}

        {!webSearchLoading && webSearchError && (
          <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{webSearchError}</span>
          </div>
        )}

        {!webSearchLoading && !webSearchError && webResults && webResults.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <p className="text-xs text-slate-400">No web results found. Try different keywords.</p>
          </div>
        )}

        {!webSearchLoading && !webSearchError && webResults && webResults.length > 0 && (
          <div className="space-y-6">
            {webResults.map((result, idx) => (
              <div
                key={idx}
                onClick={() => onOpenExternalResult(result)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-xs hover:shadow-md transition-all p-6 cursor-pointer flex flex-col lg:flex-row gap-6 group"
              >
                {/* Thumbnail / Placeholder */}
                <div className="w-full lg:w-72 h-48 lg:h-auto rounded-xl overflow-hidden relative shrink-0 bg-slate-900 flex items-center justify-center">
                  {result.thumbnail ? (
                    <img
                      src={result.thumbnail}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90"
                    />
                  ) : (
                    <Globe className="w-10 h-10 text-slate-600" />
                  )}
                </div>

                {/* Info Block */}
                <div className="flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug">
                          {result.title}
                        </h2>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                      {result.snippet}
                    </p>

                    {/* Quick-Tab Shortcuts — jump straight into a specific section of the
                        detail page instead of always landing on the overview. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {(
                        [
                          { tab: 'cfp', label: 'Call for Papers', icon: FileText },
                          { tab: 'speakers', label: 'Speakers', icon: Users },
                          { tab: 'committee', label: 'Committee', icon: UserCheck },
                          { tab: 'sponsors', label: 'Sponsors', icon: Briefcase },
                          { tab: 'venue', label: 'Venue', icon: MapPin },
                        ] as { tab: ExternalDetailTab; label: string; icon: typeof FileText }[]
                      ).map(({ tab, label, icon: Icon }) => (
                        <button
                          key={tab}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenExternalResult(result, tab);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[11px] font-semibold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                        >
                          <Icon className="w-3 h-3" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Card Action Row */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                    <span className="px-4 py-1.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition-colors">
                      View Details
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
