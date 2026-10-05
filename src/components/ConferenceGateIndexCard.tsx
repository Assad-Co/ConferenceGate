import React, { useEffect, useState } from 'react';
import { Award, ShieldCheck } from 'lucide-react';
import { fetchMyProfessionalTrust, type ProfessionalTrustSummary } from '../api/professionalTrust';

export const ConferenceGateIndexCard: React.FC = () => {
  const [trust, setTrust] = useState<ProfessionalTrustSummary | null>(null);
  useEffect(() => { fetchMyProfessionalTrust().then(setTrust).catch(() => setTrust(null)); }, []);
  if (!trust) return null;
  return (
    <div className="p-5 rounded-2xl border border-blue-200 bg-white space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><Award className="w-5 h-5 text-blue-700" /><h4 className="text-sm font-bold text-slate-900">ConferenceGate Index</h4></div>
          <p className="text-[11px] text-slate-500 mt-1">Professional reputation score based only on stored ConferenceGate activity, organizer evaluations, verified reviews/roles and imported professional evidence.</p>
        </div>
        <div className="text-right"><div className="text-3xl font-extrabold text-blue-800">{trust.conferenceGateIndex}</div><div className="text-[10px] text-slate-400">/ 100</div></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]"><div className="p-2 rounded-lg border border-slate-200 bg-white"><b>{trust.evidence.organizerEvaluations}</b><br/>Organizer evaluations</div><div className="p-2 rounded-lg border border-slate-200 bg-white"><b>{trust.evidence.verifiedReviews}</b><br/>Verified reviews</div><div className="p-2 rounded-lg border border-slate-200 bg-white"><b>{trust.evidence.completedRoles}</b><br/>Completed roles</div><div className="p-2 rounded-lg border border-slate-200 bg-white"><b>{trust.evidence.certificationCount}</b><br/>Imported certificates</div></div>
      <div className={`text-xs font-bold flex items-center gap-2 ${trust.reviewerEligible ? 'text-emerald-700' : 'text-amber-700'}`}><ShieldCheck className="w-4 h-4" />{trust.eligibilityReason}</div>
    </div>
  );
};
