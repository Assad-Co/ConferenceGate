import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Linkedin, Loader2, ShieldAlert } from 'lucide-react';
import {
  fetchLinkedInConferenceActivity,
  type LinkedInConferenceActivity,
  type LinkedInConferenceSignal,
} from '../api/linkedinConferenceActivity';
import {
  fetchLinkedInProfileEnrichment,
  type LinkedInProfileEnrichment,
} from '../api/linkedinProfile';

type CrossTab = 'conferences' | 'papers' | 'reviews' | 'committee' | 'badges';

interface Props {
  tab: string;
  onPaperTitlesChange?: (titles: string[]) => void;
}

function textFrom(record: any, keys: string[]): string {
  if (typeof record === 'string') return record.trim();
  if (!record || typeof record !== 'object') return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function yearFrom(record: any): string {
  const direct = record?.year;
  if (typeof direct === 'number' || (typeof direct === 'string' && /^20\d{2}$/.test(direct.trim()))) {
    return String(direct);
  }
  const raw = textFrom(record, ['publishedOn', 'publishedAt', 'publicationDate', 'date', 'createdAt']);
  const match = raw.match(/\b(20\d{2})\b/);
  return match?.[1] || '';
}

function sourceLink(url: string | null | undefined, label = 'LinkedIn evidence') {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:underline mt-1"
    >
      <ExternalLink className="w-3 h-3" />
      {label}
    </a>
  );
}

function EvidenceBadge({ claimed = false, confidence }: { claimed?: boolean; confidence?: number }) {
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${claimed ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
      {claimed ? 'Member claim from LinkedIn' : 'LinkedIn signal'}{typeof confidence === 'number' ? ` · ${confidence}%` : ''}
    </span>
  );
}

function SignalCard({ signal }: { signal: LinkedInConferenceSignal }) {
  return (
    <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="font-bold text-xs text-slate-900">{signal.label}</h4>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {[signal.role, signal.year, signal.kind.replaceAll('_', ' ')].filter(Boolean).join(' • ')}
        </p>
        {sourceLink(signal.sourceUrl)}
      </div>
      <EvidenceBadge claimed={signal.memberClaimed} confidence={signal.confidence} />
    </div>
  );
}

