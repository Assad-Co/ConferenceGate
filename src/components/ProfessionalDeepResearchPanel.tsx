import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import {
  fetchProfessionalEvidence,
  refreshProfessionalEvidence,
  type ProfessionalEvidenceItem,
  type ProfessionalEvidenceSnapshot,
} from '../api/professionalEvidence';

const confidenceLabel: Record<string, string> = {
  verified: 'Verified',
  strong: 'Strongly supported',
  member_claimed: 'Member claimed',
  possible: 'Possible match',
};

const confidenceClass: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  strong: 'bg-blue-50 text-blue-700 border-blue-200',
  member_claimed: 'bg-amber-50 text-amber-700 border-amber-200',
  possible: 'bg-slate-50 text-slate-600 border-slate-200',
};

const kindLabel: Record<string, string> = {
  publication: 'Publication',
  conference_paper: 'Conference paper',
  conference_role: 'Conference role',
  conference_attendance: 'Conference attendance',
  position: 'Professional position',
  patent: 'Patent',
  public_bio: 'Public profile',
};

export const ProfessionalDeepResearchPanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ProfessionalEvidenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const next = await fetchProfessionalEvidence();
      setSnapshot(next);
      setError(null);
      return next;
    } catch (err: any) {
      setError(err?.message || 'Could not load Professional Deep Research.');
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchProfessionalEvidence()
      .then((next) => { if (!cancelled) setSnapshot(next); })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Could not load Professional Deep Research.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!snapshot || !['queued', 'running'].includes(snapshot.status)) return;
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, [snapshot?.status]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshProfessionalEvidence();
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not start Professional Deep Research.');
    } finally {
      setRefreshing(false);
    }
  };

  const evidence = useMemo(() => {
    if (!snapshot) return [] as ProfessionalEvidenceItem[];
    return snapshot.items.slice(0, 30);
  }, [snapshot]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Professional Deep Research…
      </div>
    );
  }

  const summary = snapshot?.summary;
  const running = snapshot && ['queued', 'running'].includes(snapshot.status);

  return (
    <section className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-white p-5">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-700" />
            <h3 className="text-base font-extrabold text-slate-900">Professional Deep Research & Evidence Graph</h3>
          </div>
          <p className="mt-1 text-xs text-slate-600 max-w-3xl leading-relaxed">
            LinkedIn anchors your identity; ConferenceGate then cross-checks public scholarly indexes, official conference/society pages and public professional sources. Private LinkedIn data is never accessed, and uncertain same-name matches stay separate from verified reputation.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Public sources only</span>
            <span>•</span><span>Possible matches do not affect your ConferenceGate Index</span>
            <span>•</span><span>OAuth access tokens are not stored</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || Boolean(running)}
          className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold disabled:opacity-50"
        >
          {refreshing || running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {running ? 'Researching public evidence…' : 'Refresh Deep Research'}
        </button>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <div className="rounded-xl bg-white border border-emerald-100 p-3"><div className="text-[10px] uppercase font-bold text-slate-400">Verified</div><div className="text-xl font-extrabold text-emerald-700">{summary?.verified || 0}</div></div>
        <div className="rounded-xl bg-white border border-blue-100 p-3"><div className="text-[10px] uppercase font-bold text-slate-400">Strong support</div><div className="text-xl font-extrabold text-blue-700">{summary?.strong || 0}</div></div>
        <div className="rounded-xl bg-white border border-amber-100 p-3"><div className="text-[10px] uppercase font-bold text-slate-400">Member claims</div><div className="text-xl font-extrabold text-amber-700">{summary?.memberClaimed || 0}</div></div>
        <div className="rounded-xl bg-white border border-slate-200 p-3"><div className="text-[10px] uppercase font-bold text-slate-400">Possible matches</div><div className="text-xl font-extrabold text-slate-700">{summary?.possible || 0}</div></div>
      </div>

      {snapshot?.status === 'not_started' && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-white p-4 text-xs text-slate-600">
          Deep Research starts automatically after a LinkedIn sign-in/link. You can also start it now with <b>Refresh Deep Research</b>.
        </div>
      )}

      {snapshot?.lastRun?.status === 'failed' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          The last public-source research pass did not finish: {snapshot.lastRun.error || 'unknown error'}. Your existing profile remains unchanged; retry when ready.
        </div>
      )}

      {evidence.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4 text-blue-700" /><h4 className="text-sm font-extrabold text-slate-900">Evidence Graph</h4></div>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {evidence.map((item) => (
              <div key={`${item.id}-${item.sourceType}`} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase font-extrabold text-slate-500">{kindLabel[item.kind] || item.kind}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${confidenceClass[item.confidence] || confidenceClass.possible}`}>{confidenceLabel[item.confidence] || item.confidence}</span>
                  {item.year && <span className="text-[10px] text-slate-400">{item.year}</span>}
                  <span className="text-[10px] text-slate-400">{item.sourceType.replaceAll('_', ' ')}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{item.title}</div>
                {(item.role || item.organization || item.conferenceTitle) && (
                  <div className="mt-1 text-[11px] text-slate-500">{[item.role, item.organization, item.conferenceTitle].filter(Boolean).join(' · ')}</div>
                )}
                <div className="mt-1 text-[11px] text-slate-500">{item.evidenceReason}</div>
                {item.sourceUrl && (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
                    Open public evidence <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default ProfessionalDeepResearchPanel;
