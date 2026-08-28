import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Bookmark,
  Users,
  Globe,
  Hotel,
  BookOpen,
  Map as MapIcon,
  Loader2,
  AlertCircle,
  FileText,
  UserCheck,
  Briefcase,
  MapPin,
  CalendarRange,
  DollarSign,
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

const DISCOVERY_SUGGESTIONS = [
  'Artificial Intelligence',
  'Cybersecurity',
  'Engineering',
  'Healthcare',
  'Energy',
  'Sustainability',
  'Business',
  'Virtual conferences',
  'Open call for papers',
];

// Common global conference destinations. Organizer-created Conference Gate locations are merged
// into this at runtime, so a newly added country/city automatically appears without a code change.
const CONFERENCE_CITIES_BY_COUNTRY: Record<string, string[]> = {
  'Argentina': ['Buenos Aires', 'Córdoba', 'Mendoza'],
  'Australia': ['Brisbane', 'Melbourne', 'Perth', 'Sydney'],
  'Austria': ['Graz', 'Salzburg', 'Vienna'],
  'Bahrain': ['Manama'],
  'Belgium': ['Antwerp', 'Brussels', 'Ghent'],
  'Brazil': ['Brasília', 'Rio de Janeiro', 'São Paulo'],
  'Canada': ['Calgary', 'Montréal', 'Ottawa', 'Toronto', 'Vancouver'],
  'Chile': ['Santiago'],
  'China': ['Beijing', 'Guangzhou', 'Hangzhou', 'Shanghai', 'Shenzhen'],
  'Colombia': ['Bogotá', 'Cartagena', 'Medellín'],
  'Czechia': ['Brno', 'Prague'],
  'Denmark': ['Aarhus', 'Copenhagen'],
  'Egypt': ['Alexandria', 'Cairo', 'Sharm El Sheikh'],
  'Finland': ['Espoo', 'Helsinki', 'Tampere'],
  'France': ['Lyon', 'Marseille', 'Nice', 'Paris'],
  'Germany': ['Berlin', 'Cologne', 'Frankfurt', 'Hamburg', 'Munich'],
  'Ghana': ['Accra'],
  'Greece': ['Athens', 'Thessaloniki'],
  'Hong Kong': ['Hong Kong'],
  'Hungary': ['Budapest'],
  'India': ['Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Mumbai', 'Pune'],
  'Indonesia': ['Bali', 'Jakarta', 'Surabaya'],
  'Ireland': ['Cork', 'Dublin', 'Galway'],
  'Italy': ['Florence', 'Milan', 'Rome', 'Turin', 'Venice'],
  'Japan': ['Kyoto', 'Osaka', 'Tokyo', 'Yokohama'],
  'Jordan': ['Amman', 'Aqaba'],
  'Kenya': ['Mombasa', 'Nairobi'],
  'Kuwait': ['Kuwait City'],
  'Malaysia': ['Kuala Lumpur', 'Penang'],
  'Mexico': ['Cancún', 'Guadalajara', 'Mexico City', 'Monterrey'],
  'Morocco': ['Casablanca', 'Marrakesh', 'Rabat'],
  'Netherlands': ['Amsterdam', 'Eindhoven', 'Rotterdam', 'The Hague'],
  'New Zealand': ['Auckland', 'Christchurch', 'Wellington'],
  'Nigeria': ['Abuja', 'Lagos'],
  'Norway': ['Bergen', 'Oslo', 'Trondheim'],
  'Oman': ['Muscat'],
  'Pakistan': ['Islamabad', 'Karachi', 'Lahore'],
  'Philippines': ['Cebu', 'Manila'],
  'Poland': ['Kraków', 'Warsaw', 'Wrocław'],
  'Portugal': ['Lisbon', 'Porto'],
  'Qatar': ['Doha'],
  'Romania': ['Bucharest', 'Cluj-Napoca'],
  'Saudi Arabia': ['Al Khobar', 'AlUla', 'Dammam', 'Dhahran', 'Jeddah', 'Riyadh'],
  'Singapore': ['Singapore'],
  'South Africa': ['Cape Town', 'Durban', 'Johannesburg', 'Pretoria'],
  'South Korea': ['Busan', 'Seoul'],
  'Spain': ['Barcelona', 'Madrid', 'Málaga', 'Valencia'],
  'Sweden': ['Gothenburg', 'Malmö', 'Stockholm'],
  'Switzerland': ['Basel', 'Geneva', 'Lausanne', 'Zurich'],
  'Taiwan': ['Kaohsiung', 'Taipei'],
  'Thailand': ['Bangkok', 'Chiang Mai', 'Phuket'],
  'Tunisia': ['Hammamet', 'Tunis'],
  'Turkey': ['Ankara', 'Antalya', 'Istanbul', 'Izmir'],
  'United Arab Emirates': ['Abu Dhabi', 'Dubai', 'Sharjah'],
  'United Kingdom': ['Birmingham', 'Edinburgh', 'Glasgow', 'London', 'Manchester'],
  'United States': ['Atlanta', 'Austin', 'Boston', 'Chicago', 'Dallas', 'Denver', 'Houston', 'Las Vegas', 'Los Angeles', 'Miami', 'New York', 'Orlando', 'Philadelphia', 'San Diego', 'San Francisco', 'Seattle', 'Washington, DC'],
  'Vietnam': ['Da Nang', 'Hanoi', 'Ho Chi Minh City'],
};

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
  const [endAtMonth, setEndAtMonth] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [timingFilter, setTimingFilter] = useState('');

  // The real lowest published registration price for a conference — the figure a reader actually
  // compares against when deciding whether an event is in their budget. Only conferences with at
  // least one priced package have a number here; an empty packages list means pricing was never
  // entered, not that the event is free, so it stays null rather than being guessed as $0.
  const startingPriceOf = (conf: Conference): number | null => {
    const prices = (conf.registrationPackages || [])
      .map((pkg) => pkg.price)
      .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price >= 0);
    return prices.length > 0 ? Math.min(...prices) : null;
  };

  // The slider's own ends are derived from real prices in the current catalog, the same way
  // locationOptions below is derived from real conference locations — never a guessed ceiling
  // like a flat $0–$5,000, which would misrepresent both cheap and very expensive catalogs alike.
  const priceBounds = useMemo(() => {
    const prices = (conferences || [])
      .map((conf) => startingPriceOf(conf))
      .filter((price): price is number => price !== null);
    if (prices.length === 0) return null;
    return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
  }, [conferences]);

  // null = "still tracking the live catalog bounds automatically" (the default, unfiltered
  // state); becomes a fixed pair the moment the reader drags a handle, so their chosen range
  // survives even if the catalog's own min/max shifts afterward.
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const priceFilterActive = priceRange !== null;
  const [priceMin, priceMax] = priceRange ?? (priceBounds ? [priceBounds.min, priceBounds.max] : [0, 0]);
  const formatPrice = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;

  const locationOptions = useMemo(() => {
    const byCountry = new Map<string, Set<string>>(
      Object.entries(CONFERENCE_CITIES_BY_COUNTRY).map(([country, cities]) => [country, new Set(cities)])
    );
    (conferences || []).forEach((conference) => {
      const country = conference.location?.country?.trim();
      const city = conference.location?.city?.trim();
      if (!country) return;
      if (!byCountry.has(country)) byCountry.set(country, new Set());
      if (city) byCountry.get(country)!.add(city);
    });
    return [...byCountry.entries()]
      .map(([country, cities]) => ({ country, cities: [...cities].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.country.localeCompare(b.country));
  }, [conferences]);

  const countryOptions = locationOptions.map((option) => option.country);
  const cityOptions = countryFilter
    ? locationOptions.find((option) => option.country === countryFilter)?.cities || []
    : [];

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
  const filtered = (conferences || []).filter((conf) => {
    const term = searchTerm.trim().toLowerCase();
    const locationTerm = locationFilter.trim().toLowerCase();
    const countryTerm = countryFilter.trim().toLowerCase();
    const formatTerm = formatFilter.trim().toLowerCase().replace(/[-\s]+/g, '');
    const confMonth = (conf.dates.start || '').slice(0, 7);
    const confLocation = [
      conf.location?.city,
      conf.location?.venue,
      conf.location?.country,
    ].filter(Boolean).join(' ').toLowerCase();
    const confCountry = (conf.location?.country || '').toLowerCase();
    const confFormat = (conf.format || '').toLowerCase().replace(/[-\s]+/g, '');
    const duration = conferenceDurationDays(conf.dates.start, conf.dates.end);
    const startDay = new Date(`${conf.dates.start}T12:00:00`).getDay();
    const endDay = new Date(`${conf.dates.end}T12:00:00`).getDay();
    const touchesWeekend = [startDay, endDay].some((day) => day === 0 || day === 6);

    if (
      term &&
      !(conf.title || '').toLowerCase().includes(term) &&
      !(conf.description || '').toLowerCase().includes(term) &&
      !(conf.topics || []).some((topic) => topic.toLowerCase().includes(term))
    ) return false;
    if (startFromMonth && confMonth < startFromMonth) return false;
    if (endAtMonth && confMonth > endAtMonth) return false;
    if (locationTerm && !confLocation.includes(locationTerm)) return false;
    if (countryTerm && !confCountry.includes(countryTerm)) return false;
    if (formatTerm && confFormat !== formatTerm) return false;
    if (timingFilter === 'one-day' && duration !== 1) return false;
    if (timingFilter === 'multi-day' && duration < 2) return false;
    if (timingFilter === 'weekend' && !touchesWeekend) return false;
    if (timingFilter === 'weekday' && touchesWeekend) return false;
    if (priceFilterActive) {
      const startingPrice = startingPriceOf(conf);
      // Excluded rather than assumed free or assumed in-range — the reader has deliberately
      // narrowed the range, and an event Conference Gate has no price for cannot be honestly
      // confirmed to fit it.
      if (startingPrice === null) return false;
      if (startingPrice < priceMin || startingPrice > priceMax) return false;
    }
    return true;
  });

  // Live web results always populate the page — the typed search term if there is one,
  // otherwise a fixed default query so Discover is never empty.
  const [webResults, setWebResults] = useState<LiveSearchResult[] | null>(null);
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const lastWebQueryRef = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    // Live results do not arrive with normalized filter fields, so every selected filter is sent
    // to the search engine itself. Conference Gate catalog records are filtered exactly above;
    // live results are strongly biased by the same date, place, country, and format choices.
    let dateBias = '';
    if (startFromMonth) {
      const [year, month] = startFromMonth.split('-').map(Number);
      const name = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });
      dateBias += ` from ${name} ${year}`;
    }
    if (endAtMonth) {
      const [year, month] = endAtMonth.split('-').map(Number);
      const name = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });
      dateBias += ` until ${name} ${year}`;
    }
    const locationBias = locationFilter.trim() ? ` in ${locationFilter.trim()}` : '';
    const countryBias = countryFilter.trim() ? ` ${countryFilter.trim()}` : '';
    const formatBias = formatFilter ? ` ${formatFilter} conference` : '';
    const timingBias =
      timingFilter === 'one-day' ? ' one day' :
      timingFilter === 'multi-day' ? ' multi day' :
      timingFilter === 'weekend' ? ' weekend' :
      timingFilter === 'weekday' ? ' weekday' : '';
    // Live results carry no structured registration price to filter on — a search snippet's
    // dollar figure, if it even mentions one, is free text we'd have to guess-parse — so a chosen
    // range is biased into the query itself rather than applied as a real filter.
    const priceBias = priceFilterActive ? ` ${formatPrice(priceMin)}-${formatPrice(priceMax)}` : '';
    const effectiveQuery =
      (trimmed || DEFAULT_DISCOVER_QUERY) +
      dateBias +
      locationBias +
      countryBias +
      formatBias +
      timingBias +
      priceBias;

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
  }, [searchTerm, startFromMonth, endAtMonth, locationFilter, countryFilter, formatFilter, timingFilter, priceFilterActive, priceMin, priceMax]);

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
              Real conferences created through Conference Gate, plus individual official conference websites found live.
            </p>
          </div>
        </div>

        {/* Search and filters shared by Conference Gate records and Live Web Search. */}
        <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, keywords, topics..."
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden transition-all"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2.5">
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-blue-500">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-500">From</span>
              <input
                type="month"
                value={startFromMonth}
                onChange={(e) => setStartFromMonth(e.target.value)}
                className="min-w-0 flex-1 text-xs text-slate-800 bg-transparent focus:outline-hidden"
              />
            </label>

            <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-blue-500">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-500">To</span>
              <input
                type="month"
                value={endAtMonth}
                min={startFromMonth || undefined}
                onChange={(e) => setEndAtMonth(e.target.value)}
                className="min-w-0 flex-1 text-xs text-slate-800 bg-transparent focus:outline-hidden"
              />
            </label>

            <label className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value);
                  setLocationFilter('');
                }}
                aria-label="Country"
                className="w-full pl-9 pr-8 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden"
              >
                <option value="">Any country</option>
                {countryOptions.map((country) => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </label>

            <label className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                disabled={!countryFilter}
                aria-label="City"
                className="w-full pl-9 pr-8 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <option value="">{countryFilter ? 'Any city' : 'Select country first'}</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </label>

            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              aria-label="Conference format"
              className="px-3 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">Any format</option>
              <option value="In-person">In-person</option>
              <option value="Virtual">Virtual</option>
              <option value="Hybrid">Hybrid</option>
            </select>

            <select
              value={timingFilter}
              onChange={(e) => setTimingFilter(e.target.value)}
              aria-label="Conference timing"
              className="px-3 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">Any timing</option>
              <option value="one-day">One-day event</option>
              <option value="multi-day">Multi-day event</option>
              <option value="weekend">Weekend</option>
              <option value="weekday">Weekday</option>
            </select>
          </div>

          {/* Price range — bounds come from the real lowest registration price across the current
              catalog, never a guessed ceiling, so the meter always spans prices that actually
              exist. Hidden entirely when nothing in the catalog has a real price yet. */}
          {priceBounds && priceBounds.max > priceBounds.min && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
                  <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                  Price range
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {formatPrice(priceMin)} – {formatPrice(priceMax)}
                </span>
              </div>
              <div className="relative h-4 flex items-center">
                <div className="absolute inset-x-0 h-1.5 bg-slate-200 rounded-full" />
                <div
                  className="absolute h-1.5 bg-blue-500 rounded-full"
                  style={{
                    left: `${((priceMin - priceBounds.min) / (priceBounds.max - priceBounds.min)) * 100}%`,
                    right: `${100 - ((priceMax - priceBounds.min) / (priceBounds.max - priceBounds.min)) * 100}%`,
                  }}
                />
                {/* Two overlapping native range inputs — the standard dependency-free way to get
                    a dual-handle slider. Each input's own track is pointer-events-none so only
                    its thumb (re-enabled via the pseudo-element selectors) can be grabbed,
                    letting both handles coexist on the same track without fighting for clicks. */}
                <input
                  type="range"
                  min={priceBounds.min}
                  max={priceBounds.max}
                  value={priceMin}
                  aria-label="Minimum price"
                  onChange={(e) => setPriceRange([Math.min(Number(e.target.value), priceMax), priceMax])}
                  className="absolute w-full h-4 appearance-none bg-transparent pointer-events-none cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent"
                />
                <input
                  type="range"
                  min={priceBounds.min}
                  max={priceBounds.max}
                  value={priceMax}
                  aria-label="Maximum price"
                  onChange={(e) => setPriceRange([priceMin, Math.max(Number(e.target.value), priceMin)])}
                  className="absolute w-full h-4 appearance-none bg-transparent pointer-events-none cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent"
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-slate-400 font-medium">{formatPrice(priceBounds.min)}</span>
                <span className="text-[9px] text-slate-400 font-medium">{formatPrice(priceBounds.max)}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Popular searches</span>
            {DISCOVERY_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setSearchInput(suggestion)}
                className={`px-2.5 py-1 rounded-full border text-[10px] font-semibold transition-colors cursor-pointer ${
                  searchTerm === suggestion
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                {suggestion}
              </button>
            ))}
            {(searchTerm || startFromMonth || endAtMonth || locationFilter || countryFilter || formatFilter || timingFilter || priceFilterActive) && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setStartFromMonth('');
                  setEndAtMonth('');
                  setLocationFilter('');
                  setCountryFilter('');
                  setFormatFilter('');
                  setTimingFilter('');
                  setPriceRange(null);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-3 h-3" />
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Honest empty state when the selected filters hide the Conference Gate catalog. */}
      {filtered.length === 0 &&
        (conferences || []).length > 0 &&
        (searchTerm || startFromMonth || endAtMonth || locationFilter || countryFilter || formatFilter || timingFilter || priceFilterActive) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <p className="text-xs text-slate-500">
              No Conference Gate conferences match the selected filters. Live Web Search below is still checking
              the wider web with the same choices.
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
                            <MapIcon className="w-3.5 h-3.5 text-rose-500" />
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
                                <MapIcon className="w-3 h-3 text-blue-500" />
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
              Only current and upcoming individual conference websites are shown. Old editions, duplicates,
              directories, calendars, and multi-conference lists are excluded.
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
            <p className="text-xs text-slate-400">No current or upcoming conference websites found. Try different keywords or broader filters.</p>
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