export const LinkedInImportedTabSections: React.FC<Props> = ({ tab, onPaperTitlesChange }) => {
  const [profile, setProfile] = useState<LinkedInProfileEnrichment | null>(null);
  const [activity, setActivity] = useState<LinkedInConferenceActivity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([fetchLinkedInProfileEnrichment(), fetchLinkedInConferenceActivity()])
      .then(([profileResult, activityResult]) => {
        if (cancelled) return;
        if (profileResult.status === 'fulfilled') setProfile(profileResult.value.profile);
        if (activityResult.status === 'fulfilled') setActivity(activityResult.value.activity);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allSignals = activity?.conferenceActivity || [];
  const conferenceSignals = useMemo(
    () => allSignals.filter((s) => ['PAST_CONFERENCE', 'UPCOMING_CONFERENCE', 'CONFERENCE_ROLE', 'CONFERENCE_MENTION'].includes(s.kind)),
    [allSignals],
  );
  const paperSignals = useMemo(() => allSignals.filter((s) => s.kind === 'PAPER_ABSTRACT'), [allSignals]);
  const importedPublicationTitles = useMemo(
    () => (profile?.publications || [])
      .map((pub: any) => textFrom(pub, ['title', 'name', 'publicationTitle']))
      .map((title) => title.trim())
      .filter(Boolean),
    [profile],
  );

  useEffect(() => {
    if (!onPaperTitlesChange) return;
    const unique = Array.from(
      new Map(
        importedPublicationTitles.map((title) => [
          title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
          title,
        ]),
      ).values(),
    );
    onPaperTitlesChange(unique);
  }, [importedPublicationTitles, onPaperTitlesChange]);
  const committeeSignals = useMemo(
    () => allSignals.filter((s) =>
      s.kind === 'CONFERENCE_ROLE' &&
      s.memberClaimed &&
      !s.repostOrQuote &&
      s.confidence >= 90
    ),
    [allSignals],
  );
  const reviewSignals = useMemo(
    () => allSignals.filter((s) => s.kind === 'CONFERENCE_ROLE' && /reviewer/i.test(s.role || '')),
    [allSignals],
  );
  const badgeEvidence = useMemo(
    () => allSignals.filter((s) => s.memberClaimed && s.confidence >= 90 && ['PAST_CONFERENCE', 'CONFERENCE_ROLE', 'PAPER_ABSTRACT'].includes(s.kind)),
    [allSignals],
  );

  if (!['conferences', 'papers', 'reviews', 'committee', 'badges'].includes(tab)) return null;
  if (loading) {
    return (
      <div className="mb-6 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading imported LinkedIn evidence…
      </div>
    );
  }

  if (tab === 'conferences' && conferenceSignals.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Conference Activity</h3>
          <p className="text-[11px] text-slate-500 mt-1">Attendance, participation and conference roles found in the member's own public LinkedIn posts. These remain evidence-backed member claims until independently verified.</p>
        </div>
        <div className="space-y-2">{conferenceSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }

  if (tab === 'papers') {
    const publications = profile?.publications || [];
    const calls = activity?.callsForPapers || [];
    if (!publications.length && !paperSignals.length && !calls.length) return null;
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-5">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> Imported LinkedIn Papers & Abstracts</h3>
          <p className="text-[11px] text-slate-500 mt-1">Publications and conference-paper evidence imported from the public LinkedIn profile and its posts.</p>
        </div>
        {publications.length > 0 && (
          <div className="space-y-2">
            {publications.map((pub: any, index: number) => {
              const title = textFrom(pub, ['title', 'name', 'publicationTitle']) || 'LinkedIn publication';
              const venue = textFrom(pub, ['publisher', 'journal', 'venue', 'description']);
              const url = textFrom(pub, ['url', 'link', 'publicationUrl', 'doiUrl']);
              return (
                <div key={`${title}-${index}`} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <h4 className="font-bold text-xs text-slate-900">{title}</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">{[venue, yearFrom(pub)].filter(Boolean).join(' • ')}</p>
                  {sourceLink(url || profile?.linkedinUrl, url ? 'Publication source' : 'LinkedIn profile')}
                </div>
              );
            })}
          </div>
        )}
        {paperSignals.length > 0 && <div className="space-y-2">{paperSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>}
        {calls.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-slate-100">
            <h4 className="text-sm font-bold text-slate-900">Calls for Papers / Abstracts found on LinkedIn</h4>
            {calls.map((call) => (
              <div key={call.id} className="p-3 rounded-xl border border-amber-200 bg-amber-50">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="font-bold text-xs text-slate-900">{call.label}</div><div className="text-[10px] text-slate-500 mt-0.5">{[call.kind.replaceAll('_', ' '), call.year].filter(Boolean).join(' • ')}</div>{sourceLink(call.sourceUrl)}</div>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800">Official-site check required</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  if (tab === 'committee' && committeeSignals.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Conference Roles & Leadership Evidence</h3>
        <div className="space-y-2">{committeeSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }

  if (tab === 'reviews' && reviewSignals.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Linkedin className="w-4 h-4 text-[#0A66C2]" /> LinkedIn Reviewer Evidence</h3>
        <div className="space-y-2">{reviewSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }

  if (tab === 'badges' && badgeEvidence.length > 0) {
    return (
      <section className="mb-6 pb-6 border-b border-slate-100 space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-600" /> LinkedIn Evidence Awaiting Badge Verification</h3>
          <p className="text-[11px] text-slate-500 mt-1">Strong member claims are surfaced here as verification candidates, but LinkedIn alone does not create a ConferenceGate verified badge.</p>
        </div>
        <div className="space-y-2">{badgeEvidence.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div>
      </section>
    );
  }

  return null;
};

export default LinkedInImportedTabSections;
