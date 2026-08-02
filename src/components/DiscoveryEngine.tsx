import React, { useMemo, useState } from 'react';
import {
  Search,
  Calendar,
  MapPin,
  Star,
  Bookmark,
  Users,
  Globe,
  SlidersHorizontal,
  Video,
  Layers,
  Hotel,
  BookOpen,
  Map,
  X,
  ChevronDown,
} from 'lucide-react';
import { Conference } from '../types';

interface DiscoveryEngineProps {
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onOpenSubmitAbstract: (confId?: string) => void;
  initialSearchQuery?: string;
}

const FORMAT_OPTIONS: Array<{ value: Conference['format']; label: string; icon: React.ElementType }> = [
  { value: 'Online', label: 'Virtual', icon: Video },
  { value: 'Hybrid', label: 'Hybrid', icon: Layers },
  { value: 'Physical', label: 'In-person', icon: Users },
];

const parsePriceRange = (priceRange: string): [number, number] => {
  const nums = (priceRange.match(/[\d,]+/g) || ['0']).map((n) => parseInt(n.replace(/,/g, ''), 10));
  if (nums.length === 0) return [0, 0];
  if (nums.length === 1) return [nums[0], nums[0]];
  return [nums[0], nums[nums.length - 1]];
};

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; icon: React.ElementType }> = ({
  checked,
  onChange,
  label,
  icon: Icon,
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
      checked ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
    }`}
  >
    <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
      <Icon className={`w-4 h-4 ${checked ? 'text-blue-600' : 'text-slate-400'}`} />
      {label}
    </span>
    <span
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </span>
  </button>
);

const rangeThumbClasses =
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-track]:bg-transparent';

export const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({
  conferences,
  onSelectConference,
  onOpenSubmitAbstract,
  initialSearchQuery = '',
}) => {
  const [searchTerm, setSearchInput] = useState(initialSearchQuery);
  const [selectedIndustry, setSelectedIndustry] = useState<string>('All');
  const [selectedCfp, setSelectedCfp] = useState<string>('All');
  const [savedIds, setSavedIds] = useState<string[]>(['conf_1']);
  const [followedIds, setFollowedIds] = useState<string[]>(['conf_1', 'conf_2']);

  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<Conference['format'][]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [facilityHotel, setFacilityHotel] = useState(false);
  const [facilityBrochure, setFacilityBrochure] = useState(false);
  const [facilityCityMap, setFacilityCityMap] = useState(false);

  const priceBounds = useMemo(() => {
    const all = (conferences || []).flatMap((c) => parsePriceRange(c.priceRange));
    if (all.length === 0) return { min: 0, max: 1000 };
    return { min: Math.min(...all), max: Math.max(...all) };
  }, [conferences]);

  const [priceMin, setPriceMin] = useState(priceBounds.min);
  const [priceMax, setPriceMax] = useState(priceBounds.max);

  const toggleSave = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleFollow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFollowedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleFormat = (fmt: Conference['format']) => {
    setSelectedFormats((prev) => (prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]));
  };

  const resetAllFilters = () => {
    setSearchInput('');
    setSelectedIndustry('All');
    setSelectedCfp('All');
    setSelectedFormats([]);
    setDateFrom('');
    setDateTo('');
    setLocationQuery('');
    setFacilityHotel(false);
    setFacilityBrochure(false);
    setFacilityCityMap(false);
    setPriceMin(priceBounds.min);
    setPriceMax(priceBounds.max);
  };

  const activeFilterCount =
    (selectedFormats.length > 0 ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0) +
    (locationQuery ? 1 : 0) +
    (priceMin !== priceBounds.min || priceMax !== priceBounds.max ? 1 : 0) +
    (facilityHotel ? 1 : 0) +
    (facilityBrochure ? 1 : 0) +
    (facilityCityMap ? 1 : 0);

  const filtered = (conferences || []).filter((conf) => {
    const matchesSearch =
      !searchTerm ||
      (conf.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (conf.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (conf.topics || []).some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesIndustry =
      selectedIndustry === 'All' || (conf.industry || '').includes(selectedIndustry);

    const matchesCfp =
      selectedCfp === 'All' || conf.cfpStatus === selectedCfp;

    const matchesFormat = selectedFormats.length === 0 || selectedFormats.includes(conf.format);

    const matchesDate = (() => {
      if (!dateFrom && !dateTo) return true;
      const confStart = new Date(conf.dates.start).getTime();
      const confEnd = new Date(conf.dates.end).getTime();
      if (dateFrom && confEnd < new Date(dateFrom).getTime()) return false;
      if (dateTo && confStart > new Date(dateTo).getTime()) return false;
      return true;
    })();

    const matchesLocation =
      !locationQuery ||
      `${conf.location.city} ${conf.location.country} ${conf.location.venue}`
        .toLowerCase()
        .includes(locationQuery.toLowerCase());

    const [confMin, confMax] = parsePriceRange(conf.priceRange);
    const matchesPrice = confMax >= priceMin && confMin <= priceMax;

    const matchesHotel = !facilityHotel || !!(conf.accommodation && conf.accommodation.trim().length > 0);
    const matchesBrochure = !facilityBrochure || !!conf.hasBrochure;
    const matchesCityMap = !facilityCityMap || !!conf.hasCityMap;

    return (
      matchesSearch &&
      matchesIndustry &&
      matchesCfp &&
      matchesFormat &&
      matchesDate &&
      matchesLocation &&
      matchesPrice &&
      matchesHotel &&
      matchesBrochure &&
      matchesCityMap
    );
  });

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Global Discovery Engine
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
              Explore Academic & Technical Conferences
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Filter by date, price, location, event type, nearby facilities, industry, or call for papers status.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              Showing {filtered.length} Conferences
            </span>
          </div>
        </div>

        {/* Primary Filter Bar */}
        <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] gap-4">
          {/* Keyword Search */}
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, keywords, topics..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden transition-all"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          {/* Industry Filter */}
          <div>
            <select
              value={selectedIndustry}
              onChange={(e) => setSelectedIndustry(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden font-medium cursor-pointer"
            >
              <option value="All">All Industries</option>
              <option value="Energy">Energy & Geosciences</option>
              <option value="Artificial Intelligence">Artificial Intelligence</option>
              <option value="Petroleum">Petroleum & Mining</option>
              <option value="Technology">Technology & Software</option>
            </select>
          </div>

          {/* Call For Papers Status */}
          <div>
            <select
              value={selectedCfp}
              onChange={(e) => setSelectedCfp(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden font-medium cursor-pointer"
            >
              <option value="All">All CFP Statuses</option>
              <option value="Open">Call for Papers Open</option>
              <option value="Extended">CFP Extended</option>
              <option value="Closed">CFP Closed</option>
            </select>
          </div>

          {/* More Filters Toggle */}
          <button
            onClick={() => setShowMoreFilters((v) => !v)}
            className={`px-4 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors shrink-0 ${
              showMoreFilters || activeFilterCount > 0
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-white/25 text-[10px] flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Expanded Filters Panel */}
        {showMoreFilters && (
          <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
            {/* Dates */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Conference Dates
                </label>
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => {
                      setDateFrom('');
                      setDateTo('');
                    }}
                    className="text-[10px] font-bold text-slate-400 hover:text-blue-600 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">From</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden cursor-pointer"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">To</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-rose-500" />
                Location
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  placeholder="City, country, or venue..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Price Range */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-blue-600" />
                Price Range
              </label>
              <div className="relative h-2 mt-4 mx-1">
                <div className="absolute inset-0 bg-slate-200 rounded-full" />
                <div
                  className="absolute h-full bg-blue-600 rounded-full"
                  style={{
                    left: `${((priceMin - priceBounds.min) / Math.max(1, priceBounds.max - priceBounds.min)) * 100}%`,
                    right: `${100 - ((priceMax - priceBounds.min) / Math.max(1, priceBounds.max - priceBounds.min)) * 100}%`,
                  }}
                />
                <input
                  type="range"
                  min={priceBounds.min}
                  max={priceBounds.max}
                  value={priceMin}
                  onChange={(e) => setPriceMin(Math.min(Number(e.target.value), priceMax))}
                  className={`absolute inset-0 w-full h-2 appearance-none bg-transparent pointer-events-none ${rangeThumbClasses}`}
                />
                <input
                  type="range"
                  min={priceBounds.min}
                  max={priceBounds.max}
                  value={priceMax}
                  onChange={(e) => setPriceMax(Math.max(Number(e.target.value), priceMin))}
                  className={`absolute inset-0 w-full h-2 appearance-none bg-transparent pointer-events-none ${rangeThumbClasses}`}
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <span className="text-slate-400 text-[10px] font-semibold block">Min price</span>
                  <span className="font-bold text-slate-900">${priceMin.toLocaleString()}</span>
                </div>
                <div className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <span className="text-slate-400 text-[10px] font-semibold block">Max price</span>
                  <span className="font-bold text-slate-900">${priceMax.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Type of Event */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-900">Type of Event</label>
              <div className="grid grid-cols-3 gap-2">
                {FORMAT_OPTIONS.map((opt) => {
                  const active = selectedFormats.includes(opt.value);
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleFormat(opt.value)}
                      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-50 border-blue-400 text-blue-700'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-[11px] font-bold">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Nearby Facilities */}
            <div className="space-y-2 lg:col-span-2">
              <label className="text-xs font-bold text-slate-900">Nearby Facilities</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Toggle checked={facilityHotel} onChange={setFacilityHotel} label="Hotel Included" icon={Hotel} />
                <Toggle
                  checked={facilityBrochure}
                  onChange={setFacilityBrochure}
                  label="Conference Brochure"
                  icon={BookOpen}
                />
                <Toggle checked={facilityCityMap} onChange={setFacilityCityMap} label="City Map Provided" icon={Map} />
              </div>
            </div>

            {/* Reset */}
            <div className="lg:col-span-2 flex justify-end">
              <button
                onClick={resetAllFilters}
                className="text-xs font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Reset all filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Conference Cards List */}
      <div className="space-y-6">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
            <Search className="w-8 h-8 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">No matching conferences found</h3>
            <p className="text-xs text-slate-500">
              Try adjusting your search criteria or clearing selected filters.
            </p>
            <button
              onClick={() => {
                setSelectedIndustry('All');
                setSelectedCfp('All');
                resetAllFilters();
              }}
              className="px-4 py-2 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filtered.map((conf) => {
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

                  <div className="absolute top-3 right-3 bg-emerald-500 text-white font-extrabold text-xs px-2.5 py-1 rounded-full shadow-xs flex items-center gap-1">
                    <Star className="w-3 h-3 fill-white" />
                    <span>{conf.recommendationScore}% Match</span>
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
                        <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 mt-1">
                          <span className="flex items-center gap-1.5 text-blue-700">
                            <Calendar className="w-3.5 h-3.5" />
                            {conf.dates.start} — {conf.dates.end}
                          </span>
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <MapPin className="w-3.5 h-3.5 text-rose-500" />
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Call for Papers:</span>
                        <span className="font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-md text-[11px]">
                          {conf.cfpStatus} (Deadline: {conf.abstractDeadline})
                        </span>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Network Attendance:</span>
                        <span className="font-bold text-blue-700 bg-blue-100/60 px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {conf.networkAttendeesCount} Connections Attending
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
                        {conf.attendeeCount}+ Registered Attendees
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
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                      >
                        View Conference Page
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
