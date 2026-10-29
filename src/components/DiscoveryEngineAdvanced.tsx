import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpDown,
  Bookmark,
  Briefcase,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  FileText,
  Globe,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { Conference } from '../types';
import { conferenceTrustSignals, conferenceMatchReasons } from '../utils/conferenceTrust';
import { deduplicateConferenceResults, formatConferenceLocation } from '../utils/conferencePresentation';
import { conferenceDurationDays, formatDateRange } from '../utils/date';
import { generateInitialsAvatar, getInitials } from '../utils/avatar';
import { withinDateWindow } from '../utils/conferenceFilter';
import {
  catalogueFacetOptions,
  filterStoredDiscoveryResults,
  resultDetailCoverage,
  sortStoredDiscoveryResults,
  type DiscoveryResultSort,
} from '../utils/discoveryResultFilter';
import { searchConferencesOnTheWeb, type LiveSearchResult } from '../api/search';
import type { ExternalDetailTab } from './ExternalConferenceDetail';

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

const DISCOVERY_MINIMUM_MONTH = '2026-09';
const MONTHS = [
  ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'], ['05', 'May'], ['06', 'Jun'],
  ['07', 'Jul'], ['08', 'Aug'], ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
] as const;
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 15 }, (_, index) => String(currentYear + index));

const POPULAR_SEARCHES = [
  'Artificial Intelligence',
  'Data Science',
  'Cybersecurity',
  'Engineering',
  'Petroleum & Geoscience',
  'Energy',
  'Hydrogen & CCUS',
  'Climate & Sustainability',
  'Healthcare',
  'Pharmaceuticals & Biotechnology',
  'Finance',
  'Aviation & Aerospace',
  'Mining & Minerals',
  'Real Estate',
] as const;

const DETAIL_SECTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any detail section' },
  { value: 'cfp', label: 'Call for Papers available' },
  { value: 'agenda', label: 'Program / agenda available' },
  { value: 'speakers', label: 'Speakers available' },
  { value: 'committee', label: 'Committee available' },
  { value: 'sponsors', label: 'Sponsors / exhibitors available' },
  { value: 'venue', label: 'Venue / accommodation available' },
  { value: 'fees', label: 'Fees / pricing available' },
  { value: 'community', label: 'Community / social available' },
];

function normalizedConferenceFormat(value: string | undefined): string {
  const raw = String(value || '').toLowerCase().replace(/[-\s]+/g, '');
  if (raw === 'physical') return 'inperson';
  if (raw === 'online') return 'virtual';
  return raw;
}

