import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, DollarSign, Sparkles, Target } from 'lucide-react';

export interface SponsorWizardDraft {
  sectors: string;
  categories: string;
  regions: string;
  opportunityTypes: string;
  budgetMin: string;
  budgetMax: string;
  alertFrequency: 'instant' | 'daily' | 'weekly';
}

interface SponsorWizardPanelProps {
  preferenceDraft: SponsorWizardDraft;
  setPreferenceDraft: React.Dispatch<React.SetStateAction<SponsorWizardDraft>>;
  saving: boolean;
  onSubmit: (event: React.FormEvent) => void | Promise<void>;
  onOpenRequests: () => void;
}

const steps = [
  ['Strategy', 'Define the industries and conference categories that fit your brand.'],
  ['Markets & Formats', 'Choose regions and the sponsorship formats you want to support.'],
  ['Budget & Alerts', 'Set commercial range and how quickly ConferenceGate should alert you.'],
  ['Review', 'Confirm your sponsor profile before ConferenceGate starts ranking opportunities.'],
];

export const SponsorWizardPanel: React.FC<SponsorWizardPanelProps> = ({
  preferenceDraft,
  setPreferenceDraft,
  saving,
  onSubmit,
  onOpenRequests,
}) => {
  const [step, setStep] = useState(0);
  const inputClass = 'w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200';
  const summary = [
    ['Industries', preferenceDraft.sectors || 'Not set'],
    ['Conference categories', preferenceDraft.categories || 'Not set'],
    ['Regions', preferenceDraft.regions || 'Not set'],
    ['Sponsorship formats', preferenceDraft.opportunityTypes || 'Not set'],
    ['Budget', `${preferenceDraft.budgetMin || 'Open'} – ${preferenceDraft.budgetMax || 'Open'}`],
    ['Alert frequency', preferenceDraft.alertFrequency],
  ];

  return (
    <form onSubmit={onSubmit} className="max-w-4xl mx-auto bg-white rounded-3xl border border-blue-100 shadow-xs overflow-hidden">
      <div className="p-6 sm:p-8 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white">
        <div className="text-[10px] uppercase font-extrabold tracking-wider text-blue-600">Sponsor Pro</div>
        <h2 className="text-xl font-extrabold text-slate-900 mt-1 flex items-center gap-2"><Sparkles className="w-5 h-5 text-blue-700" /> Sponsor Wizard</h2>
        <p className="text-xs text-slate-500 mt-1">Build your sponsorship strategy once. ConferenceGate uses it to rank organizer opportunities and power relevant alerts.</p>
        <div className="grid grid-cols-4 gap-2 mt-6">
          {steps.map(([label], index) => (
            <button key={label} type="button" onClick={() => setStep(index)} className="text-left cursor-pointer">
              <div className={`h-1.5 rounded-full ${index <= step ? 'bg-blue-700' : 'bg-slate-200'}`} />
              <div className={`text-[9px] mt-1 font-bold ${index === step ? 'text-blue-700' : 'text-slate-400'}`}>{index + 1}. {label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 sm:p-8 min-h-[330px]">
        <div className="mb-5"><h3 className="font-bold text-base text-slate-900">{steps[step][0]}</h3><p className="text-xs text-slate-500 mt-1">{steps[step][1]}</p></div>

        {step === 0 && <div className="space-y-4">
          <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Industries / sectors</label><input value={preferenceDraft.sectors} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, sectors: e.target.value }))} placeholder="Energy, Oil & Gas, AI, Healthcare" className={inputClass} /><p className="text-[9px] text-slate-400 mt-1">Separate values with commas.</p></div>
          <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Conference categories</label><input value={preferenceDraft.categories} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, categories: e.target.value }))} placeholder="Petroleum & Geoscience, Engineering, Technology" className={inputClass} /></div>
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex gap-2"><Target className="w-4 h-4 shrink-0 mt-0.5" /><span>These choices define the strategic fit score when organizers publish sponsorship opportunities.</span></div>
        </div>}

        {step === 1 && <div className="space-y-4">
          <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Target regions</label><input value={preferenceDraft.regions} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, regions: e.target.value }))} placeholder="GCC, Middle East, Europe, North America" className={inputClass} /></div>
          <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Sponsorship formats</label><input value={preferenceDraft.opportunityTypes} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, opportunityTypes: e.target.value }))} placeholder="Exhibition Booth, Gala Dinner, Technical Session, App, Lanyard" className={inputClass} /></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-slate-500">{['Brand visibility','Lead generation','Thought leadership','Technical engagement'].map((item) => <div key={item} className="p-3 rounded-xl bg-slate-50 border border-slate-100 font-semibold text-center">{item}</div>)}</div>
        </div>}

        {step === 2 && <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Minimum budget</label><div className="relative"><DollarSign className="absolute w-4 h-4 left-3 top-3 text-slate-400" /><input type="number" min="0" value={preferenceDraft.budgetMin} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, budgetMin: e.target.value }))} className={`${inputClass} pl-9`} /></div></div>
            <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Maximum budget</label><div className="relative"><DollarSign className="absolute w-4 h-4 left-3 top-3 text-slate-400" /><input type="number" min="0" value={preferenceDraft.budgetMax} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, budgetMax: e.target.value }))} className={`${inputClass} pl-9`} /></div></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Opportunity alert frequency</label><select value={preferenceDraft.alertFrequency} onChange={(e) => setPreferenceDraft((prev) => ({ ...prev, alertFrequency: e.target.value as SponsorWizardDraft['alertFrequency'] }))} className={inputClass}><option value="instant">Instant — strongest new opportunities</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option></select></div>
          <p className="text-[10px] text-slate-500">ConferenceGate only alerts you about stored organizer opportunities and your saved watchlist. It does not expose your private email to organizers.</p>
        </div>}

        {step === 3 && <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{summary.map(([label, value]) => <div key={label} className="p-4 rounded-xl border border-slate-200 bg-slate-50"><div className="text-[9px] uppercase font-bold text-slate-400">{label}</div><div className="text-xs font-semibold text-slate-800 mt-1 break-words">{value}</div></div>)}</div>
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-800 flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /><span>Saving this wizard activates personalized matching. You can change it any time without affecting existing Deal Rooms or Sponsor Requests.</span></div>
          <button type="button" onClick={onOpenRequests} className="text-xs font-bold text-blue-700 hover:underline cursor-pointer">Need something specific? Open Sponsor Request →</button>
        </div>}
      </div>

      <div className="p-5 sm:px-8 border-t border-slate-100 flex items-center justify-between gap-3">
        <button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-30"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
        {step < steps.length - 1 ? <button type="button" onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))} className="px-5 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold flex items-center gap-1 cursor-pointer">Continue <ArrowRight className="w-3.5 h-3.5" /></button> : <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50">{saving ? 'Saving…' : 'Save Sponsor Wizard'}</button>}
      </div>
    </form>
  );
};

export default SponsorWizardPanel;
