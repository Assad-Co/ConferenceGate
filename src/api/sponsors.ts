import { SponsorshipPackage, SponsorProfile } from '../types';

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export async function fetchSponsorshipPackages(): Promise<SponsorshipPackage[]> {
  const res = await fetch('/api/sponsors/packages', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.packages;
}

export async function createSponsorshipPackage(payload: {
  conferenceId: string;
  tier: string;
  price: number;
  benefits: string[];
  boothSpace?: string;
  speakingOps?: string;
  totalSlots?: number;
  sourceOpportunityId?: string;
}): Promise<SponsorshipPackage> {
  const res = await fetch('/api/sponsors/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.package;
}

export async function notifyVerifiedSponsors(packageId: string, opportunityName: string): Promise<number> {
  const res = await fetch(`/api/sponsors/packages/${packageId}/notify-verified-sponsors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ opportunityName }),
  });
  const data = await parseResponse(res);
  return data.notifiedCount;
}

export interface SponsorApplicationSummary {
  id: string;
  packageId: string;
  tier: string;
  conferenceTitle: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
}

export async function applyForSponsorship(packageId: string): Promise<SponsorApplicationSummary> {
  const res = await fetch('/api/sponsors/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ packageId }),
  });
  const data = await parseResponse(res);
  return data.application;
}

export async function fetchMySponsorApplications(): Promise<SponsorApplicationSummary[]> {
  const res = await fetch('/api/sponsors/applications/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.applications;
}

export interface SponsorApplicant {
  applicationId: string;
  packageId: string;
  tier: string;
  conferenceTitle: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
  sponsor: SponsorProfile;
}

export async function fetchApplicantsForMyPackages(): Promise<SponsorApplicant[]> {
  const res = await fetch('/api/sponsors/applications/for-my-packages', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.applicants;
}

export async function decideSponsorApplication(
  applicationId: string,
  status: 'Approved' | 'Rejected'
): Promise<void> {
  const res = await fetch(`/api/sponsors/applications/${applicationId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
  await parseResponse(res);
}

export interface ReviewableSponsor {
  id: string;
  companyName: string;
  logo: string | null;
}

export async function fetchReviewableSponsors(): Promise<ReviewableSponsor[]> {
  const res = await fetch('/api/sponsors/reviewable/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.sponsors;
}

export async function submitSponsorReview(payload: {
  sponsorId: string;
  conferenceTitle: string;
  rating: number;
  comment?: string;
}): Promise<void> {
  const res = await fetch('/api/sponsors/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await parseResponse(res);
}

export async function fetchMySponsorProfile(): Promise<Omit<SponsorProfile, 'id' | 'companyName' | 'logo' | 'description' | 'industry' | 'verificationStatus'>> {
  const res = await fetch('/api/sponsors/profile/mine', { credentials: 'include' });
  return parseResponse(res);
}


export interface ExternalSponsorshipPackage {
  name: string;
  priceText: string | null;
  priceAmount: number | null;
  currency: string | null;
  benefits: string[];
  sourceUrl: string;
}

export interface ExternalSponsorshipOpportunity {
  conferenceId: string;
  conferenceTitle: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  country: string | null;
  officialUrl: string;
  sponsorUrl: string;
  actionUrl: string;
  actionLabel: 'View Sponsorship' | 'Inquire Now';
  hasPublishedPricing: boolean;
  categories: string[];
  packages: ExternalSponsorshipPackage[];
  checkedAt: string | null;
}

export async function fetchExternalSponsorshipOpportunities(): Promise<ExternalSponsorshipOpportunity[]> {
  const res = await fetch('/api/sponsors/external-opportunities', { credentials: 'include' });
  const data = await parseResponse(res);
  return Array.isArray(data.opportunities) ? data.opportunities : [];
}


export interface SponsorPreferences {
  sectors: string[];
  categories: string[];
  regions: string[];
  opportunityTypes: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  alertFrequency: 'instant' | 'daily' | 'weekly';
}

export async function fetchMySponsorPreferences(): Promise<SponsorPreferences> {
  const res = await fetch('/api/sponsors/preferences/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.preferences;
}

export async function updateMySponsorPreferences(payload: SponsorPreferences): Promise<SponsorPreferences> {
  const res = await fetch('/api/sponsors/preferences/mine', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.preferences;
}

export interface SponsorshipNeed {
  id: string;
  conferenceId: string;
  conferenceTitle: string;
  organizerId: string;
  title: string;
  description: string;
  categories: string[];
  targetSectors: string[];
  regions: string[];
  opportunityTypes: string[];
  priceAmount: number | null;
  priceOnRequest: boolean;
  totalSlots: number;
  benefits: string[];
  deadline: string | null;
  status: 'active' | 'closed';
  createdAt: string;
  matchScore: number | null;
}

export interface CreateSponsorshipNeedPayload {
  conferenceId: string;
  title: string;
  description?: string;
  categories?: string[];
  targetSectors?: string[];
  regions?: string[];
  opportunityTypes?: string[];
  priceAmount?: number | null;
  priceOnRequest?: boolean;
  totalSlots?: number;
  benefits?: string[];
  deadline?: string;
}

export async function createSponsorshipNeed(payload: CreateSponsorshipNeedPayload): Promise<{ need: SponsorshipNeed; notifiedSponsors: number }> {
  const res = await fetch('/api/sponsors/needs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseResponse(res);
}

export async function fetchMySponsorshipNeeds(): Promise<SponsorshipNeed[]> {
  const res = await fetch('/api/sponsors/needs/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.needs;
}

export async function fetchMatchedSponsorshipNeeds(): Promise<SponsorshipNeed[]> {
  const res = await fetch('/api/sponsors/needs/matched', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.needs;
}

export interface SponsorshipNeedInquiry {
  id: string;
  needId: string;
  needTitle: string;
  conferenceTitle: string;
  sponsorId: string;
  sponsorName: string;
  message: string;
  budget: number | null;
  status: 'new' | 'contacted' | 'negotiating' | 'won' | 'lost' | 'withdrawn';
  createdAt: string;
}

export async function inquireAboutSponsorshipNeed(
  needId: string,
  payload: { message?: string; budget?: number | null }
): Promise<void> {
  const res = await fetch(`/api/sponsors/needs/${needId}/inquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await parseResponse(res);
}

export async function fetchMySponsorshipNeedInquiries(): Promise<SponsorshipNeedInquiry[]> {
  const res = await fetch('/api/sponsors/needs/inquiries/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.inquiries;
}

export async function updateSponsorshipNeedInquiryStatus(
  inquiryId: string,
  status: 'new' | 'contacted' | 'negotiating' | 'won' | 'lost'
): Promise<void> {
  const res = await fetch(`/api/sponsors/needs/inquiries/${inquiryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
  await parseResponse(res);
}


export interface SponsorshipDealUpdate {
  id: string;
  authorId: string;
  kind: 'note' | 'proposal' | 'contract' | 'invoice' | 'deliverable' | 'payment' | 'status';
  text: string;
  url: string | null;
  createdAt: string;
}

export interface SponsorshipDeal {
  id: string;
  inquiryId: string;
  needId: string;
  organizerId: string;
  sponsorId: string;
  conferenceId: string;
  conferenceTitle: string;
  opportunityTitle: string;
  counterpartName: string;
  agreedAmount: number | null;
  currency: string;
  status: 'negotiating' | 'agreement_reached' | 'contract_pending' | 'payment_pending' | 'paid' | 'delivering' | 'completed' | 'canceled';
  proposalNotes: string;
  deliverables: string[];
  contractUrl: string | null;
  invoiceUrl: string | null;
  paymentReference: string | null;
  createdAt: string;
  updatedAt: string;
  updates: SponsorshipDealUpdate[];
}

export async function fetchMySponsorshipDeals(): Promise<SponsorshipDeal[]> {
  const res = await fetch('/api/sponsors/deals/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.deals;
}

export async function updateSponsorshipDeal(
  dealId: string,
  payload: {
    agreedAmount?: number | null;
    currency?: string;
    proposalNotes?: string;
    deliverables?: string[];
    contractUrl?: string | null;
    invoiceUrl?: string | null;
    status?: 'negotiating' | 'agreement_reached' | 'contract_pending' | 'payment_pending' | 'delivering' | 'completed' | 'canceled';
  }
): Promise<SponsorshipDeal> {
  const res = await fetch(`/api/sponsors/deals/${dealId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.deal;
}

export async function addSponsorshipDealUpdate(
  dealId: string,
  payload: {
    kind?: 'note' | 'proposal' | 'contract' | 'invoice' | 'deliverable';
    text: string;
    url?: string;
  }
): Promise<SponsorshipDealUpdate> {
  const res = await fetch(`/api/sponsors/deals/${dealId}/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.update;
}
