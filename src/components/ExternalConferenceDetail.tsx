import React, { useEffect, useState } from 'react';
import {
  Calendar,
  MapPin,
  FileText,
  Users,
  Award,
  Briefcase,
  CheckCircle2,
  Clock,
  Globe,
  Hotel,
  Plane,
  ArrowLeft,
  UserCheck,
  ExternalLink,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { LiveSearchResult, ExtractedConferenceDetails, extractConferenceDetails } from '../api/search';
import { generateInitialsAvatar } from '../utils/avatar';

interface ExternalConferenceDetailProps {
  result: LiveSearchResult;
  onBack: () => void;
}

const EmptyExtractState: React.FC<{ message: string; sourceUrl: string }> = ({ message, sourceUrl }) => (
  <div className="py-8 text-center space-y-3">
    <p className="text-xs text-slate-500 max-w-md mx-auto">{message}</p>
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded-xl transition-colors"
    >
      <Globe className="w-3.5 h-3.5" />
      <span>Check the official website</span>
      <ExternalLink className="w-3 h-3" />
    </a>
  </div>
);

const PersonCard: React.FC<{ name: string; title: string | null; org: string | null; role: string | null }> = ({
  name,
  title,
  org,
  role,
}) => (
  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-4">
    <img src={generateInitialsAvatar(name)} alt="" className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-300 shrink-0" />
    <div className="text-xs">
      {role && (
        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">{role}</span>
      )}
      <h5 className="font-bold text-slate-900 mt-0.5">{name}</h5>
      {(title || org) && (
        <p className="text-slate-600">
          {title}
          {title && org ? ', ' : ''}
          {org}
        </p>
      )}
    </div>
  </div>
);

export const ExternalConferenceDetail: React.FC<ExternalConferenceDetailProps> = ({ result, onBack }) => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'cfp' | 'agenda' | 'speakers' | 'committee' | 'sponsors' | 'venue' | 'community'
  >('overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ExtractedConferenceDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    extractConferenceDetails(result.link, result.title).then((extracted) => {
      if (!cancelled) {
        setData(extracted);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [result.link, result.title]);

  const submissionLink = data?.submissionUrl || result.link;

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

        <a
          href={result.link}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Visit Website</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Hero Banner Header */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="relative h-64 sm:h-80 bg-slate-900 flex items-center justify-center">
          {result.thumbnail ? (
            <img src={result.thumbnail} alt={result.title} className="w-full h-full object-cover opacity-70" />
          ) : (
            <Globe className="w-16 h-16 text-slate-700" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

          <div className="absolute top-6 left-6 flex items-center gap-3 bg-slate-950/70 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
            {result.favicon && <img src={result.favicon} alt="" className="w-5 h-5 rounded shrink-0" />}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-300">Source</div>
              <div className="text-xs font-bold text-white">{result.displayLink}</div>
            </div>
          </div>

          <div className="absolute top-6 right-6 bg-amber-500 text-white font-extrabold text-xs px-3 py-1.5 rounded-full shadow-md flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            AI-Extracted, Unverified
          </div>

          <div className="absolute bottom-6 left-6 right-6 text-white space-y-2">
            {data?.format && (
              <span className="bg-blue-600 text-white font-bold text-[10px] uppercase px-2.5 py-0.5 rounded-md">
                {data.format}
              </span>
            )}
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow-sm">
              {result.title}
            </h1>
            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-200 font-medium">
              {data?.datesText && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-400" />
                  {data.datesText}
                </span>
              )}
              {data?.locationText && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-rose-400" />
                  {data.locationText}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Disclaimer Banner */}
        <div className="p-4 bg-amber-50 border-t border-b border-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            This page shows information an AI assistant automatically pulled from{' '}
            <a href={result.link} target="_blank" rel="noopener noreferrer" className="font-bold underline">
              {result.displayLink}
            </a>
            . It hasn't been verified by Conference Gate, some details may be missing or inaccurate, and this isn't
            part of our curated conference catalog. Always confirm on the official website before registering,
            submitting, or making decisions based on this content.
          </p>
        </div>

        {/* Primary Action Callouts Bar */}
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <a
            href={submissionLink}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Submit via Official Site</span>
          </a>
          <a
            href={result.link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Award className="w-4 h-4" />
            <span>Reviewer Info on Site</span>
          </a>
          <a
            href={result.link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
          >
            <UserCheck className="w-4 h-4" />
            <span>Committee Info on Site</span>
          </a>
          <a
            href={result.link}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Briefcase className="w-4 h-4" />
            <span>Sponsorship Info on Site</span>
          </a>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'cfp', label: 'Call for Papers' },
            { id: 'agenda', label: 'Program & Agenda' },
            { id: 'speakers', label: `Keynote Speakers (${data?.speakers.length || 0})` },
            { id: 'committee', label: 'Technical Committee' },
            { id: 'sponsors', label: `Sponsors & Exhibitors (${data?.sponsors.length || 0})` },
            { id: 'venue', label: 'Venue & Accommodation' },
            { id: 'community', label: 'Community' },
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
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-400 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Reading the source page for real details...
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-lg font-bold text-slate-900">About</h3>
                    <a
                      href={result.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Official Website</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {data?.overviewSummary || result.snippet}
                  </p>
                  {!data?.extracted && (
                    <p className="text-[11px] text-slate-400 italic">
                      {data?.isFallback
                        ? 'AI extraction is not available right now — the summary above comes from the search result snippet only.'
                        : "Couldn't read this page's full content — the summary above comes from the search result snippet only."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'cfp' && (
              <div className="space-y-6">
                {data?.cfpStatus || data?.cfpDeadline ? (
                  <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="space-y-1">
                      {data?.cfpStatus && (
                        <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
                          Call for Papers Status: {data.cfpStatus}
                        </span>
                      )}
                      <h3 className="text-lg font-bold">Submit Your Research Abstract</h3>
                      {data?.cfpDeadline && (
                        <p className="text-xs text-blue-200">
                          Abstract Submission Deadline: <strong className="text-white">{data.cfpDeadline}</strong>
                        </p>
                      )}
                    </div>
                    <a
                      href={submissionLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shrink-0 cursor-pointer"
                    >
                      Submit via Official Site
                    </a>
                  </div>
                ) : (
                  <EmptyExtractState
                    message="No call-for-papers status or deadline was found on this page."
                    sourceUrl={result.link}
                  />
                )}
              </div>
            )}

            {activeTab === 'agenda' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Program & Agenda</h3>
                {!data?.agendaSessions.length ? (
                  <EmptyExtractState
                    message="No session-by-session program was found on this page."
                    sourceUrl={result.link}
                  />
                ) : (
                  <div className="space-y-3">
                    {data.agendaSessions.map((ses, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-start justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                            {(ses.date || ses.time) && (
                              <>
                                <Clock className="w-3.5 h-3.5 text-blue-600" />
                                <span>{[ses.date, ses.time].filter(Boolean).join(' • ')}</span>
                              </>
                            )}
                            {ses.track && <span className="text-blue-600 font-semibold">{ses.track}</span>}
                          </div>
                          <h5 className="text-sm font-bold text-slate-900">{ses.title}</h5>
                        </div>
                        {ses.speakerName && (
                          <div className="flex items-center gap-3 shrink-0">
                            <img
                              src={generateInitialsAvatar(ses.speakerName)}
                              alt=""
                              className="w-9 h-9 rounded-full object-cover ring-2 ring-blue-500/20"
                            />
                            <div className="text-xs font-bold text-slate-900">{ses.speakerName}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'speakers' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Keynote & Invited Speakers</h3>
                {!data?.speakers.length ? (
                  <EmptyExtractState message="No named speakers were found on this page." sourceUrl={result.link} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.speakers.map((spk, idx) => (
                      <PersonCard key={idx} name={spk.name} title={spk.title} org={spk.org} role={spk.role || 'Speaker'} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'committee' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Technical Committee & Advisory Board</h3>
                {!data?.committee.length ? (
                  <EmptyExtractState
                    message="No technical committee roster was found on this page."
                    sourceUrl={result.link}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.committee.map((cm, idx) => (
                      <PersonCard key={idx} name={cm.name} title={cm.title} org={cm.org} role={cm.role} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'sponsors' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Sponsors & Exhibitors</h3>
                {!data?.sponsors.length ? (
                  <EmptyExtractState
                    message="No sponsors or exhibitors were found on this page."
                    sourceUrl={result.link}
                  />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {data.sponsors.map((sp, idx) => (
                      <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
                        <div className="font-bold text-xs text-slate-900">{sp.name}</div>
                        {sp.tier && (
                          <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md">
                            {sp.tier}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
                    {data?.accommodationText ? (
                      <p>{data.accommodationText}</p>
                    ) : (
                      <p className="text-slate-400">
                        No accommodation details were found on this page —{' '}
                        <a href={result.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">
                          check the official website
                        </a>
                        .
                      </p>
                    )}
                  </div>
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                      <Plane className="w-4 h-4 text-rose-500" />
                      <span>Travel & Airport Transit</span>
                    </div>
                    {data?.travelText ? (
                      <p>{data.travelText}</p>
                    ) : (
                      <p className="text-slate-400">
                        No travel guidance was found on this page —{' '}
                        <a href={result.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">
                          check the official website
                        </a>
                        .
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'community' && (
              <div className="space-y-4 text-xs text-slate-600">
                <h3 className="text-lg font-bold text-slate-900">Conference Community & Discussions</h3>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-900">Not Available</span>
                  <p className="pt-1 text-slate-500">
                    This conference isn't in our verified catalog, so there's no Conference Gate community discussion
                    tied to it. Head to the <CheckCircle2 className="w-3 h-3 inline text-blue-600" /> Feed tab to
                    connect with attendees, authors, and reviewers on the platform generally.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
