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


export interface SponsorSavedOpportunity {
  id: string;
  sourceType: 'internal_need' | 'package' | 'external_catalog';
  sourceId: string;
  conferenceId: string | null;
  conferenceTitle: string;
  title: string;
  snapshot: Record<string, any>;
  alertEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSponsorWatchlist(): Promise<SponsorSavedOpportunity[]> {
  const res = await fetch('/api/sponsors/watchlist/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return Array.isArray(data.items) ? data.items : [];
}

export async function saveSponsorOpportunity(
  sourceType: SponsorSavedOpportunity['sourceType'],
  sourceId: string
): Promise<SponsorSavedOpportunity> {
  const res = await fetch('/api/sponsors/watchlist', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sourceType, sourceId }),
  });
  const data = await parseResponse(res);
  return data.item;
}

export async function setSponsorWatchAlert(
  itemId: string,
  alertEnabled: boolean
): Promise<SponsorSavedOpportunity> {
  const res = await fetch(`/api/sponsors/watchlist/${itemId}/alerts`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ alertEnabled }),
  });
  const data = await parseResponse(res);
  return data.item;
}

export async function removeSponsorSavedOpportunity(itemId: string): Promise<void> {
  const res = await fetch(`/api/sponsors/watchlist/${itemId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseResponse(res);
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
  matchReasons: string[];
  matchBreakdown: {
    sector: number | null;
    category: number | null;
    region: number | null;
    opportunityType: number | null;
    budget: number | null;
  } | null;
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


export interface SponsorRequest {
  id: string;
  sponsorId: string;
  sponsorName: string;
  title: string;
  description: string;
  categories: string[];
  regions: string[];
  opportunityTypes: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  targetAudience: string;
  startDate: string | null;
  endDate: string | null;
  status: 'active' | 'closed';
  responseCount: number;
  createdAt: string;
}

export interface SponsorRequestResponse {
  id: string;
  requestId: string;
  requestTitle: string;
  organizerId: string;
  organizerName: string;
  conferenceId: string;
  conferenceTitle: string;
  message: string;
  status: 'new' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
}

export async function createSponsorRequest(payload: {
  title: string;
  description?: string;
  categories?: string[];
  regions?: string[];
  opportunityTypes?: string[];
  budgetMin?: number | null;
  budgetMax?: number | null;
  targetAudience?: string;
  startDate?: string;
  endDate?: string;
}): Promise<SponsorRequest> {
  const res = await fetch('/api/sponsors/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.request;
}

export async function fetchMySponsorRequests(): Promise<SponsorRequest[]> {
  const res = await fetch('/api/sponsors/requests/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.requests;
}

export async function fetchSponsorRequestBoard(): Promise<SponsorRequest[]> {
  const res = await fetch('/api/sponsors/requests/board', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.requests;
}

export async function respondToSponsorRequest(
  requestId: string,
  payload: { conferenceId: string; message?: string }
): Promise<void> {
  const res = await fetch(`/api/sponsors/requests/${requestId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await parseResponse(res);
}

export async function fetchMySponsorRequestResponses(): Promise<SponsorRequestResponse[]> {
  const res = await fetch('/api/sponsors/requests/responses/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.responses;
}

export async function decideSponsorRequestResponse(
  responseId: string,
  status: 'accepted' | 'declined'
): Promise<void> {
  const res = await fetch(`/api/sponsors/requests/responses/${responseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
  await parseResponse(res);
}


export interface SponsorshipNeedAnalyticsItem {
  needId: string;
  title: string;
  conferenceId: string;
  conferenceTitle: string;
  publishedPrice: number | null;
  views: number;
  inquiries: number;
  negotiating: number;
  won: number;
  contracts: number;
  payments: number;
  realizedRevenue: number;
  inquiryRate: number;
  winRate: number;
}

export interface SponsorshipNeedAnalytics {
  needs: SponsorshipNeedAnalyticsItem[];
  totals: {
    views: number;
    inquiries: number;
    negotiating: number;
    won: number;
    payments: number;
    realizedRevenue: number;
  };
}

export async function fetchSponsorshipNeedAnalytics(): Promise<SponsorshipNeedAnalytics> {
  const res = await fetch('/api/sponsors/needs/analytics', { credentials: 'include' });
  return parseResponse(res);
}


export interface SponsorLaunchpad {
  companyProfileReady: boolean;
  preferencesReady: boolean;
  preferenceGroupsCompleted: number;
  alertFrequency: 'instant' | 'daily' | 'weekly';
  meaningfulMatches: number;
  highMatches: number;
  savedOpportunities: number;
  watchAlertsEnabled: number;
  inquiriesSent: number;
  dealRooms: number;
  paidDeals: number;
  sponsorRequests: number;
  organizerResponses: number;
  unreadSponsorshipAlerts: number;
  nextAction: {
    key: string;
    label: string;
    description: string;
    targetTab: 'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'roi' | 'profile';
  };
}

export async function fetchSponsorLaunchpad(): Promise<SponsorLaunchpad> {
  const res = await fetch('/api/sponsors/launchpad', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.launchpad;
}

export interface SponsorPortfolioAnalytics {
  meaningfulMatches: number;
  highMatches: number;
  inquiriesSent: number;
  activeDeals: number;
  negotiations: number;
  contracts: number;
  paidDeals: number;
  completedDeals: number;
  committedSpend: number;
  paidSpend: number;
  sponsorRequests: number;
  organizerResponses: number;
  acceptedRequestResponses: number;
}

export async function fetchSponsorPortfolioAnalytics(): Promise<SponsorPortfolioAnalytics> {
  const res = await fetch('/api/sponsors/analytics/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.analytics;
}
