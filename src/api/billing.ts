async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Billing request failed');
  return data;
}

export interface BillingStatus {
  role: 'professional' | 'organizer' | 'sponsor';
  status: string;
  plan: string | null;
  provider: string | null;
  periodEnd: string | null;
  hasPaidAccess: boolean;
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await fetch('/api/billing/status', { credentials: 'include' });
  return parseResponse(res);
}

export async function fetchCheckoutUrl(): Promise<{ checkoutUrl: string | null; alreadyActive: boolean }> {
  const res = await fetch('/api/billing/checkout', { credentials: 'include' });
  return parseResponse(res);
}


export interface BillingLedgerPayment {
  id: string;
  dealId: string;
  conferenceTitle: string;
  opportunityTitle: string;
  provider: string;
  paymentReference: string;
  amount: number | null;
  currency: string;
  status: 'settled' | 'refunded';
  settledAt: string;
}

export interface BillingLedger {
  summary: {
    settledPayments: number;
    settledAmount: number;
  };
  payments: BillingLedgerPayment[];
}

export async function fetchBillingLedger(): Promise<BillingLedger> {
  const res = await fetch('/api/billing/ledger/mine', { credentials: 'include' });
  return parseResponse(res);
}
