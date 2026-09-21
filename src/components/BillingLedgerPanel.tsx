import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2, ReceiptText, ShieldCheck } from 'lucide-react';
import { fetchBillingLedger, type BillingLedger } from '../api/billing';

interface BillingLedgerPanelProps {
  perspective: 'organizer' | 'sponsor';
}

export const BillingLedgerPanel: React.FC<BillingLedgerPanelProps> = ({ perspective }) => {
  const [ledger, setLedger] = useState<BillingLedger>({
    summary: { settledPayments: 0, settledAmount: 0 },
    payments: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchBillingLedger()
      .then((data) => {
        if (!active) return;
        setLedger(data);
        setError(null);
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message || 'Could not load payment ledger.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-10 bg-white rounded-3xl border border-slate-200 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-700 mx-auto" />
        <p className="text-xs text-slate-500 mt-2">Loading provider-confirmed payments…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div>
            <span className="text-[10px] font-bold uppercase text-blue-600">Commercial Controls</span>
            <h2 className="text-xl font-bold text-slate-900 mt-1">Payment Ledger</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Only payment-provider settlement events enter this ledger. Manual Deal Room actions cannot create a settled payment.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 min-w-32">
              <div className="text-[9px] font-bold uppercase text-slate-400">Settled Payments</div>
              <div className="text-xl font-extrabold text-slate-900">{ledger.summary.settledPayments}</div>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 min-w-40">
              <div className="text-[9px] font-bold uppercase text-emerald-600">
                {perspective === 'organizer' ? 'Settled Revenue' : 'Settled Spend'}
              </div>
              <div className="text-xl font-extrabold text-emerald-900">
                {'$'}{ledger.summary.settledAmount.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {error && <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{error}</div>}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-blue-700" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Settlement History</h3>
              <p className="text-[10px] text-slate-500">Provider reference, amount, and linked sponsorship Deal Room.</p>
            </div>
          </div>
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
        </div>

        {ledger.payments.length === 0 ? (
          <div className="p-10 text-center">
            <CreditCard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-800">No settled sponsorship payments yet</h4>
            <p className="text-xs text-slate-500 mt-1">
              Payments will appear here only after the configured provider confirms settlement.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="p-3">Conference / Opportunity</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{payment.opportunityTitle}</div>
                      <div className="text-[10px] text-slate-500">{payment.conferenceTitle}</div>
                    </td>
                    <td className="p-3 font-semibold text-slate-700">{payment.provider}</td>
                    <td className="p-3 font-mono text-[10px] text-slate-600">{payment.paymentReference}</td>
                    <td className="p-3 font-extrabold text-emerald-700">
                      {payment.amount === null ? '—' : `${payment.currency} ${payment.amount.toLocaleString()}`}
                    </td>
                    <td className="p-3 text-slate-500">{payment.settledAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
