import React, { useMemo, useState } from 'react';
import { MessageSquareQuote, Send, Star } from 'lucide-react';
import {
  addSponsorshipDealUpdate,
  type SponsorshipDeal,
  type SponsorshipDealUpdate,
} from '../api/sponsors';

const CRITERIA = [
  ['communication', 'Communication'],
  ['responsiveness', 'Responsiveness'],
  ['coordination', 'Organizer coordination'],
  ['deliverables', 'Clarity of sponsorship deliverables'],
  ['eventExecution', 'Event execution & sponsor support'],
] as const;

type CriterionKey = (typeof CRITERIA)[number][0];

const RatingRow: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
    <span className="text-xs font-semibold text-slate-700">{label}</span>
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          onClick={() => onChange(score)}
          aria-label={`${label}: ${score} of 5`}
          className="cursor-pointer p-0.5"
        >
          <Star className={`w-5 h-5 ${score <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
        </button>
      ))}
    </div>
  </div>
);

export const SponsorOrganizerFeedbackSheet: React.FC<{
  deal: SponsorshipDeal;
  onSaved?: (update: SponsorshipDealUpdate) => void;
}> = ({ deal, onSaved }) => {
  const existingFeedback = useMemo(
    () => deal.updates.find((update) => update.text.startsWith('[SPONSOR_FEEDBACK]')),
    [deal.updates]
  );
  const [ratings, setRatings] = useState<Record<CriterionKey, number>>({
    communication: 0,
    responsiveness: 0,
    coordination: 0,
    deliverables: 0,
    eventExecution: 0,
  });
  const [overall, setOverall] = useState(0);
  const [wouldWorkAgain, setWouldWorkAgain] = useState<'yes' | 'no' | ''>('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = overall > 0 && Object.values(ratings).every((value) => value > 0) && Boolean(wouldWorkAgain);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete || saving || existingFeedback || saved) return;
    setSaving(true);
    setError(null);
    try {
      const text = [
        '[SPONSOR_FEEDBACK]',
        `Sponsor → Organizer feedback for ${deal.conferenceTitle}`,
        `Overall: ${overall}/5`,
        ...CRITERIA.map(([key, label]) => `${label}: ${ratings[key]}/5`),
        `Would work with this organizer again: ${wouldWorkAgain === 'yes' ? 'Yes' : 'No'}`,
        comments.trim() ? `Comments: ${comments.trim()}` : '',
      ].filter(Boolean).join(' · ');
      const update = await addSponsorshipDealUpdate(deal.id, { kind: 'note', text }, 'sponsor');
      setSaved(true);
      onSaved?.(update);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save feedback. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (existingFeedback || saved) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
          <MessageSquareQuote className="w-4 h-4" />
          Sponsor feedback submitted
        </div>
        <p className="text-[11px] text-emerald-700 mt-1">Your organizer feedback is saved in this completed Deal Room.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <MessageSquareQuote className="w-4 h-4 text-blue-700" />
          <h4 className="text-sm font-extrabold text-slate-900">Sponsor → Organizer Feedback Sheet</h4>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Available after a sponsorship is completed. Rate the organizer and event partnership experience.</p>
      </div>

      <RatingRow label="Overall experience" value={overall} onChange={setOverall} />
      <div>
        {CRITERIA.map(([key, label]) => (
          <RatingRow
            key={key}
            label={label}
            value={ratings[key]}
            onChange={(value) => setRatings((prev) => ({ ...prev, [key]: value }))}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-wide font-bold text-slate-500">Would you work with this organizer again?</label>
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setWouldWorkAgain(value)}
              className={`px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer ${wouldWorkAgain === value ? 'bg-blue-900 border-blue-900 text-white' : 'bg-white border-slate-200 text-slate-700'}`}
            >
              {value === 'yes' ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>

      <textarea
        rows={3}
        value={comments}
        onChange={(event) => setComments(event.target.value)}
        placeholder="Optional comments about communication, event execution, sponsor support, or future collaboration..."
        className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs"
      />

      {error && <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">{error}</div>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!complete || saving}
          className="px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
          {saving ? 'Submitting…' : 'Submit Organizer Feedback'}
        </button>
      </div>
    </form>
  );
};

export default SponsorOrganizerFeedbackSheet;
