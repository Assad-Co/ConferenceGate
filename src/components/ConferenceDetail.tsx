import React, { useState } from 'react';
import {
  Calendar,
  MapPin,
  Building2,
  FileText,
  Users,
  Award,
  Briefcase,
  Share2,
  Bookmark,
  CheckCircle2,
  Clock,
  Globe,
  Sparkles,
  MessageSquare,
  Hotel,
  Plane,
  ChevronRight,
  ArrowLeft,
  UserCheck,
} from 'lucide-react';
import { Conference } from '../types';
import { formatDateRange } from '../utils/date';

interface ConferenceDetailProps {
  conference: Conference;
  onBack: () => void;
  onOpenSubmitAbstract: (confId: string) => void;
  onVolunteerReviewer: (confId: string) => void;
  onExpressCommitteeInterest: (confId: string) => void;
  onApplySponsorship: (confId: string) => void;
  registeredPackageId?: string | null;
  onRegister?: (conferenceId: string, conferenceTitle: string, packageId: string, packageName: string) => void;
  isSaved?: boolean;
  isFollowed?: boolean;
  onToggleSave?: () => void;
  onToggleFollow?: () => void;
}

export const ConferenceDetail: React.FC<ConferenceDetailProps> = ({
  conference,
  onBack,
  onOpenSubmitAbstract,
  onVolunteerReviewer,
  onExpressCommitteeInterest,
  onApplySponsorship,
  registeredPackageId = null,
  onRegister,
  isSaved = false,
  isFollowed = false,
  onToggleSave,
  onToggleFollow,
}) => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'cfp' | 'agenda' | 'speakers' | 'committee' | 'sponsors' | 'venue' | 'community'
  >('overview');
  const registeredPackage = registeredPackageId;
  const saved = isSaved;
  const followed = isFollowed;

  return (
    <div className="space-y-8">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Discovery</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleSave}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer flex items-center gap-1.5 ${
              saved
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${saved ? 'fill-current' : ''}`} />
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>
          <button
            onClick={onToggleFollow}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-xl border transition-colors cursor-pointer ${
              followed
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {followed ? 'Following Organizer' : '+ Follow Organizer'}
          </button>
        </div>
      </div>

      {/* Hero Banner Header */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="relative h-64 sm:h-80 bg-slate-900">
          <img
            src={conference.banner}
            alt={conference.title}
            className="w-full h-full object-cover opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

          {/* Organizer Logo & Name */}
          <div className="absolute top-6 left-6 flex items-center gap-3 bg-slate-950/70 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
            <img
              src={conference.organizerLogo}
              alt={conference.organizerName}
              className="w-8 h-8 rounded-lg object-cover ring-2 ring-white/50"
            />
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-300">Organizer</div>
              <div className="text-xs font-bold text-white">{conference.organizerName}</div>
            </div>
          </div>

          <div className="absolute top-6 right-6 bg-emerald-500 text-white font-extrabold text-xs px-3 py-1.5 rounded-full shadow-md">
            {conference.recommendationScore}% Match For Your Profile
          </div>

          {/* Title & Key Specs */}
          <div className="absolute bottom-6 left-6 right-6 text-white space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-blue-600 text-white font-bold text-[10px] uppercase px-2.5 py-0.5 rounded-md">
                {conference.format}
              </span>
              <span className="bg-slate-800/80 text-slate-200 font-semibold text-[10px] px-2.5 py-0.5 rounded-md">
                {conference.industry}
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow-sm">
              {conference.title}
            </h1>

            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-200 font-medium">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-blue-400" />
                {formatDateRange(conference.dates.start, conference.dates.end)}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-rose-400" />
                {conference.location.venue}, {conference.location.city}, {conference.location.country}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-400" />
                {conference.attendeeCount}+ Attendees ({conference.networkAttendeesCount} Network Connections)
              </span>
            </div>
          </div>
        </div>

        {/* Primary Action Callouts Bar */}
        <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onOpenSubmitAbstract(conference.id)}
              className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Submit Abstract</span>
            </button>
            <button
              onClick={() => onVolunteerReviewer(conference.id)}
              className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Award className="w-4 h-4" />
              <span>Volunteer as Reviewer</span>
            </button>
            <button
              onClick={() => onExpressCommitteeInterest(conference.id)}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              <span>Join Technical Committee</span>
            </button>
            <button
              onClick={() => onApplySponsorship(conference.id)}
              className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Briefcase className="w-4 h-4" />
              <span>Become Sponsor</span>
            </button>
          </div>

          <div className="text-right">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Registration Prices</div>
            <div className="text-sm font-bold text-slate-900">{conference.priceRange}</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'cfp', label: `Call for Papers (${conference.cfpStatus})` },
            { id: 'agenda', label: 'Program & Agenda' },
            { id: 'speakers', label: `Keynote Speakers (${conference.speakers.length})` },
            { id: 'committee', label: 'Technical Committee' },
            { id: 'sponsors', label: `Sponsors & Exhibitors (${conference.sponsors.length})` },
            { id: 'venue', label: 'Venue & Accommodation' },
            { id: 'community', label: `Community (${conference.communityPosts})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Description */}
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-slate-900">About the Conference</h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {conference.description}
              </p>
            </div>

            {/* Conference Themes & Tracks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Main Themes & Focus Areas
                </h4>
                <div className="space-y-2">
                  {(conference.mainThemes || []).map((theme, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs font-medium text-slate-700">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{theme}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Scientific Tracks
                </h4>
                <div className="space-y-2">
                  {(conference.tracks || []).map((track, i) => (
                    <div key={i} className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs font-semibold text-slate-800">
                      {track}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Registration Packages Card */}
            <div className="pt-6 border-t border-slate-100 space-y-4">
              <h3 className="text-lg font-bold text-slate-900">Registration Packages</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {(conference.registrationPackages || []).map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`p-6 rounded-2xl border transition-all flex flex-col justify-between space-y-4 ${
                      registeredPackage === pkg.id
                        ? 'border-blue-600 bg-blue-50/50 shadow-md ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="space-y-3">
                      <h4 className="font-bold text-sm text-slate-900">{pkg.name}</h4>
                      <div className="text-2xl font-extrabold text-blue-700">${pkg.price}</div>
                      <p className="text-xs text-slate-600 leading-relaxed">{pkg.description}</p>
                      <ul className="space-y-1.5 pt-2 text-xs text-slate-700">
                        {(pkg.features || []).map((feat, idx) => (
                          <li key={idx} className="flex items-center gap-1.5 text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      onClick={() => onRegister?.(conference.id, conference.title, pkg.id, pkg.name)}
                      className={`w-full py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                        registeredPackage === pkg.id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-blue-900 hover:bg-blue-950 text-white'
                      }`}
                    >
                      {registeredPackage === pkg.id ? 'Registered ✓ — Verified Attendance' : 'Register Package'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cfp' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
                  Call for Papers Status: {conference.cfpStatus}
                </span>
                <h3 className="text-lg font-bold">Submit Your Research Abstract</h3>
                <p className="text-xs text-blue-200">
                  Abstract Submission Deadline: <strong className="text-white">{conference.abstractDeadline}</strong>
                </p>
              </div>
              <button
                onClick={() => onOpenSubmitAbstract(conference.id)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shrink-0 cursor-pointer"
              >
                Submit Abstract Now
              </button>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Submission Guidelines & Topics
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <h5 className="font-bold text-slate-900">Format & Structure</h5>
                  <p>Maximum 500 words. Include background, methodology, experimental results, and conclusions.</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <h5 className="font-bold text-slate-900">Peer Review Policy</h5>
                  <p>Double-blind peer review handled by accredited Conference Gate technical committee reviewers.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'agenda' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900">Interactive Program & Agenda</h3>
            {conference.agendaDays.length === 0 ? (
              <p className="text-xs text-slate-500">Program schedule is being finalized by the Technical Committee.</p>
            ) : (
              (conference.agendaDays || []).map((day, idx) => (
                <div key={idx} className="space-y-3">
                  <h4 className="text-sm font-bold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg w-fit">
                    {day.dayName} ({day.date})
                  </h4>
                  <div className="space-y-3">
                    {(day.sessions || []).map((ses) => (
                      <div key={ses.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                            <Clock className="w-3.5 h-3.5 text-blue-600" />
                            <span>{ses.time}</span>
                            <span>•</span>
                            <span className="text-slate-800 font-bold">{ses.hall}</span>
                            <span>•</span>
                            <span className="text-blue-600 font-semibold">{ses.track}</span>
                          </div>
                          <h5 className="text-sm font-bold text-slate-900">{ses.title}</h5>
                          {ses.abstractSummary && (
                            <p className="text-xs text-slate-600">{ses.abstractSummary}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <img src={ses.speakerAvatar} alt={ses.speakerName} className="w-9 h-9 rounded-full object-cover ring-2 ring-blue-500/20" />
                          <div className="text-xs">
                            <div className="font-bold text-slate-900">{ses.speakerName}</div>
                            <div className="text-[10px] text-slate-500">{ses.speakerTitle}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'speakers' && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-slate-900">Keynote & Invited Speakers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(conference.speakers || []).map((spk) => (
                <div key={spk.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex gap-4">
                  <img src={spk.avatar} alt={spk.name} className="w-16 h-16 rounded-2xl object-cover ring-2 ring-blue-500/30 shrink-0" />
                  <div className="space-y-1 text-xs">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 font-bold rounded-md text-[10px]">
                      {spk.role}
                    </span>
                    <h4 className="font-bold text-sm text-slate-900">{spk.name}</h4>
                    <p className="text-slate-600 font-medium">{spk.title} — {spk.org}</p>
                    <p className="text-slate-500 pt-1 leading-snug">{spk.bio}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'committee' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Technical Committee & Advisory Board</h3>
              <button
                onClick={() => onExpressCommitteeInterest(conference.id)}
                className="px-3.5 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl hover:bg-blue-100 transition-colors"
              >
                + Express Committee Interest
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(conference.committee || []).map((cm) => (
                <div key={cm.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-4">
                  <img src={cm.avatar} alt={cm.name} className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-300 shrink-0" />
                  <div className="text-xs">
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                      {cm.committeeRole}
                    </span>
                    <h5 className="font-bold text-slate-900 mt-0.5">{cm.name}</h5>
                    <p className="text-slate-600">{cm.title}, {cm.org}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'sponsors' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Event Sponsors & Exhibitors</h3>
              <button
                onClick={() => onApplySponsorship(conference.id)}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Explore Sponsorship Packages
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {(conference.sponsors || []).map((sp) => (
                <div key={sp.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
                  <img src={sp.logo} alt={sp.name} className="w-12 h-12 rounded-xl object-cover mx-auto" />
                  <div className="font-bold text-xs text-slate-900">{sp.name}</div>
                  <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md">
                    {sp.tier} Sponsor
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'venue' && (
          <div className="space-y-6 text-xs text-slate-600">
            <h3 className="text-lg font-bold text-slate-900">Venue, Accommodation & Travel</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Hotel className="w-4 h-4 text-blue-600" />
                  <span>Accommodation Details</span>
                </div>
                <p>{conference.accommodation}</p>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Plane className="w-4 h-4 text-rose-500" />
                  <span>Travel & Airport Transit</span>
                </div>
                <p>{conference.travelInfo}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'community' && (
          <div className="space-y-4 text-xs text-slate-600">
            <h3 className="text-lg font-bold text-slate-900">Conference Community & Discussions</h3>
            <p>Connect with other registered attendees, keynote speakers, and authors prior to the event.</p>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <span className="font-bold text-slate-900">Community Feed</span>
              <p className="pt-1 text-slate-500">
                Discussion threads scoped to individual conferences aren't available yet — head to the Community tab
                to connect with other attendees, authors, and reviewers on the platform.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
