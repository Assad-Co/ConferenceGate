import React, { useEffect, useState } from 'react';
import { History, Link as LinkIcon, Plus, Trash2 } from 'lucide-react';
import {
  SponsorHistoryRecord,
  createSponsorHistoryRecord,
  deleteSponsorHistoryRecord,
  fetchMySponsorHistoryRecords,
} from '../api/sponsors';
import { useToast } from './Toast';

const blank = () => ({
  year: String(new Date().getFullYear()),
  conferenceTitle: '',
  organizerName: '',
  tier: '',
  location: '',
  contribution: '',
  amount: '',
  currency: 'USD',
  evidenceUrl: '',
  notes: '',
});

export const SponsorHistoryEditor: React.FC = () => {
  const [records, setRecords] = useState<SponsorHistoryRecord[]>([]);
  const [draft, setDraft] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    fetchMySponsorHistoryRecords().then(setRecords).catch(() => {});
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.conferenceTitle.trim() || !draft.year) return;
    setSaving(true);
    try {
      const record = await createSponsorHistoryRecord({
        year: Number(draft.year),
        conferenceTitle: draft.conferenceTitle.trim(),
        organizerName: draft.organizerName.trim(),
        tier: draft.tier.trim(),
        location: draft.location.trim(),
        contribution: draft.contribution.trim(),
        amount: draft.amount ? Number(draft.amount) : null,
        currency: draft.currency.trim() || 'USD',
        evidenceUrl: draft.evidenceUrl.trim(),
        notes: draft.notes.trim(),
      });
      setRecords((prev) => [record, ...prev].sort((a, b) => b.year - a.year));
      setDraft(blank());
      setOpen(false);
      showToast({ type: 'success', title: 'Sponsorship history added', message: 'This entry is saved as sponsor-entered history and is clearly separated from ConferenceGate-verified sponsorships.' });
    } catch (error) {
      showToast({ type: 'info', title: 'Could not save sponsorship history', message: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSponsorHistoryRecord(id);
      setRecords((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      showToast({ type: 'info', title: 'Could not remove history entry', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const inputClass = 'w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200';

  return (
    <div className="bg-white rounded-3xl border border-blue-100 p-6 sm:p-8 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><History className="w-5 h-5 text-blue-700" /><h3 className="font-bold text-sm text-slate-900">Sponsor-Entered Sponsorship History</h3></div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">Add sponsorships completed outside ConferenceGate using a structured template. These records are marked self-reported and never count as ConferenceGate-verified sponsorships.</p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="px-4 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"><Plus className="w-4 h-4" /> Add Sponsorship</button>
      </div>

      {open && (
        <form onSubmit={save} className="p-4 sm:p-5 rounded-2xl bg-blue-50/40 border border-blue-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-[9px] uppercase font-bold text-slate-500">Year *</label><input required type="number" min="1950" max="2100" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} className={inputClass} /></div>
            <div><label className="text-[9px] uppercase font-bold text-slate-500">Conference / Event *</label><input required value={draft.conferenceTitle} onChange={(e) => setDraft({ ...draft, conferenceTitle: e.target.value })} placeholder="Event name" className={inputClass} /></div>
            <div><label className="text-[9px] uppercase font-bold text-slate-500">Organizer</label><input value={draft.organizerName} onChange={(e) => setDraft({ ...draft, organizerName: e.target.value })} placeholder="Organizer / society" className={inputClass} /></div>
            <div><label className="text-[9px] uppercase font-bold text-slate-500">Package / Tier</label><input value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })} placeholder="Gold, Platinum, Exhibitor..." className={inputClass} /></div>
            <div><label className="text-[9px] uppercase font-bold text-slate-500">Location / Region</label><input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Bahrain, GCC, Europe..." className={inputClass} /></div>
            <div><label className="text-[9px] uppercase font-bold text-slate-500">Contribution / Sponsorship Type</label><input value={draft.contribution} onChange={(e) => setDraft({ ...draft, contribution: e.target.value })} placeholder="Booth, dinner, session, lanyard..." className={inputClass} /></div>
            <div className="grid grid-cols-3 gap-2 sm:col-span-2"><div className="col-span-2"><label className="text-[9px] uppercase font-bold text-slate-500">Amount</label><input type="number" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="Optional" className={inputClass} /></div><div><label className="text-[9px] uppercase font-bold text-slate-500">Currency</label><input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 6) })} className={inputClass} /></div></div>
            <div className="sm:col-span-2"><label className="text-[9px] uppercase font-bold text-slate-500">Evidence URL</label><input type="url" value={draft.evidenceUrl} onChange={(e) => setDraft({ ...draft, evidenceUrl: e.target.value })} placeholder="Official event page, sponsor announcement, or public evidence" className={inputClass} /></div>
            <div className="sm:col-span-2"><label className="text-[9px] uppercase font-bold text-slate-500">Notes / Outcomes</label><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Objectives, activation, outcome, audience, leads, or other notes..." className={inputClass} /></div>
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer">Cancel</button><button disabled={saving} className="px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50">{saving ? 'Saving…' : 'Save History Entry'}</button></div>
        </form>
      )}

      {records.length === 0 ? (
        <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-400">No sponsor-entered sponsorship history yet. Use the template above to add past sponsorships.</div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => (
            <div key={record.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[9px] font-extrabold uppercase">Self-reported</span><span className="font-bold text-xs text-slate-900">{record.year} · {record.conferenceTitle}</span></div>
                <div className="text-[10px] text-slate-500 mt-1">{[record.organizerName, record.tier, record.location, record.contribution].filter(Boolean).join(' · ')}</div>
                {record.amount !== null && <div className="text-[10px] font-bold text-blue-700 mt-1">{record.currency} {record.amount.toLocaleString()}</div>}
                {record.notes && <p className="text-[10px] text-slate-600 mt-1">{record.notes}</p>}
              </div>
              <div className="flex gap-2 shrink-0">{record.evidenceUrl && <a href={record.evidenceUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-slate-200 text-blue-700 text-[10px] font-bold flex items-center gap-1"><LinkIcon className="w-3 h-3" /> Evidence</a>}<button type="button" onClick={() => remove(record.id)} className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-4 h-4" /></button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SponsorHistoryEditor;
