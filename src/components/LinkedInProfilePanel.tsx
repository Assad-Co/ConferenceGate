import React, { useEffect, useState } from 'react';
import {
  Linkedin,
  RefreshCw,
  Briefcase,
  GraduationCap,
  FileText,
  Award,
  Calendar,
  Megaphone,
  ExternalLink,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  fetchLinkedInProfileEnrichment,
  refreshLinkedInProfileEnrichment,
  type LinkedInProfileEnrichment,
} from '../api/linkedinProfile';
import {
  fetchLinkedInConferenceActivity,
  refreshLinkedInConferenceActivity,
  type LinkedInConferenceActivity,
  type LinkedInConferenceSignal,
  type LinkedInCallSignal,
} from '../api/linkedinConferenceActivity';

interface Props {
  currentUserId?: string;
  linkedinUrl?: string;
}

function text(value: any): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  return '';
}

function experienceTitle(item: any): string {
  return text(item?.position) || text(item?.title) || text(item?.role) || 'Professional role';
}

function experienceOrg(item: any): string {
  return text(item?.companyName) || text(item?.company) || text(item?.organization) || '';
}

function dateText(item: any): string {
  const start = text(item?.startDate?.text) || text(item?.startDate) || text(item?.date);
  const end = text(item?.endDate?.text) || text(item?.endDate);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

function educationTitle(item: any): string {
  return text(item?.schoolName) || text(item?.school) || text(item?.institution) || 'Education';
}

function educationDetail(item: any): string {
  return [text(item?.degreeName) || text(item?.degree), text(item?.fieldOfStudy)].filter(Boolean).join(' · ');
}

function publicationTitle(item: any): string {
  return text(item?.name) || text(item?.title) || text(item?.publicationTitle) || 'Publication';
}

function patentTitle(item: any): string {
  return text(item?.title) || text(item?.name) || 'Patent';
}

const kindLabel: Record<LinkedInConferenceSignal['kind'], string> = {
  PAST_CONFERENCE: 'Past conference',
  UPCOMING_CONFERENCE: 'Upcoming conference',
  CONFERENCE_ROLE: 'Conference role',
  PAPER_ABSTRACT: 'Paper / abstract',
  CONFERENCE_MENTION: 'Conference mention',
};

const callLabel: Record<LinkedInCallSignal['kind'], string> = {
  CALL_FOR_PAPERS: 'Call for papers',
  CALL_FOR_ABSTRACTS: 'Call for abstracts',
  REGISTRATION: 'Registration',
};

export const LinkedInProfilePanel: React.FC<Props> = ({ currentUserId, linkedinUrl }) => {
  const [profile, setProfile] = useState<LinkedInProfileEnrichment | null>(null);
  const [activity, setActivity] = useState<LinkedInConferenceActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [profileResult, activityResult] = await Promise.allSettled([
      fetchLinkedInProfileEnrichment(),
      fetchLinkedInConferenceActivity(),
    ]);
    if (profileResult.status === 'fulfilled') setProfile(profileResult.value.profile);
    if (activityResult.status === 'fulfilled') setActivity(activityResult.value.activity);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([fetchLinkedInProfileEnrichment(), fetchLinkedInConferenceActivity()])
      .then(([p, a]) => {
        if (cancelled) return;
        if (p.status === 'fulfilled') setProfile(p.value.profile);
        if (a.status === 'fulfilled') setActivity(a.value.activity);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const handleRefresh = async () => {
    const url = linkedinUrl || profile?.linkedinUrl || activity?.linkedinUrl;
    if (!url) {
      setError('Add your public LinkedIn profile URL in Edit Profile first.');
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const [p, a] = await Promise.allSettled([
        refreshLinkedInProfileEnrichment(url),
        refreshLinkedInConferenceActivity(url),
      ]);
      if (p.status === 'rejected' && a.status === 'rejected') {
        throw new Error(p.reason?.message || a.reason?.message || 'LinkedIn import failed.');
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not refresh LinkedIn data.');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading LinkedIn profile…
      </div>
    );
  }

  if (!profile && !activity) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <Linkedin className="w-10 h-10 text-[#0A66C2] mx-auto mb-3" />
        <h3 className="text-lg font-extrabold text-slate-900">Build your ConferenceGate profile from LinkedIn</h3>
        <p className="text-sm text-slate-500 mt-2">
          Import your public professional profile and conference-related public posts. No LinkedIn password is required.
        </p>
        <button
          onClick={handleRefresh}
          disabled={refreshing || !linkedinUrl}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-900 text-white text-sm font-bold disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Linkedin className="w-4 h-4" />}
          Import from LinkedIn
        </button>
        {!linkedinUrl && <p className="text-xs text-slate-400 mt-3">Add your LinkedIn URL through Edit Profile first.</p>}
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      </div>
    );
  }

  const explicitClaims = (activity?.conferenceActivity || []).filter((item) => item.memberClaimed && !item.repostOrQuote);
  const otherConferenceSignals = (activity?.conferenceActivity || []).filter((item) => !item.memberClaimed || item.repostOrQuote);

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Linkedin className="w-5 h-5 text-[#0A66C2]" />
            <h2 className="text-lg font-extrabold text-slate-900">LinkedIn Professional & Conference Profile</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Public LinkedIn data only. ConferenceGate treats explicit first-person posts as member claims and keeps reposts as discovery signals—not proof of attendance, authorship, or a role.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh LinkedIn
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
          <div className="text-[10px] uppercase font-bold text-slate-400">Conference claims</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{explicitClaims.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
          <div className="text-[10px] uppercase font-bold text-slate-400">Calls & opportunities</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{activity?.callsForPapers.length || 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
          <div className="text-[10px] uppercase font-bold text-slate-400">Publications</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{profile?.publications.length || 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
          <div className="text-[10px] uppercase font-bold text-slate-400">Patents</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{profile?.patents.length || 0}</div>
        </div>
      </div>

      {explicitClaims.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-extrabold text-slate-900">Conference history, papers & positions</h3>
          </div>
          <div className="space-y-3">
            {explicitClaims.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                    {kindLabel[item.kind]}
                  </span>
                  {item.role && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-50 text-violet-700">{item.role}</span>
                  )}
                  {item.year && <span className="text-[11px] font-semibold text-slate-400">{item.year}</span>}
                </div>
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> LinkedIn member claim</span>
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline flex items-center gap-1">
                      Evidence <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(activity?.callsForPapers.length || 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-extrabold text-slate-900">Calls for papers, abstracts & registration</h3>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {activity!.callsForPapers.map((item) => (
              <div key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                <div className="text-[10px] uppercase font-extrabold text-amber-700 mb-1">{callLabel[item.kind]}{item.year ? ` · ${item.year}` : ''}</div>
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                {item.sourceUrl && (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
                    View LinkedIn source <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(profile?.publications.length || 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-emerald-600" /><h3 className="text-sm font-extrabold text-slate-900">Publications</h3></div>
          <div className="space-y-2">
            {profile!.publications.map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-800">{publicationTitle(item)}</div>
                {(text(item?.date) || text(item?.publisher)) && <div className="text-[11px] text-slate-500 mt-1">{[text(item?.publisher), text(item?.date)].filter(Boolean).join(' · ')}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(profile?.patents.length || 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3"><Award className="w-4 h-4 text-violet-600" /><h3 className="text-sm font-extrabold text-slate-900">Patents</h3></div>
          <div className="space-y-2">
            {profile!.patents.map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-800">{patentTitle(item)}</div>
                {(text(item?.patentNumber) || text(item?.date)) && <div className="text-[11px] text-slate-500 mt-1">{[text(item?.patentNumber), text(item?.date)].filter(Boolean).join(' · ')}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(profile?.experience.length || 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3"><Briefcase className="w-4 h-4 text-slate-600" /><h3 className="text-sm font-extrabold text-slate-900">Experience</h3></div>
          <div className="grid md:grid-cols-2 gap-3">
            {profile!.experience.slice(0, 12).map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-800">{experienceTitle(item)}</div>
                <div className="text-xs text-slate-500 mt-0.5">{experienceOrg(item)}</div>
                {dateText(item) && <div className="text-[11px] text-slate-400 mt-1">{dateText(item)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(profile?.education.length || 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3"><GraduationCap className="w-4 h-4 text-slate-600" /><h3 className="text-sm font-extrabold text-slate-900">Education</h3></div>
          <div className="grid md:grid-cols-2 gap-3">
            {profile!.education.map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-800">{educationTitle(item)}</div>
                {educationDetail(item) && <div className="text-xs text-slate-500 mt-0.5">{educationDetail(item)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {otherConferenceSignals.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-xs font-bold text-slate-600">Other conference mentions from LinkedIn ({otherConferenceSignals.length})</summary>
          <div className="space-y-2 mt-3">
            {otherConferenceSignals.slice(0, 25).map((item) => (
              <div key={item.id} className="text-xs text-slate-600 border-t border-slate-100 pt-2">
                <span className="font-bold">{kindLabel[item.kind]}:</span> {item.label}
                {item.repostOrQuote && <span className="ml-2 text-slate-400">repost/quote — not a personal claim</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default LinkedInProfilePanel;
