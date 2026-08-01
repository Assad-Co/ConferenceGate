import React, { useState } from 'react';
import { X, Calendar, Clock, Send, MessageSquare, CheckCircle2, Users } from 'lucide-react';

interface NetworkingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NetworkingModal: React.FC<NetworkingModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const [date, setDate] = useState('2026-10-16');
  const [time, setTime] = useState('14:30');
  const [note, setNote] = useState('');
  const [scheduled, setScheduled] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setScheduled(true);
    setTimeout(() => {
      setScheduled(false);
      onClose();
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <Users className="w-5 h-5 text-blue-600" />
            <span>Schedule 1-on-1 B2B Meeting</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
            <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80" alt="Dr. Sarah" className="w-10 h-10 rounded-full object-cover" />
            <div>
              <div className="font-bold text-slate-900">Dr. Sarah Ahmed</div>
              <div className="text-[10px] text-slate-500">Aramco Innovation Labs • Subsurface AI Lead</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-900 uppercase text-[10px]">Select Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg" />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-900 uppercase text-[10px]">Time Slot</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-900 uppercase text-[10px]">Meeting Topic / Intro Note</label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hi Dr. Sarah, I would love to discuss your keynote on AI reservoir modeling..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
            ></textarea>
          </div>

          {scheduled && (
            <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Meeting invitation dispatched to Dr. Sarah!</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-xs">
              Send Meeting Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
