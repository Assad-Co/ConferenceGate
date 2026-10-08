import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { fetchMyProfessionalTrust, type ProfessionalTrustSummary } from '../api/professionalTrust';

export const ConferenceGateIndexCard: React.FC = () => {
  const [trust, setTrust] = useState<ProfessionalTrustSummary | null>(null);
  useEffect(() => { fetchMyProfessionalTrust().then(setTrust).catch(() => setTrust(null)); }, []);
  if (!trust) return null;
  const verifiedEvidenceCount =
    trust.evidence.organizerEvaluations + trust.evidence.verifiedReviews + trust.evidence.completedRoles;
  return (
    <div className="p-5 rounded-2xl border border-blue-200 bg-white space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-700" /><h4 className="text-sm font-bold text-slate-900">Verified Conference Record</h4></div>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">Evidence-backed ConferenceGate activity is shown directly instead of being compressed into an arbitrary reputation score. Imported credentials remain source-labeled and are not silently upgraded to verified activity.</p>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2 text-right">
          <div className="text-2xl font-extrabold text-emerald-800">{verifiedEvidenceCount}</div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">verified records</div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.organizerEvaluations}</b><br/>Organizer evaluations</div>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.verifiedReviews}</b><br/>Verified peer reviews</div>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.completedRoles}</b><br/>Organizer-confirmed roles</div>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><b className="text-base text-slate-900">{trust.evidence.certificationCount}</b><br/>Imported credentials</div>
      </div>
      <div className={`text-xs font-bold flex items-center gap-2 ${trust.reviewerEligible ? 'text-emerald-700' : 'text-amber-700'}`}><ShieldCheck className="w-4 h-4" />{trust.eligibilityReason}</div>
    </div>
  );
};
