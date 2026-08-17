import React, { useState } from 'react';
import { X, ShieldCheck, Copy, CheckCircle2, Award, ExternalLink } from 'lucide-react';
import { UserProfile } from '../types';

interface DigitalBadgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
}

export const DigitalBadgeModal: React.FC<DigitalBadgeModalProps> = ({
  isOpen,
  onClose,
  userProfile,
}) => {
  if (!isOpen) return null;

  const [copied, setCopied] = useState(false);
  const badgeEmbedCode = `<iframe src="https://conferencegate.com/embed/badge/${userProfile.id}" width="300" height="180" frameborder="0"></iframe>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(badgeEmbedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <Award className="w-5 h-5 text-blue-500" />
            <span>Verified Digital Badge Widget</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Badge Preview Card */}
        <div className="p-6 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl border border-slate-800 text-white space-y-4 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-blue-400 bg-blue-500/20 px-2.5 py-0.5 rounded-full border border-blue-400/30">
              <Award className="w-3 h-3" />
              Verified Conference Identity
            </div>
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>

          <div className="flex items-center gap-4">
            <img src={userProfile.avatar} alt={userProfile.name} className="w-14 h-14 rounded-2xl object-cover ring-2 ring-blue-400/50" />
            <div>
              <h4 className="font-extrabold text-base text-white">{userProfile.name}</h4>
              <p className="text-xs text-slate-300">{userProfile.organization}</p>
              <p className="text-[10px] text-blue-300 font-semibold mt-0.5">
                {userProfile.contributions.conferencesAttended} Conferences Attended • Reviewer Kudos: +
                {userProfile.contributions.reviewerKudos}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400">
            <span>Verified by Conference Gate System</span>
            <span className="text-white font-bold">ID: #CG-{userProfile.id.slice(-8).toUpperCase()}</span>
          </div>
        </div>

        {/* Share & Embed Code */}
        <div className="space-y-2 text-xs">
          <label className="font-bold text-slate-900 uppercase text-[10px]">Embed Code for Website / LinkedIn</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={badgeEmbedCode}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px]"
            />
            <button
              onClick={handleCopy}
              className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-xl shrink-0 cursor-pointer flex items-center gap-1"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
