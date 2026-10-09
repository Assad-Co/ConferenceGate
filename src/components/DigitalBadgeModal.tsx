import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Copy, CheckCircle2, Award, Loader2 } from 'lucide-react';
import { UserProfile } from '../types';
import { fetchMyProfessionalTrust, type ProfessionalTrustSummary } from '../api/professionalTrust';

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
  const [copied, setCopied] = useState(false);
  const [trust, setTrust] = useState<ProfessionalTrustSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    fetchMyProfessionalTrust()
      .then((next) => {
        if (!cancelled) setTrust(next);
      })
      .catch(() => {
        if (!cancelled) setTrust(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const verifiedReviews = trust?.evidence.verifiedReviews ?? 0;
  const completedRoles = trust?.evidence.completedRoles ?? 0;
  const organizerEvaluations = trust?.evidence.organizerEvaluations ?? 0;
  const verifiedRecordCount = verifiedReviews + completedRoles + organizerEvaluations;
  const badgeLabel = verifiedRecordCount > 0 ? 'Verified Conference Record' : 'ConferenceGate Professional Record';
  const recordSummary = [
    `ConferenceGate professional record for ${userProfile.name}${userProfile.organization ? ` — ${userProfile.organization}` : ''}.`,
    `Verified peer reviews: ${verifiedReviews}.`,
    `Organizer-confirmed completed roles: ${completedRoles}.`,
    `Organizer evaluations: ${organizerEvaluations}.`,
    trust?.evidence.linkedinVerified ? 'LinkedIn identity source connected.' : 'Imported and self-reported evidence is kept separate from verified ConferenceGate activity.',
  ].join(' ');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recordSummary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <Award className="w-5 h-5 text-blue-500" />
            <span>ConferenceGate Professional Badge</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer" aria-label="Close professional badge">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 bg-gradient-to-br from-blue-50 via-sky-50 to-cyan-50 rounded-2xl border border-blue-200 text-slate-900 space-y-4 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-blue-700 bg-white/80 px-2.5 py-0.5 rounded-full border border-blue-200">
              <Award className="w-3 h-3" />
              {badgeLabel}
            </div>
            {verifiedRecordCount > 0 && <ShieldCheck className="w-5 h-5 text-emerald-600" />}
          </div>

          <div className="flex items-center gap-4">
            <img src={userProfile.avatar} alt={userProfile.name} className="w-14 h-14 rounded-2xl object-cover ring-2 ring-blue-400/50" />
            <div className="min-w-0">
              <h4 className="font-extrabold text-base text-slate-950 truncate">{userProfile.name}</h4>
              <p className="text-xs text-slate-600 truncate">{userProfile.organization}</p>
              <p className="text-[10px] text-slate-500 font-semibold mt-1">
                {verifiedRecordCount > 0
                  ? `${verifiedRecordCount} verified ConferenceGate record${verifiedRecordCount === 1 ? '' : 's'}`
                  : 'No verified ConferenceGate activity yet'}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading verified ConferenceGate activity…
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-blue-100 bg-white/70 p-2">
                <div className="text-base font-extrabold text-slate-900">{verifiedReviews}</div>
                <div className="text-[9px] text-slate-500">Peer reviews</div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-white/70 p-2">
                <div className="text-base font-extrabold text-slate-900">{completedRoles}</div>
                <div className="text-[9px] text-slate-500">Confirmed roles</div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-white/70 p-2">
                <div className="text-base font-extrabold text-slate-900">{organizerEvaluations}</div>
                <div className="text-[9px] text-slate-500">Evaluations</div>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-blue-200 flex items-center justify-between gap-3 text-[10px] text-slate-500">
            <span>ConferenceGate evidence only · imported records stay source-labeled</span>
            <span className="text-slate-900 font-bold shrink-0">ID: #CG-{userProfile.id.slice(-8).toUpperCase()}</span>
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Share a plain-language summary of the ConferenceGate activity shown above. This does not convert LinkedIn imports, attendance claims, or other self-reported records into verified credentials.
          </p>
          <button
            type="button"
            onClick={handleCopy}
            disabled={loading}
            className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-xl cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Summary Copied' : 'Copy Record Summary'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
