import React, { useState } from 'react';
import { X, Star, MessageSquare } from 'lucide-react';
import { useToast } from './Toast';

interface ConferenceFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  conferenceTitle: string;
}

export const ConferenceFeedbackModal: React.FC<ConferenceFeedbackModalProps> = ({
  isOpen,
  onClose,
  conferenceTitle,
}) => {
  const { showToast } = useToast();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');

  if (!isOpen) return null;

  const reset = () => {
    setRating(0);
    setHoverRating(0);
    setComment('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;
    showToast({
      type: 'success',
      title: 'Feedback submitted',
      message: `Thanks for reviewing "${conferenceTitle}" — organizers use this to improve future sessions.`,
    });
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            <span>Conference & Workshop Feedback</span>
          </div>
          <button onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <p className="text-xs text-slate-500">How was your experience at</p>
          <p className="text-sm font-bold text-slate-900">{conferenceTitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHoverRating(n)}
                onMouseLeave={() => setHoverRating(0)}
                className="cursor-pointer p-0.5"
              >
                <Star
                  className={`w-8 h-8 transition-colors ${
                    n <= (hoverRating || rating) ? 'fill-blue-500 text-blue-500' : 'text-slate-300'
                  }`}
                />
              </button>
            ))}
          </div>

          <textarea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What stood out — sessions, speakers, organization, venue? (optional)"
            className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden leading-relaxed"
          />

          <button
            type="submit"
            disabled={rating === 0}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-40"
          >
            Submit Feedback
          </button>
        </form>
      </div>
    </div>
  );
};
