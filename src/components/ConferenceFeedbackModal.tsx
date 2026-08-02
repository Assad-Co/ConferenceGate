import React, { useMemo, useState } from 'react';
import { X, MessageSquare, Mic2, CalendarCheck2, Sparkles, CalendarDays, Send } from 'lucide-react';
import { useToast } from './Toast';

interface ConferenceFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  conferenceTitle: string;
}

const SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

const SPEAKER_QUESTIONS = [
  'Did the speaker/facilitator explain the material clearly?',
  'Was the speaker willing to answer your questions?',
  'Did the speaker demonstrate strong subject-matter expertise?',
  'Would you attend another session led by this speaker?',
  'Would you recommend this speaker to fellow professionals?',
];

const EVENT_QUESTIONS = [
  'Were the session/event objectives clearly stated at the outset?',
  'Were the objectives met?',
  'Was the content appropriate for your interests and level?',
  'Do you consider this event good value for the registration cost?',
  'Would you recommend this event to fellow professionals?',
];

type Ratings = Record<string, number>;

const RatingTable: React.FC<{
  title: string;
  icon: React.ElementType;
  questions: string[];
  sectionKey: string;
  ratings: Ratings;
  onRate: (key: string, value: number) => void;
}> = ({ title, icon: Icon, questions, sectionKey, ratings, onRate }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
      <Icon className="w-4 h-4 text-blue-600" />
      <span>{title}</span>
    </div>
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-left min-w-[520px]">
        <thead>
          <tr>
            <th className="w-1/2" />
            {SCALE.map((label) => (
              <th key={label} className="text-center text-[9px] font-bold text-slate-400 uppercase tracking-wide pb-1 px-1">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => {
            const key = `${sectionKey}_${i}`;
            return (
              <tr key={key} className="border-t border-slate-100">
                <td className="py-2 pr-2 text-xs text-slate-700">{q}</td>
                {SCALE.map((_, optIdx) => (
                  <td key={optIdx} className="text-center py-2 px-1">
                    <button
                      type="button"
                      onClick={() => onRate(key, optIdx + 1)}
                      className="cursor-pointer"
                      aria-label={`${q}: ${SCALE[optIdx]}`}
                    >
                      <span
                        className={`inline-block w-4 h-4 rounded-full border-2 transition-colors ${
                          ratings[key] === optIdx + 1
                            ? 'bg-blue-600 border-blue-600'
                            : 'border-slate-300 hover:border-blue-400'
                        }`}
                      />
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export const ConferenceFeedbackModal: React.FC<ConferenceFeedbackModalProps> = ({
  isOpen,
  onClose,
  conferenceTitle,
}) => {
  const { showToast } = useToast();
  const [ratings, setRatings] = useState<Ratings>({});
  const [comment, setComment] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');

  const overall = useMemo(() => {
    const values: number[] = Object.values(ratings);
    if (values.length === 0) return null;
    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
    return { avg, label: SCALE[Math.min(SCALE.length - 1, Math.round(avg) - 1)] };
  }, [ratings]);

  if (!isOpen) return null;

  const reset = () => {
    setRatings({});
    setComment('');
    setRecipientEmail('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleRate = (key: string, value: number) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(ratings).length === 0) return;
    const ratingSummary = overall ? ` — overall rating: ${overall.label}.` : '.';
    showToast({
      type: 'success',
      title: 'Feedback submitted',
      message: recipientEmail
        ? `Thanks for reviewing "${conferenceTitle}"${ratingSummary} A copy was sent to ${recipientEmail}.`
        : `Thanks for reviewing "${conferenceTitle}"${ratingSummary} Organizers use this to improve future sessions.`,
    });
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between sticky top-0 bg-white pb-1">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            <span>Conference & Workshop Feedback</span>
          </div>
          <button onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
            Conference / Workshop
          </label>
          <div className="flex items-center justify-between gap-2 w-full px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700">
            <span>{conferenceTitle}</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide shrink-0">Auto-filled</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <RatingTable
            title="Facilitator / Speaker Evaluation"
            icon={Mic2}
            questions={SPEAKER_QUESTIONS}
            sectionKey="speaker"
            ratings={ratings}
            onRate={handleRate}
          />

          <RatingTable
            title="Conference / Workshop Experience"
            icon={CalendarCheck2}
            questions={EVENT_QUESTIONS}
            sectionKey="event"
            ratings={ratings}
            onRate={handleRate}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Overall Feedback
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What stood out — sessions, speakers, organization, venue? (optional)"
              className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden leading-relaxed"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-blue-600" />
              Send a copy to organizer / employer (optional)
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="organizer@conference.com or hr@yourcompany.com"
              className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden"
            />
          </div>

          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100">
            <div className="text-xs text-slate-500 pt-3">
              {overall ? (
                <span>
                  Overall Rating:{' '}
                  <span className="font-bold text-blue-700">
                    {overall.label} ({overall.avg.toFixed(1)}/6)
                  </span>
                </span>
              ) : (
                <span>Rate at least one question to submit.</span>
              )}
            </div>
            <button
              type="submit"
              disabled={Object.keys(ratings).length === 0}
              className="mt-3 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-40 shrink-0"
            >
              Submit Feedback
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
