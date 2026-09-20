import React, { useState } from 'react';
import { CreditCard, ShieldCheck, Loader2 } from 'lucide-react';
import { fetchCheckoutUrl } from '../api/billing';

interface PaidWorkspaceGateProps {
  role: 'organizer' | 'sponsor';
  status?: string;
  plan?: string | null;
  onRefreshAccount?: () => void | Promise<void>;
}

export const PaidWorkspaceGate: React.FC<PaidWorkspaceGateProps> = ({
  role,
  status = 'required',
  plan,
  onRefreshAccount,
}) => {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = role === 'organizer' ? 'Organizer Pro' : 'Sponsor Pro';

  const openCheckout = async () => {
    setOpening(true);
    setError(null);
    try {
      const result = await fetchCheckoutUrl();
      if (result.alreadyActive) {
        await onRefreshAccount?.();
        return;
      }
      if (!result.checkoutUrl) throw new Error('Checkout is not configured.');
      window.location.assign(result.checkoutUrl);
    } catch (err: any) {
      setError(err?.message || 'Could not open checkout.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-10">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-7 sm:p-9 bg-blue-50 border-b border-blue-100">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-blue-200 text-blue-700 text-[10px] font-extrabold uppercase">
            <ShieldCheck className="w-3.5 h-3.5" />
            Paid Workspace
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-3">{label}</h1>
          <p className="text-sm text-slate-600 mt-2 max-w-xl">
            {role === 'organizer'
              ? 'Create and operate conferences, recruit professionals, manage abstracts, publish sponsorship needs, communicate, and track analytics.'
              : 'Access full sponsorship opportunities, personalized matching, organizer inquiries, saved opportunities, alerts, and sponsorship workflow.'}
          </p>
        </div>

        <div className="p-7 sm:p-9 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {(role === 'organizer'
              ? [
                  'Conference Wizard & publishing',
                  'Professional matching & invitations',
                  'Abstract and reviewer workflow',
                  'Technical committee management',
                  'Sponsor needs & sponsor CRM',
                  'Communications and analytics',
                ]
              : [
                  'Full sponsorship marketplace',
                  'Matched conference opportunities',
                  'Organizer inquiries and responses',
                  'Saved opportunities and alerts',
                  'Company sponsorship profile',
                  'Sponsorship history and analytics',
                ]
            ).map((feature) => (
              <div key={feature} className="p-3 rounded-xl bg-slate-50 border border-slate-200 font-semibold text-slate-700">
                {feature}
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-500">
            Current status: <strong className="text-slate-800">{status}</strong>
            {plan ? <> · Plan: <strong className="text-slate-800">{plan}</strong></> : null}
          </div>

          {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{error}</div>}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={openCheckout}
              disabled={opening}
              className="flex-1 py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Subscribe to {label}
            </button>
            <button
              onClick={() => onRefreshAccount?.()}
              className="px-5 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
            >
              I completed payment — refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
