import React, { useEffect, useState } from 'react';
import { Award, Download, FileText, ShieldCheck, Star, Upload } from 'lucide-react';
import type { AbstractSubmission, Conference } from '../types';
import {
  downloadSubmissionDocument,
  evaluateConference,
  fetchMyProfessionalTrust,
  fetchSubmissionDocuments,
  uploadSubmissionDocument,
  type ProfessionalTrustSummary,
  type SubmissionDocument,
} from '../api/professionalTrust';

export const ReviewerEligibilityCard: React.FC = () => {
  const [trust, setTrust] = useState<ProfessionalTrustSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchMyProfessionalTrust().then(setTrust).catch((e) => setError(e?.message || 'Could not load reviewer eligibility.')); }, []);
  if (error) return <div className="p-4 rounded-2xl border border-rose-200 bg-white text-xs text-rose-700">{error}</div>;
  if (!trust) return <div className="p-4 rounded-2xl border border-slate-200 bg-white text-xs text-slate-400">Checking Professional reviewer eligibility…</div>;
  return <div className={`p-5 rounded-2xl border bg-white ${trust.reviewerEligible ? 'border-emerald-200' : 'border-amber-200'}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2"><ShieldCheck className={`w-5 h-5 ${trust.reviewerEligible ? 'text-emerald-600' : 'text-amber-600'}`} /><h3 className="font-bold text-sm text-slate-900">{trust.reviewerEligible ? 'Eligible for the open Reviewer Portal' : 'Reviewer eligibility not yet met'}</h3></div><p className="text-xs text-slate-600 mt-1 max-w-3xl">{trust.eligibilityReason}</p></div>
      <div className="text-right"><div className="text-[10px] font-bold uppercase text-slate-400">ConferenceGate Index</div><div className="text-2xl font-extrabold text-blue-800">{trust.conferenceGateIndex}</div><div className="text-[10px] capitalize text-slate-500">{trust.credentialLevel} credential</div></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2 text-[10px]"><span className="px-2 py-1 rounded-full bg-slate-50 border border-slate-200">{trust.evidence.publicationCount} publications</span><span className="px-2 py-1 rounded-full bg-slate-50 border border-slate-200">{trust.evidence.experienceYears} yrs experience</span><span className="px-2 py-1 rounded-full bg-slate-50 border border-slate-200">{trust.evidence.certificationCount} certifications</span><span className="px-2 py-1 rounded-full bg-slate-50 border border-slate-200">{trust.evidence.verifiedReviews} verified reviews</span></div>
  </div>;
};

export const ReviewerDocumentWorkflow: React.FC<{ submission: AbstractSubmission }> = ({ submission }) => {
  const [documents, setDocuments] = useState<SubmissionDocument[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => fetchSubmissionDocuments(submission.id).then(setDocuments).catch(() => setDocuments([]));
  useEffect(() => { refresh(); }, [submission.id]);
  const upload = async (file?: File) => {
    if (!file) return;
    try { await uploadSubmissionDocument(submission.id, 'reviewer_return', file); setMessage('Reviewed file sent securely to the organizer.'); refresh(); }
    catch (e: any) { setMessage(e?.message || 'Could not upload the reviewed file.'); }
  };
  return <div className="p-5 rounded-2xl border border-blue-100 bg-white space-y-3">
    <div><h4 className="font-bold text-sm text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-700" />Abstract files</h4><p className="text-[11px] text-slate-500 mt-1">Download the author's submitted file, complete your review, then return a PDF/DOC/DOCX (max 5 MB). The organizer is notified automatically.</p></div>
    <div className="space-y-2">{documents.length === 0 ? <p className="text-xs text-slate-400">No file has been attached yet. You can still review the abstract text below.</p> : documents.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-white"><div><div className="text-xs font-bold text-slate-800">{doc.fileName}</div><div className="text-[10px] text-slate-400">{doc.kind.replaceAll('_',' ')} · {(doc.byteSize / 1024).toFixed(0)} KB</div></div><button type="button" onClick={() => downloadSubmissionDocument(submission.id, doc.id)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold cursor-pointer"><Download className="w-3.5 h-3.5" />Download</button></div>)}</div>
    <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold cursor-pointer"><Upload className="w-4 h-4" />Return reviewed file<input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
    {message && <div className="text-xs font-semibold text-blue-700">{message}</div>}
  </div>;
};

export const ProfessionalConferenceEvaluation: React.FC<{ conferences: Conference[] }> = ({ conferences }) => {
  const [conferenceId, setConferenceId] = useState('');
  const [ratings, setRatings] = useState({ scientificQuality: 5, organization: 5, networking: 5, professionalValue: 5 });
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const selected = conferences.find((c) => c.id === conferenceId);
  const submit = async () => {
    if (!selected) return;
    try { const result = await evaluateConference(selected.id, { conferenceTitle: selected.title, role: 'Professional', ratings, comment }); setMessage(`Conference evaluation submitted — ${result.overallScore.toFixed(1)}/5.`); }
    catch (e: any) { setMessage(e?.message || 'Could not submit conference evaluation.'); }
  };
  return <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
    <div><h3 className="font-bold text-sm text-slate-900 flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" />Professional Conference Evaluation</h3><p className="text-[11px] text-slate-500 mt-1">Professionals can rate scientific quality, organization, networking and professional value. These are kept separate from sponsor reviews.</p></div>
    <select value={conferenceId} onChange={(e) => setConferenceId(e.target.value)} className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs"><option value="">Select conference to evaluate</option>{conferences.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{(Object.keys(ratings) as Array<keyof typeof ratings>).map((key) => <label key={key} className="text-[10px] font-bold text-slate-500 uppercase">{key.replace(/([A-Z])/g,' $1')}<select value={ratings[key]} onChange={(e) => setRatings({ ...ratings, [key]: Number(e.target.value) })} className="mt-1 w-full p-2 rounded-lg border border-slate-200 bg-white text-xs">{[5,4,3,2,1].map((n) => <option key={n} value={n}>{n}/5</option>)}</select></label>)}</div>
    <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional professional assessment" className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs" />
    <button disabled={!selected} onClick={submit} className="px-4 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer">Submit conference evaluation</button>
    {message && <div className="text-xs font-semibold text-emerald-700">{message}</div>}
  </div>;
};