function localTimingMatches(conf: Conference, timing: string): boolean {
  if (!timing) return true;
  const duration = conferenceDurationDays(conf.dates.start, conf.dates.end);
  const start = new Date(`${conf.dates.start}T12:00:00`);
  const end = new Date(`${conf.dates.end}T12:00:00`);
  let touchesWeekend = false;
  if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
    const cursor = new Date(start);
    while (cursor <= end) {
      if (cursor.getDay() === 0 || cursor.getDay() === 6) {
        touchesWeekend = true;
        break;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  if (timing === 'one-day') return duration === 1;
  if (timing === 'multi-day') return duration >= 2;
  if (timing === 'weekend') return touchesWeekend;
  if (timing === 'weekday') return !touchesWeekend;
  return true;
}

function dateLine(start?: string | null, end?: string | null): string | null {
  if (!start) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return start;
  const format = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    return `${day} ${MONTHS[month - 1]?.[1] || month} ${year}`;
  };
  if (start === end) return format(start);
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]?.[1]} ${sy}`;
  return `${format(start)} – ${format(end)}`;
}

function formatLabel(format?: string | null): string | null {
  if (format === 'in-person') return 'In-Person';
  if (format === 'hybrid') return 'Hybrid';
  if (format === 'online') return 'Online';
  return null;
}

function preferredTab(result: LiveSearchResult): ExternalDetailTab {
  if (result.cfpOpen && result.sections?.includes('cfp')) return 'cfp';
  if (result.sections?.includes('fees')) return 'fees';
  if (result.sections?.includes('agenda')) return 'agenda';
  if (result.sections?.includes('speakers')) return 'speakers';
  return 'overview';
}

function preferredAction(result: LiveSearchResult): string {
  const tab = preferredTab(result);
  if (tab === 'cfp') return 'Review Open CFP';
  if (tab === 'fees') return 'Check Fees';
  if (tab === 'agenda') return 'View Program';
  if (tab === 'speakers') return 'View Speakers';
  return 'View Details';
}

const ResultLogo: React.FC<{ result: LiveSearchResult }> = ({ result }) => {
  const [failed, setFailed] = useState(false);
  const logo = result.favicon || result.thumbnail;
  if (logo && !failed) {
    return (
      <img
        src={logo}
        alt={`${result.title} mark`}
        className="max-w-full max-h-full object-contain"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="text-sm font-black text-slate-700 text-center leading-tight">
      {getInitials(result.acronym || result.title)}
    </span>
  );
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
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery);
  const [interests, setInterests] = useState(() => {
    try { return window.localStorage.getItem('conferencegate-discovery-interests') || ''; } catch { return ''; }
  });
  const [personalized, setPersonalized] = useState(false);
  const [semanticScores, setSemanticScores] = useState<Record<string, number>>({});
  const [semanticStatus, setSemanticStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  useEffect(() => { try { window.localStorage.setItem('conferencegate-discovery-interests', interests); } catch {} }, [interests]);
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState(String(initialSearchQuery ?? '').trim());
  const [searchSubmitCount, setSearchSubmitCount] = useState(0);
  const [manualRetryCount, setManualRetryCount] = useState(0);

  const [startFromMonth, setStartFromMonth] = useState(DISCOVERY_MINIMUM_MONTH);
  const [endAtMonth, setEndAtMonth] = useState('');
  const effectiveStartMonth = startFromMonth && startFromMonth > DISCOVERY_MINIMUM_MONTH
    ? startFromMonth
    : DISCOVERY_MINIMUM_MONTH;

  const [countryFilter, setCountryFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [timingFilter, setTimingFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [organizerFilter, setOrganizerFilter] = useState('');
  const [cfpOnly, setCfpOnly] = useState(false);
  const [requiredSection, setRequiredSection] = useState('');
  const [minimumDetailSections, setMinimumDetailSections] = useState(0);
  const [richDetailsOnly, setRichDetailsOnly] = useState(false);
  const [resultSort, setResultSort] = useState<DiscoveryResultSort>('recommended');
  const [visibleResultCount, setVisibleResultCount] = useState(24);

  // A full browse response is the facet source. It is a server-side stored-catalogue read, not a
  // provider search, so country/city/organizer/category choices represent the worldwide catalogue
  // rather than whichever cards happen to survive the current filters.
  const [facetCatalogue, setFacetCatalogue] = useState<LiveSearchResult[]>([]);
  const [webResults, setWebResults] = useState<LiveSearchResult[] | null>(null);
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const lastRequestKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    searchConferencesOnTheWeb('', 'low', false)
      .then((results) => {
        if (!active) return;
        setFacetCatalogue(results);
        if (!submittedSearchTerm) setWebResults(results);
      })
      .catch(() => {
        // Search still works even if this optional facet snapshot fails.
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const query = String(submittedSearchTerm ?? '').trim();
    const key = `${query}|${manualRetryCount}|${searchSubmitCount}`;
    if (lastRequestKey.current === key) return;
    lastRequestKey.current = key;
    let active = true;
    setWebSearchLoading(true);
    setWebSearchError(null);

    searchConferencesOnTheWeb(query, query ? 'high' : 'low', manualRetryCount > 0)
      .then((results) => {
        if (!active || lastRequestKey.current !== key) return;
        setWebResults(results);
        if (!query && results.length) setFacetCatalogue(results);
      })
      .catch((error) => {
        if (!active || lastRequestKey.current !== key) return;
        setWebSearchError(error?.message || 'Conference search failed. Please try again.');
      })
      .finally(() => {
        if (active && lastRequestKey.current === key) setWebSearchLoading(false);
      });

    return () => { active = false; };
  }, [submittedSearchTerm, searchSubmitCount, manualRetryCount]);

  const facetSource = facetCatalogue.length ? facetCatalogue : (webResults || []);
  const facets = useMemo(() => catalogueFacetOptions(facetSource), [facetSource]);

  const localLocations = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const conf of conferences || []) {
      const country = conf.location?.country?.trim();
      const city = conf.location?.city?.trim();
      if (!country) continue;
      if (!map.has(country)) map.set(country, new Set());
      if (city) map.get(country)!.add(city);
    }
    return map;
  }, [conferences]);

  const locationOptions = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const option of facets.locations) map.set(option.country, new Set(option.cities));
    for (const [country, cities] of localLocations.entries()) {
      if (!map.has(country)) map.set(country, new Set());
      for (const city of cities) map.get(country)!.add(city);
    }
    return [...map.entries()]
      .map(([country, cities]) => ({ country, cities: [...cities].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.country.localeCompare(b.country));
  }, [facets.locations, localLocations]);

  const countryOptions = locationOptions.map((item) => item.country);
  const cityOptions = countryFilter
    ? locationOptions.find((item) => item.country === countryFilter)?.cities || []
    : [];
  const organizerOptions = useMemo(() => {
    const values = new Set(facets.organizers);
    for (const conf of conferences || []) if (String(conf.organizerName ?? '').trim()) values.add(conf.organizerName.trim());
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [facets.organizers, conferences]);

  const localFiltered = useMemo(() => (conferences || []).filter((conf) => {
    // Automated launch-acceptance fixtures must never appear in public discovery.
    const title = String(conf.title ?? '').toLowerCase();
    const description = String(conf.description ?? '').toLowerCase();
    if (title.includes('synthetic launch acceptance') ||
        (title.includes('test only') && description.includes('automated acceptance'))) return false;
    const term = String(searchTerm ?? '').trim().toLowerCase();
    const searchable = [conf.title, conf.description, conf.organizerName, ...(conf.topics || [])]
      .filter(Boolean).join(' ').toLowerCase();
    if (term && !searchable.includes(term)) return false;
    if (!withinDateWindow({ start: conf.dates.start }, { effectiveStartMonth, endAtMonth })) return false;
    if (countryFilter && String(conf.location?.country || '').toLowerCase() !== countryFilter.toLowerCase()) return false;
    if (cityFilter && String(conf.location?.city || '').toLowerCase() !== cityFilter.toLowerCase()) return false;
    if (organizerFilter && !String(conf.organizerName || '').toLowerCase().includes(organizerFilter.toLowerCase())) return false;
    if (categoryFilter) {
      const subject = [conf.title, conf.description, ...(conf.topics || [])].filter(Boolean).join(' ').toLowerCase();
      if (!subject.includes(categoryFilter.toLowerCase())) return false;
    }
    if (formatFilter) {
      const wanted = normalizedConferenceFormat(formatFilter);
      const actual = normalizedConferenceFormat(conf.format);
      if (wanted === 'virtual') {
        if (actual !== 'virtual' && actual !== 'hybrid') return false;
      } else if (actual !== wanted) return false;
    }
    if (!localTimingMatches(conf, timingFilter)) return false;
    if (cfpOnly && conf.cfpStatus !== 'Open' && conf.cfpStatus !== 'Extended') return false;
    return true;
  }), [
    conferences,
    searchTerm,
    effectiveStartMonth,
    endAtMonth,
    countryFilter,
    cityFilter,
    organizerFilter,
    categoryFilter,
    formatFilter,
    timingFilter,
    cfpOnly,
  ]);

  const filteredStored = useMemo(() => filterStoredDiscoveryResults(webResults || [], {
    startMonth: effectiveStartMonth,
    endMonth: endAtMonth,
    country: countryFilter,
    city: cityFilter,
    format: formatFilter,
    timing: timingFilter,
    category: categoryFilter,
    organizer: organizerFilter,
    cfpOnly,
    requiredSection,
    minimumDetailSections,
    richDetailsOnly,
  }), [
    webResults,
    effectiveStartMonth,
    endAtMonth,
    countryFilter,
    cityFilter,
    formatFilter,
    timingFilter,
    categoryFilter,
    organizerFilter,
    cfpOnly,
    requiredSection,
    minimumDetailSections,
    richDetailsOnly,
  ]);

  const allStored = useMemo(() => {
    const sorted = sortStoredDiscoveryResults(deduplicateConferenceResults(filteredStored), resultSort);
    if (!personalized || !interests.trim()) return sorted;
    return [...sorted].sort((left, right) =>
      conferenceMatchReasons(right, interests).length - conferenceMatchReasons(left, interests).length);
  }, [filteredStored, resultSort, personalized, interests]);


  useEffect(() => {
    if (!personalized || !interests.trim() || !allStored.length) {
      setSemanticScores({}); setSemanticStatus('idle'); return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSemanticStatus('loading');
      const candidates = allStored.slice(0, 30).map(item => ({
        key: item.link + '|' + item.title,
        text: [item.title, item.category, ...(item.categories || []), item.description].filter(Boolean).join(' ').slice(0, 650),
      }));
      try {
        const response = await fetch('/api/search/semantic-rank', {
          method: 'POST', credentials: 'include', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interests, candidates }),
        });
        if (!response.ok) throw new Error('Semantic matching unavailable');
        const payload = await response.json();
        if (!Array.isArray(payload.scores)) throw new Error('Missing semantic scores');
        setSemanticScores(Object.fromEntries(payload.scores.map((item: { key: string; score: number }) => [item.key, item.score])));
        setSemanticStatus('ready');
      } catch {
        if (!controller.signal.aborted) { setSemanticScores({}); setSemanticStatus('fallback'); }
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [personalized, interests, allStored]);

  const rankedStored = useMemo(() => {
    if (semanticStatus !== 'ready') return allStored;
    return [...allStored].sort((left, right) =>
      (semanticScores[right.link + '|' + right.title] ?? -2) - (semanticScores[left.link + '|' + left.title] ?? -2));
  }, [allStored, semanticScores, semanticStatus]);

  useEffect(() => { setVisibleResultCount(24); }, [allStored]);
  const displayedStored = rankedStored.slice(0, visibleResultCount);
  const activeFilterCount = [
    countryFilter,
    cityFilter,
    formatFilter,
    timingFilter,
    categoryFilter,
    organizerFilter,
    requiredSection,
    endAtMonth,
    cfpOnly ? 'cfp' : '',
    minimumDetailSections ? String(minimumDetailSections) : '',
    richDetailsOnly ? 'rich' : '',
  ].filter(Boolean).length;

  const updateStartBoundary = (value: string) => {
    setStartFromMonth(value);
    if (value && endAtMonth && endAtMonth < value) setEndAtMonth(value);
  };
  const updateEndBoundary = (value: string) => {
    if (value && startFromMonth && value < startFromMonth) setEndAtMonth(startFromMonth);
    else setEndAtMonth(value);
  };

  const submitSearch = (term = searchTerm) => {
    const query = term.trim();
    setSearchTerm(term);
    setSubmittedSearchTerm(query);
    setSearchSubmitCount((count) => count + 1);
  };

  const applyPopularSearch = (term: string) => {
    setCategoryFilter(term);
    setSearchTerm('');
    setSubmittedSearchTerm(term);
    setSearchSubmitCount((count) => count + 1);
  };

  const clearFilters = () => {
    setStartFromMonth(DISCOVERY_MINIMUM_MONTH);
    setEndAtMonth('');
    setCountryFilter('');
    setCityFilter('');
    setFormatFilter('');
    setTimingFilter('');
    setCategoryFilter('');
    setOrganizerFilter('');
    setCfpOnly(false);
    setRequiredSection('');
    setMinimumDetailSections(0);
    setRichDetailsOnly(false);
    setResultSort('recommended');
  };

  const clearEverything = () => {
    clearFilters();
    setSearchTerm('');
    setSubmittedSearchTerm('');
    setSearchSubmitCount((count) => count + 1);
  };

  return (
    <div className="space-y-8">
      <section className="bg-blue-50 rounded-2xl border border-blue-100 p-6 sm:p-8 shadow-xs">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-600">Global Discovery Engine</span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
            Explore Academic & Technical Conferences
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Search Conference Gate’s worldwide catalogue across conference identity and deep stored content.
          </p>
        </div>

        <div className="mt-6 pt-6 border-t border-blue-100 space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search title, topic, organizer, speaker, sponsor, venue, CFP, publication/indexing…"
                aria-label="Deep conference search"
                className="w-full pl-9 pr-3 py-2.5 bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={webSearchLoading}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
            >
              {webSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {webSearchLoading ? 'Searching' : 'Search'}
            </button>
          </form>
          <p className="text-[10px] text-slate-500">
            Deep search includes CFP requirements, agenda sessions, speakers, committees, sponsors/exhibitors, venue/accommodation,
            fees/pricing, community, and publication/indexing text already stored for each conference.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-8 gap-2.5">
            <div className="xl:col-span-2 flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200 focus-within:border-blue-500">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-500">From</span>
              <select
                value={startFromMonth.split('-')[1] || ''}
                aria-label="From month"
                onChange={(event) => {
                  const month = event.target.value;
                  updateStartBoundary(month ? `${startFromMonth.split('-')[0] || currentYear}-${month}` : '');
                }}
                className="min-w-0 flex-1 text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Month</option>
                {MONTHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select
                value={startFromMonth.split('-')[0] || ''}
                aria-label="From year"
                onChange={(event) => {
                  const year = event.target.value;
                  updateStartBoundary(year ? `${year}-${startFromMonth.split('-')[1] || '01'}` : '');
                }}
                className="w-[4.6rem] text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Year</option>
                {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>

            <div className="xl:col-span-2 flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200 focus-within:border-blue-500">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-500">To</span>
              <select
                value={endAtMonth.split('-')[1] || ''}
                aria-label="To month"
                onChange={(event) => {
                  const month = event.target.value;
                  updateEndBoundary(month ? `${endAtMonth.split('-')[0] || startFromMonth.split('-')[0] || currentYear}-${month}` : '');
                }}
                className="min-w-0 flex-1 text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Month</option>
                {MONTHS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select
                value={endAtMonth.split('-')[0] || ''}
                aria-label="To year"
                onChange={(event) => {
                  const year = event.target.value;
                  updateEndBoundary(year ? `${year}-${endAtMonth.split('-')[1] || '12'}` : '');
                }}
                className="w-[4.6rem] text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Year</option>
                {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>

            <label className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={countryFilter}
                onChange={(event) => {
                  setCountryFilter(event.target.value);
                  setCityFilter('');
                }}
                aria-label="Country"
                className="w-full pl-9 pr-8 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
              >
                <option value="">Any country</option>
                {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}
              </select>
            </label>

            <label className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                disabled={!countryFilter}
                aria-label="City"
                className="w-full pl-9 pr-8 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden disabled:text-slate-400"
              >
                <option value="">{countryFilter ? 'Any city' : 'Select country first'}</option>
                {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
              </select>
            </label>

            <select
              value={formatFilter}
              onChange={(event) => setFormatFilter(event.target.value)}
              aria-label="Conference format"
              className="px-3 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">Any format</option>
              <option value="In-person">In-person</option>
              <option value="Virtual">Virtual / online</option>
              <option value="Hybrid">Hybrid</option>
            </select>

            <select
              value={timingFilter}
              onChange={(event) => setTimingFilter(event.target.value)}
              aria-label="Conference timing"
              className="px-3 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">Any timing</option>
              <option value="one-day">One-day event</option>
              <option value="multi-day">Multi-day event</option>
              <option value="weekend">Touches weekend</option>
              <option value="weekday">Weekday only</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2.5 p-3 rounded-xl border border-blue-100 bg-white/70">
            <div className="relative">
              <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={organizerFilter}
                onChange={(event) => setOrganizerFilter(event.target.value)}
                aria-label="Organizer or society"
                className="w-full pl-9 pr-8 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
              >
                <option value="">Any organizer / society</option>
                {organizerOptions.map((organizer) => <option key={organizer} value={organizer}>{organizer}</option>)}
              </select>
            </div>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Subject category"
              className="px-3 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">Any subject / specialty</option>
              {facets.categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>

            <select
              value={requiredSection}
              onChange={(event) => setRequiredSection(event.target.value)}
              aria-label="Required conference detail"
              className="px-3 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
            >
              {DETAIL_SECTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>

            <select
              value={minimumDetailSections}
              onChange={(event) => setMinimumDetailSections(Number(event.target.value))}
              aria-label="Minimum data depth"
              className="px-3 py-2 bg-white text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
            >
              <option value={0}>Any data depth</option>
              <option value={4}>4+ of 9 detail areas</option>
              <option value={6}>6+ of 9 detail areas</option>
              <option value={8}>8+ of 9 detail areas</option>
              <option value={9}>9/9 detail areas</option>
            </select>

            <button
              type="button"
              onClick={() => setCfpOnly((value) => !value)}
              className={cfpOnly
                ? 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 text-xs font-bold text-emerald-700 cursor-pointer'
                : 'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:border-emerald-200 cursor-pointer'}
            >
              <FileText className="w-4 h-4" />
              Open CFP only
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Popular fields
            </span>
            {POPULAR_SEARCHES.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => applyPopularSearch(suggestion)}
                className={categoryFilter === suggestion
                  ? 'px-2.5 py-1 rounded-full border border-blue-600 bg-blue-600 text-[10px] font-semibold text-white cursor-pointer'
                  : 'px-2.5 py-1 rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700 cursor-pointer'}
              >
                {suggestion}
              </button>
            ))}
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                <X className="w-3 h-3" /> Clear filters ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      </section>

      {localFiltered.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Conference Gate hosted conferences</h2>
            <p className="text-[11px] text-slate-500">Organizer-created conferences with native Conference Gate workflows.</p>
          </div>
          <div className="space-y-4">
            {localFiltered.map((conf) => {
              const saved = savedConferenceIds.includes(conf.id);
              const followed = followedConferenceIds.includes(conf.id);
              const accepting = conf.cfpStatus === 'Open' || conf.cfpStatus === 'Extended';
              return (
                <article
                  key={conf.id}
                  onClick={() => onSelectConference(conf)}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-blue-300 shadow-xs hover:shadow-md transition-all p-5 cursor-pointer flex flex-col md:flex-row gap-5"
                >
                  <div className="w-full md:w-48 h-36 rounded-xl bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
                    {conf.banner ? <img src={conf.banner} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl font-black text-white/70">{getInitials(conf.title)}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">{conf.title}</h3>
                        <p className="text-xs text-slate-500 mt-1">{formatDateRange(conf.dates.start, conf.dates.end)} · {conf.location.city}, {conf.location.country}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onToggleSave?.(conf.id); }}
                          className={saved ? 'p-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200' : 'p-2 rounded-xl bg-slate-50 text-slate-400 border border-slate-200'}
                          title="Save conference"
                        >
                          <Bookmark className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onToggleFollow?.(conf.id); }}
                          className={followed ? 'px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold' : 'px-3 py-2 rounded-xl bg-slate-50 text-slate-600 border border-slate-200 text-xs font-bold'}
                        >
                          {followed ? 'Following' : '+ Follow'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 mt-2 line-clamp-2">{conf.description}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-xs">
                        <img src={conf.logo || generateInitialsAvatar(conf.organizerName)} alt="" className="w-6 h-6 rounded-md object-cover" />
                        <span className="font-semibold text-slate-600">{conf.organizerName}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!accepting}
                          onClick={(event) => { event.stopPropagation(); if (accepting) onOpenSubmitAbstract(conf.id); }}
                          className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {accepting ? 'Submit Abstract' : 'CFP Closed'}
                        </button>
                        <button type="button" className="px-3 py-2 rounded-xl bg-blue-900 text-white text-xs font-bold">View Conference</button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Globe className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Worldwide Conference Results</h2>
              <p className="text-[11px] text-slate-500">
                {displayedStored.length} match{displayedStored.length === 1 ? '' : 'es'} from the stored global catalogue · facets from {facetSource.length} server records.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRichDetailsOnly((value) => !value)}
              className={richDetailsOnly
                ? 'px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-700 cursor-pointer'
                : 'px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-600 cursor-pointer'}
            >
              6+ detail areas
            </button>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={resultSort}
                onChange={(event) => setResultSort(event.target.value as DiscoveryResultSort)}
                aria-label="Sort conference results"
                className="bg-transparent text-[11px] font-bold text-slate-700 focus:outline-hidden"
              >
                <option value="recommended">Recommended</option>
                <option value="soonest">Soonest first</option>
                <option value="complete">Most complete</option>
                <option value="cfp">Open CFP first</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setManualRetryCount((count) => count + 1)}
              disabled={webSearchLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${webSearchLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {webSearchLoading && (!webResults || webResults.length === 0) && (
          <div className="bg-white rounded-2xl border border-slate-200 py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Searching stored conference intelligence…
          </div>
        )}

        {webSearchError && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs font-semibold text-amber-800">
            {webSearchError}
          </div>
        )}

        {!webSearchLoading && !webSearchError && webResults && displayedStored.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <Search className="w-6 h-6 text-blue-600 mx-auto" />
            <h3 className="text-sm font-bold text-slate-900 mt-3">No conference matches every selected condition</h3>
            <p className="text-xs text-slate-500 mt-1">Broaden a date, geography, organizer, section, or data-depth filter.</p>
            <button type="button" onClick={clearEverything} className="mt-4 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold">Clear search and filters</button>
          </div>
        )}

        {!webSearchError && displayedStored.length > 0 && (
          <div className="space-y-4">
            {displayedStored.map((result) => {
              const date = dateLine(result.startDate, result.endDate);
              const place = formatConferenceLocation([result.location?.city, result.location?.country].filter(Boolean).join(', '));
              const categories = Array.from(new Set([result.category, ...(result.categories || [])].filter(Boolean) as string[])).slice(0, 4);
              const trust = conferenceTrustSignals(result);
              const reasons = conferenceMatchReasons(result, personalized && interests.trim() ? interests : submittedSearchTerm);
              return (
                <article
                  key={`${result.link}|${result.title}|${result.startDate || ''}`}
                  onClick={() => onOpenExternalResult(result)}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-xs hover:shadow-md transition-all p-5 sm:p-6 cursor-pointer flex flex-col sm:flex-row sm:items-center gap-5 group"
                >
                  <div className="w-28 h-28 shrink-0 rounded-2xl bg-white border border-slate-200 flex items-center justify-center p-3 overflow-hidden">
                    <ResultLogo result={result} />
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug">{result.title}</h3>
                        {result.organization && <p className="text-[11px] font-semibold text-slate-500 mt-0.5">{result.organization}</p>}
                        <p className="text-[11px] text-slate-500 mt-1" title={trust.missing.length ? `Missing: ${trust.missing.join(', ')}. Not independently verified.` : 'Information completeness only; not independently verified.'}>
                          Information: {trust.score}/{trust.total} · Verification not confirmed
                        </p>
                        {reasons.length > 0 && <p className="text-[11px] text-indigo-700 mt-1">Topic matches: {reasons.join(', ')}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {result.cfpOpen && <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-bold text-emerald-700">Open CFP</span>}
                        <span className={resultDetailCoverage(result) >= 6
                          ? 'px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-[10px] font-bold text-indigo-700'
                          : 'px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-bold text-slate-600'}>
                          {resultDetailCoverage(result)}/9 details
                        </span>
                      </div>
                    </div>

                    {(date || place) && (
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                        {date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-slate-400" />{date}</span>}
                        {place && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4 text-slate-400" />{place}</span>}
                      </div>
                    )}

                    {(categories.length > 0 || formatLabel(result.format)) && (
                      <div className="flex flex-wrap gap-2">
                        {categories.map((category) => <span key={category} className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">{category}</span>)}
                        {formatLabel(result.format) && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">{formatLabel(result.format)}</span>}
                      </div>
                    )}

                    {result.description && <p className="text-xs text-slate-600 line-clamp-2">{result.description}</p>}

                    <div className="flex flex-wrap gap-2">
                      {result.sections?.includes('cfp') && <QuickTab label="CFP" icon={FileText} onClick={() => onOpenExternalResult(result, 'cfp')} />}
                      {result.sections?.includes('agenda') && <QuickTab label="Program" icon={CalendarDays} onClick={() => onOpenExternalResult(result, 'agenda')} />}
                      {result.sections?.includes('speakers') && <QuickTab label="Speakers" icon={Users} onClick={() => onOpenExternalResult(result, 'speakers')} />}
                      {result.sections?.includes('committee') && <QuickTab label="Committee" icon={UserCheck} onClick={() => onOpenExternalResult(result, 'committee')} />}
                      {result.sections?.includes('sponsors') && <QuickTab label="Sponsors" icon={Briefcase} onClick={() => onOpenExternalResult(result, 'sponsors')} />}
                      {result.sections?.includes('fees') && <QuickTab label="Fees" icon={FileText} onClick={() => onOpenExternalResult(result, 'fees')} />}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenExternalResult(result, preferredTab(result));
                      }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors"
                    >
                      {preferredAction(result)} <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {visibleResultCount < allStored.length && (
          <div className="text-center space-y-2">
            <p className="text-xs text-slate-500" aria-live="polite">Showing {displayedStored.length} of {allStored.length} conferences</p>
            <button type="button" onClick={() => setVisibleResultCount((count) => count + 24)} className="min-h-11 px-5 py-2.5 rounded-xl bg-blue-900 text-white text-sm font-bold">Show more conferences</button>
          </div>
        )}

        {facetCatalogue.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Worldwide facets are built from the full server catalogue snapshot, not only the currently visible cards.
          </div>
        )}
      </section>
    </div>
  );
};

const QuickTab: React.FC<{
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}> = ({ label, icon: Icon, onClick }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[11px] font-semibold rounded-lg border border-slate-200 transition-colors"
  >
    <Icon className="w-3 h-3" /> {label}
  </button>
);
