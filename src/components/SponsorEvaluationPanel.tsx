import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquareQuote, Send, ShieldCheck } from 'lucide-react';
import type { Conference } from '../types';
import { fetchApplicantsForMyPackages, type ReviewableSponsor, type SponsorApplicant } from '../api/sponsors';

const SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
const DELIVERY = [
  'Did the sponsor deliver the agreed benefits, assets, or services?',
  'Did the sponsor meet agreed deadlines and event milestones?',
  'Was sponsor communication responsive and professional?',
  'Did the sponsor comply with branding, venue, and event requirements?',
  'Was the sponsor team adequately prepared for its booth, session, or activation?',
];
const PARTNERSHIP = [
  'Did the sponsor contribute positively to the attendee/event experience?',
  'Was collaboration with the organizer efficient and constructive?',
  'Did sponsor representatives behave professionally during the event?',
  'Did the delivered sponsorship provide appropriate value for the agreed package?',
  'Would you work with or recommend this sponsor for a future conference?',
];

const RatingTable: React.FC<{ title: string; prefix: string; questions: string[]; ratings: Record<string, number>; onRate: (key: string, value: number) => void }> = ({ title, prefix, questions, ratings, onRate }) => (
  <div className="space-y-2 overflow-x-auto">
    <div className="text-xs font-bold text-slate-900">{title}</div>
    <table className="w-full min-w-[660px] text-left">
      <thead><tr><th className="w-[44%]" />{SCALE.map((label) => <th key={label} className="text-center text-[9px] uppercase font-bold text-slate-400 px-1 pb-1">{label}</th>)}</tr></thead>
      <tbody>{questions.map((question, index) => {
        const key = `${prefix}_${index}`;
        return <tr key={key} className="border-t border-slate-100">
          <td className="py-2.5 pr-3 text-[11px] text-slate-700">{question}</td>
          {SCALE.map((_, option) => <td key={option} className="text-center py-2 px-1"><button type="button" onClick={() => onRate(key, option + 1)} className="cursor-pointer" aria-label={`${question}: ${SCALE[option]}`}><span className={`inline-block w-4 h-4 rounded-full border-2 ${ratings[key] === option + 1 ? 'bg-blue-600 border-blue-600' : 'border-slate-300 hover:border-blue-400'}`} /></button></td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>
);

export const SponsorEvaluationPanel: React.FC<{
  sponsors: ReviewableSponsor[];
  conferences: Conference[];
  onSubmit: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string; ratings: Record<string, number>; overallScore: number }) => void | Promise<void>;
}> = ({ sponsors, conferences, onSubmit }) => {
  const [sponsorId, setSponsorId] = useState(sponsors[0]?.id || '');
  const [conferenceTitle, setConferenceTitle] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [relationshipsLoading, setRelationshipsLoading] = useState(true);
  const [approvedLinks, setApprovedLinks] = useState<SponsorApplicant[]>([]);

  useEffect(() => {
    let cancelled = false;
    setRelationshipsLoading(true);
    fetchApplicantsForMyPackages()
      .then((items) => {
        if (!cancelled) setApprovedLinks(items.filter((item) => item.status === 'Approved'));
      })
      .catch(() => {
        if (!cancelled) setApprovedLinks([]);
      })
      .finally(() => {
        if (!cancelled) setRelationshipsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const eligibleConferenceTitles = useMemo(() => {
    const titles = approvedLinks
      .filter((item) => item.sponsor?.id === sponsorId && item.status === 'Approved')
      .map((item) => item.conferenceTitle)
      .filter(Boolean);
    return [...new Set(titles)];
  }, [approvedLinks, sponsorId]);

  const eligibleConferences = useMemo(() => {
    const ownedByTitle = new Map(conferences.map((conference) => [conference.title, conference]));
    return eligibleConferenceTitles.map((title) => ownedByTitle.get(title) || { id: title, title } as Conference);
  }, [conferences, eligibleConferenceTitles]);

  useEffect(() => {
    if (!eligibleConferenceTitles.length) {
      setConferenceTitle('');
      return;
    }
    if (!eligibleConferenceTitles.includes(conferenceTitle)) {
      setConferenceTitle(eligibleConferenceTitles[0]);
    }
  }, [conferenceTitle, eligibleConferenceTitles]);

  const values = Object.values(ratings);
  const overallScore = useMemo(() => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, [ratings]);
  const complete = values.length === DELIVERY.length + PARTNERSHIP.length;
  const verifiedRelationship = Boolean(sponsorId && conferenceTitle && eligibleConferenceTitles.includes(conferenceTitle));

  if (!sponsors.length) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sponsorId || !conferenceTitle || !complete || !verifiedRelationship || sending) return;
    setSending(true);
    try {
      const legacyRating = Math.max(1, Math.min(5, Math.round((overallScore / 6) * 5)));
      await onSubmit(sponsorId, { conferenceTitle, rating: legacyRating, comment: comment.trim(), ratings, overallScore: Number(overallScore.toFixed(2)) });
      setRatings({});
      setComment('');
    } finally { setSending(false); }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><MessageSquareQuote className="w-5 h-5 text-blue-600" /><h3 className="font-bold text-sm text-slate-900">Sponsor Evaluation</h3></div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold"><ShieldCheck className="w-3 h-3" />Verified relationships only</span>
      </div>
      <p className="text-xs text-slate-500 -mt-2">Only sponsor/conference pairs backed by an approved ConferenceGate sponsorship can be evaluated here. The completed review becomes part of the sponsor's reputation history alongside reviews from other organizers.</p>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={sponsorId}
            onChange={(e) => {
              setSponsorId(e.target.value);
              setRatings({});
              setComment('');
            }}
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
          >
            {sponsors.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
          </select>
          <select
            value={conferenceTitle}
            onChange={(e) => setConferenceTitle(e.target.value)}
            disabled={relationshipsLoading || eligibleConferences.length === 0}
            className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium disabled:opacity-50"
          >
            {relationshipsLoading && <option value="">Checking approved relationship…</option>}
            {!relationshipsLoading && eligibleConferences.length === 0 && <option value="">No approved conference relationship</option>}
            {eligibleConferences.map((conference) => <option key={conference.id} value={conference.title}>{conference.title}</option>)}
          </select>
        </div>
        {!relationshipsLoading && sponsorId && eligibleConferences.length === 0 && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">This sponsor is not linked to an approved sponsorship for one of your current conferences, so a verified review cannot be submitted.</div>
        )}
        <RatingTable title="Delivery & Reliability" prefix="delivery" questions={DELIVERY} ratings={ratings} onRate={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))} />
        <RatingTable title="Partnership & Event Experience" prefix="partnership" questions={PARTNERSHIP} ratings={ratings} onRate={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))} />
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional organizer comments about the sponsor's delivery, collaboration, staff, or event contribution..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500">{complete ? <>Overall: <span className="font-bold text-blue-700">{overallScore.toFixed(1)} / 6</span>{verifiedRelationship && <span className="ml-2 text-emerald-700 font-bold">· Verified sponsorship</span>}</> : <>Complete all {DELIVERY.length + PARTNERSHIP.length} criteria ({values.length}/{DELIVERY.length + PARTNERSHIP.length})</>}</div>
          <button type="submit" disabled={!complete || sending || !sponsorId || !conferenceTitle || !verifiedRelationship || relationshipsLoading} className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-40"><Send className="w-3.5 h-3.5" />{sending ? 'Submitting…' : 'Submit Verified Sponsor Evaluation'}</button>
        </div>
      </form>
    </div>
  );
};

export default SponsorEvaluationPanel;