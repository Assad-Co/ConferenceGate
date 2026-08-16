import { AbstractSubmission } from '../types';

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export interface CreateSubmissionPayload {
  conferenceId: string;
  conferenceTitle: string;
  title: string;
  track: string;
  topic: string;
  keywords: string[];
  abstractText: string;
  preferredType: 'Oral' | 'Poster';
  primaryAuthor: { name: string; email: string; affiliation: string; bio: string };
  coAuthors: Array<{ name: string; affiliation: string; email: string }>;
  conflictOfInterest: string;
}

export interface SubmitReviewPayload {
  scores: Record<string, number>;
  commentsToAuthor: string;
  confidentialComments: string;
  recommendation: string;
}

export interface ConferenceRegistration {
  conferenceId: string;
  conferenceTitle: string;
  packageId: string | null;
  packageName: string | null;
  registeredAt: string;
}

export async function fetchSubmissions(): Promise<AbstractSubmission[]> {
  const res = await fetch('/api/activity/submissions', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.submissions;
}

export async function createSubmission(payload: CreateSubmissionPayload): Promise<AbstractSubmission> {
  const res = await fetch('/api/activity/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export async function submitReview(submissionId: string, payload: SubmitReviewPayload): Promise<AbstractSubmission> {
  const res = await fetch(`/api/activity/submissions/${submissionId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export async function volunteerForReview(opportunityId: string, conferenceTitle: string, topic: string): Promise<void> {
  const res = await fetch('/api/activity/reviews/volunteer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ opportunityId, conferenceTitle, topic }),
  });
  await parseResponse(res);
}

export async function fetchMyVolunteeredOpportunityIds(): Promise<string[]> {
  const res = await fetch('/api/activity/reviews/volunteers/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.opportunityIds;
}

export async function registerForConference(
  conferenceId: string,
  conferenceTitle: string,
  packageId: string,
  packageName: string
): Promise<void> {
  const res = await fetch('/api/activity/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ conferenceId, conferenceTitle, packageId, packageName }),
  });
  await parseResponse(res);
}

export async function fetchMyRegistrations(): Promise<ConferenceRegistration[]> {
  const res = await fetch('/api/activity/registrations/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.registrations;
}
