import React, { useState } from 'react';
import {
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Calendar,
  MapPin,
  Building2,
  FileText,
  Award,
  Users,
  Briefcase,
  Layers,
  CheckCircle2,
  Globe,
  Flame,
  Star,
} from 'lucide-react';
import { Conference } from '../types';
import { LogoMark } from './Logo';

interface HomeLandingProps {
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onNavigateTab: (tab: string) => void;
  onOpenSubmitAbstract: (confId?: string) => void;
  onSearchQuery: (query: string) => void;
}

export const HomeLanding: React.FC<HomeLandingProps> = ({
  conferences,
  onSelectConference,
  onNavigateTab,
  onOpenSubmitAbstract,
  onSearchQuery,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const categories = [
    'All',
    'Energy & Geosciences',
    'AI & Machine Learning',
    'Petroleum Systems',
    'Healthcare & Physics',
    'Cyber Security',
    'Virtual & Hybrid',
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onSearchQuery(searchInput);
      onNavigateTab('discover');
    }
  };

  const filteredConferences = (conferences || []).filter((conf) => {
    if (activeCategory === 'All') return true;
    if (activeCategory === 'Energy & Geosciences') return (conf.industry || '').includes('Energy') || (conf.topics || []).includes('Geosciences');
    if (activeCategory === 'AI & Machine Learning') return (conf.topics || []).includes('Artificial Intelligence') || (conf.topics || []).includes('Machine Learning');
    if (activeCategory === 'Petroleum Systems') return (conf.topics || []).includes('Petroleum Systems');
    if (activeCategory === 'Virtual & Hybrid') return conf.format === 'Hybrid' || conf.format === 'Online';
    return true;
  });

  return (
    <div className="space-y-16 pb-12">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-8 sm:p-12 lg:p-16 shadow-2xl border border-slate-800">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"></div>
        <LogoMark size={340} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.05] pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 text-blue-300 text-xs font-semibold backdrop-blur-md">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Verified Conference Identity Platform</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Science conference <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-300 bg-clip-text text-transparent">
              done right
            </span>
          </h1>

          <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Discover conferences, manage events, submit research, review abstracts, connect professionals, and unlock sponsorship opportunities—all in one platform.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <button
              onClick={() => onNavigateTab('discover')}
              className="px-6 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40 transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Discover Conferences</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigateTab('organizer')}
              className="px-6 py-3.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold rounded-xl text-sm backdrop-blur-md transition-all flex items-center gap-2 cursor-pointer"
            >
              <Building2 className="w-4 h-4" />
              <span>Organize a Conference</span>
            </button>
            <button
              onClick={() => onNavigateTab('sponsor')}
              className="px-6 py-3.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-400/40 font-bold rounded-xl text-sm backdrop-blur-md transition-all flex items-center gap-2 cursor-pointer"
            >
              <Briefcase className="w-4 h-4" />
              <span>Explore Sponsorship Opportunities</span>
            </button>
          </div>

          {/* Global Search Box in Hero */}
          <div className="pt-6 max-w-2xl mx-auto">
            <form onSubmit={handleSearchSubmit} className="relative flex items-center">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Find your perfect conference, topic, or call for papers..."
                className="w-full pl-12 pr-32 py-4 bg-white text-slate-900 rounded-2xl shadow-2xl text-sm focus:outline-hidden font-medium placeholder:text-slate-400"
              />
              <Search className="w-5 h-5 text-slate-400 absolute left-4" />
              <button
                type="submit"
                className="absolute right-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Search
              </button>
            </form>
            {/* Quick Topic Chips */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-xs text-slate-300">
              <span className="text-slate-400">Popular:</span>
              {['Geosciences', 'Petroleum Systems', 'AI & Subsurface', 'Energy Transition', 'Cyber Security', 'Hybrid'].map(
                (chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setSearchInput(chip);
                      onSearchQuery(chip);
                      onNavigateTab('discover');
                    }}
                    className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
                  >
                    {chip}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Core Brand Identity Difference Banner */}
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-sky-50 border border-blue-200/80 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xs">
        <div className="space-y-2 text-center md:text-left">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold uppercase tracking-wider">
            Clear Identity
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">
            LinkedIn builds your general professional identity. <br className="hidden sm:inline" />
            <span className="text-blue-700">Conference Gate builds and verifies your conference professional identity.</span>
          </h3>
          <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
            All posts, abstracts, reviews, committee positions, keynotes, and kudos on Conference Gate are strictly verified academic and technical event activities.
          </p>
        </div>
        <button
          onClick={() => onNavigateTab('profile')}
          className="px-5 py-3 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-md shrink-0 flex items-center gap-2 cursor-pointer"
        >
          <Award className="w-4 h-4" />
          <span>View Verified Profile</span>
        </button>
      </div>

      {/* Promoted Conferences Section */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
              <Flame className="w-4 h-4 text-blue-400 fill-blue-400" />
              <span>Promoted Conferences</span>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight mt-1">
              Find the best conference for you
            </h2>
          </div>

          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  activeCategory === cat
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Conference Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredConferences.map((conf) => (
            <div
              key={conf.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-xl transition-all duration-200 flex flex-col overflow-hidden group"
            >
              {/* Banner Image */}
              <div className="relative h-44 overflow-hidden bg-slate-900">
                <img
                  src={conf.banner}
                  alt={conf.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent"></div>

                {/* Match Score Badge */}
                <div className="absolute top-3 right-3 bg-emerald-500/90 text-white font-extrabold text-xs px-2.5 py-1 rounded-full backdrop-blur-md shadow-md flex items-center gap-1">
                  <Star className="w-3 h-3 fill-white" />
                  <span>{conf.recommendationScore}% Match</span>
                </div>

                {/* Format Pill */}
                <div className="absolute top-3 left-3 bg-white/90 text-slate-800 font-bold text-[10px] uppercase px-2.5 py-1 rounded-full backdrop-blur-md shadow-xs">
                  {conf.format}
                </div>

                {/* Title & Organizer inside banner bottom */}
                <div className="absolute bottom-3 left-3 right-3 text-white">
                  <h3 className="font-bold text-sm leading-snug line-clamp-2 drop-shadow-xs">
                    {conf.title}
                  </h3>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {conf.description}
                  </p>

                  <div className="space-y-1.5 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="font-medium text-slate-700">
                        {conf.dates.start} — {conf.dates.end}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span>{conf.location.city}, {conf.location.country}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="font-medium text-slate-700">
                        Call for Papers: <strong className="text-emerald-600">{conf.cfpStatus}</strong> (Deadline: {conf.abstractDeadline})
                      </span>
                    </div>
                  </div>

                  {/* Topics Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(conf.topics || []).slice(0, 3).map((topic, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-semibold"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action Footer */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase font-bold">Registration</span>
                    <span className="text-xs font-bold text-slate-900">{conf.priceRange}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenSubmitAbstract(conf.id)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      Submit Abstract
                    </button>
                    <button
                      onClick={() => onSelectConference(conf)}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-xs cursor-pointer"
                    >
                      See Details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center pt-2">
          <button
            onClick={() => onNavigateTab('discover')}
            className="px-8 py-3 bg-white border border-slate-300 hover:border-slate-400 text-slate-800 text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            See All Conferences ({conferences.length})
          </button>
        </div>
      </div>

      {/* Strategic Platform Capabilities Grid */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 shadow-sm space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
            End-to-End Conference Ecosystem
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            Designed for the complete conference lifecycle
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Whether you are presenting groundbreaking research, chairing a technical committee, reviewing papers, organizing an international congress, or sponsoring event booths.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Abstract Submission & Review</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Submit research papers with primary & co-authors, track real-time screening & peer review statuses, and receive verified feedback from accredited reviewers.
            </p>
          </div>

          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
              <Award className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Reviewer Network & Kudos</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Global reviewer pool with automated AI reviewer matching. Earn verified Reviewer Kudos (+20 Kudos per review) and build an accredited peer-review record.
            </p>
          </div>

          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <Briefcase className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-slate-900">Sponsorship & ROI Analytics</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Marketplace connecting corporate sponsors with technical conferences. Track brand exposure, logo impressions, B2B lead requests, and booth attendance in real time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
