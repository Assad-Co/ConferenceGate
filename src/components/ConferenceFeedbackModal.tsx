import React, { useEffect, useMemo, useState } from 'react';
import { X, MessageSquare, Mic2, CalendarCheck2, Sparkles, CalendarDays, Send, User, Building2, UserCog, Tag } from 'lucide-react';
import { useToast } from './Toast';
import { ConferenceRole } from '../types';
import { submitConferenceFeedback } from '../api/activity';

interface ConferenceFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  conferenceId?: string;
  conferenceTitle: string;
  organizerName?: string;
  eventDate?: string;
  participantName?: string;
  participantCompany?: string;
  defaultRole?: ConferenceRole;
}

const SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

const ROLE_OPTIONS: ConferenceRole[] = [
  'Presenter',
  'Speaker',
  'Keynote',
  'Technical Committee',
  'Reviewer',
  'Session Chair',
  'Moderator',
  'Author',
  'Organizer Rep',
  'Attendee',
];

const AutoFilledField: React.FC<{ icon: React.ElementType; label: string; value: string }> = ({
  icon: Icon,
  label,
  value,
}) => (
  <div className="space-y-1.5">
    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-blue-600" />
      {label}
    </label>
    <div className="flex items-center justify-between gap-2 w-full px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700">
      <span className="truncate" title={value}>{value || '—'}</span>
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide shrink-0">Auto-filled</span>
    </div>
  </div>
);

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
  conferenceId,
  conferenceTitle,
  organizerName = '',
  eventDate = '',
  participantName = '',
  participantCompany = '',
  defaultRole,
}) => {
  const { showToast } = useToast();
  const [ratings, setRatings] = useState<Ratings>({});
  const [comment, setComment] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [role, setRole] = useState<ConferenceRole>(defaultRole || 'Attendee');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setRole(defaultRole || 'Attendee');
  }, [isOpen, defaultRole]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(ratings).length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await submitConferenceFeedback({
        conferenceId,
        conferenceTitle,
        role,
        ratings,
        comment: comment.trim() || undefined,
        recipientEmail: recipientEmail.trim() || undefined,
      });
      const ratingSummary = overall ? ` — overall rating: ${overall.label}.` : '.';
      showToast({
        type: 'success',
        title: 'Feedback submitted',
        message: `Thanks for reviewing "${conferenceTitle}"${ratingSummary} Your response has been recorded for the organizing committee.`,
      });
      handleClose();
    } catch (err: any) {
      showToast({ type: 'info', title: 'Feedback not submitted', message: err.message || 'Please try again.' });
    } finally {
      setSubmitting(false);
    }
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

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AutoFilledField icon={CalendarDays} label="Conference / Workshop" value={conferenceTitle} />
            <AutoFilledField icon={Building2} label="Name of Organizer" value={organizerName} />
            <AutoFilledField icon={CalendarCheck2} label="Date of Event" value={eventDate} />
            <AutoFilledField icon={User} label="Name of Participant" value={participantName} />
          </div>
          <AutoFilledField icon={Building2} label="Company / Organization Affiliated With" value={participantCompany} />

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <UserCog className="w-3.5 h-3.5 text-blue-600" />
              Your Role at This Event
            </label>
            <div className="relative">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ConferenceRole)}
                className="w-full appearance-none px-3 py-2.5 bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden cursor-pointer"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Tag className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
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
              Contact email for follow-up (optional)
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="organizer@conference.com or hr@yourcompany.com"
              className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden"
            />
            <p className="text-[10px] text-slate-400">Saved with your feedback record — no email is sent automatically.</p>
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
              disabled={Object.keys(ratings).length === 0 || submitting}
              className="mt-3 px-6 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-40 shrink-0"
            >
              {submitting ? 'Submitting…' : 'Submit Feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
