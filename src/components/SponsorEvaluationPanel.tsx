import React, { useMemo, useState } from 'react';
import { MessageSquareQuote, Send } from 'lucide-react';
import type { Conference } from '../types';
import type { ReviewableSponsor } from '../api/sponsors';

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
  const [conferenceTitle, setConferenceTitle] = useState(conferences[0]?.title || '');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const values = Object.values(ratings);
  const overallScore = useMemo(() => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, [ratings]);
  const complete = values.length === DELIVERY.length + PARTNERSHIP.length;

  if (!sponsors.length) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sponsorId || !conferenceTitle || !complete || sending) return;
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
      <div className="flex items-center gap-2"><MessageSquareQuote className="w-5 h-5 text-blue-600" /><h3 className="font-bold text-sm text-slate-900">Sponsor Evaluation</h3></div>
      <p className="text-xs text-slate-500 -mt-2">Use the same Very Poor → Excellent evaluation approach used for conference feedback. The completed review becomes part of the sponsor's ConferenceGate profile and can be seen alongside reviews from other organizers.</p>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">{sponsors.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}</select>
          <select value={conferenceTitle} onChange={(e) => setConferenceTitle(e.target.value)} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">{conferences.map((c) => <option key={c.id} value={c.title}>{c.title}</option>)}</select>
        </div>
        <RatingTable title="Delivery & Reliability" prefix="delivery" questions={DELIVERY} ratings={ratings} onRate={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))} />
        <RatingTable title="Partnership & Event Experience" prefix="partnership" questions={PARTNERSHIP} ratings={ratings} onRate={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))} />
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional organizer comments about the sponsor's delivery, collaboration, staff, or event contribution..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500">{complete ? <>Overall: <span className="font-bold text-blue-700">{overallScore.toFixed(1)} / 6</span></> : <>Complete all {DELIVERY.length + PARTNERSHIP.length} criteria ({values.length}/{DELIVERY.length + PARTNERSHIP.length})</>}</div>
          <button type="submit" disabled={!complete || sending || !sponsorId || !conferenceTitle} className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-40"><Send className="w-3.5 h-3.5" />{sending ? 'Submitting…' : 'Submit Sponsor Evaluation'}</button>
        </div>
      </form>
    </div>
  );
};

export default SponsorEvaluationPanel;
