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
