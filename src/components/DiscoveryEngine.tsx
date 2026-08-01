import React, { useState } from 'react';
import {
  Search,
  Filter,
  Calendar,
  MapPin,
  Building2,
  FileText,
  Star,
  Bookmark,
  Share2,
  Users,
  CheckCircle2,
  Globe,
  SlidersHorizontal,
  Plus,
} from 'lucide-react';
import { Conference } from '../types';

interface DiscoveryEngineProps {
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onOpenSubmitAbstract: (confId?: string) => void;
  initialSearchQuery?: string;
}

export const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({
  conferences,
  onSelectConference,
  onOpenSubmitAbstract,
  initialSearchQuery = '',
}) => {
  const [searchTerm, setSearchInput] = useState(initialSearchQuery);
  const [selectedIndustry, setSelectedIndustry] = useState<string>('All');
  const [selectedFormat, setSelectedFormat] = useState<string>('All');
  const [selectedCfp, setSelectedCfp] = useState<string>('All');
  const [savedIds, setSavedIds] = useState<string[]>(['conf_1']);
  const [followedIds, setFollowedIds] = useState<string[]>(['conf_1', 'conf_2']);

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

  const filtered = (conferences || []).filter((conf) => {
    const matchesSearch =
      !searchTerm ||
      (conf.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (conf.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (conf.topics || []).some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesIndustry =
      selectedIndustry === 'All' || (conf.industry || '').includes(selectedIndustry);

    const matchesFormat =
      selectedFormat === 'All' || conf.format === selectedFormat;

    const matchesCfp =
      selectedCfp === 'All' || conf.cfpStatus === selectedCfp;

    return matchesSearch && matchesIndustry && matchesFormat && matchesCfp;
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
              Filter by industry, research topic, call for papers status, location, or AI recommendation match score.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              Showing {filtered.length} Conferences
            </span>
          </div>
        </div>

        {/* Global Filter Bar */}
        <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

          {/* Format Filter */}
          <div>
            <select
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden font-medium cursor-pointer"
            >
              <option value="All">All Event Formats</option>
              <option value="Physical">Physical / On-site</option>
              <option value="Hybrid">Hybrid (In-person & Virtual)</option>
              <option value="Online">Online / Virtual</option>
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
        </div>
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
                setSearchInput('');
                setSelectedIndustry('All');
                setSelectedFormat('All');
                setSelectedCfp('All');
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
