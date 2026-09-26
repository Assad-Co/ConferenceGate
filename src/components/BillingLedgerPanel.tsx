import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2, ReceiptText, ShieldCheck } from 'lucide-react';
import { fetchBillingLedger, type BillingCurrencyTotal, type BillingLedger } from '../api/billing';

interface BillingLedgerPanelProps {
  perspective: 'organizer' | 'sponsor';
}

export const BillingLedgerPanel: React.FC<BillingLedgerPanelProps> = ({ perspective }) => {
  const [ledger, setLedger] = useState<BillingLedger>({
    summary: {
      settledPayments: 0,
      currencyTotals: [],
      payoutPaidCurrencyTotals: [],
      payoutPendingCurrencyTotals: [],
      payoutPendingCount: 0,
    },
    payments: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const renderTotals = (items: BillingCurrencyTotal[]) => {
    if (items.length === 0) return '—';
    return items.map((item) => `${item.currency} ${item.amount.toLocaleString()}`).join(' · ');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchBillingLedger(perspective)
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
              Only payment-provider settlement events enter this ledger. Sponsor payment and organizer payout are tracked as separate states, so a collected payment is never presented as an organizer payout until a provider confirms it.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 min-w-32">
              <div className="text-[9px] font-bold uppercase text-slate-400">Sponsor-Paid Deals</div>
              <div className="text-xl font-extrabold text-slate-900">{ledger.summary.settledPayments}</div>
            </div>
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 min-w-44">
              <div className="text-[9px] font-bold uppercase text-blue-600">
                {perspective === 'organizer' ? 'Sponsor-Paid Amount' : 'Settled Spend'}
              </div>
              <div className="text-sm font-extrabold text-blue-900 mt-1">
                {renderTotals(ledger.summary.currencyTotals)}
              </div>
            </div>
            {perspective === 'organizer' && (
              <>
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 min-w-44">
                  <div className="text-[9px] font-bold uppercase text-amber-700">
                    Payout Pending ({ledger.summary.payoutPendingCount})
                  </div>
                  <div className="text-sm font-extrabold text-amber-900 mt-1">
                    {renderTotals(ledger.summary.payoutPendingCurrencyTotals)}
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 min-w-44">
                  <div className="text-[9px] font-bold uppercase text-emerald-600">Organizer Paid Out</div>
                  <div className="text-sm font-extrabold text-emerald-900 mt-1">
                    {renderTotals(ledger.summary.payoutPaidCurrencyTotals)}
                  </div>
                </div>
              </>
            )}
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
                  <th className="p-3">Payment State</th>
                  {perspective === 'organizer' && <th className="p-3">Organizer Payout</th>}
                  <th className="p-3">Provider Event</th>
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
                    <td className={
                      'p-3 font-extrabold ' +
                      (payment.status === 'refunded' ? 'text-rose-700 line-through' : 'text-emerald-700')
                    }>
                      {payment.amount === null ? '—' : `${payment.currency} ${payment.amount.toLocaleString()}`}
                    </td>
                    <td className="p-3">
                      <span className={
                        'inline-flex px-2 py-1 rounded-full text-[9px] font-bold uppercase ' +
                        (payment.status === 'refunded'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-emerald-50 text-emerald-700')
                      }>
                        {payment.status}
                      </span>
                    </td>
                    {perspective === 'organizer' && (
                      <td className="p-3">
                        <div className={
                          'inline-flex px-2 py-1 rounded-full text-[9px] font-bold uppercase ' +
                          (payment.payoutStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : payment.payoutStatus === 'held'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700')
                        }>
                          {payment.payoutStatus || 'pending'}
                        </div>
                        {payment.payoutAmount !== null && (
                          <div className="text-[10px] text-slate-500 mt-1">
                            {payment.currency} {payment.payoutAmount.toLocaleString()}
                            {payment.platformFeeAmount ? ` · fee ${payment.currency} ${payment.platformFeeAmount.toLocaleString()}` : ''}
                          </div>
                        )}
                        {payment.payoutReference && (
                          <div className="text-[9px] font-mono text-slate-400 mt-1">{payment.payoutReference}</div>
                        )}
                      </td>
                    )}
                    <td className="p-3 text-slate-500">
                      <div>{payment.settledAt}</div>
                      <div className="text-[9px] font-mono text-slate-400 mt-1">{payment.paymentReference}</div>
                    </td>
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
