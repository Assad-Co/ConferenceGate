import React, { useEffect, useMemo, useState } from 'react';
import { Award, Briefcase, CheckCircle2, Plus, Search, Send, ShieldCheck, Star, Users } from 'lucide-react';
import {
  createProfessionalInvitation,
  searchProfessionals,
  type ProfessionalDirectoryProfile,
} from '../api/activity';
import {
  createRecruitmentDraft,
  evaluateProfessional,
  fetchRecruitmentDrafts,
  type ConferenceRecruitmentDraft,
} from '../api/professionalTrust';
import type { Conference } from '../types';

interface Props {
  conferences: Conference[];
  onContinueToWizard: (draft: ConferenceRecruitmentDraft) => void;
}

export const ProfessionalRecruitmentPanel: React.FC<Props> = ({ conferences, onContinueToWizard }) => {
  const [drafts, setDrafts] = useState<Array<ConferenceRecruitmentDraft & { acceptedCount?: number }>>([]);
  const [draftForm, setDraftForm] = useState({ title: '', description: '', startDate: '', endDate: '', city: '', country: '', topics: '', officialUrl: '' });
  const [selectedId, setSelectedId] = useState('');
  const [roleType, setRoleType] = useState<'committee' | 'chair' | 'speaker'>('committee');
  const [query, setQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [minExperienceYears, setMinExperienceYears] = useState(0);
  const [minPublications, setMinPublications] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [reviewerEligibleOnly, setReviewerEligibleOnly] = useState(false);
  const [results, setResults] = useState<ProfessionalDirectoryProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invited, setInvited] = useState<Record<string, boolean>>({});
  const [evaluationTarget, setEvaluationTarget] = useState<ProfessionalDirectoryProfile | null>(null);
  const [evaluation, setEvaluation] = useState({ expertise: 5, reliability: 5, communication: 5, contribution: 5, comment: '' });

  const refreshDrafts = () => fetchRecruitmentDrafts().then((items: any) => setDrafts(items)).catch(() => {});
  useEffect(() => { refreshDrafts(); }, []);

  const selectedDraft = drafts.find((item) => item.id === selectedId);
  const selectedConference = conferences.find((item) => item.id === selectedId);
  const selectedTitle = selectedDraft?.title || selectedConference?.title || '';
  const allTargets = useMemo(() => [
    ...drafts.map((draft) => ({ id: draft.id, title: `${draft.title} — recruitment draft`, kind: 'draft' as const })),
    ...conferences.map((conf) => ({ id: conf.id, title: conf.title, kind: 'conference' as const })),
  ], [drafts, conferences]);

  const createDraft = async () => {
    if (!draftForm.title.trim()) return;
    setLoading(true); setMessage(null);
    try {
      const draft = await createRecruitmentDraft({
        title: draftForm.title.trim(), description: draftForm.description.trim(), startDate: draftForm.startDate,
        endDate: draftForm.endDate, city: draftForm.city.trim(), country: draftForm.country.trim(),
        topics: draftForm.topics.split(',').map((v) => v.trim()).filter(Boolean), officialUrl: draftForm.officialUrl.trim(),
      });
      setDrafts((prev) => [draft, ...prev]);
      setSelectedId(draft.id);
      setDraftForm({ title: '', description: '', startDate: '', endDate: '', city: '', country: '', topics: '', officialUrl: '' });
      setMessage('Basic conference saved. You can recruit the committee before completing the full Conference Wizard.');
    } catch (error: any) { setMessage(error?.message || 'Could not save the recruitment draft.'); }
    finally { setLoading(false); }
  };

  const search = async () => {
    setLoading(true); setMessage(null);
    try {
      const found = await searchProfessionals({
        roleType,
        q: query.trim() || undefined,
        conferenceId: selectedId || undefined,
        country: countryFilter.trim() || undefined,
        organization: organizationFilter.trim() || undefined,
        minExperienceYears: minExperienceYears || undefined,
        minPublications: minPublications || undefined,
        verifiedOnly,
        reviewerEligibleOnly,
        limit: 100,
      });
      setResults(found);
      if (!found.length) setMessage('No available Professionals matched these filters. Clear one or more filters and try again.');
    } catch (error: any) { setMessage(error?.message || 'Could not search the Professional Network.'); }
    finally { setLoading(false); }
  };

  const clearProfessionalFilters = () => {
    setQuery('');
    setCountryFilter('');
    setOrganizationFilter('');
    setMinExperienceYears(0);
    setMinPublications(0);
    setVerifiedOnly(false);
    setReviewerEligibleOnly(false);
    setResults([]);
    setMessage(null);
  };

  const invite = async (person: ProfessionalDirectoryProfile) => {
    if (!selectedId || !selectedTitle) return;
    const roleTitle = roleType === 'committee' ? 'Technical Committee Member' : roleType === 'chair' ? 'Session Chair' : 'Speaker / Keynote';
    setLoading(true); setMessage(null);
    try {
      await createProfessionalInvitation({
        professionalId: person.id, conferenceId: selectedId, roleType, title: roleTitle,
        message: `We would like to invite you to serve as ${roleTitle} for ${selectedTitle}. This invitation is being sent during ConferenceGate's pre-wizard committee recruitment stage.`,
      });
      setInvited((prev) => ({ ...prev, [person.id]: true }));
      setMessage(`Invitation sent to ${person.name}. The organizer is notified when the Professional accepts or declines.`);
      setTimeout(refreshDrafts, 600);
    } catch (error: any) { setMessage(error?.message || 'Could not send the invitation.'); }
    finally { setLoading(false); }
  };

  const submitEvaluation = async () => {
    if (!evaluationTarget || !selectedId || !selectedTitle) return;
    setLoading(true); setMessage(null);
    try {
      await evaluateProfessional(evaluationTarget.id, {
        conferenceId: selectedId, conferenceTitle: selectedTitle,
        ratings: { expertise: evaluation.expertise, reliability: evaluation.reliability, communication: evaluation.communication, contribution: evaluation.contribution },
        comment: evaluation.comment,
      });
      setMessage(`Verified evaluation saved for ${evaluationTarget.name}. It now contributes to their ConferenceGate Index and digital credential level.`);
      setEvaluationTarget(null);
    } catch (error: any) { setMessage(error?.message || 'Could not save the evaluation.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div>
          <span className="text-[10px] font-bold uppercase text-blue-600">Step 1 · Before Conference Wizard</span>
          <h2 className="text-xl font-bold text-slate-900">Build the committee from basic conference information</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">Create a lightweight conference draft, search the Professional Network, and invite committee members. Once a Professional accepts, continue into the full Conference Wizard.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={draftForm.title} onChange={(e) => setDraftForm({ ...draftForm, title: e.target.value })} placeholder="Conference title *" className="p-3 rounded-xl border border-slate-200 bg-white text-xs" />
          <input value={draftForm.topics} onChange={(e) => setDraftForm({ ...draftForm, topics: e.target.value })} placeholder="Topics / expertise, comma separated" className="p-3 rounded-xl border border-slate-200 bg-white text-xs" />
          <input value={draftForm.startDate} onChange={(e) => setDraftForm({ ...draftForm, startDate: e.target.value })} type="date" className="p-3 rounded-xl border border-slate-200 bg-white text-xs" />
          <input value={draftForm.endDate} onChange={(e) => setDraftForm({ ...draftForm, endDate: e.target.value })} type="date" className="p-3 rounded-xl border border-slate-200 bg-white text-xs" />
          <input value={draftForm.city} onChange={(e) => setDraftForm({ ...draftForm, city: e.target.value })} placeholder="City" className="p-3 rounded-xl border border-slate-200 bg-white text-xs" />
          <input value={draftForm.country} onChange={(e) => setDraftForm({ ...draftForm, country: e.target.value })} placeholder="Country" className="p-3 rounded-xl border border-slate-200 bg-white text-xs" />
          <input value={draftForm.officialUrl} onChange={(e) => setDraftForm({ ...draftForm, officialUrl: e.target.value })} placeholder="Official URL (optional)" className="p-3 rounded-xl border border-slate-200 bg-white text-xs md:col-span-2" />
          <textarea value={draftForm.description} onChange={(e) => setDraftForm({ ...draftForm, description: e.target.value })} placeholder="Short conference scope / objective" className="p-3 rounded-xl border border-slate-200 bg-white text-xs md:col-span-2 min-h-20" />
        </div>
        <button type="button" onClick={createDraft} disabled={loading || !draftForm.title.trim()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"><Plus className="w-4 h-4" />Save basic conference & recruit committee</button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="p-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold">
            <option value="">Select conference / recruitment draft</option>
            {allTargets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <select value={roleType} onChange={(e) => setRoleType(e.target.value as any)} className="p-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold"><option value="committee">Technical Committee</option><option value="chair">Session Chair</option><option value="speaker">Speaker / Keynote</option></select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
            placeholder="Expertise, name, position, certificate…"
            className="p-3 rounded-xl bg-white border border-slate-200 text-xs"
          />
          <button type="button" onClick={search} disabled={loading} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-800 hover:bg-blue-900 text-white text-xs font-bold disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"><Search className="w-4 h-4" />Find Professionals</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          <input value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} placeholder="Country" className="p-3 rounded-xl bg-white border border-slate-200 text-xs" />
          <input value={organizationFilter} onChange={(e) => setOrganizationFilter(e.target.value)} placeholder="Organization" className="p-3 rounded-xl bg-white border border-slate-200 text-xs" />
          <select value={minExperienceYears} onChange={(e) => setMinExperienceYears(Number(e.target.value))} className="p-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold">
            <option value={0}>Any experience</option><option value={5}>5+ years</option><option value={10}>10+ years</option><option value={15}>15+ years</option><option value={20}>20+ years</option>
          </select>
          <select value={minPublications} onChange={(e) => setMinPublications(Number(e.target.value))} className="p-3 rounded-xl bg-white border border-slate-200 text-xs font-semibold">
            <option value={0}>Any publications</option><option value={1}>1+ publication</option><option value={5}>5+ publications</option><option value={10}>10+ publications</option><option value={25}>25+ publications</option>
          </select>
          <div className="flex items-center gap-4 px-3 rounded-xl border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700">
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />Verified identity</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={reviewerEligibleOnly} onChange={(e) => setReviewerEligibleOnly(e.target.checked)} />Reviewer eligible</label>
          </div>
          <button type="button" onClick={clearProfessionalFilters} className="px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-600 cursor-pointer">Clear filters</button>
        </div>
        {!selectedId && <p className="text-[11px] text-slate-500">Browse the Professional Network now. Select a conference or recruitment draft only when you are ready to invite or evaluate someone.</p>}
        {results.length > 0 && <p className="text-[11px] font-semibold text-slate-500">{results.length} Professional{results.length === 1 ? '' : 's'} matched the current filters.</p>}
        {selectedDraft && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <div><div className="text-xs font-bold text-slate-900">{selectedDraft.title}</div><div className="text-[11px] text-slate-600">Accepted invitations: <b>{Number((selectedDraft as any).acceptedCount || 0)}</b>. Full wizard opens after at least one Professional accepts.</div></div>
            <button type="button" disabled={Number((selectedDraft as any).acceptedCount || 0) < 1} onClick={() => onContinueToWizard(selectedDraft)} className="px-4 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"><CheckCircle2 className="w-4 h-4 inline mr-1" />Continue to Conference Wizard</button>
          </div>
        )}
        {message && <div className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-3">{message}</div>}
      </div>

      {results.length > 0 && <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {results.map((person) => <div key={person.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
          <div className="flex items-start justify-between gap-4"><div><h3 className="font-bold text-sm text-slate-900">{person.name}</h3><p className="text-xs text-slate-500">{person.title}{person.organization ? ` · ${person.organization}` : ''}</p></div><span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">{person.matchScore}% match</span></div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            {(person as any).reviewerEligible && <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold"><ShieldCheck className="w-3 h-3 inline mr-1" />Reviewer eligible</span>}
            {(person as any).conferenceGateIndex !== undefined && <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 font-bold"><Award className="w-3 h-3 inline mr-1" />CG Index {(person as any).conferenceGateIndex}</span>}
            <span className="px-2 py-1 rounded-full bg-slate-50 text-slate-600"><Briefcase className="w-3 h-3 inline mr-1" />{(person as any).experienceYears || 0} yrs</span>
            <span className="px-2 py-1 rounded-full bg-slate-50 text-slate-600">{(person as any).publicationCount || 0} publications</span>
          </div>
          {Array.isArray((person as any).recentPositions) && (person as any).recentPositions.length > 0 && <div><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">LinkedIn positions · past 7 years</div><div className="text-xs text-slate-700 space-y-1">{(person as any).recentPositions.slice(0,6).map((p: string, i: number) => <div key={i}>• {p}</div>)}</div></div>}
          {Array.isArray((person as any).certifications) && (person as any).certifications.length > 0 && <div><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Digital / LinkedIn certifications</div><div className="flex flex-wrap gap-1">{(person as any).certifications.slice(0,8).map((c: string, i: number) => <span key={i} className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] text-slate-700">{c}</span>)}</div></div>}
          <div className="flex flex-wrap gap-2"><button type="button" title={!selectedId ? 'Select a conference or recruitment draft to invite this Professional.' : undefined} onClick={() => invite(person)} disabled={!selectedId || invited[person.id] || loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-900 text-white text-xs font-bold disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer"><Send className="w-3.5 h-3.5" />{invited[person.id] ? 'Invitation sent' : 'Invite'}</button><button type="button" title={!selectedId ? 'Select a conference or recruitment draft before recording an organizer evaluation.' : undefined} disabled={!selectedId} onClick={() => setEvaluationTarget(person)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"><Star className="w-3.5 h-3.5" />Evaluate Professional</button></div>
        </div>)}
      </div>}

      {evaluationTarget && <div className="bg-white rounded-2xl border border-indigo-200 p-5 space-y-4"><div><h3 className="font-bold text-sm text-slate-900">Evaluate {evaluationTarget.name}</h3><p className="text-[11px] text-slate-500">Organizer-verified evaluations affect ConferenceGate Index and digital credential level.</p></div><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{(['expertise','reliability','communication','contribution'] as const).map((key) => <label key={key} className="text-[10px] font-bold uppercase text-slate-500">{key}<select value={evaluation[key]} onChange={(e) => setEvaluation({ ...evaluation, [key]: Number(e.target.value) })} className="mt-1 w-full p-2 rounded-lg border border-slate-200 bg-white text-xs">{[5,4,3,2,1].map((n) => <option key={n} value={n}>{n}/5</option>)}</select></label>)}</div><textarea value={evaluation.comment} onChange={(e) => setEvaluation({ ...evaluation, comment: e.target.value })} placeholder="Professional contribution comment" className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs" /><div className="flex gap-2"><button onClick={submitEvaluation} className="px-4 py-2 rounded-xl bg-indigo-700 text-white text-xs font-bold cursor-pointer">Save verified evaluation</button><button onClick={() => setEvaluationTarget(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer">Cancel</button></div></div>}
    </div>
  );
};
